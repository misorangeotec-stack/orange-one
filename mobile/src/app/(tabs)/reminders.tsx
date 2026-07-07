/**
 * Reminders — leads that have a follow-up action set, grouped by that action.
 * Phase 1 derives these from the contact store; scheduled push comes in Phase 2.
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContactCard } from '@/components/leads/ContactCard';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLeads } from '@/lib/leads/store';

export default function RemindersScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { contacts, masters } = useLeads();

  const groups = useMemo(() => {
    return masters.followUpActions
      .map((action) => ({
        action,
        items: contacts.filter((c) => c.followUpActionId === action.id),
      }))
      .filter((g) => g.items.length > 0);
  }, [contacts, masters.followUpActions]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.three }]}>
      <View style={styles.inner}>
        <ThemedText type="subtitle">Reminders</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {total} lead{total === 1 ? '' : 's'} need follow-up
        </ThemedText>

        {groups.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-outline" size={40} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">No pending follow-ups.</ThemedText>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.action.id} style={styles.group}>
              <View style={styles.groupHead}>
                <Ionicons name="flag" size={16} color={theme.textSecondary} />
                <ThemedText type="smallBold">{g.action.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">({g.items.length})</ThemedText>
              </View>
              <View style={styles.list}>
                {g.items.map((c) => <ContactCard key={c.id} contact={c} />)}
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  group: { gap: Spacing.two },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  list: { gap: Spacing.three },
});
