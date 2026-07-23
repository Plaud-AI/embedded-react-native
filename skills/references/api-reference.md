# Plaud SDK — JS API reference

The typed native module `PlaudSdk` (from `plaud-sdk`). Source of truth:
`modules/plaud-sdk/src/PlaudSdk.types.ts` and `modules/plaud-sdk/ios/PlaudSdkModule.swift`.

All methods are iOS-device-only and reject on Android / the simulator. Guard call sites with
`isAvailable`. Methods that fetch data (`startScan`, `getFileList`) resolve immediately and
deliver results later via **events** — the promise resolving means "the request was sent," not
"here's the data."

## Module exports

```ts
import { PlaudSdk, isAvailable } from 'plaud-sdk';
```

- `isAvailable: boolean` — `true` only when the native module is linked and callable (physical
  iOS device). `false` on Android/simulator, where `PlaudSdk` is a no-op `Proxy` whose methods
  reject and whose `addListener` returns a harmless `{ remove() {} }`.
- `PlaudSdk: PlaudSdkModule` — the typed handle (also the default export).

## Methods

| Method | Signature | Notes |
| --- | --- | --- |
| `initSDK` | `(o: { userAccessToken: string; customDomain: string; userId?: string }) => Promise<void>` | Call once before anything else. `customDomain` is domain-only (no `https://`). `userId` is reused as the default connect `deviceToken`. Rejects `ERR_PLAUD_ARGS` if token/domain missing. |
| `startScan` | `() => Promise<void>` | Begins BLE scan. Internally waits for CoreBluetooth to reach `.poweredOn` (polls ~18s); emits `scanTimeout` with `reason: 'bluetoothNotPoweredOn'` if it never powers on. Devices arrive via `scanResult`. |
| `stopScan` | `() => Promise<void>` | Stops scanning. |
| `connectBleDevice` | `(o: { uuid?: string; serialNumber?: string; deviceToken?: string }) => Promise<void>` | Connect to a device from a prior `scanResult`. Prefer `uuid`. Must scan first (device objects are cached natively) or it rejects `ERR_PLAUD_UNKNOWN_DEVICE`. Connection result arrives via `connectState`. |
| `disconnect` | `() => Promise<void>` | Disconnect the current device. |
| `depair` | `(o?: { clear?: boolean }) => Promise<void>` | Unpair. `clear` defaults `true` (also clears local pairing state). Result via `depair` event. |
| `isConnected` | `() => Promise<{ connected: boolean }>` | Synchronous-ish status check (this one returns data directly). |
| `getFileList` | `(o?: { startSessionId?: number }) => Promise<void>` | Request the on-device recording list. Results arrive via the `fileList` event. |
| `exportAudio` | `(o: { sessionId: number; format?: PlaudAudioFormat; channels?: number }) => Promise<{ sessionId: number; outputPath: string }>` | Decode a recording to a file in `Documents/PlaudExports`. Resolves with the written path; emits `exportProgress` events along the way. `format` defaults to `'mp3'`. Rejects `ERR_PLAUD_ARGS` (bad sessionId) or `ERR_PLAUD_EXPORT`. |

`PlaudAudioFormat = 'pcm' | 'mp3' | 'wav' | 'opus'`.

`exportAudio` returns a raw path; prefix with `file://` if not already present before handing
it to `expo-file-system` / `fetch`.

## Events

Subscribe with `PlaudSdk.addListener(name, cb)`, which returns `{ remove() }`. Always remove on
unmount. `addListener`/`removeListener`/`removeAllListeners` come from the Expo `NativeModule`
base and are fully typed.

| Event | Payload | When |
| --- | --- | --- |
| `scanResult` | `{ devices: PlaudScanDevice[] }` | Devices discovered during a scan (may fire repeatedly with a growing list). |
| `scanTimeout` | `{ reason?: string }` | Scan window ended, or BLE never powered on (`reason: 'bluetoothNotPoweredOn'`). |
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
  uuid: string;          // CoreBluetooth peripheral id — use this to connect
  serialNumber: string;
  rssi: number;
  supportWiFi: boolean;
}

interface PlaudConnectState {
  connected: boolean;
  failed: boolean;       // true for handshake failure (state 2/-1/-2), not a normal disconnect
  state: number;
}

interface PlaudPenState {
  state: number; privacy: number; keyState: number; uDisk: number;
  findMyToken: number; hasSndpKey: number; deviceAccessToken: number;
}

interface PlaudFile {
  sn: string;
  sessionId: number;     // identifies the recording for exportAudio
  size: number;          // bytes
  scenes: number;
  channels: number;
  isOgg: boolean;
  isMusic: boolean;
  duration: number;      // seconds
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

```ts
PlaudSdk.addListener('scanResult', ({ devices }) => setDevices(devices));
PlaudSdk.addListener('connectState', ({ connected, failed }) => {
  if (connected) PlaudSdk.getFileList();          // load recordings on connect
  else if (failed) showError('Connection failed — move closer and retry');
});
PlaudSdk.addListener('fileList', ({ files }) => setFiles(files));

await PlaudSdk.startScan();
// user picks a device:
await PlaudSdk.connectBleDevice({ uuid: device.uuid });
// user picks a file:
const { outputPath } = await PlaudSdk.exportAudio({ sessionId: file.sessionId, format: 'mp3' });
```

See `react-native-demo/src/app/index.tsx` for the full stateful version.
