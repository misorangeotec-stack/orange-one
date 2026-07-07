import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const bg = isPrimary ? Brand.orange : isDanger ? '#E5484D' : variant === 'secondary' ? theme.backgroundElement : 'transparent';
  const fg = isPrimary || isDanger ? '#ffffff' : theme.text;
  const border = variant === 'secondary' ? theme.border : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, borderColor: border, borderWidth: variant === 'secondary' ? 1 : 0 },
        (pressed || busy || disabled) && styles.dim,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <ThemedText style={[styles.label, { color: fg }]}>{label}</ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { fontWeight: '700', fontSize: 15 },
  dim: { opacity: 0.6 },
});
