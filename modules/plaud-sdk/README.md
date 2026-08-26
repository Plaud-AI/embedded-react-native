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
  live in the app's `app.json` under `ios.infoPlist`. Wi-Fi fast transfer needs two more plist
  keys and two entitlements — see [Wi-Fi fast transfer](#wi-fi-fast-transfer).
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
  flag, so it is always `false` there. It says nothing about whether Wi-Fi fast transfer works:
  on Android, probe a *connected* device with `getWifiTransferState()` / `startWifiTransfer()`.
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

## Wi-Fi fast transfer

Instead of streaming a recording over BLE, the recorder can bring up its own Wi-Fi AP; the phone
joins it and files come across a local WebSocket. It is dramatically faster, and it reuses the same
export contract, so switching an existing call site over is a one-word change:

```ts
await PlaudSdk.startWifiTransfer();            // device must already be BLE-connected
// wifiState walks: openingHotspot → connecting → connected → handshakeCompleted → ready
// Both platforms show a system "Join Wi-Fi network?" prompt the user must accept.
// On `ready` the module requests the file list itself — a `wifiFileList` event follows.
const { outputPath } = await PlaudSdk.exportAudioViaWiFi({ sessionId, format: 'mp3' });
await PlaudSdk.deleteWifiFiles({ sessionIds });  // only after every transfer has finished
await PlaudSdk.stopWifiTransfer();               // also closes the device's AP
```

Implemented on **both platforms** with identical method names, event names, payload shapes and
error codes, so no `Platform.OS` branch is needed.

### iOS setup

Wi-Fi transfer is the one feature that needs app-level configuration. In an Expo app the `ios/`
directory is generated, so it goes in `app.json` and survives `expo prebuild`:

```jsonc
{
  "expo": {
    "ios": {
      "entitlements": {
        "com.apple.developer.networking.HotspotConfiguration": true,
        "com.apple.developer.networking.wifi-info": true
      },
      "infoPlist": {
        "NSLocalNetworkUsageDescription": "…transfer recordings over Wi-Fi.",
        "NSLocationWhenInUseUsageDescription": "…identify and join your recorder's hotspot."
      }
    }
  }
}
```

**Hotspot Configuration is a provisioning-profile-gated capability.** It has to be enabled on the
App ID in the Apple developer portal, and a free personal team cannot enable it — signing fails
otherwise.

`NEHotspotConfiguration` also needs **granted When-In-Use location**; without it the join fails with
no useful reason. `startWifiTransfer` requests it before touching BLE and rejects
`ERR_PLAUD_WIFI_PREREQ` if it has been denied. iOS additionally prompts for Local Network access the
first time the SDK binds its WebSocket — there is no API to pre-request that one.

### Android setup

**`app.json` needs nothing.** `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`, `CHANGE_NETWORK_STATE` and
`ACCESS_NETWORK_STATE` all arrive from the AAR's manifest, and the runtime `ACCESS_FINE_LOCATION`
the SDK needs to read the SSID is already requested for BLE scanning.

### ⚠️ Things the module handles that you must not "simplify" away

1. **BLE must be connected when the transfer starts** — the SDK lifts the ChaCha20-Poly1305 session
   keys off the BLE link at that moment. Both platforms reject `ERR_PLAUD_WIFI_PREREQ` otherwise.
2. **Any in-flight sync must stop first.** On Android the device then needs ~1.5 s to go idle, or
   openWiFi answers status 4 and the join fails with error 1003.
3. **The SDK does not fetch the file list itself.** The module requests it once the session is
   usable, guarded to fire once per session; JS just receives a `wifiFileList` event.
4. **Delete only after every transfer finishes.** A `deleteWifiFiles()` between transfers disrupts
   the WebSocket. Likewise, don't force-close: let the device self-disconnect.
5. **Teardown is not just "disconnect".** Android goes through `NiceBuildSdk.stopWifiTransfer()` and
   iOS through `setDeviceWiFi(open: false)` → `endWiFiTransfer()` → `PlaudWiFiAgent.disconnect()`.
   The naive calls tear down the phone side and leave the recorder in Wi-Fi mode until a ~2 minute
   firmware timeout. Both platforms also run this on module destroy, so a JS reload mid-session
   doesn't leave the handset stranded on the recorder's AP with no internet.

An app that adds its own BLE auto-reconnect must suppress it for the duration of a Wi-Fi session:
the device drops BLE to run its AP, and reconnecting mid-handshake kills the transfer. (This module
has no auto-reconnect, so there's nothing to suppress today.)

### iOS-specific details

The iOS SDK exposes a lower-level surface than Android's `IWifiTransferAgent`, so
`PlaudWifiController.swift` derives what JS sees. Worth knowing:

- **`PlaudWifiFile.fileName` is synthesised** as `"<sn>-<sessionId>"`. Android's device payload
  carries a real name; iOS's `BleFile` has none.
- **`wifiBattery.charging` is always `false`** — iOS's `wifiPower` callback has no charging flag.
- **`wifiState` is tracked by the module.** iOS has no connection-state enum, so the states are
  derived from `bleWiFiOpen` → `wifiConnectionStatus` → `wifiHandshake` → `wifiClose`.
- **`wifiError.code` is mapped, not passed through.** Android forwards its SDK's own numbers; iOS
  maps its callbacks onto the same code space so call sites can branch identically.
- A **185 s connect watchdog** backs the SDK's own 180 s join budget, and the module waits **3 s**
  after the device reports its AP up before joining — the reference app's timings, both load-bearing.

### Raw downloads are not exposed

Earlier versions had `downloadWifiFile` / `downloadAllWifiFiles`. They wrote the device's stream
**verbatim** — still encrypted, no container — producing `.opus` blobs that could not be played,
timed or transcribed, and they have been removed from both platforms. `exportAudioViaWiFi` runs the
same decode pipeline as the BLE path and is the only Wi-Fi transfer path; it reports completion by
resolving its own promise.

## Not ported from the Capacitor plugin

`readFile` / `putBinary` — those existed only to work around WKWebView CORS when Capacitor
loaded a remote origin. React Native has no WebView/CORS constraint: read exported files with
`expo-file-system` and upload with `fetch`.
