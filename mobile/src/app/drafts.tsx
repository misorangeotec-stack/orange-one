/**
 * Drafts — leads that are still only in this phone's memory (not yet synced to
 * the server), including cards/voice notes still awaiting AI. A clear view of
 * "what's local-only" so nothing is silently stuck.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContactCard } from '@/components/leads/ContactCard';
import { ThemedText } from '@/components/themed-text';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLeads } from '@/lib/leads/store';

export default function DraftsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { contacts, isPending, syncing, syncNow } = useLeads();

  const drafts = useMemo(() => contacts.filter((c) => isPending(c.id)), [contacts, isPending]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <ThemedText type="smallBold" style={styles.headerTitle}>
          Drafts
        </ThemedText>
        {drafts.length > 0 ? (
          <Pressable onPress={syncNow} hitSlop={8}>
            <Ionicons name={syncing ? 'sync-outline' : 'cloud-upload-outline'} size={22} color={Brand.orange} />
          </Pressable>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}>
        <View style={styles.inner}>
          {drafts.length === 0 ? (
            <EmptyState onCreate={() => router.push('/add')} />
          ) : (
            <>
              <View style={[styles.banner, { backgroundColor: Brand.orangeSoft, borderColor: Brand.orange }]}>
                <Ionicons name="cloud-offline-outline" size={18} color={Brand.orange} />
                <ThemedText type="small" style={{ flex: 1, color: Brand.navy }}>
                  {drafts.length} lead{drafts.length === 1 ? '' : 's'} saved on this phone, not yet synced. They upload
                  automatically when you’re online — tap the cloud to sync now.
                </ThemedText>
              </View>
              <View style={styles.list}>
                {drafts.map((c) => (
                  <ContactCard key={c.id} contact={c} />
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.hero, { backgroundColor: Brand.orangeSoft }]}>
        <Ionicons name="id-card-outline" size={64} color={Brand.orange} />
        <View style={styles.heroBadge}>
          <Ionicons name="time-outline" size={20} color="#ffffff" />
        </View>
      </View>

      {/* Flow */}
      <View style={styles.flow}>
        <Step icon="camera-outline" label="Scan / Add" />
        <Ionicons name="ellipsis-horizontal" size={16} color={theme.textSecondary} />
        <Step icon="hourglass-outline" label="Process" />
        <Ionicons name="ellipsis-horizontal" size={16} color={theme.textSecondary} />
        <Step icon="cloud-done-outline" label="Synced" />
      </View>

      <ThemedText type="smallBold" style={styles.emptyTitle}>
        No drafts right now
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
        Leads you capture offline — and cards/voice notes still being read by AI — show here until they sync to the
        server. Everything is safe on your phone in the meantime.
      </ThemedText>

      <Pressable onPress={onCreate} style={[styles.cta, { backgroundColor: Brand.orange }]}>
        <Ionicons name="add" size={20} color="#ffffff" />
        <ThemedText style={styles.ctaText}>Create lead</ThemedText>
      </Pressable>
    </View>
  );
}

function Step({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepIcon, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Ionicons name={icon} size={20} color={Brand.orange} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: 1,
  },
  headerTitle: { flex: 1, fontSize: 16 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Spacing.two + 2, padding: Spacing.three },
  list: { gap: Spacing.three },
  empty: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.six },
  hero: { width: 180, height: 180, borderRadius: 90, alignItems: 'center', justifyContent: 'center' },
  heroBadge: { position: 'absolute', top: 30, right: 44, width: 40, height: 40, borderRadius: 20, backgroundColor: Brand.orange, alignItems: 'center', justifyContent: 'center' },
  flow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  step: { alignItems: 'center', gap: Spacing.one },
  stepIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, marginTop: Spacing.two },
  emptyText: { textAlign: 'center', paddingHorizontal: Spacing.three },
  cta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.three, paddingHorizontal: Spacing.five, borderRadius: Spacing.three, marginTop: Spacing.two },
  ctaText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
});
