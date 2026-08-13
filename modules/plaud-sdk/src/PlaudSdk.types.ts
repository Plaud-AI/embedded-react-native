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
  /** iOS only — the Android SDK's scan payload carries no Wi-Fi flag, so it is always `false`. */
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
}
