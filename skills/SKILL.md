---
name: setup-plaud-react-native
description: Set up the Plaud SDK Expo/React Native module (BLE connect, on-device recording, file list, audio export) on iOS and Android in an existing or new React Native app. Use when a user wants to integrate Plaud's native device SDK into a React Native / Expo app.
---

# Setting up the Plaud React Native module

`plaud-sdk` is a local [Expo module](https://docs.expo.dev/modules/overview/) that bridges
Plaud's precompiled native device SDK into React Native on **iOS and Android**. It exposes BLE
scan/connect, on-device recording events, file listing, and audio export to JavaScript, with a
typed event stream.

Both platforms implement the **same JS surface, event names and payload shapes**, so app code
needs no platform branches (the handful of real differences are listed in
`references/android.md`). The module lives at `modules/plaud-sdk/` in this repo; a full
reference app is at `react-native-demo/` (`src/app/index.tsx` is the canonical usage example).

Use this skill to add the module to an app and get it building on a device.

## ⚠️ Read these constraints before anything else

- **Physical device only, on both platforms.** iOS: the frameworks are arm64, iOS 15+, with
  **no simulator slice** — `npx expo run:ios --device`. Android: the SDK needs a real Bluetooth
  radio, so an emulator just emits `scanTimeout` with `reason: 'bluetoothNotPoweredOn'` —
  `npx expo run:android` on a handset.
- **Custom dev build, not Expo Go.** This is custom native code; Expo Go cannot load it.
- Where the module isn't linked (web, iOS simulator), `isAvailable` is `false` and every
  `PlaudSdk` method rejects. Guard every call site with `isAvailable` so the app stays
  functional (just without the SDK) on those targets.

If the user expects this to run on the simulator or an emulator, set expectations first — no
amount of setup makes the SDK work there.

## Prerequisites

| Tool | Notes |
| --- | --- |
| Node.js | v20+ (v24 used in this repo) |
| Xcode (iOS) | 16.x+, with a physical iPhone + Apple ID |
| CocoaPods (iOS) | `brew install cocoapods` |
| Android Studio + JDK 17 (Android) | Android SDK platform-tools, plus a physical handset with USB debugging |
| An Expo-based RN app | Expo SDK 52+ (this repo uses SDK 57). Bare RN works after Step 0. |

The module is built on Expo's module system, so the smoothest path is an Expo (or
Expo-prebuild) app. Bare React Native works too — you just install the Expo Modules
infrastructure first.

## Setup workflow

Work through these steps in order. Do not skip the `isAvailable` guard (Step 4) — it is the
difference between an app that degrades gracefully off-device and one that crashes.

### Step 0 — (bare RN only) add Expo Modules support

Skip if the app already uses Expo. For a bare React Native app, install the Expo Modules
runtime once — it provides `requireNativeModule` and the autolinking the module depends on:

```bash
npx install-expo-modules@latest
```

### Step 1 — copy the module into the app

Place it where Expo autolinking looks: a `modules/` folder at the project root.

```bash
cp -R modules/plaud-sdk /path/to/your-app/modules/plaud-sdk
```

On iOS this copies three large `.xcframework` binaries and on Android a `plaud-sdk.aar`.
**Verify they came across** (`modules/plaud-sdk/ios/Frameworks/`,
`modules/plaud-sdk/android/libs/`) — a shallow or filtered copy that drops them produces
confusing link/build errors later.

Then add a TypeScript path mapping so `import { PlaudSdk } from 'plaud-sdk'` type-resolves:

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

> **No `npm install` is needed for the module** — it isn't an installed package. Expo
> autolinking discovers it from `modules/` at prebuild/build time via
> `expo-module.config.json`, which registers `PlaudSdkModule` for both `apple.modules` and
> `android.modules`. **No Podfile, Xcode, `settings.gradle` or `build.gradle` edits by hand on
> either platform.**

### Step 2 — declare permissions

**iOS** — these live in the app config (not the module) so they survive `expo prebuild`. Add
them under `expo.ios.infoPlist` in `app.json`:

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

Without `NSBluetoothAlwaysUsageDescription` the app crashes the moment it touches Bluetooth.
`UIBackgroundModes: ["bluetooth-central"]` keeps BLE alive when backgrounded.

**Android** — **`app.json` needs nothing.** The Bluetooth/location permissions are declared in
`plaud-sdk.aar`'s own manifest and reach the app through manifest merging. They must still be
*granted at runtime* on Android 12+, which the module handles itself — see Step 4.

### Step 3 — generate the native project and build

```bash
# iOS
npx expo prebuild -p ios       # regenerates ios/ from app.json and runs pod install
npx expo run:ios --device      # build + install on a connected iPhone

# Android
npx expo prebuild -p android   # regenerates android/ from app.json
npx expo run:android           # build + install on a connected handset
```

Re-run `expo prebuild` after **any** native config change (permissions, bundle id, plugins). In
a bare app that manages `ios/`/`android/` by hand, run `pod install` from `ios/` instead —
autolinking still discovers the module on both platforms.

The first Android build is slow: the AAR's hand-declared transitive dependencies
(`modules/plaud-sdk/android/build.gradle`) all resolve on that pass.

### Step 4 — use it from JS (guard, init, subscribe, drive, clean up)

The module is **event-driven**: JS calls (`startScan`, `connectBleDevice`, `getFileList`) kick
off work, and results arrive on the event stream, not as return values. The five-part shape:

```ts
import { PlaudSdk, isAvailable } from 'plaud-sdk';

// 1. GUARD — where the module isn't linked (web, iOS simulator) it isn't callable.
if (!isAvailable) { /* show a "device required" state; skip SDK calls */ }

// 2. INIT — once, with a per-user JWT (see references/transcription-and-tokens.md).
await PlaudSdk.initSDK({
  userAccessToken,                      // per-user Bearer JWT (your backend mints this)
  customDomain: 'platform-us.plaud.ai', // domain only, no https://
  userId: 'your-app-user-id',           // reused as the default connect deviceToken
});

// 3. SUBSCRIBE — this is where results land.
const subs = [
  PlaudSdk.addListener('scanResult', ({ devices }) => {/* show devices */}),
  PlaudSdk.addListener('connectState', ({ connected, failed }) => {
    if (connected) PlaudSdk.getFileList();   // ask for recordings once connected
  }),
  PlaudSdk.addListener('fileList', ({ files }) => {/* show recordings */}),
  PlaudSdk.addListener('exportProgress', ({ progress, message }) => {/* progress UI */}),
  PlaudSdk.addListener('scanTimeout', ({ reason }) => {/* prompt to enable Bluetooth */}),
];

// 4. DRIVE it. On Android startScan() prompts for BLE permissions first and rejects with
//    ERR_PLAUD_PERMISSIONS if denied — handle that rejection.
await PlaudSdk.startScan();
await PlaudSdk.connectBleDevice({ uuid: device.uuid });        // from a scanResult device
const { outputPath } = await PlaudSdk.exportAudio({ sessionId, format: 'mp3' });

// 5. CLEAN UP listeners on unmount.
subs.forEach((s) => s.remove());
```

`react-native-demo/src/app/index.tsx` is a complete, production-shaped version (React state,
error handling, live-recording banners, unpair flow). **Read it before building your own
screen** — it shows the correct event → state wiring for every callback.

To prompt for Android permissions earlier than the first scan, call the Android-only
`requestPermissions()` behind a platform check (it's absent on iOS):

```ts
if (Platform.OS === 'android') {
  const { granted } = await PlaudSdk.requestPermissions!();
}
```

## References

Pull these in only when the task needs them:

- **`references/api-reference.md`** — every `PlaudSdk` method, every event and its payload, all
  TypeScript types, and the error codes. Consult when writing call sites or handling an event.
- **`references/android.md`** — Android-specific behavior: the hand-declared AAR dependencies,
  runtime permissions, the connect-handshake prerequisites, and the payload fields that differ
  from iOS. Read this before debugging an Android-only failure or upgrading the AAR.
- **`references/transcription-and-tokens.md`** — where the per-user JWT comes from, and the
  optional export → upload → transcribe HTTP flow (which is **not** part of the native module
  and belongs behind a backend in production).

## Key facts to keep straight

- **Never edit `ios/` or `android/` by hand in an Expo app.** They're generated by
  `expo prebuild`. Put native config in `app.json` and regenerate.
- **`customDomain` is domain-only** — `platform-us.plaud.ai`, not `https://platform-us.plaud.ai`.
  On Android it also repoints the SDK's Partner API, which otherwise hardcodes `platform-jp`
  and breaks every handshake for non-JP tokens (see `references/android.md`).
- **`initSDK` does not mint the token.** The per-user Bearer JWT is an app/backend
  responsibility. For local testing, `EXPO_PUBLIC_PLAUD_ACCESS_TOKEN` works (Expo inlines
  `EXPO_PUBLIC_*` at build), but those vars are extractable from the bundle — never ship
  credentials in the client.
- **Scan before you connect, on both platforms.** The native side caches the device objects
  from `scanResult` and looks them up by `uuid`; a hardcoded id rejects with
  `ERR_PLAUD_UNKNOWN_DEVICE`.
- **`readFile` / `putBinary` do not exist here.** They were Capacitor WKWebView CORS shims. In
  RN, read exported files with `expo-file-system` and upload with `fetch`.
