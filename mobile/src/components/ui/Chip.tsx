import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Chip({
  label,
  color,
  selected,
  onPress,
  onRemove,
}: {
  label: string;
  color?: string;
  selected?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const accent = color ?? Brand.orange;
  const bg = selected ? `${accent}22` : theme.backgroundElement;
  const border = selected ? accent : theme.border;
  const fg = selected ? accent : theme.text;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: bg, borderColor: border }]}>
      {color ? <View style={[styles.dot, { backgroundColor: accent }]} /> : null}
      <ThemedText type="small" style={[styles.label, { color: fg }]}>
        {label}
      </ThemedText>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="close" size={14} color={fg} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontWeight: '600' },
});
