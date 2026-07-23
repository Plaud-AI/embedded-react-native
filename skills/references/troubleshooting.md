# Plaud RN module — troubleshooting

Symptom → cause → fix. Most problems trace back to the device-only constraint or to skipping a
setup step.

## `isAvailable` is `false` / every method rejects with "native module is unavailable"

The native module isn't linked and callable in this context. Causes, most common first:

- **Running on the simulator or Android.** The frameworks are arm64 iOS-device-only — there is
  no simulator slice and no Android build. Run on a physical iPhone:
  `npx expo run:ios --device`. This is expected behavior off-device, not a bug — the app
  should degrade gracefully.
- **Using Expo Go.** This is custom native code; Expo Go can't load it. Use a custom dev build.
- **Module not autolinked.** Confirm `modules/plaud-sdk/` exists at the app root, `package.json`
  has `"plaud-sdk": "file:./modules/plaud-sdk"`, you ran `npm install`, then re-ran
  `npx expo prebuild -p ios`. `expo-module.config.json` must be present (it registers
  `PlaudSdkModule`).

## App crashes on launch or when scanning

Missing `NSBluetoothAlwaysUsageDescription`. iOS hard-crashes any Bluetooth access without a
usage-description string. Add it (and `UIBackgroundModes: ["bluetooth-central"]`) under
`expo.ios.infoPlist` in `app.json`, then `npx expo prebuild -p ios` to regenerate.

## `startScan` resolves but no `scanResult` ever fires

- **Bluetooth off or permission denied.** The module waits ~18s for CoreBluetooth to power on,
  then emits `scanTimeout` with `reason: 'bluetoothNotPoweredOn'`. Handle that event — prompt
  the user to enable Bluetooth and grant permission.
- **No device advertising.** The Plaud recorder must be on and in range. `scanResult` fires
  repeatedly with a growing device list; give it a few seconds.

## `connectBleDevice` rejects with `ERR_PLAUD_UNKNOWN_DEVICE`

You must **scan before you connect** — the native side caches the `BleDevice` objects from
`scanResult` and looks them up by `uuid`/`serialNumber`. Connect using a `uuid` from a device
that appeared in a `scanResult`, in the same session (don't connect to a hardcoded id).

## `connectState` reports `failed: true`

Handshake failure (`state` ∈ {2, -1, -2}), distinct from a normal disconnect (`state` 0).
Usually signal/range or a token mismatch. Move the device closer and retry. Confirm `initSDK`
ran with a valid `userAccessToken` and the `userId`/`deviceToken` that binds the device.

## `initSDK` rejects `ERR_PLAUD_ARGS`

`userAccessToken` or `customDomain` is empty. `customDomain` must be **domain-only** —
`platform-us.plaud.ai`, not `https://platform-us.plaud.ai`.

## `exportAudio` never completes / `ERR_PLAUD_EXPORT`

- Watch `exportProgress` events to see how far it got.
- The output lands in `Documents/PlaudExports`. The resolved `outputPath` may lack the
  `file://` scheme — add it before passing to `expo-file-system` / `fetch`.
- Ensure the device stayed connected throughout; a disconnect mid-export aborts it.

## Pod install / build failures after adding the module

- Re-run `npx expo prebuild -p ios` (regenerates `ios/` and runs `pod install`). Never
  hand-edit `ios/` in an Expo app — it's generated and your edits get wiped.
- Bare RN app managing `ios/` by hand: run `pod install` from `ios/` directly.
- Confirm CocoaPods is installed (`brew install cocoapods`) and Xcode 16+/iOS 15+ deployment
  target. The podspec pins `:ios => '15.1'`.
- The three `.xcframework`s must have copied over with the module (they're large binaries under
  `modules/plaud-sdk/ios/Frameworks/`). A shallow copy that dropped them breaks the vendored
  frameworks link.

## Transcription upload throws "creating blobs from arraybuffer are not supported"

RN's Blob polyfill. Don't use `file.slice()`; PUT `Uint8Array` chunks instead. See
`references/transcription-and-tokens.md` — the demo's `plaud-transcription.ts` already does
this correctly.
