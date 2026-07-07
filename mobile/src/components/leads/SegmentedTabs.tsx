import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Two-way pill toggle (Person info / Company info). */
export function SegmentedTabs({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: theme.backgroundSelected }]}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[styles.tab, active && { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold" style={{ color: active ? Brand.orange : theme.textSecondary }}>
              {opt.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', borderRadius: 999, padding: 4, gap: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two + 2, borderRadius: 999 },
});
