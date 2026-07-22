# Plaud SDK for React Native

A local [Expo module](https://docs.expo.dev/modules/overview/) that bridges Plaud's native
iOS device SDK into React Native. It exposes BLE scan/connect, on-device recording events,
file listing, and audio export to JavaScript — the RN counterpart of the Capacitor `PlaudSdk`
plugin.

```
embedded-react-native/
├── modules/
│   └── plaud-sdk/          ← the reusable module (copy this into your app)
│       ├── expo-module.config.json
│       ├── index.ts
│       ├── src/            ← JS layer (typed API + platform guard)
│       └── ios/            ← Swift bridge + vendored Plaud xcframeworks
└── react-native-demo/      ← a working Expo app that consumes the module
```

- **`modules/plaud-sdk/`** — the module itself. This is the piece you drop into another
  project. See `modules/plaud-sdk/README.md` for the terse module-level notes.
- **`react-native-demo/`** — a reference Expo (SDK 57) app wiring the module end to end:
  scan → connect → list → export → transcribe. `src/app/index.tsx` is the canonical usage
  example.

---

## How the module works

The module is three layers stacked on top of each other. A JS call travels down; native
events travel back up.

```
 your React Native code
        │  import { PlaudSdk, isAvailable } from 'plaud-sdk'
        ▼
 ┌─────────────────────────────┐
 │ JS layer  (src/*.ts)        │  requireNativeModule('PlaudSdk'), fully typed,
 │                             │  degrades to a no-op Proxy off-iOS
 └─────────────────────────────┘
        │  Expo Modules bridge (AsyncFunction / Events)
        ▼
 ┌─────────────────────────────┐
 │ Swift layer                 │  PlaudSdkModule + PlaudSdkController
 │ (ios/PlaudSdkModule.swift)  │  delegate → sendEvent() back to JS
 └─────────────────────────────┘
        │  calls PlaudDeviceAgent
        ▼
 ┌─────────────────────────────┐
 │ Plaud native SDK            │  three precompiled .xcframeworks
 │ (ios/Frameworks/*)          │  BLE / Device / WiFi
 └─────────────────────────────┘
```

**1. JS layer (`src/index.ts`, `src/PlaudSdk.types.ts`).**
`requireNativeModule('PlaudSdk')` resolves the native module at runtime. It's called lazily
inside a `try/catch` and only on iOS, so the module never throws at import time. Two exports
matter:
- `isAvailable` — `true` only when the native module is linked and callable (a physical iOS
  device). Guard every call site with it.
- `PlaudSdk` — the typed handle. When the native module is absent (Android / simulator), it's
  a `Proxy` whose methods reject and whose `addListener` is a harmless no-op, so shared code
  doesn't need platform branches everywhere.

**2. Swift layer (`ios/PlaudSdkModule.swift`).**
`PlaudSdkModule` is an Expo `Module`. Its `definition()` declares the `AsyncFunction`s
(`initSDK`, `startScan`, `connectBleDevice`, `getFileList`, `exportAudio`, …) and the `Events`
it can emit. Because an Expo `Module` isn't `NSObject`-derived, it can't be the Plaud SDK's
Objective-C delegate itself — so all SDK interaction lives in `PlaudSdkController` (an
`NSObject` conforming to `PlaudDeviceAgentProtocol`). The controller talks to
`PlaudDeviceAgent.shared`, and forwards every delegate callback to JS through a closure that
calls `sendEvent` **on the main queue** (SDK callbacks can arrive on arbitrary threads).

**3. Plaud native SDK (`ios/Frameworks/*.xcframework`).**
Three precompiled binary frameworks — `PlaudBleSDK`, `PlaudDeviceBasicSDK`, `PlaudWiFiSDK` —
vendored by `ios/PlaudSdk.podspec` (`vendored_frameworks`). CocoaPods embeds and code-signs
them automatically; there are no Podfile or Xcode edits to make by hand.

### Autolinking (no Podfile edits)

Expo autolinks local modules. During `expo prebuild` / `pod install`, `use_expo_modules!`
scans the app's module search paths, finds any folder with an `expo-module.config.json`, and
links it. This module's config registers the Swift module:

```json
{ "platforms": ["apple"], "apple": { "modules": ["PlaudSdkModule"] } }
```

So integrating the module is mostly *placing the folder where Expo looks* and rebuilding —
covered below.

### Command / event split

Imperative actions are **promise-returning methods**; results and device-initiated activity
arrive as **events**. For example, `connectBleDevice()` resolves as soon as the connect is
*dispatched*; the actual connection outcome shows up later on the `connectState` event. Design
your UI around the event stream, not the method return values.

| Method (JS → native)                          | What it does                                                    |
| --------------------------------------------- | -------------------------------------------------------------- |
| `initSDK({ userAccessToken, customDomain, userId? })` | Initialise the SDK with a per-user JWT. `customDomain` is domain-only (no `https://`). |
| `startScan()` / `stopScan()`                  | BLE scan. Scan waits for Bluetooth to power on before firing.   |
| `connectBleDevice({ uuid?, serialNumber?, deviceToken? })` | Connect to a scanned device. Defaults `deviceToken` to `userId` so the handshake binds the device to the user. |
| `disconnect()`                                | Drop the current connection.                                    |
| `depair({ clear? })`                          | Unpair; `clear: true` (default) also wipes local pairing state. Result via `depair` event. |
| `isConnected()`                               | `Promise<{ connected: boolean }>`.                              |
| `getFileList({ startSessionId? })`            | Request recordings — results arrive on the `fileList` event.    |
| `exportAudio({ sessionId, format?, channels? })` | Decode a recording to `Documents/PlaudExports`. Resolves `{ sessionId, outputPath }`; emits `exportProgress`. `format` defaults to `mp3`. |

| Event                                    | Fires when                                              |
| ---------------------------------------- | ------------------------------------------------------- |
| `scanResult`                             | Devices discovered (`{ devices: PlaudScanDevice[] }`).  |
| `scanTimeout`                            | Scan ended without result (e.g. Bluetooth off).         |
| `connectState`                           | Connection state changed (`connected` / `failed` / raw `state`). |
| `penState` / `bind`                      | Device state / bind handshake updates.                  |
| `fileList`                               | Response to `getFileList` (`{ files: PlaudFile[] }`).   |
| `exportProgress`                         | Progress during `exportAudio` (`{ sessionId, progress, message }`). |
| `recordStart` / `recordStop` / `recordPause` / `recordResume` | Device-initiated recording (physical button / VAD). |
| `depair`                                 | Unpair completed.                                        |

Every method and event is fully typed — see `modules/plaud-sdk/src/PlaudSdk.types.ts`.

---

## ⚠️ Platform constraints — read this first

The Plaud frameworks are **arm64, iOS 15+, device-only**. There is **no simulator slice** and
**no Android support**. That means:

- You must run on a **physical iPhone** (`npx expo run:ios --device`), never the simulator.
- You must use a **custom dev build**, not Expo Go (this is custom native code).
- On Android or the simulator, `isAvailable` is `false` and every `PlaudSdk` method rejects —
  so guard call sites and keep the app functional (just without the SDK) on those targets.

---

## Implementing the module in an existing React Native project

The module is built on Expo's module system, so the smoothest path is an Expo (or
Expo-prebuild) app. Bare React Native works too — you just need the Expo Modules
infrastructure installed first.

### Prerequisites

| Tool                          | Notes                                             |
| ----------------------------- | ------------------------------------------------- |
| Node.js                       | v20+ (v24 used here)                              |
| Xcode                         | 16.x+, with a physical iPhone + Apple ID          |
| CocoaPods                     | `brew install cocoapods`                          |
| An Expo-based RN app          | Expo SDK 52+ recommended (this repo uses SDK 57)  |

### Step 0 (bare RN only): add Expo Modules support

Skip this if your app already uses Expo. For a bare React Native app, install the Expo Modules
runtime once — it's what provides `requireNativeModule` and the autolinking `PlaudSdk`
depends on:

```bash
npx install-expo-modules@latest
```

### Step 1: copy the module into your app

Place the module where Expo autolinking looks — a `modules/` folder at your project root:

```bash
cp -R modules/plaud-sdk /path/to/your-app/modules/plaud-sdk
```

Then reference it from your app's `package.json` so Metro and TypeScript resolve the
`plaud-sdk` import to the local folder:

```jsonc
// your-app/package.json
{
  "dependencies": {
    "plaud-sdk": "file:./modules/plaud-sdk"
  }
}
```

```bash
npm install
```

> The module's `expo-module.config.json` is what makes autolinking pick it up — no manual
> native linking, no Podfile edits.

### Step 2: declare BLE permissions in `app.json`

These live in the app's config (not the module) so they survive `expo prebuild`. Add them
under `expo.ios.infoPlist`:

```jsonc
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSBluetoothAlwaysUsageDescription": "Plaud uses Bluetooth to connect to your recorder and sync recordings.",
        "UIBackgroundModes": ["bluetooth-central"]
      }
    }
  }
}
```

### Step 3: generate the native project and build

```bash
npx expo prebuild -p ios     # regenerates ios/ from app.json and runs pod install
npx expo run:ios --device    # build + install on a connected iPhone
```

Re-run `expo prebuild` after any native config change. If you're in a bare app that manages
`ios/` by hand, run `pod install` from `ios/` instead — autolinking still discovers the module.

### Step 4: use it from JS

```ts
import { PlaudSdk, isAvailable } from 'plaud-sdk';

if (!isAvailable) {
  // Android / simulator — the native module isn't linked. Degrade gracefully.
}

// 1. Initialise with a per-user JWT (see "Tokens" below).
await PlaudSdk.initSDK({
  userAccessToken,                    // per-user Bearer JWT
  customDomain: 'platform-us.plaud.ai', // domain only, no https://
  userId: 'your-app-user-id',         // reused as the connect deviceToken
});

// 2. Subscribe to the event stream — this is where results land.
const subs = [
  PlaudSdk.addListener('scanResult', ({ devices }) => {/* show devices */}),
  PlaudSdk.addListener('connectState', ({ connected, failed }) => {
    if (connected) PlaudSdk.getFileList();      // ask for recordings once connected
  }),
  PlaudSdk.addListener('fileList', ({ files }) => {/* show recordings */}),
  PlaudSdk.addListener('exportProgress', ({ progress, message }) => {/* progress UI */}),
];

// 3. Drive it.
await PlaudSdk.startScan();
// user taps a device from scanResult:
await PlaudSdk.connectBleDevice({ uuid: device.uuid });
// user taps a file from fileList:
const { outputPath } = await PlaudSdk.exportAudio({ sessionId, format: 'mp3' });

// 4. Clean up listeners on unmount.
subs.forEach((s) => s.remove());
```

The demo's `react-native-demo/src/app/index.tsx` is a complete, production-shaped version of
this (React state, error handling, live-recording banners). Read it before building your own
screen.

---

## Tokens and transcription (your app's responsibility)

`initSDK` needs a **per-user access token** (a Bearer JWT). The SDK does *not* mint it — that's
an app/backend concern. Mint it via Plaud's partner OAuth flow on your backend and hand it to
the client. For local testing you can paste one via `EXPO_PUBLIC_PLAUD_ACCESS_TOKEN` (Expo
inlines `EXPO_PUBLIC_*` at build time).

Once a recording is exported to a local file, **uploading and transcribing it is plain HTTP —
not part of this native module**. The demo shows the full flow in
`react-native-demo/src/lib/plaud-transcription.ts` (presigned S3 upload → submit → poll).

> ⚠️ The demo calls the Plaud platform API directly from the device with `EXPO_PUBLIC_*`
> credentials, which are extractable from the bundle. That's fine for a demo, but in
> production the transcription API key and upload must live behind a backend.

---

## Running the demo app

```bash
cd react-native-demo
npm install
cp .env.example .env        # fill in EXPO_PUBLIC_PLAUD_* values
npx expo prebuild -p ios
npx expo run:ios --device   # physical iPhone required
```

See `react-native-demo/README.md` for the full build-and-run walkthrough.
