import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { PlaudColors } from '@/constants/theme';

/**
 * Named icons used across the Plaud screens, mapped to SF Symbols. Mirrors the
 * lucide set from the Next.js demo's icons.tsx (radar / unlink / refresh /
 * file-audio / file-text / close). SF Symbols render on iOS; on other platforms
 * SymbolView falls back gracefully.
 */
const SYMBOLS = {
  radar: 'dot.radiowaves.left.and.right',
  unlink: 'bolt.horizontal.circle',
  refresh: 'arrow.clockwise',
  fileAudio: 'waveform',
  fileText: 'doc.text',
  close: 'xmark',
  check: 'checkmark.circle.fill',
  play: 'play.circle.fill',
} satisfies Record<string, SymbolViewProps['name']>;

export type PlaudIconName = keyof typeof SYMBOLS;

type IconProps = {
  name: PlaudIconName;
  size?: number;
  color?: string;
  weight?: SymbolViewProps['weight'];
};

export function Icon({ name, size = 18, color = PlaudColors.textLight, weight = 'medium' }: IconProps) {
  return (
    <SymbolView
      name={SYMBOLS[name]}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
    />
  );
}
