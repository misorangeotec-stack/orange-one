import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { Brand } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Deterministic pseudo-random bar heights (no real FFT — a visual affordance).
const BARS = Array.from({ length: 40 }, (_, i) => 6 + Math.abs(Math.sin(i * 1.7) * 18) + (i % 3) * 3);

// Fewer, chunkier bars for the live recording equalizer.
const REC_BARS = Array.from({ length: 28 }, (_, i) => 8 + Math.abs(Math.sin(i * 1.3) * 20));

/**
 * Waveform.
 *   - `recording`: live capture → an animated equalizer (bars pulse at varying heights).
 *   - `progress` (0..1) + `active`: playback → fills bars up to the play head.
 *   - otherwise: a flat, idle waveform.
 */
export function Waveform({ progress = 0, active = false, recording = false }: { progress?: number; active?: boolean; recording?: boolean }) {
  const theme = useTheme();

  if (recording) return <RecordingWave />;

  return (
    <View style={styles.row}>
      {BARS.map((h, i) => {
        const filled = active && i / BARS.length <= progress;
        return (
          <View
            key={i}
            style={[styles.bar, { height: h, backgroundColor: filled ? Brand.orange : theme.backgroundSelected }]}
          />
        );
      })}
    </View>
  );
}

/** Live recording equalizer — each bar loops between a low and full scale, out of phase. */
function RecordingWave() {
  // Start each bar at a different height so it never reads as a solid/full block.
  const vals = useRef(REC_BARS.map((_, i) => new Animated.Value(0.25 + ((i * 7) % 10) / 13))).current;

  useEffect(() => {
    const loops = vals.map((v, i) => {
      const up = 360 + ((i * 53) % 320); // varied durations → bars drift out of sync = lively
      const down = 320 + ((i * 37) % 300);
      return Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: up, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: down, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
    });
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [vals]);

  return (
    <View style={styles.row}>
      {REC_BARS.map((h, i) => (
        <Animated.View
          key={i}
          style={[styles.bar, { height: h, backgroundColor: Brand.orange, transform: [{ scaleY: vals[i] }] }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1, height: 40 },
  bar: { width: 3, borderRadius: 2 },
});
