/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/**
 * Plaud "dev" design language — dark-surface tokens lifted from the Next.js demo's
 * globals.css (plaud-design-system/dev/colors_and_type.css). The Plaud screens are
 * dark-only, so these are used directly rather than through the light/dark Colors map.
 */
export const PlaudColors = {
  black: '#000000',
  white: '#ffffff',

  surface: '#0f0f0f',
  surfaceFooter: '#090909',
  surfaceInput: '#1d1d1d',
  surfaceCard: 'rgba(29, 29, 29, 0.7)',

  textWhite: '#ffffff',
  textLight: '#ebebeb',
  textMuted: '#adadad',
  textDim: '#858585',
  textFaint: '#5c5c5c',

  borderSubtle: '#333333',
  borderFocus: '#5c5c5c',

  accentBlue: '#00d0ff',
  statusError: '#f15042',
  statusOk: '#36d96c',
  statusWarn: '#fabe3e',
} as const;

export const PlaudRadius = {
  sm: 5,
  pill: 999,
} as const;
