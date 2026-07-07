/**
 * Theme tokens for the Orange One mobile app.
 *
 * `Colors` holds the per-scheme (light/dark) palette consumed by the themed
 * primitives (`ThemedText`, `ThemedView`) and screens via `useTheme()`. The
 * brand hues mirror the web portal's Tailwind tokens (see `frontend/vite.config.ts`):
 *   orange  #FF6A1F   ink/navy #0B1B40   page #F6F9FD
 */

import '@/global.css';

import { Platform } from 'react-native';

/** Orange One brand hues, scheme-independent (buttons, accents, splash). */
export const Brand = {
  orange: '#FF6A1F',
  orange2: '#FF8A3D',
  orangeSoft: '#FFF1E8',
  navy: '#0B1B40',
  navy2: '#15294F',
} as const;

export const Colors = {
  light: {
    text: '#0B1B40',
    background: '#F6F9FD',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E9EEF6',
    textSecondary: '#64748B',
    border: '#E9EEF6',
    tint: Brand.orange,
  },
  dark: {
    text: '#F5F7FB',
    background: '#0B1220',
    backgroundElement: '#15294F',
    backgroundSelected: '#1E3560',
    textSecondary: '#8A99B0',
    border: '#1E3560',
    tint: Brand.orange2,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
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
