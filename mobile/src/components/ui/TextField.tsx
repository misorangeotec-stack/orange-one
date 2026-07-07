import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TextField({
  label,
  style,
  ...props
}: TextInputProps & { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.border },
          style,
        ]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one, flex: 1 },
  label: { paddingHorizontal: Spacing.half },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two + 2,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
    minHeight: 52,
  },
});
