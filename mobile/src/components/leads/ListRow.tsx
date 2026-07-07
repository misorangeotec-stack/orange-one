import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A settings-style row: leading icon tile, label, and a trailing value/chevron. */
export function ListRow({
  icon,
  label,
  value,
  onPress,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.border }, last && styles.last, pressed && styles.pressed]}>
      <View style={[styles.iconTile, { backgroundColor: Brand.orangeSoft }]}>
        <Ionicons name={icon} size={18} color={Brand.orange} />
      </View>
      <ThemedText style={styles.label}>{label}</ThemedText>
      {value ? (
        <ThemedText type="small" themeColor="textSecondary">
          {value}
        </ThemedText>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 1,
  },
  last: { borderBottomWidth: 0 },
  pressed: { opacity: 0.6 },
  iconTile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 15 },
});
