/**
 * View card — a captured lead. Person / Company segmented tabs. Person shows
 * identity, categories, notes, voice notes (play + add), and tap-to-call/email.
 * Company shows web/address, an insights placeholder, card images, and the
 * capture location + time.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ImageLightbox } from '@/components/leads/ImageLightbox';
import { MediaImage } from '@/components/leads/MediaImage';
import { SegmentedTabs } from '@/components/leads/SegmentedTabs';
import { VoicePlayer } from '@/components/leads/VoicePlayer';
import { VoiceRecorder, type RecordedVoice } from '@/components/leads/VoiceRecorder';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/Chip';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { autofillFromVoice } from '@/lib/leads/suggestions';
import { newId, useLeads } from '@/lib/leads/store';
import type { Contact, VoiceNote } from '@/lib/leads/types';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ViewCardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getContact, updateContact, deleteContact, masters } = useLeads();

  const contact = getContact(id);
  const [tab, setTab] = useState<'person' | 'company'>('person');
  const [zoomUri, setZoomUri] = useState<string | null>(null);

  if (!contact) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.background }]}>
        <ThemedText>Contact not found.</ThemedText>
        <Pressable onPress={() => router.back()}>
          <ThemedText style={{ color: Brand.orange }}>Go back</ThemedText>
        </Pressable>
      </View>
    );
  }

  const patch = (partial: Partial<Contact>) => updateContact(contact.id, { ...contact, ...partial });

  const addVoice = (v: RecordedVoice) => {
    const note: VoiceNote = {
      id: newId('v'),
      uri: v.uri,
      durationMs: v.durationMs,
      transcript: v.transcript,
      summary: v.summary,
      suggestedInterest: v.suggestedInterest,
      followUps: v.followUps,
      status: v.status,
      createdAt: new Date().toISOString(),
    };
    const fill = autofillFromVoice(note, masters, {
      interest: !!contact.interestLevelId,
      followUp: !!contact.followUpActionId,
      notes: !!contact.notes[0]?.text,
    });
    patch({
      voiceNotes: [...contact.voiceNotes, note],
      interestLevelId: fill.interestLevelId ?? contact.interestLevelId,
      followUpActionId: fill.followUpActionId ?? contact.followUpActionId,
      notes: fill.noteText
        ? [...contact.notes, { id: newId('n'), text: fill.noteText, createdAt: new Date().toISOString() }]
        : contact.notes,
    });
  };
  const removeVoice = (vid: string) => patch({ voiceNotes: contact.voiceNotes.filter((n) => n.id !== vid) });

  const confirmDelete = () => {
    Alert.alert('Delete lead', `Remove ${contact.person.name || 'this contact'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteContact(contact.id); router.back(); } },
    ]);
  };

  const source = masters.source.find((s) => s.id === contact.sourceId);
  const categories = masters.categories.filter((c) => contact.categoryIds.includes(c.id));
  const interest = masters.interestLevels.find((i) => i.id === contact.interestLevelId);
  const asked = masters.askedAbout.filter((a) => contact.askedAboutIds.includes(a.id));
  const followUp = masters.followUpActions.find((f) => f.id === contact.followUpActionId);
  const cardImages = [contact.cardImages.front, contact.cardImages.back].filter(Boolean) as string[];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <ThemedText type="smallBold" style={styles.headerTitle}>View card</ThemedText>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push({ pathname: '/contact/new', params: { id: contact.id } })} hitSlop={8}>
            <Ionicons name="create-outline" size={22} color={theme.text} />
          </Pressable>
          <Pressable onPress={confirmDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={22} color="#E5484D" />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}>
        <View style={styles.inner}>
          <SegmentedTabs
            options={[{ key: 'person', label: 'Person info' }, { key: 'company', label: 'Company info' }]}
            value={tab}
            onChange={(k) => setTab(k as 'person' | 'company')}
          />

          {tab === 'person' ? (
            <View style={[styles.card, { borderColor: Brand.orange, backgroundColor: theme.backgroundElement }]}>
              <Row icon="person-circle-outline" value={contact.person.name || 'Unnamed'} strong photo={contact.person.photoUri} onZoom={setZoomUri} />
              {contact.person.jobTitles.filter(Boolean).map((t, i) => (
                <Row key={i} icon="briefcase-outline" value={t} />
              ))}
              <Row icon="business-outline" value={contact.company.name} />

              {source ? <Row icon="megaphone-outline" value={`Source: ${source.label}`} /> : null}
              {categories.length ? (
                <View style={styles.chipRow}>
                  {categories.map((c) => <Chip key={c.id} label={c.label} selected />)}
                </View>
              ) : null}
              {interest ? (
                <View style={styles.chipRow}>
                  <Chip label={interest.label} color={interest.color} selected />
                </View>
              ) : null}
              {asked.length ? (
                <View style={styles.chipRow}>
                  {asked.map((a) => <Chip key={a.id} label={a.label} selected />)}
                </View>
              ) : null}

              {/* Notes */}
              {contact.notes.map((n) => (
                <View key={n.id} style={styles.noteBlock}>
                  <View style={styles.noteHead}>
                    <ThemedText type="small" themeColor="textSecondary">{formatDateTime(n.createdAt)}</ThemedText>
                    <Pressable onPress={() => router.push({ pathname: '/contact/new', params: { id: contact.id } })} hitSlop={6}>
                      <Ionicons name="create-outline" size={18} color={Brand.orange} />
                    </Pressable>
                  </View>
                  <Row icon="document-text-outline" value={n.text} />
                </View>
              ))}
              <Pressable onPress={() => router.push({ pathname: '/contact/new', params: { id: contact.id } })} style={styles.addRow}>
                <Ionicons name="add-circle-outline" size={20} color={Brand.orange} />
                <ThemedText style={{ color: Brand.orange }}>Add Notes</ThemedText>
              </Pressable>

              {/* Voice notes */}
              {contact.voiceNotes.map((n) => (
                <VoicePlayer key={n.id} note={n} onDelete={() => removeVoice(n.id)} />
              ))}
              <VoiceRecorder onRecorded={addVoice} />

              {/* Contact actions */}
              {contact.person.mobiles.filter(Boolean).map((m, i) => (
                <View key={`m${i}`} style={styles.contactRow}>
                  <Pressable style={styles.contactMain} onPress={() => Linking.openURL(`tel:${m.replace(/\s/g, '')}`)}>
                    <View style={[styles.iconTile, { backgroundColor: '#27AE6022' }]}><Ionicons name="call" size={18} color="#27AE60" /></View>
                    <ThemedText style={{ flex: 1 }}>{m}</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => Linking.openURL(`https://wa.me/${m.replace(/[^\d]/g, '')}`)} hitSlop={6} style={[styles.waBtn]}>
                    <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                  </Pressable>
                </View>
              ))}
              {contact.person.emails.filter(Boolean).map((e, i) => (
                <Pressable key={`e${i}`} style={styles.contactRow} onPress={() => Linking.openURL(`mailto:${e}`)}>
                  <View style={[styles.iconTile, { backgroundColor: Brand.orangeSoft }]}><Ionicons name="mail" size={18} color={Brand.orange} /></View>
                  <ThemedText style={{ flex: 1 }} numberOfLines={1}>{e}</ThemedText>
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </Pressable>
              ))}

              {/* Other people printed on the same card */}
              {contact.additionalPeople && contact.additionalPeople.length ? (
                <View style={styles.alsoWrap}>
                  <ThemedText type="smallBold" style={styles.alsoTitle}>Also on this card</ThemedText>
                  {contact.additionalPeople.map((ap, idx) => (
                    <View key={idx} style={[styles.alsoPerson, { borderColor: theme.border }]}>
                      <Row icon="person-outline" value={ap.name || 'Unnamed'} strong />
                      {ap.jobTitles.filter(Boolean).map((t, i) => (
                        <Row key={`t${i}`} icon="briefcase-outline" value={t} />
                      ))}
                      {ap.mobiles.filter(Boolean).map((m, i) => (
                        <View key={`m${i}`} style={styles.contactRow}>
                          <Pressable style={styles.contactMain} onPress={() => Linking.openURL(`tel:${m.replace(/\s/g, '')}`)}>
                            <View style={[styles.iconTile, { backgroundColor: '#27AE6022' }]}><Ionicons name="call" size={18} color="#27AE60" /></View>
                            <ThemedText style={{ flex: 1 }}>{m}</ThemedText>
                          </Pressable>
                          <Pressable onPress={() => Linking.openURL(`https://wa.me/${m.replace(/[^\d]/g, '')}`)} hitSlop={6} style={styles.waBtn}>
                            <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                          </Pressable>
                        </View>
                      ))}
                      {ap.emails.filter(Boolean).map((e, i) => (
                        <Pressable key={`e${i}`} style={styles.contactRow} onPress={() => Linking.openURL(`mailto:${e}`)}>
                          <View style={[styles.iconTile, { backgroundColor: Brand.orangeSoft }]}><Ionicons name="mail" size={18} color={Brand.orange} /></View>
                          <ThemedText style={{ flex: 1 }} numberOfLines={1}>{e}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : (
            <View style={[styles.card, { borderColor: Brand.navy, backgroundColor: theme.backgroundElement }]}>
              <Row icon="globe-outline" value={contact.company.name} strong />
              {contact.company.websites.filter(Boolean).map((w, i) => (
                <Pressable key={i} style={styles.contactRow} onPress={() => Linking.openURL(w.startsWith('http') ? w : `https://${w}`)}>
                  <View style={[styles.iconTile, { backgroundColor: Brand.orangeSoft }]}><Ionicons name="link" size={18} color={Brand.orange} /></View>
                  <ThemedText style={{ flex: 1 }} numberOfLines={1}>{w}</ThemedText>
                </Pressable>
              ))}
              {contact.company.addresses.filter(Boolean).map((a, i) => (
                <Row key={i} icon="location-outline" value={a} />
              ))}
              {followUp ? <Row icon="flag-outline" value={`Follow-up: ${followUp.label}`} /> : null}
              {contact.quantityNeeded ? <Row icon="cube-outline" value={`Quantity: ${contact.quantityNeeded}`} /> : null}
              {contact.teamSize ? <Row icon="people-outline" value={`Team size: ${contact.teamSize}`} /> : null}

              {/* Insights placeholder */}
              <View style={[styles.insights, { backgroundColor: theme.backgroundSelected }]}>
                <Ionicons name="sparkles-outline" size={18} color={theme.textSecondary} />
                <ThemedText type="small" themeColor="textSecondary">AI insights coming in Phase 2</ThemedText>
              </View>

              {/* Card images — tap to view full size */}
              {cardImages.length ? (
                <View style={styles.cardImages}>
                  {cardImages.map((uri) => (
                    <Pressable key={uri} onPress={() => setZoomUri(uri)}>
                      <MediaImage uri={uri} style={styles.cardImage} contentFit="cover" />
                      <View style={styles.zoomHint}>
                        <Ionicons name="expand-outline" size={14} color="#ffffff" />
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {/* Captured meta */}
              {contact.capturedAt ? (
                <View style={[styles.metaBox, { backgroundColor: theme.backgroundSelected }]}>
                  <View style={styles.metaHead}>
                    <Ionicons name="location-outline" size={16} color={theme.textSecondary} />
                    <ThemedText type="small" themeColor="textSecondary">Captured at</ThemedText>
                  </View>
                  <ThemedText type="small">{contact.capturedAt.address}</ThemedText>
                  {contact.capturedAt.lat != null ? (
                    <Pressable onPress={() => Linking.openURL(`https://maps.google.com/?q=${contact.capturedAt?.lat},${contact.capturedAt?.lng}`)}>
                      <ThemedText type="small" style={{ color: Brand.orange }}>Show Map</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <View style={[styles.metaBox, { backgroundColor: theme.backgroundSelected }]}>
                <View style={styles.metaHead}>
                  <Ionicons name="time-outline" size={16} color={theme.textSecondary} />
                  <ThemedText type="small" themeColor="textSecondary">Captured on</ThemedText>
                </View>
                <ThemedText type="small">{formatDateTime(contact.capturedOn)}</ThemedText>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <ImageLightbox uri={zoomUri} onClose={() => setZoomUri(null)} />
    </View>
  );
}

function Row({ icon, value, strong, photo, onZoom }: { icon: keyof typeof Ionicons.glyphMap; value: string; strong?: boolean; photo?: string | null; onZoom?: (uri: string) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {photo ? (
        <Pressable onPress={() => onZoom?.(photo)}>
          <MediaImage uri={photo} style={styles.rowPhoto} contentFit="cover" />
        </Pressable>
      ) : (
        <View style={[styles.iconTile, { backgroundColor: Brand.orangeSoft }]}>
          <Ionicons name={icon} size={18} color={Brand.orange} />
        </View>
      )}
      <ThemedText type={strong ? 'smallBold' : 'default'} style={{ flex: 1, fontSize: strong ? 16 : 15 }}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, borderBottomWidth: 1 },
  headerTitle: { flex: 1, fontSize: 16 },
  headerActions: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  card: { borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowPhoto: { width: 44, height: 44, borderRadius: 22 },
  iconTile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  noteBlock: { gap: Spacing.one },
  noteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  contactMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  waBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#25D36618', alignItems: 'center', justifyContent: 'center' },
  alsoWrap: { gap: Spacing.two, marginTop: Spacing.one },
  alsoTitle: { fontSize: 14 },
  alsoPerson: { borderWidth: 1, borderRadius: Spacing.two + 2, padding: Spacing.three, gap: Spacing.two },
  insights: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.two },
  cardImages: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  cardImage: { width: 140, height: 88, borderRadius: Spacing.two },
  zoomHint: { position: 'absolute', right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  metaBox: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.one },
  metaHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
