require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PlaudSdk'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = 'https://plaud.ai'
  # Plaud's frameworks are built for iOS 15+ (arm64 device only).
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Only compile the module's own Swift here; the SDK binaries are vendored below.
  s.source_files = '*.{h,m,swift}'

  # The Plaud SDK, shipped as precompiled binary frameworks. CocoaPods embeds and
  # code-signs these automatically (the PlaudDeviceBasicSDK.bundle is nested inside
  # its .framework, so it comes along for free — no separate resource_bundles needed).
  s.vendored_frameworks = [
    'Frameworks/PlaudBleSDK.xcframework',
    'Frameworks/PlaudWiFiSDK.xcframework',
    'Frameworks/PlaudDeviceBasicSDK.xcframework'
  ]

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
