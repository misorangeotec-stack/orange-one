/**
 * A repeatable input group: one or more text rows, each with add (+) and delete
 * (🗑) affordances (matches the reference Upload-Contact form). Used for mobiles,
 * emails, job titles, websites, addresses.
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function FieldRepeater({
  values,
  onChange,
  placeholder,
  keyboardType,
  repeatable = true,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
  repeatable?: boolean;
}) {
  const theme = useTheme();
  const rows = values.length ? values : [''];

  const setAt = (i: number, text: string) => {
    const next = [...rows];
    next[i] = text;
    onChange(next);
  };
  const add = () => onChange([...rows, '']);
  const removeAt = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    onChange(next.length ? next : ['']);
  };

  return (
    <View style={styles.wrap}>
      {rows.map((val, i) => (
        <View
          key={i}
          style={[styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <TextInput
            style={[styles.input, { color: theme.text }]}
            placeholder={placeholder}
            placeholderTextColor={theme.textSecondary}
            value={val}
            onChangeText={(t) => setAt(i, t)}
            keyboardType={keyboardType}
            autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
            autoCorrect={false}
          />
          {repeatable ? (
            <View style={styles.btns}>
              <Pressable onPress={() => removeAt(i)} hitSlop={6} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={20} color="#E5484D" />
              </Pressable>
              {i === rows.length - 1 ? (
                <Pressable onPress={add} hitSlop={6} style={styles.iconBtn}>
                  <Ionicons name="add" size={22} color="#3B82F6" />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: Spacing.three },
  btns: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconBtn: { padding: 2 },
});
