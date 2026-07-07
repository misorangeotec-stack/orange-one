/**
 * Home dashboard list item: navy company header + person row with quick actions
 * (call / email) and an interest-level dot. Tapping opens the View card screen.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLeads } from '@/lib/leads/store';
import type { Contact } from '@/lib/leads/types';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ContactCard({ contact }: { contact: Contact }) {
  const theme = useTheme();
  const router = useRouter();
  const { masters, isPending } = useLeads();
  const pending = isPending(contact.id);
  // AI still owed (card read / voice transcription) → show "Processing…" so a
  // draft reads as working, not merely stuck offline.
  const processing = !!contact.pendingExtract || contact.voiceNotes.some((v) => v.status === 'pending');

  const interest = masters.interestLevels.find((i) => i.id === contact.interestLevelId);
  const phone = contact.person.mobiles.find(Boolean) ?? contact.company.mobiles.find(Boolean);
  const email = contact.person.emails.find(Boolean) ?? contact.company.emails.find(Boolean);
  const title = contact.person.jobTitles.find(Boolean);
  const waDigits = phone ? phone.replace(/[^\d]/g, '') : '';

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/contact/[id]', params: { id: contact.id } })}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, pressed && styles.pressed]}>
      {/* Company header */}
      <View style={styles.header}>
        <Ionicons name="business" size={16} color="#ffffff" />
        <ThemedText type="smallBold" style={styles.headerText} numberOfLines={1}>
          {contact.company.name || 'No company'}
        </ThemedText>
        {processing ? (
          <View style={styles.processing}>
            <ActivityIndicator size="small" color="#ffffff" />
            <ThemedText type="small" style={styles.processingText}>Processing…</ThemedText>
          </View>
        ) : pending ? (
          <Ionicons name="cloud-offline-outline" size={15} color="rgba(255,255,255,0.85)" />
        ) : null}
        {interest ? <View style={[styles.interestDot, { backgroundColor: interest.color ?? Brand.orange }]} /> : null}
      </View>

      {/* Person row */}
      <View style={styles.body}>
        <View style={styles.avatar}>
          {contact.person.photoUri ? (
            <Image source={{ uri: contact.person.photoUri }} style={styles.avatarImg} contentFit="cover" />
          ) : (
            <Ionicons name="person" size={20} color={theme.textSecondary} />
          )}
        </View>

        <View style={styles.info}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {contact.person.name || 'Unnamed'}
          </ThemedText>
          {title ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {title}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.date}>
            {formatDate(contact.capturedOn)}
          </ThemedText>
        </View>

        <View style={styles.actions}>
          {waDigits ? (
            <Pressable onPress={() => Linking.openURL(`https://wa.me/${waDigits}`)} hitSlop={6} style={[styles.actionBtn, { backgroundColor: '#25D36618' }]}>
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            </Pressable>
          ) : null}
          {email ? (
            <Pressable onPress={() => Linking.openURL(`mailto:${email}`)} hitSlop={6} style={[styles.actionBtn, { backgroundColor: Brand.orangeSoft }]}>
              <Ionicons name="mail" size={18} color={Brand.orange} />
            </Pressable>
          ) : null}
          {phone ? (
            <Pressable onPress={() => Linking.openURL(`tel:${phone.replace(/\s/g, '')}`)} hitSlop={6} style={[styles.actionBtn, { backgroundColor: '#27AE6018' }]}>
              <Ionicons name="call" size={18} color="#27AE60" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Spacing.three, borderWidth: 1, overflow: 'hidden' },
  pressed: { opacity: 0.85 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Brand.navy,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
  },
  headerText: { color: '#ffffff', flex: 1 },
  processing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  processingText: { color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
  interestDot: { width: 10, height: 10, borderRadius: 5 },
  body: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(100,116,139,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: 44, height: 44 },
  info: { flex: 1, gap: 1 },
  date: { marginTop: 2 },
  actions: { flexDirection: 'row', gap: 6 },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
