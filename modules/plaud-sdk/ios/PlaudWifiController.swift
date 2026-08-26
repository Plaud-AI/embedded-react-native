import CoreLocation
import ExpoModulesCore
import PlaudBleSDK
import PlaudDeviceBasicSDK

/// Owns an iOS Wi-Fi fast-transfer session end to end.
///
/// Instead of streaming a recording over BLE, the recorder brings up its own Wi-Fi AP; the phone
/// joins it and the device dials back into a local WebSocket the SDK runs. It is dramatically
/// faster, and `exportAudioViaWiFi` resolves the same `{ sessionId, outputPath }` as the BLE
/// `exportAudio`, so an export call site switches paths by changing the method name alone.
///
/// This is a separate `NSObject` for the same reason `PlaudSdkController` is one — Expo's `Module`
/// isn't `NSObject`-derived, so it can't conform to `@objc PlaudWiFiAgentProtocol`. Results reach
/// JS through `emit`, the closure the module hands in.
///
/// Where Android's SDK exposes a single `IWifiTransferAgent` with a `WifiConnectionState` enum,
/// iOS gives us a handful of lower-level callbacks and no state type at all, so the
/// `PlaudWifiState` strings JS sees are derived and tracked here. The call sequence and its
/// timings mirror the Plaud iOS reference app (`plaud-sdk-public` → `SyncManager.swift`); the
/// comments below record the parts that are load-bearing.
final class PlaudWifiController: NSObject {
  private let emit: (String, [String: Any?]) -> Void

  /// App-level user identifier from `initSDK`, the fallback handshake identity. iOS never sends it
  /// (nothing in the Wi-Fi flow takes a user id — `getFileList` wants a request tag), but it is
  /// still validated so a missing id fails the same way it would on Android instead of only
  /// surfacing once the app is tried on a handset.
  var userId: String?

  /// The current `PlaudWifiState`, tracked because the iOS SDK has nothing to ask.
  private var state = "none"

  /// True between `startWifiTransfer` and teardown. Every delegate callback is gated on it so a
  /// late arrival from a finished session can't resurrect one, and so teardown runs exactly once.
  private var expectingCallbacks = false

  /// One-shot guard for the automatic file-list request — the SDK never fetches it itself.
  private var fileListRequested = false

  /// Start deferred until the Location prompt is answered. `NEHotspotConfiguration` needs
  /// When-In-Use location, so a first run has to wait for the user before touching BLE.
  private var pendingStart: (userId: String?, promise: Promise)?

  /// Retains in-flight export bridges so neither they nor their `Promise` are deallocated before
  /// the SDK finishes. Touched only on the main queue.
  private var exportBridges: Set<ExportCallbackBridge> = []

  /// iOS confirms deletes one file at a time (`wifiFileDelete`), but JS's `wifiDeleteComplete` is
  /// per batch, so the outstanding ids are tracked until the batch is settled.
  private var pendingDeletes: Set<Int> = []
  private var deleteTotal = 0
  private var deleteFailures = 0
  private var deleteTimeout: DispatchWorkItem?

  private var connectWatchdog: DispatchWorkItem?
  private lazy var locationManager = CLLocationManager()

  /// The SDK's own join budget is 180s; the watchdog gives it a little slack before giving up.
  private static let connectTimeout: TimeInterval = 185

  /// The device needs a moment after it reports its AP up — joining immediately fails.
  private static let hotspotSettleDelay: TimeInterval = 3.0

  /// How long to wait for delete confirmations before reporting the batch with what we have.
  private static let deleteTimeoutSeconds: TimeInterval = 4.0

  init(emit: @escaping (String, [String: Any?]) -> Void) {
    self.emit = emit
    super.init()
  }

  // MARK: - Session lifecycle

  func startWifiTransfer(_ options: WifiTransferOptions?, promise: Promise) {
    let requested = options?.userId
    DispatchQueue.main.async {
      self.beginTransfer(userId: requested ?? self.userId, promise: promise)
    }
  }

  /// Main queue only. Re-entered from `locationManagerDidChangeAuthorization` once the user has
  /// answered the Location prompt.
  private func beginTransfer(userId: String?, promise: Promise) {
    guard let userId = userId, !userId.isEmpty else {
      promise.reject("ERR_PLAUD_ARGS", "userId is required — pass it here or set it in initSDK")
      return
    }

    // The Location gate comes first, before anything touches BLE: iOS requires When-In-Use
    // location for NEHotspotConfiguration, and without it the join fails with no useful reason.
    switch locationManager.authorizationStatus {
    case .notDetermined:
      pendingStart = (userId, promise)
      locationManager.delegate = self
      locationManager.requestWhenInUseAuthorization()
      return
    case .denied, .restricted:
      promise.reject(
        "ERR_PLAUD_WIFI_PREREQ",
        "Wi-Fi transfer needs Location access to join the recorder's hotspot — enable it in Settings"
      )
      return
    default:
      break
    }

    // The SDK lifts its session keys off the BLE link when the transfer begins.
    guard PlaudDeviceAgent.shared.isConnected() else {
      promise.reject("ERR_PLAUD_WIFI_PREREQ",
                     "Wi-Fi transfer needs a live BLE connection — connect the device first")
      return
    }
    guard !expectingCallbacks, !PlaudDeviceAgent.shared.isWiFiTransferActive else {
      promise.reject("ERR_PLAUD_WIFI",
                     "Wi-Fi transfer could not be started — one is already active")
      return
    }

    expectingCallbacks = true
    fileListRequested = false
    resetDeleteBatch()

    // Hand the radio over. A BLE download still in flight makes the device answer the open-AP
    // command with a busy status, and the join then fails.
    PlaudDeviceAgent.shared.stopDownloadFile()

    PlaudWiFiAgent.shared.delegate = self
    // No SDK callback produces this phase — it covers the BLE open-AP command being in flight.
    setState("openingHotspot")
    PlaudDeviceAgent.shared.setDeviceWiFi(open: true)
    armConnectWatchdog()

    // Resolving means *started*, not usable: JS waits for `wifiState` to reach "ready".
    promise.resolve(nil)
  }

  func stopWifiTransfer(promise: Promise) {
    DispatchQueue.main.async {
      self.teardown(finalState: "stopped")
      promise.resolve(nil)
    }
  }

  func isWifiTransferActive(promise: Promise) {
    DispatchQueue.main.async {
      promise.resolve(["active": self.expectingCallbacks])
    }
  }

  func getWifiTransferState(promise: Promise) {
    DispatchQueue.main.async {
      promise.resolve(["state": self.state])
    }
  }

  /// Called by the module when it is torn down (a JS reload, say). Without this the handset is
  /// left joined to the recorder's AP with no internet, and the recorder sits in Wi-Fi mode until
  /// its firmware times out.
  func moduleWillDestroy() {
    teardown(finalState: "stopped")
  }

  // MARK: - Files

  func getWifiFileList(promise: Promise) {
    DispatchQueue.main.async {
      guard self.isReady else {
        promise.reject("ERR_PLAUD_WIFI_NOT_READY", Self.notReady("file list"))
        return
      }
      self.requestFileList()
      promise.resolve(nil)
    }
  }

  /// The Wi-Fi counterpart of `exportAudio` — same options, same `exportProgress` events, same
  /// `PlaudExports` output dir, same resolved shape. Additionally emits `wifiTransferProgress`
  /// with the live throughput.
  func exportAudioViaWiFi(_ options: ExportOptions, promise: Promise) {
    guard options.sessionId >= 0 else {
      promise.reject("ERR_PLAUD_ARGS", "sessionId is required")
      return
    }
    let format = plaudExportFormat(from: options.format)
    let channels = options.channels
    let sessionId = options.sessionId
    DispatchQueue.main.async {
      guard self.isReady else {
        promise.reject("ERR_PLAUD_WIFI_NOT_READY", Self.notReady("export"))
        return
      }
      let bridge = ExportCallbackBridge(
        sessionId: sessionId,
        promise: promise,
        emit: self.emit,
        emitsWifiProgress: true
      ) { [weak self] finished in
        DispatchQueue.main.async { self?.exportBridges.remove(finished) }
      }
      self.exportBridges.insert(bridge)
      PlaudWiFiAgent.shared.exportAudioViaWiFi(
        sessionId: sessionId,
        outputDir: plaudExportsDirectory().path,
        format: format,
        channels: channels,
        callback: bridge
      )
    }
  }

  /// Delete recordings from the device. Only ever call this once every transfer in the session has
  /// finished — a delete between two exports disrupts the WebSocket and stalls the next file.
  func deleteWifiFiles(_ options: WifiDeleteOptions, promise: Promise) {
    guard !options.sessionIds.isEmpty else {
      promise.reject("ERR_PLAUD_ARGS", "sessionIds must not be empty")
      return
    }
    let ids = options.sessionIds
    DispatchQueue.main.async {
      guard self.isReady else {
        promise.reject("ERR_PLAUD_WIFI_NOT_READY", Self.notReady("delete"))
        return
      }
      self.pendingDeletes = Set(ids)
      self.deleteTotal = ids.count
      self.deleteFailures = 0
      for id in ids { PlaudWiFiAgent.shared.deleteFile(id, 1) }

      // The device doesn't reliably answer every delete. Report the batch with what arrived
      // rather than leaving JS waiting on an event that never comes.
      let work = DispatchWorkItem { [weak self] in
        guard let self = self, !self.pendingDeletes.isEmpty else { return }
        self.deleteFailures += self.pendingDeletes.count
        self.pendingDeletes.removeAll()
        self.finishDeleteBatch()
      }
      self.deleteTimeout = work
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.deleteTimeoutSeconds, execute: work)

      promise.resolve(nil)
    }
  }

  // MARK: - BLE-side callback, forwarded by PlaudSdkController

  /// `bleWiFiOpen` is delivered on `PlaudDeviceAgentProtocol`, so the BLE controller receives it
  /// and hands it over here. It carries the credentials for the AP the recorder just brought up.
  func handleBleWiFiOpen(status: Int, wifiName: String, wholeName: String, wifiPass: String) {
    DispatchQueue.main.async {
      guard self.expectingCallbacks else { return }
      guard status == 0 else {
        self.failSession(1002, "The recorder could not open its Wi-Fi hotspot (status \(status))")
        return
      }
      self.setState("connecting")

      // The SDK's own docs are explicit that the BLE device is handed over *here*, in the
      // open-AP callback, rather than when the session starts.
      PlaudWiFiAgent.shared.bleDevice = BleAgent.shared.bleDevice
      PlaudWiFiAgent.shared.delegate = self

      // `wholeName` is the full SSID; `wifiName` is a short form that will not join.
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.hotspotSettleDelay) { [weak self] in
        guard let self = self, self.expectingCallbacks else { return }
        PlaudWiFiAgent.shared.connectWifi(wholeName, wifiPass, 180)
        self.armConnectWatchdog()
      }
    }
  }

  // MARK: - Helpers

  private var isReady: Bool { state == "ready" || state == "handshakeCompleted" }

  private static func notReady(_ what: String) -> String {
    "Wi-Fi transfer is not ready — wait for the wifiState \"ready\" event before requesting the \(what)"
  }

  private func setState(_ next: String) {
    state = next
    emit("wifiState", ["state": next])
  }

  private func emitError(_ code: Int, _ message: String) {
    emit("wifiError", ["code": code, "message": message])
  }

  private func failSession(_ code: Int, _ message: String) {
    emitError(code, message)
    teardown(finalState: "error")
  }

  /// `READY` and the handshake can't both be observed on iOS, so the list is requested from the
  /// one callback that means "channel usable", behind a guard in case JS also asks.
  private func requestFileListOnce() {
    guard !fileListRequested else { return }
    fileListRequested = true
    requestFileList()
  }

  private func requestFileList() {
    // `uid` is just a request tag, `0` means "from the beginning", `single: false` means "all".
    PlaudWiFiAgent.shared.getFileList(Int(Date().timeIntervalSince1970), 0, false)
  }

  private func armConnectWatchdog() {
    cancelConnectWatchdog()
    let work = DispatchWorkItem { [weak self] in
      guard let self = self, self.expectingCallbacks, !self.isReady else { return }
      self.failSession(1003, "Timed out joining the recorder's Wi-Fi — move closer and try again")
    }
    connectWatchdog = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.connectTimeout, execute: work)
  }

  private func cancelConnectWatchdog() {
    connectWatchdog?.cancel()
    connectWatchdog = nil
  }

  private func resetDeleteBatch() {
    deleteTimeout?.cancel()
    deleteTimeout = nil
    pendingDeletes.removeAll()
    deleteTotal = 0
    deleteFailures = 0
  }

  private func finishDeleteBatch() {
    deleteTimeout?.cancel()
    deleteTimeout = nil
    let failed = deleteFailures
    let deleted = max(0, deleteTotal - failed)
    emit("wifiDeleteComplete", [
      "success": failed == 0,
      "count": deleted,
      "error": failed == 0 ? nil : "\(failed) recording(s) could not be deleted"
    ])
    deleteTotal = 0
    deleteFailures = 0
  }

  /// Full teardown, phone side and device side. Runs at most once per session.
  private func teardown(finalState: String) {
    cancelConnectWatchdog()
    resetDeleteBatch()
    fileListRequested = false
    exportBridges.removeAll()
    pendingStart = nil
    guard expectingCallbacks else { return }
    expectingCallbacks = false
    // Order matters: ask the device to drop its AP over BLE first, then release the phone side.
    // `disconnect()` removes the NEHotspotConfiguration, after which iOS rejoins the network the
    // phone was on before.
    PlaudDeviceAgent.shared.setDeviceWiFi(open: false)
    PlaudDeviceAgent.shared.endWiFiTransfer()
    PlaudWiFiAgent.shared.disconnect()
    PlaudWiFiAgent.shared.delegate = nil
    setState(finalState)
  }

  /// The device ended the session on its own. `endWiFiTransfer` already asks it to close its AP,
  /// and a second `setDeviceWiFi(open: false)` can make it answer with an error status — so this
  /// path deliberately releases only the phone side.
  private func handleDeviceClose(finalState: String) {
    cancelConnectWatchdog()
    resetDeleteBatch()
    fileListRequested = false
    exportBridges.removeAll()
    guard expectingCallbacks else { return }
    expectingCallbacks = false
    PlaudDeviceAgent.shared.endWiFiTransfer()
    PlaudWiFiAgent.shared.disconnect()
    PlaudWiFiAgent.shared.delegate = nil
    setState(finalState)
  }
}

// MARK: - CLLocationManagerDelegate

extension PlaudWifiController: CLLocationManagerDelegate {
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard let pending = pendingStart, manager.authorizationStatus != .notDetermined else { return }
    pendingStart = nil
    beginTransfer(userId: pending.userId, promise: pending.promise)
  }
}

// MARK: - PlaudWiFiAgentProtocol
//
// Every method is optional on the SDK side; the ones left out here carry no information JS needs
// (raw byte plumbing, rate tests, device logs, OTA). Callbacks arrive on arbitrary threads, so
// each hops to the main queue before touching state.

extension PlaudWifiController: PlaudWiFiAgentProtocol {
  func wifiConnectionStatus(_ ssid: String, _ connected: Bool) {
    DispatchQueue.main.async {
      guard self.expectingCallbacks, connected else { return }
      self.setState("connected")
    }
  }

  /// Join result from `NEHotspotConfiguration`, with the real iOS reason attached.
  func wifiConnectResult(_ success: Bool, _ errorCode: Int, _ message: String) {
    DispatchQueue.main.async {
      guard self.expectingCallbacks, !success else { return }
      // `wifiHandshake(0)` is the authority on "channel usable". Once past the connect phase a
      // join-failure callback is stale, and acting on it would flip a working transfer to failed.
      guard self.state == "openingHotspot" || self.state == "connecting" else { return }
      let reason = message.isEmpty ? "Could not join the recorder's hotspot (\(errorCode))" : message
      self.failSession(1003, reason)
    }
  }

  func wifiHandshake(_ status: Int) {
    DispatchQueue.main.async {
      guard self.expectingCallbacks else { return }
      self.cancelConnectWatchdog()
      guard status == 0 else {
        self.failSession(1004, "Wi-Fi handshake failed (status \(status))")
        return
      }
      // Android reports these as two steps; both are emitted here so the JS state machine sees
      // the same sequence on either platform.
      self.state = "handshakeCompleted"
      self.emit("wifiState", [
        "state": "handshakeCompleted",
        "session": PlaudWiFiAgent.shared.getCurrentWiFiName()
      ])
      self.setState("ready")
      self.requestFileListOnce()
    }
  }

  func wifiFileList(_ files: [BleFile]) {
    let mapped = files.map { f -> [String: Any] in
      [
        "sessionId": f.sessionId,
        // iOS carries no device-supplied name (Android's WifiFileInfo does), so synthesise a
        // stable one from the fields that identify the recording.
        "fileName": "\(f.sn)-\(f.sessionId)",
        "fileSize": f.size,
        "duration": f.duration() / 1000,  // SDK milliseconds -> JS seconds
        "timestamp": f.sessionId * 1000,  // sessionId is the recording's unix timestamp
        "scene": f.scenes
      ]
    }
    emit("wifiFileList", ["files": mapped])
  }

  func wifiFileListFail(_ status: Int) {
    DispatchQueue.main.async {
      guard self.expectingCallbacks else { return }
      // Not fatal to the session — let the one-shot guard go so JS can retry with
      // `getWifiFileList`.
      self.fileListRequested = false
      self.emitError(3000, "Could not read the recording list over Wi-Fi (status \(status))")
    }
  }

  func wifiFileDelete(_ sessionId: Int, _ status: Int) {
    DispatchQueue.main.async {
      guard self.pendingDeletes.remove(sessionId) != nil else { return }
      if status != 0 { self.deleteFailures += 1 }
      if self.pendingDeletes.isEmpty { self.finishDeleteBatch() }
    }
  }

  /// Battery piggy-backed on the Wi-Fi heartbeat. iOS carries no charging flag, so it reports
  /// false — the shape is kept identical to Android's.
  func wifiPower(_ power: Int, _ voltage: Int) {
    emit("wifiBattery", ["level": power, "charging": false])
  }

  func wifiClientFail() {
    DispatchQueue.main.async {
      guard self.expectingCallbacks else { return }
      // The SDK's docs require this so the BLE layer stops believing Wi-Fi is up.
      BleAgent.shared.setWiFiState(false)
      self.emitError(1006, "The recorder's Wi-Fi connection dropped")
    }
  }

  func wifiClose(_ status: Int) {
    DispatchQueue.main.async {
      guard self.expectingCallbacks else { return }
      guard status != 1000 else {
        // A clean WebSocket close: the device finished the session on its own terms. This is the
        // normal ending, including "there was nothing to transfer".
        self.handleDeviceClose(finalState: "stopped")
        return
      }
      switch status {
      case -1:
        self.emitError(1006, "The Wi-Fi connection failed")
      case -2:
        self.emitError(1003, "Timed out waiting to join the recorder's hotspot")
      case -3:
        self.emitError(1003, "iOS refused the hotspot configuration — check Location access and the "
                       + "Hotspot Configuration entitlement")
      default:
        self.emitError(1006, "The Wi-Fi session closed unexpectedly (status \(status))")
      }
      self.handleDeviceClose(finalState: "disconnected")
    }
  }

  func wifiCommonErr(_ cmd: Int, _ status: Int) {
    DispatchQueue.main.async {
      guard self.expectingCallbacks else { return }
      self.emitError(3001, "Wi-Fi command \(cmd) failed (status \(status))")
    }
  }
}
