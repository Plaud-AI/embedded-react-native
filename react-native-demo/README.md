# react-native-demo

An [Expo](https://expo.dev) (SDK 57) app using [expo-router](https://docs.expo.dev/router/introduction).

This project uses Expo's **managed workflow** with **Continuous Native Generation (CNG)**: the
native `ios/` and `android/` directories are *generated* from `app.json` and config plugins via
`expo prebuild` rather than edited by hand. This README documents how to generate the native
projects and run them on a **physical device** — iOS through Xcode, Android through Gradle.

The Plaud SDK needs real Bluetooth hardware, so a physical device is required on both
platforms (an Android emulator has no BLE radio).

---

## Prerequisites

| Tool | Version used | Install |
| --- | --- | --- |
| Node.js | v24 | https://nodejs.org (or `nvm`) |
| Xcode (iOS) | 26.x | Mac App Store |
| CocoaPods (iOS) | 1.17.0 | `brew install cocoapods` |
| Apple ID / Developer account (iOS) | — | Xcode → Settings → Accounts (free ID works for on-device testing) |
| Android Studio / SDK (Android) | compileSdk 36, JDK 17 | https://developer.android.com/studio |

> `bundleIdentifier` is set to **`ai.plaud.reactnativedemo`** in `app.json` (`expo.ios.bundleIdentifier`),
> and the Android `package` to the same value under `expo.android.package`.
> Change them there — not in Xcode or Gradle — so they survive regeneration.

---

## Build & run on a physical device

### 1. Install JS dependencies

```bash
npm install
```

### 2. Install CocoaPods (one-time, machine-wide)

CocoaPods integrates the native iOS dependencies. Installed via Homebrew:

```bash
brew install cocoapods
```

### 3. Generate the native iOS project (prebuild)

This creates the `ios/` directory (Xcode project + workspace) from `app.json` and runs
`pod install` automatically:

```bash
npx expo prebuild -p ios
```

Re-run this any time you change native config in `app.json` (bundle id, icons, plugins,
permissions, etc.). The `ios/` directory is generated output — prefer regenerating over
hand-editing.

### 4. Open the workspace in Xcode

```bash
open ios/reactnativedemo.xcworkspace
```

⚠️ Always open the **`.xcworkspace`**, never the `.xcodeproj` — CocoaPods requires the workspace.

---

## Build & run on Android

Connect a physical handset with USB debugging enabled, then:

```bash
npx expo prebuild -p android   # generates android/ from app.json
npx expo run:android           # builds and installs the debug APK
```

The Plaud Android SDK (`modules/plaud-sdk/android/libs/plaud-sdk.aar`) is picked up by Expo
autolinking — there are no `settings.gradle` or `build.gradle` edits to make in the app. The
Bluetooth permissions come from the AAR's manifest via manifest merging, and are requested at
runtime by `PlaudSdk.startScan()` on Android 12+.

If Gradle can't find your SDK, point it at one:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
```

---

## Everyday development

Once the app is installed on the device, you usually just need the JS dev server running:

```bash
npm run ios
```

Edit files inside the **app** directory — this project uses
[file-based routing](https://docs.expo.dev/router/introduction).

Lint:

```bash
npx expo lint
```

---

## Notes

- **`ios/` and `android/` are git-ignored generated output.** Don't commit hand edits; make
  native changes in `app.json` / config plugins and re-run prebuild. (The module's own
  `modules/plaud-sdk/android/` source is *not* generated — that one is committed.)
- This project targets **Expo SDK 57** — read the versioned docs at
  https://docs.expo.dev/versions/v57.0.0/ before writing native or config code.
