import type { NativeModule } from 'expo-modules-core';

/** A device surfaced by the SDK's `bleScanResult` callback. */
export interface PlaudScanDevice {
  name: string;
  /**
   * Stable per-device identifier to pass back to `connectBleDevice`.
   * iOS: the CoreBluetooth peripheral UUID. Android: the device's MAC address.
   */
  uuid: string;
  serialNumber: string;
  rssi: number;
  /**
   * iOS only — the Android SDK's scan payload carries no Wi-Fi flag, so it is always `false` there.
   * Not a Wi-Fi-fast-transfer capability check: on Android, probe a connected device with
   * `getWifiTransferState()` / `startWifiTransfer()`.
   */
  supportWiFi: boolean;
}

export interface PlaudScanResult {
  devices: PlaudScanDevice[];
}

export interface PlaudConnectState {
  connected: boolean;
  /** True for connection/handshake failure (state 2/-1/-2), vs. a normal disconnect. */
  failed: boolean;
  state: number;
}

export interface PlaudPenState {
  state: number;
  privacy: number;
  keyState: number;
  uDisk: number;
  /** iOS only — Android's `blePenState` callback carries just the four fields above. */
  findMyToken?: number;
  /** iOS only. */
  hasSndpKey?: number;
  /** iOS only. */
  deviceAccessToken?: number;
}

/** A recording stored on the device, from the `fileList` event. */
export interface PlaudFile {
  sn: string;
  sessionId: number;
  size: number;
  scenes: number;
  channels: number;
  isOgg: boolean;
  isMusic: boolean;
  /**
   * Duration in seconds. On Android this is derived from the file size and channel count;
   * for OGG-contained recordings it is a slight over-estimate (see the module README).
   */
  duration: number;
}

export interface PlaudFileList {
  files: PlaudFile[];
}

export interface PlaudExportProgress {
  sessionId: number;
  progress: number;
  message: string;
}

/** Device-initiated recording started (physical button / VAD). */
export interface PlaudRecordStart {
  sessionId: number;
  start: number;
  status: number;
  scene: number;
  startTime: number;
  reason: number;
}

/** Device-initiated recording stopped/paused, with the resulting file info. */
export interface PlaudRecordStop {
  sessionId: number;
  reason: number;
  fileExist: boolean;
  fileSize: number;
}

/** Device-initiated recording resumed. */
export interface PlaudRecordResume {
  sessionId: number;
  start: number;
  status: number;
  scene: number;
  startTime: number;
}

export type PlaudAudioFormat = 'pcm' | 'mp3' | 'wav' | 'opus';

/**
 * Wi-Fi fast transfer session state, from the `wifiState` event.
 *
 * `openingHotspot` is reported by the module itself while the (slow) BLE command that brings up the
 * recorder's AP is in flight; the rest come from the SDK. `handshakeCompleted` and `ready` both mean
 * the session is usable — whichever arrives first triggers the automatic `wifiFileList` request.
 */
export type PlaudWifiState =
  | 'none'
  | 'openingHotspot'
  | 'connecting'
  | 'connected'
  | 'handshaking'
  | 'handshakeCompleted'
  | 'ready'
  | 'disconnected'
  | 'stopped'
  | 'error';

export interface PlaudWifiStateEvent {
  state: PlaudWifiState;
  /** Only on `handshakeCompleted` — the SDK's session identifier. */
  session?: string;
}

/** A recording on the device as reported over Wi-Fi, from the `wifiFileList` event. */
export interface PlaudWifiFile {
  sessionId: number;
  fileName: string;
  /** Bytes. */
  fileSize: number;
  /** Seconds — normalised from the SDK's milliseconds to match `PlaudFile.duration`. */
  duration: number;
  /** Milliseconds since the epoch — normalised from the SDK's seconds. */
  timestamp: number;
  scene: number;
}

export interface PlaudWifiFileList {
  files: PlaudWifiFile[];
}

export interface PlaudWifiTransferProgress {
  sessionId: number;
  /** 0-100, for the file currently transferring. */
  progress: number;
  /** Throughput in KB/s over the last second. */
  speedKBps: number;
}

/**
 * Wi-Fi session failure. `code` is a shared number so call sites can branch the same way on both
 * platforms: 1001 prerequisites not met, 1002 could not open the device AP, 1003 could not join it,
 * 1004/1006 handshake or connection failed, 1005 local port in use, 3000 not ready,
 * 3001 command rejected, 3005 storage error. Android passes the SDK's own codes straight through;
 * iOS maps its lower-level callbacks onto the same space.
 */
export interface PlaudWifiError {
  code: number;
  message: string;
}

/** Event name → listener signature. Consumed by `PlaudSdk.addListener(name, cb)`. */
export type PlaudSdkEvents = {
  scanResult: (data: PlaudScanResult) => void;
  scanTimeout: (data: { reason?: string }) => void;
  connectState: (data: PlaudConnectState) => void;
  penState: (data: PlaudPenState) => void;
  bind: (data: { sn: string | null; status: number; protVersion: number }) => void;
  fileList: (data: PlaudFileList) => void;
  exportProgress: (data: PlaudExportProgress) => void;
  recordStart: (data: PlaudRecordStart) => void;
  recordStop: (data: PlaudRecordStop) => void;
  recordPause: (data: PlaudRecordStop) => void;
  recordResume: (data: PlaudRecordResume) => void;
  depair: (data: { status: number }) => void;
  // Wi-Fi fast transfer. Emitted on both platforms, with identical payload shapes.
  wifiState: (data: PlaudWifiStateEvent) => void;
  wifiFileList: (data: PlaudWifiFileList) => void;
  wifiTransferProgress: (data: PlaudWifiTransferProgress) => void;
  wifiDeleteComplete: (data: { success: boolean; count: number; error: string | null }) => void;
  wifiBattery: (data: { level: number; charging: boolean }) => void;
  wifiError: (data: PlaudWifiError) => void;
};

/**
 * Typed shape of the native `PlaudSdk` module. Implemented twice, with an identical surface:
 * `ios/PlaudSdkModule.swift` and `android/src/main/java/expo/modules/plaudsdk/PlaudSdkModule.kt`.
 * It extends `NativeModule`, so `addListener` / `removeListener` for every event above come
 * for free and are fully typed.
 *
 * Requires a physical device and a custom dev build on both platforms: the iOS frameworks have
 * no simulator slice, and the Android SDK needs real Bluetooth hardware. Where the module isn't
 * linked (web, iOS simulator) every call rejects — guard with `PlaudSdk.isAvailable`.
 */
export declare class PlaudSdkModule extends NativeModule<PlaudSdkEvents> {
  /**
   * Initialise the SDK with a per-user JWT. `customDomain` is domain-only (no https://).
   * `userId` is the app-level identifier reused as the default connect `deviceToken`.
   */
  initSDK(options: {
    userAccessToken: string;
    customDomain: string;
    userId?: string;
  }): Promise<void>;
  /**
   * Android only. Requests the runtime Bluetooth/location permissions BLE scanning needs on
   * API 31+. `startScan` calls this itself, so it's optional — use it to prompt at a moment
   * of your choosing. On iOS the method is absent (permissions come from the Info.plist
   * usage strings), so call it behind a `Platform.OS === 'android'` check.
   */
  requestPermissions?(): Promise<{ granted: boolean }>;
  /**
   * Start scanning. On Android this first requests BLE permissions and rejects with
   * `ERR_PLAUD_PERMISSIONS` if they're denied; if Bluetooth is off, it resolves and emits
   * `scanTimeout` with `reason: "bluetoothNotPoweredOn"` (same as iOS).
   */
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  /** Connect to a device from a prior `scanResult`, by `uuid` (preferred) or `serialNumber`. */
  connectBleDevice(options: {
    uuid?: string;
    serialNumber?: string;
    deviceToken?: string;
  }): Promise<void>;
  disconnect(): Promise<void>;
  /** Unpair; with `clear: true` (default) also clears local pairing state. Result via `depair` event. */
  depair(options?: { clear?: boolean }): Promise<void>;
  isConnected(): Promise<{ connected: boolean }>;
  /** Request the recording list; results arrive via the `fileList` event. */
  getFileList(options?: { startSessionId?: number }): Promise<void>;
  /**
   * Decode a recording to a file in the app's Documents/PlaudExports dir. Resolves with the
   * written path; emits `exportProgress` events. `format` defaults to "mp3".
   */
  exportAudio(options: {
    sessionId: number;
    format?: PlaudAudioFormat;
    channels?: number;
  }): Promise<{ sessionId: number; outputPath: string }>;

  // MARK: Wi-Fi fast transfer
  //
  // Implemented on both platforms with identical event names, payload shapes and error codes.
  // iOS additionally needs the HotspotConfiguration / wifi-info entitlements, the local-network
  // and location usage strings, and granted When-In-Use location — see the module README.

  /**
   * Start a Wi-Fi fast transfer session: the recorder opens its own Wi-Fi AP, the phone joins it —
   * the system shows a "Join Wi-Fi network?" prompt the user must accept — and recordings then
   * transfer over a local WebSocket instead of BLE.
   *
   * The device must already be connected over BLE or this rejects `ERR_PLAUD_WIFI_PREREQ`; on iOS
   * the same code comes back when Location access has been denied, since joining the AP needs it.
   * A second concurrent session rejects `ERR_PLAUD_WIFI`. `userId` defaults to the one passed to
   * `initSDK`.
   *
   * Resolving means the session was started, not that it is usable: watch `wifiState` until it
   * reports `"ready"`, at which point a `wifiFileList` event arrives without any further call.
   */
  startWifiTransfer(options?: { userId?: string }): Promise<void>;
  /**
   * Tear the session down and ask the device to close its AP, restoring the phone's normal
   * network. Safe to call when no session is running.
   */
  stopWifiTransfer(): Promise<void>;
  /** Whether a Wi-Fi session is currently running. */
  isWifiTransferActive(): Promise<{ active: boolean }>;
  /** The current session state; `"none"` when there is no session. */
  getWifiTransferState(): Promise<{ state: PlaudWifiState }>;
  /**
   * Re-request the Wi-Fi file list mid-session; results arrive via `wifiFileList`. The first list
   * is fetched automatically when the session becomes ready, so this is only needed to refresh it.
   * Rejects `ERR_PLAUD_WIFI_NOT_READY` before the session is ready.
   */
  getWifiFileList(): Promise<void>;
  /**
   * The Wi-Fi counterpart of `exportAudio`: identical options, identical
   * `{ sessionId, outputPath }` result, the same `exportProgress` events and the same
   * `Documents/PlaudExports` output directory — so an existing export call site switches to the
   * fast path by changing the method name alone. Progress is additionally reported with
   * throughput via `wifiTransferProgress`.
   */
  exportAudioViaWiFi(options: {
    sessionId: number;
    format?: PlaudAudioFormat;
    channels?: number;
  }): Promise<{ sessionId: number; outputPath: string }>;
  /**
   * Delete recordings from the device over Wi-Fi. Call this only once every transfer in the
   * session has finished — deleting between transfers disrupts the connection. The result
   * arrives via `wifiDeleteComplete`.
   */
  deleteWifiFiles(options: { sessionIds: number[] }): Promise<void>;
}
