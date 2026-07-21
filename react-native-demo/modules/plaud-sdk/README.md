# plaud-sdk (local Expo module)

Native iOS bridge to Plaud's device SDK — the React Native counterpart of the Capacitor
`PlaudSdk` plugin. Exposes BLE connect/scan, on-device file listing, and audio export to JS,
plus an event stream for scan results, connection state, device-initiated recording, etc.

## How it's wired
- **Autolinked** via `use_expo_modules!` — Expo scans `./modules` during prebuild, so no
  Podfile or Xcode edits are needed. `expo-module.config.json` registers `PlaudSdkModule`.
- The Plaud SDK ships as three precompiled `.xcframework`s in `ios/Frameworks/`
  (`PlaudBleSDK`, `PlaudDeviceBasicSDK`, `PlaudWiFiSDK`), vendored by `PlaudSdk.podspec`
  (`vendored_frameworks`). CocoaPods embeds and code-signs them automatically.
- BLE permissions (`NSBluetoothAlwaysUsageDescription`, `UIBackgroundModes: bluetooth-central`)
  live in the app's `app.json` under `ios.infoPlist`, so they survive `expo prebuild`.

## ⚠️ Device only
The frameworks are **arm64, iOS 15+, device-only** — there is no simulator slice. You must:
- Run on a **physical iPhone** (`npx expo run:ios --device`), not the simulator.
- Use a **dev build**, not Expo Go (this is custom native code).

On Android / simulator the JS `PlaudSdk` methods reject and `isAvailable` is `false`.

## Usage
```ts
import { PlaudSdk, isAvailable } from 'plaud-sdk';

if (isAvailable) {
  await PlaudSdk.initSDK({ userAccessToken, customDomain: 'platform-us.plaud.ai', userId });
  const sub = PlaudSdk.addListener('scanResult', ({ devices }) => { /* ... */ });
  await PlaudSdk.startScan();
  // ...later: sub.remove();
}
```

## Not ported from the Capacitor plugin
`readFile` / `putBinary` — those existed only to work around WKWebView CORS when Capacitor
loaded a remote origin. React Native has no WebView/CORS constraint: read exported files with
`expo-file-system` and upload with `fetch`.
