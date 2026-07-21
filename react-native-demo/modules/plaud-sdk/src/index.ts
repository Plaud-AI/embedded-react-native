import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import type { PlaudSdkModule } from './PlaudSdk.types';

export * from './PlaudSdk.types';

/**
 * The native Plaud SDK module. Only present on iOS (the SDK ships as arm64 device-only
 * xcframeworks — no simulator/Android). `requireNativeModule` throws if the native module
 * isn't linked, so we resolve it lazily and expose `isAvailable` for call-site guards.
 */
let nativeModule: PlaudSdkModule | null = null;
try {
  if (Platform.OS === 'ios') {
    nativeModule = requireNativeModule<PlaudSdkModule>('PlaudSdk');
  }
} catch {
  nativeModule = null;
}

/** True when the native module is linked and callable (a physical iOS device). */
export const isAvailable: boolean = nativeModule != null;

/**
 * Typed handle to the native module. When it isn't available (Android / simulator), method
 * calls reject and `addListener` is a harmless no-op — check `isAvailable` before use.
 */
export const PlaudSdk: PlaudSdkModule =
  nativeModule ??
  (new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'addListener' || prop === 'removeListener' || prop === 'removeAllListeners') {
          return () => ({ remove() {} });
        }
        return () =>
          Promise.reject(new Error('PlaudSdk native module is unavailable on this platform'));
      },
    },
  ) as PlaudSdkModule);

export default PlaudSdk;
