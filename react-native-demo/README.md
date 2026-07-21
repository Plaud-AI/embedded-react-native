# react-native-demo

An [Expo](https://expo.dev) (SDK 57) app using [expo-router](https://docs.expo.dev/router/introduction).

This project uses Expo's **managed workflow** with **Continuous Native Generation (CNG)**: the
native `ios/` and `android/` directories are *generated* from `app.json` and config plugins via
`expo prebuild` rather than edited by hand. This README documents how to generate the native iOS
project and run it on a **physical device** through Xcode.

---

## Prerequisites

| Tool | Version used | Install |
| --- | --- | --- |
| Node.js | v24 | https://nodejs.org (or `nvm`) |
| Xcode | 26.x | Mac App Store |
| CocoaPods | 1.17.0 | `brew install cocoapods` |
| Apple ID / Developer account | — | Xcode → Settings → Accounts (free ID works for on-device testing) |

> `bundleIdentifier` is set to **`ai.plaud.reactnativedemo`** in `app.json` (`expo.ios.bundleIdentifier`).
> Change it there — not in Xcode — so it survives regeneration.

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

## Everyday development

Once the app is installed on the device, you usually just need the JS dev server running:

```bash
npx expo start          # then press the device/simulator options in the terminal
# or
npm run ios             # build + run on iOS
npm run android         # build + run on Android
npm run web             # run in the browser
```

Edit files inside the **app** directory — this project uses
[file-based routing](https://docs.expo.dev/router/introduction).

Lint:

```bash
npx expo lint
```

---

## Notes

- **`ios/` is git-ignored generated output.** Don't commit hand edits; make native changes in
  `app.json` / config plugins and re-run prebuild.
- This project targets **Expo SDK 57** — read the versioned docs at
  https://docs.expo.dev/versions/v57.0.0/ before writing native or config code.
