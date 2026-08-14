# Plaud SDK for React Native

A local [Expo module](https://docs.expo.dev/modules/overview/) that bridges Plaud's native
device SDK into React Native on **iOS and Android**. It exposes BLE scan/connect, on-device
recording events, file listing, and audio export to JavaScript — one JS surface, two native
implementations.

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
 │                             │  degrades to a no-op Proxy where unlinked
 └─────────────────────────────┘
        │  Expo Modules bridge (AsyncFunction / Events)
 ┌──────────────────┬──────────────────────┐
 │ iOS              │ Android              │
 │ PlaudSdkModule   │ PlaudSdkModule       │  same Name("PlaudSdk"),
 │   .swift         │   .kt                │  same events & payloads
 ├──────────────────┼──────────────────────┤
 │ 3 .xcframeworks  │ plaud-sdk.aar        │  Plaud native SDK
 │ BLE/Device/WiFi  │ (+ .so per ABI)      │
 └──────────────────┴──────────────────────┘
```

**1. JS layer (`src/index.ts`, `src/PlaudSdk.types.ts`).**
`requireNativeModule('PlaudSdk')` resolves the native module at runtime. It's called lazily
inside a `try/catch` on iOS and Android, so the module never throws at import time. Two
exports matter:
- `isAvailable` — `true` only when the native module is linked and callable (a physical
  device). Guard every call site with it.
- `PlaudSdk` — the typed handle. When the native module is absent (web, iOS simulator), it's
  a `Proxy` whose methods reject and whose `addListener` is a harmless no-op, so shared code
  doesn't need platform branches everywhere.

**2a. Plaud native SDK on iOS (`ios/Frameworks/*.xcframework`).**
Three precompiled binary frameworks — `PlaudBleSDK`, `PlaudDeviceBasicSDK`, `PlaudWiFiSDK` —
vendored by `ios/PlaudSdk.podspec` (`vendored_frameworks`). CocoaPods embeds and code-signs
them automatically; there are no Podfile or Xcode edits to make by hand.

**2b. Plaud native SDK on Android (`android/libs/plaud-sdk.aar`).**
One precompiled AAR, consumed by `android/build.gradle`; its per-ABI `.so` files ship inside
it and are packaged automatically. Because the AAR carries **no POM**, its transitive
dependencies (Retrofit, OkHttp, Gson, BouncyCastle, Java-WebSocket, Conscrypt, Timber,
slf4j/logback, Guava, coroutines) are declared by hand in that `build.gradle` — see
`modules/plaud-sdk/README.md` before swapping the AAR. Bluetooth permissions come from the
AAR's own manifest via manifest merging, so `app.json` needs nothing.

---

## ⚠️ Platform constraints — read this first

The SDK talks to real Bluetooth hardware, so **both platforms need a physical device and a
custom dev build** (not Expo Go):

- **iOS** — the frameworks are **arm64, iOS 15+, device-only** with no simulator slice. Run on
  a physical iPhone (`npx expo run:ios --device`), never the simulator.
- **Android** — run on a physical handset (`npx expo run:android`). An emulator has no BLE
  radio, so scanning reports `scanTimeout`. On Android 12+ the Bluetooth permissions are
  requested at runtime by `startScan()` (or up front via `PlaudSdk.requestPermissions()`).
- Where the module isn't linked (web, iOS simulator), `isAvailable` is `false` and every
  `PlaudSdk` method rejects — so guard call sites and keep the app functional without the SDK.

---

## Running the Demo App

The demo app is included in the Plaud Embedded Module as reference for implementing the module in your own app and seeing how the module works.

### 1. Clone the Embedded React Native repo
```bash
git clone https://github.com/Plaud-AI/embedded-react-native.git
```

### 2. Install dependencies and set up env vars
```bash
cd react-native-demo
npm i
brew install cocoapods #if not already installed
cp .env.example .env
```

You can retrieve your environment credentials from the [developer portal](https://portal.plaud.ai) and retrieve a token from our [API playground](https://plaud-embedded-playground.vercel.app)

### 3a. Build and open in XCode
```bash
npx expo prebuild -p ios
open ios/reactnativedemo.xcworkspace
```
In XCode, make sure to include your Apple developer credentials and certificate. 

### 3b. Build and open in Android Studio
```bash
npx expo prebuild -p android
npx expo run:android
```

### 4. Run
Then **run on a physical device** to test out the demo app with your Plaud devices.

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
# iOS
npx expo prebuild -p ios      # regenerates ios/ from app.json and runs pod install
npx expo run:ios --device     # build + install on a connected iPhone

# Android
npx expo prebuild -p android  # regenerates android/ from app.json
npx expo run:android          # build + install on a connected handset
```

Re-run `expo prebuild` after any native config change. If you're in a bare app that manages
`ios/` or `android/` by hand, run `pod install` from `ios/` instead — autolinking still
discovers the module on both platforms, with no `settings.gradle` or Podfile edits needed.

### Step 4: use it from JS

```ts
import { PlaudSdk, isAvailable } from 'plaud-sdk';

if (!isAvailable) {
  // web / iOS simulator — the native module isn't linked. Degrade gracefully.
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
