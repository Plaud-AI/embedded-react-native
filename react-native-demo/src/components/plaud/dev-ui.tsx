import { type ReactNode, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type TextProps,
  View,
  type ViewProps,
} from 'react-native';

import { Fonts, PlaudColors, PlaudRadius } from '@/constants/theme';
import { Icon, type PlaudIconName } from './icon';

/* ---------- Text ---------- */

export function Mono({ style, ...rest }: TextProps) {
  return <Text style={[styles.mono, style]} {...rest} />;
}

export function Overline({ style, ...rest }: TextProps) {
  return <Text style={[styles.overline, style]} {...rest} />;
}

/* ---------- Card ---------- */

export function DevCard({ style, ...rest }: ViewProps) {
  return <View style={[styles.card, style]} {...rest} />;
}

/* ---------- Button ---------- */

type DevButtonProps = PressableProps & {
  label: string;
  icon?: PlaudIconName;
  variant?: 'primary' | 'destructive' | 'secondary';
  disabled?: boolean;
};

export function DevButton({
  label,
  icon,
  variant = 'primary',
  disabled,
  style,
  ...rest
}: DevButtonProps) {
  const tint =
    variant === 'primary'
      ? PlaudColors.black
      : variant === 'destructive'
        ? PlaudColors.statusError
        : PlaudColors.textWhite;

  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'destructive' && styles.btnDestructive,
        variant === 'secondary' && styles.btnSecondary,
        pressed && styles.pressed,
        disabled && styles.btnDisabled,
        style as object,
      ]}
      {...rest}>
      {icon && <Icon name={icon} size={18} color={tint} />}
      <Text style={[styles.btnLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

/* ---------- Row (tappable list item) ---------- */

export function DevRow({ style, children, ...rest }: PressableProps & { children: ReactNode }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed, style as object]}
      {...rest}>
      {children}
    </Pressable>
  );
}

/* ---------- Status pill ---------- */

export function Pill({ children, style }: { children: ReactNode; style?: ViewProps['style'] }) {
  return <View style={[styles.pill, style]}>{children}</View>;
}

/* ---------- Recording dot (pulsing) ---------- */

export function RecDot() {
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <Animated.View style={[styles.recDot, { opacity: anim, transform: [{ scale: anim }] }]} />
  );
}

/* ---------- Waveform (live recording) ---------- */

function WaveBar({ delay }: { delay: number }) {
  const anim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 500,
          delay,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0.35,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return <Animated.View style={[styles.waveBar, { transform: [{ scaleY: anim }] }]} />;
}

export function WaveBars() {
  return (
    <View style={styles.waveRow}>
      {[0, 1, 2, 3, 4].map((i) => (
        <WaveBar key={i} delay={i * 120} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mono: {
    fontFamily: Fonts.mono,
    color: PlaudColors.textLight,
  },
  overline: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: PlaudColors.textFaint,
    fontWeight: '600',
  },
  card: {
    backgroundColor: PlaudColors.surfaceCard,
    borderWidth: 1,
    borderColor: PlaudColors.borderSubtle,
    borderRadius: PlaudRadius.sm,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 24,
    borderRadius: PlaudRadius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btnPrimary: {
    backgroundColor: PlaudColors.white,
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderColor: PlaudColors.borderSubtle,
  },
  btnDestructive: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(241, 80, 66, 0.4)',
  },
  btnDisabled: {
    opacity: 0.3,
  },
  btnLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    backgroundColor: PlaudColors.surfaceInput,
    borderWidth: 1,
    borderColor: PlaudColors.borderSubtle,
    borderRadius: PlaudRadius.sm,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  pressed: {
    opacity: 0.7,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: PlaudRadius.pill,
    borderWidth: 1,
    borderColor: PlaudColors.borderSubtle,
  },
  recDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: PlaudColors.statusError,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 22,
  },
  waveBar: {
    width: 3,
    height: 22,
    borderRadius: 999,
    backgroundColor: PlaudColors.statusError,
  },
});
