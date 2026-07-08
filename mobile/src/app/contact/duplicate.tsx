/**
 * Duplicate card — shown when a freshly-scanned card was found to match an
 * existing contact (flagged with `duplicateOf` by the background read). The user
 * reviews the new card against the similar existing contact(s) and decides:
 *   - "Yes, it's a duplicate!" → discard this new draft.
 *   - "Continue anyway"        → keep it as a separate contact.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContactCard } from '@/components/leads/ContactCard';
import { ImageLightbox } from '@/components/leads/ImageLightbox';
import { MediaImage } from '@/components/leads/MediaImage';
import { ThemedText } from '@/components/themed-text';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { findDuplicates } from '@/lib/leads/dedupe';
import { useLeads } from '@/lib/leads/store';

export default function DuplicateCardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getContact, contacts, deleteContact, updateContact } = useLeads();

  const contact = getContact(id);
  const [zoomUri, setZoomUri] = useState<string | null>(null);

  // The existing contact(s) this card matches: everyone except this draft and any
  // other still-held duplicate. Falls back to the recorded duplicateOf id.
  const matches = useMemo(() => {
    if (!contact) return [];
    const others = contacts.filter((c) => c.id !== contact.id && !c.duplicateOf);
    const found = findDuplicates(contact, others);
    if (found.length) return found;
    const primary = contact.duplicateOf ? getContact(contact.duplicateOf) : undefined;
    return primary ? [primary] : [];
  }, [contact, contacts, getContact]);

  if (!contact) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.background }]}>
        <ThemedText>Card not found.</ThemedText>
        <Pressable onPress={() => router.back()}>
          <ThemedText style={{ color: Brand.orange }}>Go back</ThemedText>
        </Pressable>
      </View>
    );
  }

  const cardUri = contact.cardImages.front || contact.cardImages.back || null;

  const confirmDuplicate = () => {
    deleteContact(contact.id);
    router.back();
  };
  const keepAnyway = () => {
    updateContact(contact.id, { ...contact, duplicateOf: null });
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <ThemedText type="smallBold" style={styles.headerTitle}>Duplicate card</ThemedText>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}>
        <View style={styles.inner}>
          <ThemedText type="subtitle">Review the duplicate card</ThemedText>

          {/* New card image */}
          {cardUri ? (
            <Pressable onPress={() => setZoomUri(cardUri)}>
              <MediaImage uri={cardUri} style={styles.cardImage} contentFit="cover" />
              <View style={styles.zoomHint}>
                <Ionicons name="expand-outline" size={14} color="#ffffff" />
              </View>
            </Pressable>
          ) : null}

          {/* Similar existing contact(s) */}
          <ThemedText type="smallBold" style={styles.similarTitle}>
            Similar card{matches.length === 1 ? '' : 's'}:
          </ThemedText>
          <View style={styles.matchList}>
            {matches.length ? (
              matches.map((m) => <ContactCard key={m.id} contact={m} />)
            ) : (
              <ThemedText type="small" themeColor="textSecondary">The matching contact is no longer available.</ThemedText>
            )}
          </View>

          <View style={[styles.note, { backgroundColor: theme.backgroundSelected }]}>
            <Ionicons name="information-circle-outline" size={18} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
              Confirming this card as a duplicate will remove this card.
            </ThemedText>
          </View>

          {/* Actions */}
          <Pressable onPress={confirmDuplicate} style={[styles.primaryBtn, { backgroundColor: Brand.navy }]}>
            <Ionicons name="copy-outline" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryText}>Yes, it&rsquo;s a duplicate!</ThemedText>
          </Pressable>
          <Pressable onPress={keepAnyway} style={styles.secondaryBtn}>
            <ThemedText style={{ color: '#E5484D', fontWeight: '700' }}>Continue anyway</ThemedText>
          </Pressable>
        </View>
      </ScrollView>

      <ImageLightbox uri={zoomUri} onClose={() => setZoomUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, borderBottomWidth: 1 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  cardImage: { width: '100%', height: 210, borderRadius: Spacing.two },
  zoomHint: { position: 'absolute', right: 8, bottom: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  similarTitle: { fontSize: 15, marginTop: Spacing.one },
  matchList: { gap: Spacing.two },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.two },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingVertical: Spacing.three + 2, borderRadius: Spacing.three, marginTop: Spacing.two },
  primaryText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { alignItems: 'center', paddingVertical: Spacing.three },
});
