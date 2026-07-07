/**
 * Home dashboard — greeting, a capture stat, search + sort + interest filter,
 * and the list of captured leads (company header + person via ContactCard).
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContactCard } from '@/components/leads/ContactCard';
import { SyncChip } from '@/components/leads/SyncChip';
import { ThemedText } from '@/components/themed-text';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLeads } from '@/lib/leads/store';

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { contacts, masters, ready, isPending } = useLeads();

  const draftCount = useMemo(() => contacts.filter((c) => isPending(c.id)).length, [contacts, isPending]);

  const [query, setQuery] = useState('');
  const [sortRecent, setSortRecent] = useState(true);
  const [interestFilter, setInterestFilter] = useState<string | null>(null);

  // Home shows only fully-processed, synced leads. Drafts (not yet pushed, or
  // still being read by AI) belong to the Drafts screen until they complete.
  const liveContacts = useMemo(() => contacts.filter((c) => !isPending(c.id)), [contacts, isPending]);

  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return liveContacts.filter((c) => new Date(c.capturedOn).toDateString() === today).length;
  }, [liveContacts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = liveContacts.filter((c) => {
      if (interestFilter && c.interestLevelId !== interestFilter) return false;
      if (!q) return true;
      return (
        c.person.name.toLowerCase().includes(q) ||
        c.company.name.toLowerCase().includes(q) ||
        c.person.emails.some((e) => e.toLowerCase().includes(q)) ||
        c.person.jobTitles.some((t) => t.toLowerCase().includes(q))
      );
    });
    list = [...list].sort((a, b) =>
      sortRecent
        ? +new Date(b.capturedOn) - +new Date(a.capturedOn)
        : a.person.name.localeCompare(b.person.name)
    );
    return list;
  }, [liveContacts, query, interestFilter, sortRecent]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.three }]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>
        {/* Greeting */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={[styles.avatar, { backgroundColor: Brand.orangeSoft }]}>
              <Ionicons name="business" size={20} color={Brand.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="small" themeColor="textSecondary">
                ORANGE ONE
              </ThemedText>
              <ThemedText type="subtitle" style={styles.title}>
                Leads
              </ThemedText>
            </View>
            <Pressable onPress={() => router.push('/drafts')} hitSlop={8} style={styles.draftsBtn}>
              <Ionicons name="documents-outline" size={22} color={theme.text} />
              {draftCount > 0 ? (
                <View style={styles.draftsBadge}>
                  <ThemedText style={styles.draftsBadgeText}>{draftCount > 99 ? '99+' : draftCount}</ThemedText>
                </View>
              ) : null}
            </Pressable>
            <SyncChip />
          </View>
        </View>

        {/* Stat card */}
        <View style={[styles.stat, { backgroundColor: Brand.navy }]}>
          <View>
            <ThemedText type="title" style={styles.statNum}>
              {contacts.length}
            </ThemedText>
            <ThemedText type="small" style={styles.statLabel}>
              Leads captured
            </ThemedText>
          </View>
          <View style={styles.statDivider} />
          <View>
            <ThemedText type="title" style={styles.statNum}>
              {todayCount}
            </ThemedText>
            <ThemedText type="small" style={styles.statLabel}>
              Today
            </ThemedText>
          </View>
        </View>

        {/* Search + sort */}
        <View style={styles.searchRow}>
          <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <Ionicons name="search" size={18} color={theme.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              placeholder="Search company, name…"
              placeholderTextColor={theme.textSecondary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
          </View>
          <Pressable
            onPress={() => setSortRecent((s) => !s)}
            style={[styles.iconCircle, { borderColor: theme.border }]}>
            <Ionicons name={sortRecent ? 'time-outline' : 'text-outline'} size={18} color={Brand.orange} />
          </Pressable>
        </View>

        {/* Interest filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <FilterChip label="All" active={!interestFilter} onPress={() => setInterestFilter(null)} />
          {masters.interestLevels.map((lvl) => (
            <FilterChip
              key={lvl.id}
              label={lvl.label}
              color={lvl.color}
              active={interestFilter === lvl.id}
              onPress={() => setInterestFilter((cur) => (cur === lvl.id ? null : lvl.id))}
            />
          ))}
        </ScrollView>

        {/* List */}
        {!ready ? null : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="albums-outline" size={40} color={theme.textSecondary} />
            <ThemedText type="smallBold">No leads yet</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              Tap the + button to scan a business card or add a lead manually.
            </ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((c) => (
              <ContactCard key={c.id} contact={c} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function FilterChip({ label, color, active, onPress }: { label: string; color?: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  const accent = color ?? Brand.orange;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? `${accent}22` : theme.backgroundElement, borderColor: active ? accent : theme.border }]}>
      {color ? <View style={[styles.chipDot, { backgroundColor: accent }]} /> : null}
      <ThemedText type="small" style={{ color: active ? accent : theme.textSecondary, fontWeight: '600' }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  header: { gap: Spacing.two },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  draftsBtn: { padding: 4 },
  draftsBadge: { position: 'absolute', top: -2, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#F8B62B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  draftsBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '700' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: -4 },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    borderRadius: Spacing.three,
    padding: Spacing.four,
  },
  statNum: { color: '#ffffff', fontSize: 34, lineHeight: 38 },
  statLabel: { color: 'rgba(255,255,255,0.7)' },
  statDivider: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.2)' },
  searchRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 15 },
  iconCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: Spacing.two, paddingVertical: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.one + 2, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  list: { gap: Spacing.three },
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  center: { textAlign: 'center', paddingHorizontal: Spacing.four },
});
