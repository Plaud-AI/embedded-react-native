# Android specifics

The Android module (`modules/plaud-sdk/android/src/main/java/expo/modules/plaudsdk/PlaudSdkModule.kt`)
deliberately exposes the same JS surface, event names and payload shapes as iOS. This file
covers the places where the platform underneath genuinely differs — read it before debugging an
Android-only failure or replacing the AAR.

## How it's wired

The SDK ships as one precompiled `android/libs/plaud-sdk.aar`, consumed by
`android/build.gradle` with `api fileTree(dir: 'libs', include: ['*.aar'])`. Its per-ABI native
`.so` libraries (`libopus`, `liblame`, `libjni_ogg`, …) live inside the AAR and are packaged
automatically for all four ABIs. Autolinking picks the module up from `modules/` via
`expo-module.config.json` (`android.modules`), so there are **no `settings.gradle` or app
`build.gradle` edits to make by hand**.

### ⚠️ The AAR's transitive dependencies are declared by hand

`plaud-sdk.aar` is a **bare AAR — it carries no POM**, so Gradle cannot resolve what it depends
on. Every library its bytecode touches is listed explicitly in
`modules/plaud-sdk/android/build.gradle`:

| Dependency | Why the SDK needs it |
| --- | --- |
| kotlinx-coroutines-android | SDK internals |
| Retrofit + converter-gson, OkHttp + logging-interceptor, Gson | `sdk.network.*` |
| Java-WebSocket | `sdk.ble.wifi.*` local WebSocket server for the Wi-Fi transfer path |
| BouncyCastle (`bcprov-jdk18on`) | ChaCha20 in `sdk.ble.util.AudioDecryptor` |
| Conscrypt (`conscrypt-android`) | TLS provider used by `sdk.network.OkHttpCompat` |
| Timber, slf4j-api, logback-android | the SDK logs through both (`res/raw/logback.xml`) |
| Guava | `ThreadFactoryBuilder` in the exporter's thread pool |

Miss one and **the app compiles fine, then dies at runtime with `NoClassDefFoundError`**. If
you upgrade or replace the AAR, re-derive this list by scanning the new AAR's class references.

`packagingOptions` excludes duplicated `META-INF/DEPENDENCIES|LICENSE*|NOTICE*` (logback-android
and slf4j both ship them); dropping that block reintroduces a duplicate-resource build failure.

## Permissions

The Bluetooth/location permissions are declared in the **AAR's own manifest** and reach the app
through manifest merging, so `app.json` needs **no** `android.permissions` block. The module's
own `AndroidManifest.xml` is intentionally empty.

They still have to be *granted at runtime*. The module requests them itself, splitting by API
level to match the set the SDK's own `PermissionManager` checks:

- **API 31+ (Android 12+):** `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION`,
  `ACCESS_COARSE_LOCATION`
- **Below 31:** `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`

`startScan()` requests them and rejects with `ERR_PLAUD_PERMISSIONS` if denied. To prompt
earlier, call the Android-only `requestPermissions()` behind a platform check — it's absent on
iOS, where the Info.plist usage strings do this job:

```ts
if (Platform.OS === 'android') {
  const { granted } = await PlaudSdk.requestPermissions!();
  if (!granted) { /* explain why scanning is unavailable */ }
}
```

If the Bluetooth adapter is off, `startScan()` resolves and emits `scanTimeout` with
`reason: 'bluetoothNotPoweredOn'` rather than hanging — the SDK silently drops scans in that
state. Same event and reason string as iOS.

## ⚠️ The connect handshake has prerequisites iOS handles internally

The Android SDK leaves three steps to the caller, and skipping any of them looks identical from
JS: the scan finds the device, `connectBleDevice()` resolves, then `connectState` reports
`failed: true`. The module does all three — **don't "simplify" them away**:

1. **`initSDK` repoints the Partner API.** `sdk.network.PartnerRetrofitClient` hardcodes
   `https://platform-jp.plaud.ai` and does *not* follow `customDomain`, so a `platform-us`
   token 401s on gen-key, the RSA key pair never arrives, and every handshake after it fails.
   The module calls `NiceBuildSdk.getPartnerApiManager().updateBaseUrl("https://$customDomain")`
   before `PlaudDeviceAgent.initSDK`.
2. **`connectBleDevice` waits for `NiceBuildSdk.isPartnerDataReady()`** (polled, 10 s cap) —
   `initSDK` fetches those keys over HTTP, asynchronously.
3. **…then calls `NiceBuildSdk.signAndStoreDeviceSn(deviceType, sn)`** — the handshake reads the
   stored `snSignature`. `deviceType` comes from the SN prefix: `881` → `notepro`, `880` →
   `notepin`, `882` → `notepins`, otherwise `note`.

Steps 2 and 3 are best-effort (the SDK logs its own failures and the connect still proceeds),
which is why a stale/wrong-region token surfaces as a plain connect failure rather than an
error from `initSDK`.

## Payload fields that differ from iOS

The JS types cover both platforms; four fields are populated differently.

| Field | Android behavior |
| --- | --- |
| `PlaudScanDevice.uuid` | The device's **MAC address**, not a CoreBluetooth UUID. It's still the stable id you pass back, so `connectBleDevice({ uuid })` works unchanged. |
| `PlaudScanDevice.supportWiFi` | Always `false` — the Android scan payload carries no Wi-Fi capability flag. |
| `PlaudPenState` | Only `state`, `privacy`, `keyState`, `uDisk` are present. `findMyToken` / `hasSndpKey` / `deviceAccessToken` are iOS-only and optional in the type. |
| `PlaudFile.duration` | Computed from file size and channel count (`calculateOpusDuration`), exact for raw Opus. For OGG-contained recordings it's a slight **over-estimate** — the Android SDK's `calculateOggDuration` needs page geometry it never exposes. |

Android's `BleFile` also carries no `sn` / `channels` / `isOgg` of its own; those are properties
of the connected device, so the module reads them from the device it connected to — which is
what the SDK itself does when decoding. Consequence: **connect before calling `getFileList`**,
or those fields have nothing to read from.

## Export output

`exportAudio` writes to `filesDir/PlaudExports`, which is what `expo-file-system` exposes as
`documentDirectory` — the same relative location as iOS's `Documents/PlaudExports`, so JS-side
path handling is identical. Prefix the returned absolute path with `file://` before handing it
to `expo-file-system` / `fetch`.

## Running

`npx expo prebuild -p android && npx expo run:android`, on a **physical handset** — an emulator
has no BLE radio. Requires Android Studio / the Android SDK and JDK 17. The first build is slow
while all the hand-declared dependencies resolve.
