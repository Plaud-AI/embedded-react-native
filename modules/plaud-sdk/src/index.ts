import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { PlaudSdkModule } from './PlaudSdk.types';
export * from './PlaudSdk.types';

let nativeModule: PlaudSdkModule | null = null;
try {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    nativeModule = requireNativeModule<PlaudSdkModule>('PlaudSdk');
  }
} catch {
  nativeModule = null;
}

export const isAvailable: boolean = nativeModule != null;

export const PlaudSdk: PlaudSdkModule = nativeModule ??
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
