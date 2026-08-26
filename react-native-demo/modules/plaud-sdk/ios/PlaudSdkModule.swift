import ExpoModulesCore
import PlaudDeviceBasicSDK
import PlaudBleSDK

// MARK: - Typed argument records

struct InitOptions: Record {
  @Field var userAccessToken: String = ""
  @Field var customDomain: String = ""
  @Field var userId: String?
}

struct ConnectOptions: Record {
  @Field var uuid: String?
  @Field var serialNumber: String?
  @Field var deviceToken: String?
}

struct DepairOptions: Record {
  @Field var clear: Bool = true
}

struct FileListOptions: Record {
  @Field var startSessionId: Int = 0
}

struct ExportOptions: Record {
  @Field var sessionId: Int = -1
  @Field var format: String = "mp3"
  @Field var channels: Int = 1
}

// Wi-Fi fast transfer arguments.

struct WifiTransferOptions: Record {
  @Field var userId: String?
}

struct WifiDeleteOptions: Record {
  @Field var sessionIds: [Int] = []
}

// MARK: - Shared export helpers

/// `Documents/PlaudExports` — where both the BLE and the Wi-Fi export path write, so JS-side path
/// handling doesn't care which transport produced a file.
func plaudExportsDirectory() -> URL {
  let dir = FileManager.default
    .urls(for: .documentDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("PlaudExports", isDirectory: true)
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  return dir
}

/// Maps the JS format string onto the SDK enum, defaulting to mp3 — the only format that is both
/// playable by AVAudioPlayer and accepted by the transcription API.
func plaudExportFormat(from raw: String?) -> AudioExportFormat {
  switch (raw ?? "mp3").lowercased() {
  case "pcm": return .pcm
  case "wav": return .wav
  case "opus": return .opus
  default: return .mp3
  }
}

/// Expo module bridging Plaud's native iOS SDK. This is the RN counterpart of the
/// Capacitor `PlaudSdk` plugin (PlaudSdkPlugin.swift). Expo's `Module` base class isn't
/// `NSObject`-derived, so it can't itself conform to the `@objc PlaudDeviceAgentProtocol`;
/// all SDK interaction and delegate handling lives in `PlaudSdkController` (an NSObject),
/// which emits results back to JS through the closure the module hands it. The Wi-Fi
/// fast-transfer session has its own `NSObject` for the same reason — `PlaudWifiController`.
///
/// Surface (mirrors the Capacitor plugin, minus the `readFile`/`putBinary` CORS shims that
/// only existed because Capacitor loaded a remote-origin WebView — RN has no such
/// constraint and reads exports with expo-file-system / uploads with fetch):
/// connection lifecycle, file listing, on-device audio export, and Wi-Fi fast transfer.
public class PlaudSdkModule: Module {
  private lazy var wifi = PlaudWifiController { [weak self] event, body in
    DispatchQueue.main.async { self?.sendEvent(event, body) }
  }

  private lazy var controller = PlaudSdkController(wifi: self.wifi) { [weak self] event, body in
    // Hop to the main queue before crossing into JS, as the Capacitor plugin's `notify` did —
    // SDK delegate callbacks can arrive on arbitrary threads.
    DispatchQueue.main.async { self?.sendEvent(event, body) }
  }

  public func definition() -> ModuleDefinition {
    Name("PlaudSdk")

    Events(
      "scanResult", "scanTimeout", "connectState", "penState", "bind", "fileList",
      "exportProgress", "recordStart", "recordStop", "recordPause", "recordResume", "depair",
      // Wi-Fi fast transfer. Both platforms declare and emit the same set.
      "wifiState", "wifiFileList", "wifiTransferProgress",
      "wifiDeleteComplete", "wifiBattery", "wifiError"
    )

    AsyncFunction("initSDK") { (options: InitOptions, promise: Promise) in
      self.controller.initSDK(options, promise: promise)
    }

    AsyncFunction("startScan") { (promise: Promise) in
      self.controller.startScan(promise: promise)
    }

    AsyncFunction("stopScan") { (promise: Promise) in
      self.controller.stopScan(promise: promise)
    }

    AsyncFunction("connectBleDevice") { (options: ConnectOptions, promise: Promise) in
      self.controller.connectBleDevice(options, promise: promise)
    }

    AsyncFunction("disconnect") { (promise: Promise) in
      self.controller.disconnect(promise: promise)
    }

    AsyncFunction("depair") { (options: DepairOptions?, promise: Promise) in
      self.controller.depair(options ?? DepairOptions(), promise: promise)
    }

    AsyncFunction("isConnected") { (promise: Promise) in
      self.controller.isConnected(promise: promise)
    }

    AsyncFunction("getFileList") { (options: FileListOptions?, promise: Promise) in
      self.controller.getFileList(options ?? FileListOptions(), promise: promise)
    }

    AsyncFunction("exportAudio") { (options: ExportOptions, promise: Promise) in
      self.controller.exportAudio(options, promise: promise)
    }

    // MARK: - Wi-Fi fast transfer
    //
    // The recorder brings up its own Wi-Fi AP and files come across a local WebSocket instead of
    // BLE. Needs the `com.apple.developer.networking.HotspotConfiguration` / `.wifi-info`
    // entitlements, `NSLocalNetworkUsageDescription`, `NSLocationWhenInUseUsageDescription`, and
    // granted When-In-Use location — see the module README.

    AsyncFunction("startWifiTransfer") { (options: WifiTransferOptions?, promise: Promise) in
      self.wifi.startWifiTransfer(options, promise: promise)
    }

    AsyncFunction("stopWifiTransfer") { (promise: Promise) in
      self.wifi.stopWifiTransfer(promise: promise)
    }

    AsyncFunction("isWifiTransferActive") { (promise: Promise) in
      self.wifi.isWifiTransferActive(promise: promise)
    }

    AsyncFunction("getWifiTransferState") { (promise: Promise) in
      self.wifi.getWifiTransferState(promise: promise)
    }

    AsyncFunction("getWifiFileList") { (promise: Promise) in
      self.wifi.getWifiFileList(promise: promise)
    }

    AsyncFunction("exportAudioViaWiFi") { (options: ExportOptions, promise: Promise) in
      self.wifi.exportAudioViaWiFi(options, promise: promise)
    }

    AsyncFunction("deleteWifiFiles") { (options: WifiDeleteOptions, promise: Promise) in
      self.wifi.deleteWifiFiles(options, promise: promise)
    }

    OnDestroy {
      // A live Wi-Fi session holds an NEHotspotConfiguration and the SDK's local WebSocket
      // server. Leaking those across a JS reload leaves the handset joined to the recorder's AP
      // with no internet, so tear the session down before detaching the delegate.
      self.wifi.moduleWillDestroy()
      self.controller.detach()
    }
  }
}

/// Owns every interaction with `PlaudDeviceAgent`, holds the scan cache / in-flight export
/// bridges, and is the SDK's `PlaudDeviceAgentProtocol` delegate. Delegate callbacks are
/// forwarded to JS via `emit`, the closure supplied by the module (which calls `sendEvent`).
final class PlaudSdkController: NSObject, PlaudDeviceAgentProtocol {
  private let emit: (String, [String: Any?]) -> Void

  /// The Wi-Fi session owner. `bleWiFiOpen` arrives on this delegate but belongs to it.
  private let wifi: PlaudWifiController

  /// `connectBleDevice` needs the actual `BleDevice` the SDK handed us during a scan — JS
  /// only carries identifiers, so we retain scanned objects and look them up. Keyed by
  /// `uuid` (the CoreBluetooth peripheral id). Touched only on the main queue.
  private var scannedDevices: [String: BleDevice] = [:]

  /// Retains in-flight export bridges so neither they nor their `Promise` are deallocated
  /// before the SDK finishes. Touched only on the main queue.
  private var exportCallbacks: Set<ExportCallbackBridge> = []

  /// App-level user identifier from `initSDK`, reused as the default connect `deviceToken`
  /// (it's what binds the device to the user during the handshake).
  private var userId: String?

  private var scanReadyAttempts = 0
  private var isScanning = false

  init(wifi: PlaudWifiController, emit: @escaping (String, [String: Any?]) -> Void) {
    self.wifi = wifi
    self.emit = emit
    super.init()
  }

  // MARK: - Connection lifecycle

  func initSDK(_ options: InitOptions, promise: Promise) {
    guard !options.userAccessToken.isEmpty else {
      promise.reject("ERR_PLAUD_ARGS", "userAccessToken is required")
      return
    }
    guard !options.customDomain.isEmpty else {
      promise.reject("ERR_PLAUD_ARGS", "customDomain is required (domain only, no https://)")
      return
    }
    let userId = options.userId
    DispatchQueue.main.async {
      self.userId = userId
      self.wifi.userId = userId
      let agent = PlaudDeviceAgent.shared
      agent.delegate = self
      agent.initSDK(userAccessToken: options.userAccessToken, customDomain: options.customDomain)
      promise.resolve(nil)
    }
  }

  /// Release the process-wide delegate on module teardown, but only if it is still ours.
  func detach() {
    if PlaudDeviceAgent.shared.delegate === self {
      PlaudDeviceAgent.shared.delegate = nil
    }
  }

  func startScan(promise: Promise) {
    DispatchQueue.main.async {
      // CoreBluetooth silently drops scanForPeripherals until the central manager reaches
      // .poweredOn (async after initSDK, gated on the first-launch permission prompt), so
      // gate the real scan on the power-on state — same as the Capacitor plugin.
      self.isScanning = true
      self.scanReadyAttempts = 0
      self.attemptScanWhenReady()
      promise.resolve(nil)
    }
  }

  /// Fires the SDK scan once Bluetooth is powered on, polling ~18s. Main queue only.
  private func attemptScanWhenReady() {
    guard isScanning else { return }
    if BleAgent.shared.isPoweredOn {
      PlaudDeviceAgent.shared.startScan()
      return
    }
    scanReadyAttempts += 1
    if scanReadyAttempts > 60 {
      emit("scanTimeout", ["reason": "bluetoothNotPoweredOn"])
      return
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
      self?.attemptScanWhenReady()
    }
  }

  func stopScan(promise: Promise) {
    DispatchQueue.main.async {
      self.isScanning = false
      PlaudDeviceAgent.shared.stopScan()
      promise.resolve(nil)
    }
  }

  func connectBleDevice(_ options: ConnectOptions, promise: Promise) {
    // The app always connects with a device token (the app-level userId) so the handshake
    // binds the device to the user. Prefer an explicit token, else the remembered userId.
    let token = options.deviceToken ?? self.userId
    DispatchQueue.main.async {
      self.isScanning = false
      guard let device = self.lookupDevice(uuid: options.uuid, serialNumber: options.serialNumber) else {
        promise.reject("ERR_PLAUD_UNKNOWN_DEVICE",
                       "Unknown device — scan first, then connect by uuid or serialNumber")
        return
      }
      if let token = token, !token.isEmpty {
        PlaudDeviceAgent.shared.connectBleDevice(bleDevice: device, deviceToken: token)
      } else {
        PlaudDeviceAgent.shared.connectBleDevice(bleDevice: device)
      }
      promise.resolve(nil)
    }
  }

  func disconnect(promise: Promise) {
    DispatchQueue.main.async {
      PlaudDeviceAgent.shared.disconnect()
      promise.resolve(nil)
    }
  }

  func depair(_ options: DepairOptions, promise: Promise) {
    DispatchQueue.main.async {
      PlaudDeviceAgent.shared.depair(clear: options.clear)
      promise.resolve(nil)
    }
  }

  func isConnected(promise: Promise) {
    DispatchQueue.main.async {
      promise.resolve(["connected": PlaudDeviceAgent.shared.isConnected()])
    }
  }

  // MARK: - Files

  func getFileList(_ options: FileListOptions, promise: Promise) {
    DispatchQueue.main.async {
      PlaudDeviceAgent.shared.getFileList(startSessionId: options.startSessionId)
      promise.resolve(nil)
    }
  }

  /// Decode a recording to Documents/PlaudExports. Resolves `{ sessionId, outputPath }` on
  /// completion; emits `exportProgress` along the way. `format` defaults to mp3.
  func exportAudio(_ options: ExportOptions, promise: Promise) {
    guard options.sessionId >= 0 else {
      promise.reject("ERR_PLAUD_ARGS", "sessionId is required")
      return
    }
    let format = plaudExportFormat(from: options.format)
    let channels = options.channels
    let sessionId = options.sessionId
    DispatchQueue.main.async {
      let bridge = ExportCallbackBridge(
        sessionId: sessionId,
        promise: promise,
        emit: self.emit
      ) { [weak self] finished in
        DispatchQueue.main.async { self?.exportCallbacks.remove(finished) }
      }
      self.exportCallbacks.insert(bridge)
      PlaudDeviceAgent.shared.exportAudio(
        sessionId: sessionId,
        outputDir: plaudExportsDirectory().path,
        format: format,
        channels: channels,
        callback: bridge
      )
    }
  }

  // MARK: - PlaudDeviceAgentProtocol

  func blePenState(state: Int, privacy: Int, keyState: Int, uDisk: Int,
                   findMyToken: Int, hasSndpKey: Int, deviceAccessToken: Int) {
    emit("penState", [
      "state": state, "privacy": privacy, "keyState": keyState, "uDisk": uDisk,
      "findMyToken": findMyToken, "hasSndpKey": hasSndpKey, "deviceAccessToken": deviceAccessToken
    ])
  }

  func bleScanResult(bleDevices: [BleDevice]) {
    DispatchQueue.main.async {
      for d in bleDevices { self.scannedDevices[d.uuid] = d }
    }
    let devices = bleDevices.map { d -> [String: Any] in
      [
        "name": d.name,
        "uuid": d.uuid,
        "serialNumber": d.serialNumber,
        "rssi": d.rssi,
        "supportWiFi": d.supportWiFi
      ]
    }
    emit("scanResult", ["devices": devices])
  }

  func bleScanOverTime() {
    emit("scanTimeout", [:])
  }

  func bleConnectState(state: Int) {
    // 1 = connected, 0 = disconnected, {2, -1, -2} = connection/handshake failure.
    let failed = (state == 2 || state == -1 || state == -2)
    emit("connectState", ["connected": state == 1, "failed": failed, "state": state])
  }

  func bleBind(sn: String?, status: Int, protVersion: Int, timezone: Int) {
    emit("bind", ["sn": sn, "status": status, "protVersion": protVersion])
  }

  /// The recorder has brought up (or failed to bring up) its Wi-Fi AP, and this carries the
  /// credentials for it. It belongs to the Wi-Fi session, so hand it straight over.
  func bleWiFiOpen(_ status: Int, _ wifiName: String, _ wholeName: String, _ wifiPass: String) {
    wifi.handleBleWiFiOpen(status: status,
                           wifiName: wifiName,
                           wholeName: wholeName,
                           wifiPass: wifiPass)
  }

  // MARK: - Recording (device-initiated: physical button / VAD)

  func bleRecordStart(sessionId: Int, start: Int, status: Int, scene: Int,
                      startTime: Int, reason: Int) {
    emit("recordStart", [
      "sessionId": sessionId, "start": start, "status": status,
      "scene": scene, "startTime": startTime, "reason": reason
    ])
  }

  func bleRecordStop(sessionId: Int, reason: Int, fileExist: Bool, fileSize: Int) {
    emit("recordStop", [
      "sessionId": sessionId, "reason": reason, "fileExist": fileExist, "fileSize": fileSize
    ])
  }

  func bleRecordPause(sessionId: Int, reason: Int, fileExist: Bool, fileSize: Int) {
    emit("recordPause", [
      "sessionId": sessionId, "reason": reason, "fileExist": fileExist, "fileSize": fileSize
    ])
  }

  func bleRecordResume(sessionId: Int, start: Int, status: Int, scene: Int, startTime: Int) {
    emit("recordResume", [
      "sessionId": sessionId, "start": start, "status": status,
      "scene": scene, "startTime": startTime
    ])
  }

  func bleDepair(_ status: Int) {
    emit("depair", ["status": status])
  }

  func bleFileList(bleFiles: [BleFile]) {
    let files = bleFiles.map { f -> [String: Any] in
      [
        "sn": f.sn,
        "sessionId": f.sessionId,
        "size": f.size,
        "scenes": f.scenes,
        "channels": f.channels,
        "isOgg": f.isOgg,
        "isMusic": f.isMusic,
        "duration": f.duration()
      ]
    }
    emit("fileList", ["files": files])
  }

  // MARK: - Helpers

  private func lookupDevice(uuid: String?, serialNumber: String?) -> BleDevice? {
    if let uuid = uuid, let d = scannedDevices[uuid] { return d }
    if let serial = serialNumber {
      return scannedDevices.values.first { $0.serialNumber == serial }
    }
    return nil
  }
}

/// Adapts the SDK's per-call `AudioExportCallback` to the module: progress becomes an
/// `exportProgress` event, completion/error resolves/rejects the originating Promise. Shared by
/// the BLE and the Wi-Fi export path — the Wi-Fi one additionally reports throughput, which is
/// what lets the two produce identical results from a JS point of view.
final class ExportCallbackBridge: NSObject, AudioExportCallback {
  private let sessionId: Int
  private let promise: Promise
  private let emit: (String, [String: Any?]) -> Void
  private let emitsWifiProgress: Bool
  private let onFinish: (ExportCallbackBridge) -> Void

  init(sessionId: Int,
       promise: Promise,
       emit: @escaping (String, [String: Any?]) -> Void,
       emitsWifiProgress: Bool = false,
       onFinish: @escaping (ExportCallbackBridge) -> Void) {
    self.sessionId = sessionId
    self.promise = promise
    self.emit = emit
    self.emitsWifiProgress = emitsWifiProgress
    self.onFinish = onFinish
  }

  func onProgress(_ progress: Int, message: String) {
    emit("exportProgress", [
      "sessionId": sessionId, "progress": progress, "message": message
    ])
    guard emitsWifiProgress else { return }
    // 100 means the transfer is done and the local decode/transcode has begun, so there is no
    // meaningful throughput left to report.
    let converting = progress >= 100
    emit("wifiTransferProgress", [
      "sessionId": sessionId,
      "progress": progress,
      "speedKBps": converting ? 0 : PlaudWiFiAgent.shared.currentDownloadSpeedKBps
    ])
  }

  func onComplete(outputPath: String) {
    promise.resolve(["sessionId": sessionId, "outputPath": outputPath])
    onFinish(self)
  }

  func onError(_ error: String) {
    promise.reject("ERR_PLAUD_EXPORT", error)
    onFinish(self)
  }
}
