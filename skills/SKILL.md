---
name: setup-plaud-react-native
description: Set up the Plaud SDK Expo/React Native module (BLE connect, on-device recording, file list, audio export) in an existing or new React Native app. Use when a user wants to integrate Plaud's native iOS device SDK into a React Native / Expo app, wire up scan → connect → list → export, or troubleshoot why the module isn't linking or is unavailable at runtime.
---

# Setting up the Plaud React Native module

`plaud-sdk` is a local [Expo module](https://docs.expo.dev/modules/overview/) that bridges
Plaud's precompiled native iOS device SDK into React Native. It exposes BLE scan/connect,
on-device recording events, file listing, and audio export to JavaScript, with a typed event
stream. The module lives at `modules/plaud-sdk/` in this repo; a full reference app is at
`react-native-demo/` (`src/app/index.tsx` is the canonical usage example).

Use this skill to add the module to an app and get it building on a device.

## ⚠️ Read these constraints before anything else

The Plaud frameworks are **arm64, iOS 15+, device-only**. There is **no simulator slice** and
**no Android support**. This dictates the entire workflow:

- You **must run on a physical iPhone** (`npx expo run:ios --device`), never the simulator.
- You **must use a custom dev build**, not Expo Go (this is custom native code).
- On Android or the simulator, `isAvailable` is `false` and every `PlaudSdk` method rejects.
  Guard every call site with `isAvailable` so the app stays functional (just without the SDK)
  on those targets.

If the user is on the simulator or expects Android support, stop and set expectations first —
no amount of setup makes the SDK run there.

## Prerequisites

| Tool | Notes |
| --- | --- |
| Node.js | v20+ (v24 used in this repo) |
| Xcode | 16.x+ (26.x used here), with a physical iPhone + Apple ID |
| CocoaPods | `brew install cocoapods` |
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

Then reference it from the app's `package.json` so Metro and TypeScript resolve the
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

The module's `expo-module.config.json` (which registers `PlaudSdkModule`) is what makes
autolinking pick it up — **no manual native linking, no Podfile edits, no Xcode edits.** The
three Plaud `.xcframework`s in `ios/Frameworks/` are vendored by `PlaudSdk.podspec` and
CocoaPods embeds and code-signs them automatically.

### Step 2 — declare BLE permissions in `app.json`

These live in the app config (not the module) so they survive `expo prebuild`. Add them under
`expo.ios.infoPlist`:

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

### Step 3 — generate the native project and build

```bash
npx expo prebuild -p ios     # regenerates ios/ from app.json and runs pod install
npx expo run:ios --device    # build + install on a connected iPhone
```

Re-run `expo prebuild` after **any** native config change (permissions, bundle id, plugins).
In a bare app that manages `ios/` by hand, run `pod install` from `ios/` instead — autolinking
still discovers the module.

### Step 4 — use it from JS (guard, init, subscribe, drive, clean up)

The module is **event-driven**: JS calls (`startScan`, `connectBleDevice`, `getFileList`) kick
off work, and results arrive on the event stream, not as return values. The five-part shape:

```ts
import { PlaudSdk, isAvailable } from 'plaud-sdk';

// 1. GUARD — off-iOS the native module isn't linked. Degrade gracefully.
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
];

// 4. DRIVE it.
await PlaudSdk.startScan();
await PlaudSdk.connectBleDevice({ uuid: device.uuid });        // from a scanResult device
const { outputPath } = await PlaudSdk.exportAudio({ sessionId, format: 'mp3' });

// 5. CLEAN UP listeners on unmount.
subs.forEach((s) => s.remove());
```

`react-native-demo/src/app/index.tsx` is a complete, production-shaped version (React state,
error handling, live-recording banners, unpair flow). **Read it before building your own
screen** — it shows the correct event → state wiring for every callback.

## References

Pull these in only when the task needs them:

- **`references/api-reference.md`** — every `PlaudSdk` method, every event and its payload,
  and all the TypeScript types. Consult when writing call sites or handling a specific event.
- **`references/transcription-and-tokens.md`** — where the per-user JWT comes from, and the
  optional export → upload → transcribe HTTP flow (which is **not** part of the native module
  and belongs behind a backend in production).
- **`references/troubleshooting.md`** — symptom → cause table for the common failures
  (`isAvailable` false, scan returns nothing, connect fails, pod/build errors).

## Key facts to keep straight

- **Never edit `ios/` by hand in an Expo app.** It's generated by `expo prebuild`. Put native
  config in `app.json` and regenerate.
- **`customDomain` is domain-only** — `platform-us.plaud.ai`, not `https://platform-us.plaud.ai`.
- **`initSDK` does not mint the token.** The per-user Bearer JWT is an app/backend
  responsibility. For local testing, `EXPO_PUBLIC_PLAUD_ACCESS_TOKEN` works (Expo inlines
  `EXPO_PUBLIC_*` at build), but those vars are extractable from the bundle — never ship
  credentials in the client.
- **`readFile` / `putBinary` do not exist here.** They were Capacitor WKWebView CORS shims. In
  RN, read exported files with `expo-file-system` and upload with `fetch`.
