/**
 * Bottom-sheet single/multi selector backed by a master list. Used for
 * Categories (multi), Interest level (single), What they asked about (multi),
 * Follow-up action (single).
 */

import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MasterItem } from '@/lib/leads/types';

export function SelectSheet({
  visible,
  title,
  options,
  selectedIds,
  multi,
  onClose,
  onChange,
}: {
  visible: boolean;
  title: string;
  options: MasterItem[];
  selectedIds: string[];
  multi: boolean;
  onClose: () => void;
  onChange: (ids: string[]) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const toggle = (id: string) => {
    if (multi) {
      onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
    } else {
      onChange(selectedIds.includes(id) ? [] : [id]);
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.three }]}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <ThemedText type="smallBold">{title}</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: Brand.orange }}>
              Done
            </ThemedText>
          </Pressable>
        </View>
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: Spacing.two }}>
          {options.map((opt) => {
            const selected = selectedIds.includes(opt.id);
            return (
              <Pressable
                key={opt.id}
                onPress={() => toggle(opt.id)}
                style={[styles.option, { borderBottomColor: theme.border }]}>
                {opt.color ? <View style={[styles.dot, { backgroundColor: opt.color }]} /> : null}
                <ThemedText style={styles.optLabel}>{opt.label}</ThemedText>
                {selected ? (
                  <Ionicons name={multi ? 'checkbox' : 'checkmark-circle'} size={22} color={Brand.orange} />
                ) : (
                  <Ionicons name={multi ? 'square-outline' : 'ellipse-outline'} size={22} color={theme.textSecondary} />
                )}
              </Pressable>
            );
          })}
          {options.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No options yet — add some in Settings → Masters.
            </ThemedText>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    maxHeight: '70%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(100,116,139,0.4)', marginBottom: Spacing.two },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.two },
  list: { marginTop: Spacing.one },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, borderBottomWidth: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  optLabel: { flex: 1, fontSize: 15 },
  empty: { paddingVertical: Spacing.four, textAlign: 'center' },
});
