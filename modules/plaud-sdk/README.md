# plaud-sdk (local Expo module)

Native bridge to Plaud's device SDK on **iOS and Android** — the React Native counterpart of
the Capacitor `PlaudSdk` plugin. Exposes BLE scan/connect, on-device file listing, and audio
export to JS, plus an event stream for scan results, connection state, device-initiated
recording, etc.

Both platforms implement the **same JS surface, event names and payload shapes**
(`src/PlaudSdk.types.ts` describes both), so app code needs no platform branches.

| | iOS | Android |
|---|---|---|
| Native source | `ios/PlaudSdkModule.swift` | `android/src/main/java/expo/modules/plaudsdk/PlaudSdkModule.kt` |
| Vendored SDK | `ios/Frameworks/*.xcframework` (3) | `android/libs/plaud-sdk.aar` |
| Registered by | `expo-module.config.json` → `apple.modules` | `expo-module.config.json` → `android.modules` |
| SDK entry point | `PlaudDeviceAgent.shared` | `sdk.PlaudDeviceAgent` (Kotlin object) |

## How it's wired

**Autolinked** — Expo scans `./modules` during prebuild, so there are no Podfile, Xcode,
`settings.gradle` or `build.gradle` edits to make by hand on either platform.

- **iOS** — the SDK ships as three precompiled `.xcframework`s (`PlaudBleSDK`,
  `PlaudDeviceBasicSDK`, `PlaudWiFiSDK`) vendored by `PlaudSdk.podspec`
  (`vendored_frameworks`). CocoaPods embeds and code-signs them automatically.
- **Android** — the SDK ships as `android/libs/plaud-sdk.aar`, consumed by
  `android/build.gradle` via `api fileTree(dir: 'libs', include: ['*.aar'])`. Its native
  `.so` libraries (`libopus`, `liblame`, `libjni_ogg`, …) are inside the AAR and are packaged
  automatically for all four ABIs.

### ⚠️ The AAR's dependencies are declared by hand

`plaud-sdk.aar` is a **bare AAR — it carries no POM**, so Gradle cannot resolve its transitive
dependencies. Every library its bytecode touches is listed explicitly in
`android/build.gradle` (Retrofit, OkHttp, Gson, Java-WebSocket, BouncyCastle, Conscrypt,
Timber, slf4j + logback-android, Guava, coroutines). Miss one and the app compiles fine, then
dies at runtime with `NoClassDefFoundError`. **If you replace the AAR, re-derive that list.**

### Permissions

- **iOS** — `NSBluetoothAlwaysUsageDescription` and `UIBackgroundModes: bluetooth-central`
  live in the app's `app.json` under `ios.infoPlist`.
- **Android** — the Bluetooth/location permissions are declared in the AAR's own manifest and
  reach the app through manifest merging, so `app.json` needs nothing. They must still be
  *granted at runtime* on Android 12+: `startScan()` requests them itself and rejects with
  `ERR_PLAUD_PERMISSIONS` if denied. `PlaudSdk.requestPermissions()` (Android-only) is
  available if you'd rather prompt earlier.

## ⚠️ Physical device only

Both platforms need real Bluetooth hardware and a **dev build** (not Expo Go — this is custom
native code):

- iOS: the frameworks are **arm64, iOS 15+, device-only**, with no simulator slice —
  `npx expo run:ios --device`.
- Android: `npx expo run:android` on a physical handset. An emulator has no BLE radio, so
  scanning emits `scanTimeout` with `reason: "bluetoothNotPoweredOn"`.

Where the module isn't linked (web, iOS simulator), `isAvailable` is `false` and every
`PlaudSdk` method rejects.

## Usage

```ts
import { PlaudSdk, isAvailable } from 'plaud-sdk';

if (isAvailable) {
  await PlaudSdk.initSDK({ userAccessToken, customDomain: 'platform-us.plaud.ai', userId });
  const sub = PlaudSdk.addListener('scanResult', ({ devices }) => { /* ... */ });
  await PlaudSdk.startScan();   // Android: prompts for BLE permissions first
  // ...later: sub.remove();
}
```

## Platform differences

The JS surface is identical, but three payload fields differ because the two native SDKs do:

- **`PlaudScanDevice.uuid`** — the CoreBluetooth peripheral UUID on iOS, the **MAC address**
  on Android. Either way it's the stable identifier you pass back to `connectBleDevice`, so
  `connectBleDevice({ uuid })` works unchanged on both.
- **`PlaudScanDevice.supportWiFi`** — iOS only. Android's scan payload has no Wi-Fi capability
  flag, so it is always `false` there.
- **`PlaudPenState`** — Android's `blePenState` callback carries only `state`, `privacy`,
  `keyState` and `uDisk`; `findMyToken` / `hasSndpKey` / `deviceAccessToken` are iOS-only and
  optional in the type.
- **`PlaudFile.duration`** — Android's `BleFile` has no `duration()`, so it's computed from
  file size and channel count (exact for raw Opus). For OGG-contained recordings it is a
  slight **over-estimate**: the Android SDK's `calculateOggDuration` needs page geometry
  (header size, frames-per-page) that it never exposes.

Android's `BleFile` also carries no `sn` / `channels` / `isOgg` of its own — those are
properties of the connected device, so the module reads them from the device it connected to,
which is what the SDK itself does when decoding.

### ⚠️ Android's connect handshake has prerequisites iOS handles internally

The Android SDK leaves three steps to the caller, and skipping any of them looks the same from
JS: the scan finds the device, `connectBleDevice()` resolves, then `connectState` reports
`failed`. The module does all three — don't "simplify" them away:

1. **`initSDK` must repoint the Partner API.** `sdk.network.PartnerRetrofitClient` hardcodes
   `https://platform-jp.plaud.ai` and does *not* follow `customDomain`, so a `platform-us`
   token 401s on gen-key, the RSA key pair never arrives, and every handshake after it fails.
   The module calls `NiceBuildSdk.getPartnerApiManager().updateBaseUrl("https://$customDomain")`
   before `PlaudDeviceAgent.initSDK`.
2. **`connectBleDevice` must wait for `NiceBuildSdk.isPartnerDataReady()`** (10 s cap) —
   `initSDK` fetches those keys over HTTP, asynchronously.
3. **…then `NiceBuildSdk.signAndStoreDeviceSn(deviceType, sn)`** — the handshake reads the
   stored `snSignature`. `deviceType` comes from the SN prefix (`881` notepro, `880` notepin,
   `882` notepins, else `note`).

## Not ported from the Capacitor plugin

`readFile` / `putBinary` — those existed only to work around WKWebView CORS when Capacitor
loaded a remote origin. React Native has no WebView/CORS constraint: read exported files with
`expo-file-system` and upload with `fetch`.
