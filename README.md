# Plaud SDK for React Native

A local [Expo module](https://docs.expo.dev/modules/overview/) that bridges Plaud's native
iOS device SDK into React Native. It exposes BLE scan/connect, on-device recording events,
file listing, and audio export to JavaScript.

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

**2. Plaud native SDK (`ios/Frameworks/*.xcframework`).**
Three precompiled binary frameworks — `PlaudBleSDK`, `PlaudDeviceBasicSDK`, `PlaudWiFiSDK` —
vendored by `ios/PlaudSdk.podspec` (`vendored_frameworks`). CocoaPods embeds and code-signs
them automatically; there are no Podfile or Xcode edits to make by hand.

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

Skip this if your app already uses Expo. For a bare React Native app, install the Expo Modules
runtime once — it's what provides `requireNativeModule` and the autolinking `PlaudSdk`
depends on:

```bash
npx install-expo-modules@latest
```

### Step 0: Install the skill from this repo

The Skill has context on the Plaud Embedded plugin to help you implement this 
plugin for your react-native app.

```bash
npx skills add Plaud-AI/embedded-react-native
```

### Step 1: copy the module into your app

Place the module where Expo autolinking looks — a `modules/` folder at your project root:

```bash
cp -R modules/plaud-sdk /path/to/your-app/modules/plaud-sdk
```

The module's `expo-module.config.json` is what makes autolinking pick it up, so Metro and the
native build resolve the `plaud-sdk` import automatically.

The one thing to add is a TypeScript path mapping so
the `import { PlaudSdk } from 'plaud-sdk'` type-resolves. In your app's `tsconfig.json`:

```jsonc
// your-app/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "plaud-sdk": ["./modules/plaud-sdk"]
    }
  }
}
```

> No `npm install` is needed for the module — it isn't an installed package. Autolinking
> discovers it from `modules/` at prebuild/build time.

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
