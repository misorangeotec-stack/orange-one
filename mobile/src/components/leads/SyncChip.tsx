/**
 * Header sync-status chip: "Syncing…" / "N pending" / "All synced". Tap to force
 * a sync. Reflects both the push outbox and any offline-captured AI still owed.
 */

import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLeads } from '@/lib/leads/store';

export function SyncChip() {
  const theme = useTheme();
  const { syncing, pendingCount, syncNow } = useLeads();
  const pending = pendingCount;

  // Only look "busy" when there is real work to push. A quiet background pull
  // (nothing pending) stays "Synced" so the chip isn't constantly churning.
  const cfg =
    syncing && pending > 0
      ? { icon: 'sync-outline' as const, text: 'Syncing…', color: Brand.orange }
      : pending > 0
        ? { icon: 'cloud-offline-outline' as const, text: `${pending} pending`, color: '#F8B62B' }
        : { icon: 'cloud-done-outline' as const, text: 'Synced', color: '#27AE60' };

  return (
    <Pressable
      onPress={syncNow}
      style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
      <Ionicons name={cfg.icon} size={15} color={cfg.color} />
      <ThemedText type="small" style={{ color: cfg.color, fontWeight: '600' }}>
        {cfg.text}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one + 1,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: 999,
    borderWidth: 1,
  },
});
