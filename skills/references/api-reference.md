# Plaud SDK — JS API reference

The typed native module `PlaudSdk` (from `plaud-sdk`). Source of truth:
`modules/plaud-sdk/src/PlaudSdk.types.ts`, implemented twice with an identical surface —
`modules/plaud-sdk/ios/PlaudSdkModule.swift` and
`modules/plaud-sdk/android/src/main/java/expo/modules/plaudsdk/PlaudSdkModule.kt`.

Everything below works the same on **iOS and Android** except where a row says otherwise; the
platform differences are collected in `references/android.md`. All methods need a physical
device and reject where the module isn't linked (web, iOS simulator) — guard call sites with
`isAvailable`. Methods that fetch data (`startScan`, `getFileList`) resolve immediately and
deliver results later via **events** — the promise resolving means "the request was sent," not
"here's the data."

## Module exports

```ts
import { PlaudSdk, isAvailable } from 'plaud-sdk';
```

- `isAvailable: boolean` — `true` only when the native module is linked and callable (a
  physical iOS or Android device on a dev build). `false` on web and the iOS simulator, where
  `PlaudSdk` is a no-op `Proxy` whose methods reject and whose `addListener` returns a harmless
  `{ remove() {} }`.
- `PlaudSdk: PlaudSdkModule` — the typed handle (also the default export).

## Methods

| Method | Signature | Notes |
| --- | --- | --- |
| `initSDK` | `(o: { userAccessToken: string; customDomain: string; userId?: string }) => Promise<void>` | Call once before anything else. `customDomain` is domain-only (no `https://`); on Android it also repoints the SDK's Partner API away from its hardcoded `platform-jp` host. `userId` is reused as the default connect `deviceToken`. Rejects `ERR_PLAUD_ARGS` if token/domain missing. |
| `requestPermissions` | `() => Promise<{ granted: boolean }>` | **Android only** (absent on iOS — call it behind `Platform.OS === 'android'`). Requests the runtime BLE/location permissions. Optional: `startScan` calls it itself; use this to prompt at a moment of your choosing. |
| `startScan` | `() => Promise<void>` | Begins a BLE scan; devices arrive via `scanResult`. **Android:** requests permissions first and rejects `ERR_PLAUD_PERMISSIONS` if denied; if the adapter is off it resolves and emits `scanTimeout` with `reason: 'bluetoothNotPoweredOn'`. **iOS:** waits for CoreBluetooth to reach `.poweredOn` (polls ~18s), then emits the same `scanTimeout` reason if it never does. |
| `stopScan` | `() => Promise<void>` | Stops scanning. |
| `connectBleDevice` | `(o: { uuid?: string; serialNumber?: string; deviceToken?: string }) => Promise<void>` | Connect to a device from a prior `scanResult`. Prefer `uuid`. Must scan first (device objects are cached natively) or it rejects `ERR_PLAUD_UNKNOWN_DEVICE`. Connection result arrives via `connectState`. On Android this also waits on the handshake prerequisites — see `references/android.md`. |
| `disconnect` | `() => Promise<void>` | Disconnect the current device. |
| `depair` | `(o?: { clear?: boolean }) => Promise<void>` | Unpair. `clear` defaults `true` (also clears local pairing state). Result via `depair` event. |
| `isConnected` | `() => Promise<{ connected: boolean }>` | Status check (this one returns data directly). |
| `getFileList` | `(o?: { startSessionId?: number }) => Promise<void>` | Request the on-device recording list. Results arrive via the `fileList` event. |
| `exportAudio` | `(o: { sessionId: number; format?: PlaudAudioFormat; channels?: number }) => Promise<{ sessionId: number; outputPath: string }>` | Decode a recording to a file in the app's documents dir under `PlaudExports/` (iOS `Documents/PlaudExports`, Android `filesDir/PlaudExports` — what `expo-file-system` exposes as `documentDirectory` on both). Resolves with the written path; emits `exportProgress` along the way. `format` defaults to `'mp3'`. Rejects `ERR_PLAUD_ARGS` (bad sessionId) or `ERR_PLAUD_EXPORT`. |

`PlaudAudioFormat = 'pcm' | 'mp3' | 'wav' | 'opus'`.

`exportAudio` returns a raw path; prefix with `file://` if not already present before handing
it to `expo-file-system` / `fetch`.

## Error codes

Rejections are `CodedException`s, so `error.code` is stable on both platforms.

| Code | Thrown by | Meaning |
| --- | --- | --- |
| `ERR_PLAUD_ARGS` | `initSDK`, `exportAudio` | Missing `userAccessToken`/`customDomain`, or a bad `sessionId`. |
| `ERR_PLAUD_PERMISSIONS` | `startScan` (Android) | Runtime Bluetooth/location permissions denied. |
| `ERR_PLAUD_UNKNOWN_DEVICE` | `connectBleDevice` | No cached device matches the `uuid`/`serialNumber` — scan first. |
| `ERR_PLAUD_CONNECT` | `connectBleDevice` | The connect call itself threw natively. |
| `ERR_PLAUD_EXPORT` | `exportAudio` | Decode/write failed. |
| `ERR_PLAUD` | any | Generic fallback (e.g. React context unavailable). |

## Events

Subscribe with `PlaudSdk.addListener(name, cb)`, which returns `{ remove() }`. Always remove on
unmount. `addListener`/`removeListener`/`removeAllListeners` come from the Expo `NativeModule`
base and are fully typed. Both native modules declare the same twelve events.

| Event | Payload | When |
| --- | --- | --- |
| `scanResult` | `{ devices: PlaudScanDevice[] }` | Devices discovered during a scan (may fire repeatedly with a growing list). |
| `scanTimeout` | `{ reason?: string }` | Scan window ended, or Bluetooth is off / never powered on (`reason: 'bluetoothNotPoweredOn'`). |
| `connectState` | `{ connected: boolean; failed: boolean; state: number }` | Connection state changed. `state`: `1`=connected, `0`=disconnected, `{2,-1,-2}`=failure (`failed: true`). |
| `penState` | `PlaudPenState` | Device status snapshot (privacy, key state, uDisk, tokens). |
| `bind` | `{ sn: string \| null; status: number; protVersion: number }` | Bind/pairing handshake result. |
| `fileList` | `{ files: PlaudFile[] }` | Response to `getFileList`. |
| `exportProgress` | `{ sessionId: number; progress: number; message: string }` | Progress during `exportAudio`. |
| `recordStart` | `PlaudRecordStart` | Device-initiated recording started (physical button / VAD). |
| `recordStop` | `PlaudRecordStop` | Device-initiated recording stopped; includes resulting file info. |
| `recordPause` | `PlaudRecordStop` | Recording paused. |
| `recordResume` | `PlaudRecordResume` | Recording resumed. |
| `depair` | `{ status: number }` | Unpair completed — reset all local device state here. |

`recordStart`/`recordStop`/etc. are **device-initiated** (the user pressed the button on the
recorder). Refresh the file list on `recordStop` to pick up the new recording.

## Types

```ts
interface PlaudScanDevice {
  name: string;
  uuid: string;          // iOS: CoreBluetooth peripheral id. Android: MAC address.
                         // Either way, this is what you pass to connectBleDevice.
  serialNumber: string;
  rssi: number;
  supportWiFi: boolean;  // iOS only — always false on Android
}

interface PlaudConnectState {
  connected: boolean;
  failed: boolean;       // true for handshake failure (state 2/-1/-2), not a normal disconnect
  state: number;
}

interface PlaudPenState {
  state: number; privacy: number; keyState: number; uDisk: number;
  findMyToken?: number; hasSndpKey?: number; deviceAccessToken?: number;  // iOS only, optional
}

interface PlaudFile {
  sn: string;
  sessionId: number;     // identifies the recording for exportAudio
  size: number;          // bytes
  scenes: number;
  channels: number;
  isOgg: boolean;
  isMusic: boolean;
  duration: number;      // seconds; on Android derived from size + channels (see android.md)
}

interface PlaudExportProgress { sessionId: number; progress: number; message: string; }

interface PlaudRecordStart {
  sessionId: number; start: number; status: number;
  scene: number; startTime: number; reason: number;
}

interface PlaudRecordStop {
  sessionId: number; reason: number; fileExist: boolean; fileSize: number;
}

interface PlaudRecordResume {
  sessionId: number; start: number; status: number; scene: number; startTime: number;
}
```

## Canonical scan → connect → list → export flow

Identical on both platforms — no `Platform.OS` branches needed.

```ts
PlaudSdk.addListener('scanResult', ({ devices }) => setDevices(devices));
PlaudSdk.addListener('scanTimeout', ({ reason }) => {
  if (reason === 'bluetoothNotPoweredOn') showError('Turn Bluetooth on and retry');
});
PlaudSdk.addListener('connectState', ({ connected, failed }) => {
  if (connected) PlaudSdk.getFileList();          // load recordings on connect
  else if (failed) showError('Connection failed — move closer and retry');
});
PlaudSdk.addListener('fileList', ({ files }) => setFiles(files));

await PlaudSdk.startScan();   // Android: may reject ERR_PLAUD_PERMISSIONS
// user picks a device:
await PlaudSdk.connectBleDevice({ uuid: device.uuid });
// user picks a file:
const { outputPath } = await PlaudSdk.exportAudio({ sessionId: file.sessionId, format: 'mp3' });
```

See `react-native-demo/src/app/index.tsx` for the full stateful version.
