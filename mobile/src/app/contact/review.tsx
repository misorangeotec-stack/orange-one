/**
 * Review card — the fast, non-blocking screen shown right after scanning a
 * business card. It never waits on AI: the card's own details (name / phone /
 * email / company) are read in the background sync, so here the user only adds
 * the enrichment details (categories, notes, voice, photos, interest, etc.) and
 * saves. Saving creates the lead as a draft with `pendingExtract`, which the
 * background sync then extracts, transcribes and pushes live.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ImageLightbox } from '@/components/leads/ImageLightbox';
import { PhotoField } from '@/components/leads/PhotoField';
import { SelectSheet } from '@/components/leads/SelectSheet';
import { VoicePlayer } from '@/components/leads/VoicePlayer';
import { VoiceRecorder, type RecordedVoice } from '@/components/leads/VoiceRecorder';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/Chip';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { backfillLocation, peekLocation, warmLocation } from '@/lib/leads/media';
import { consumePendingScan } from '@/lib/leads/pendingScan';
import { autofillFromVoice } from '@/lib/leads/suggestions';
import { newId, useLeads } from '@/lib/leads/store';
import { emptyDraft, type ContactDraft, type MasterType, type VoiceNote } from '@/lib/leads/types';

type SheetKind = MasterType | null;

const CHECKLIST = [
  'The whole card sits inside the guide',
  'Only one card is in the shot',
  'The text looks sharp, not blurry',
];

export default function ReviewCardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { masters, addContact, getContact, updateContact } = useLeads();

  // The camera hands the (cropped) card image + pendingExtract flag through here.
  const [draft, setDraft] = useState<ContactDraft>(() => consumePendingScan() ?? emptyDraft());
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [saving, setSaving] = useState(false);
  const [zoomUri, setZoomUri] = useState<string | null>(null);

  // Get a location fix warm while the user fills the form, so Save can read it
  // synchronously. Offline, acquiring one takes 30-120s — far too long to hold
  // the Save tap.
  useEffect(() => warmLocation(), []);

  const clean = (arr: string[]) => arr.map((s) => s.trim()).filter(Boolean);

  const save = () => {
    if (saving) return;
    setSaving(true);
    const capturedAt = draft.capturedAt ?? peekLocation();
    const cleaned: ContactDraft = {
      ...draft,
      notes: draft.notes.filter((n) => n.text.trim()),
      reminderPhotos: clean(draft.reminderPhotos),
      quantityNeeded: (draft.quantityNeeded ?? '').trim(),
      teamSize: (draft.teamSize ?? '').trim(),
      capturedAt,
      // Card details are filled by the background sync — flag it for extraction.
      pendingExtract: !!(draft.cardImages.front || draft.cardImages.back),
    };
    const created = addContact(cleaned);
    if (!capturedAt) backfillLocation(created.id, getContact, updateContact);
    if (Platform.OS === 'android') ToastAndroid.show('Saved to drafts — processing…', ToastAndroid.SHORT);
    router.replace('/(tabs)');
  };

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
    setDraft((d) => {
      const fill = autofillFromVoice(note, masters, {
        interest: !!d.interestLevelId,
        followUp: !!d.followUpActionId,
        notes: !!d.notes[0]?.text,
      });
      return {
        ...d,
        voiceNotes: [...d.voiceNotes, note],
        interestLevelId: fill.interestLevelId ?? d.interestLevelId,
        followUpActionId: fill.followUpActionId ?? d.followUpActionId,
        notes: fill.noteText ? [{ id: newId('n'), text: fill.noteText, createdAt: new Date().toISOString() }] : d.notes,
      };
    });
  };
  const removeVoice = (id: string) => setDraft((d) => ({ ...d, voiceNotes: d.voiceNotes.filter((n) => n.id !== id) }));

  const sheetConfig = useMemo(() => {
    const map: Record<Exclude<SheetKind, null>, { title: string; multi: boolean; ids: string[]; set: (ids: string[]) => void }> = {
      source: { title: 'Source', multi: false, ids: draft.sourceId ? [draft.sourceId] : [], set: (ids) => setDraft((d) => ({ ...d, sourceId: ids[0] ?? null })) },
      categories: { title: 'Categories', multi: true, ids: draft.categoryIds, set: (ids) => setDraft((d) => ({ ...d, categoryIds: ids })) },
      interestLevels: { title: 'Interest level', multi: false, ids: draft.interestLevelId ? [draft.interestLevelId] : [], set: (ids) => setDraft((d) => ({ ...d, interestLevelId: ids[0] ?? null })) },
      askedAbout: { title: 'What they asked about', multi: true, ids: draft.askedAboutIds, set: (ids) => setDraft((d) => ({ ...d, askedAboutIds: ids })) },
      followUpActions: { title: 'Follow-up action', multi: false, ids: draft.followUpActionId ? [draft.followUpActionId] : [], set: (ids) => setDraft((d) => ({ ...d, followUpActionId: ids[0] ?? null })) },
    };
    return map;
  }, [draft.sourceId, draft.categoryIds, draft.interestLevelId, draft.askedAboutIds, draft.followUpActionId]);

  const chipsFor = (type: MasterType, ids: string[]) => masters[type].filter((m) => ids.includes(m.id));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two, borderBottomColor: theme.border, backgroundColor: theme.background }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={26} color={theme.text} />
        </Pressable>
        <ThemedText type="smallBold" style={styles.headerTitle}>
          Review card
        </ThemedText>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, { backgroundColor: Brand.orange }, saving && styles.dim]}>
          <ThemedText style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</ThemedText>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]} keyboardShouldPersistTaps="handled">
          <View style={styles.inner}>
            {/* Card scans — tap to view the complete image */}
            {draft.cardImages.front || draft.cardImages.back ? (
              <View style={styles.cardScans}>
                {[draft.cardImages.front, draft.cardImages.back].filter(Boolean).map((uri) => (
                  <Pressable key={uri as string} onPress={() => setZoomUri(uri as string)}>
                    <Image source={{ uri: uri as string }} style={styles.cardScan} contentFit="cover" />
                    <View style={styles.zoomHint}>
                      <Ionicons name="expand-outline" size={14} color="#ffffff" />
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Capture check */}
            <View style={[styles.checkCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={styles.checkHead}>
                <Ionicons name="scan-outline" size={18} color={Brand.orange} />
                <ThemedText type="smallBold" style={styles.checkTitle}>
                  Quick capture check
                </ThemedText>
              </View>
              {CHECKLIST.map((line) => (
                <View key={line} style={styles.checkRow}>
                  <View style={styles.checkTick}>
                    <Ionicons name="checkmark" size={13} color="#ffffff" />
                  </View>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {line}
                  </ThemedText>
                </View>
              ))}
            </View>

            {/* Processing note */}
            <View style={[styles.banner, { backgroundColor: Brand.orangeSoft, borderColor: Brand.orange }]}>
              <Ionicons name="sparkles-outline" size={18} color={Brand.orange} />
              <ThemedText type="small" style={{ flex: 1, color: Brand.navy }}>
                The card’s name, phone, email & company are read automatically after you save. Add anything extra below.
              </ThemedText>
            </View>

            {/* Enrichment fields */}
            <SelectRow label="Source" onPress={() => setSheet('source')} chips={chipsFor('source', draft.sourceId ? [draft.sourceId] : [])} />
            <SelectRow label="Categories" onPress={() => setSheet('categories')} chips={chipsFor('categories', draft.categoryIds)} />

            {/* Notes */}
            <View style={styles.field}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Notes</ThemedText>
              <TextInput
                style={[styles.textarea, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.border }]}
                placeholder="Notes (optional)"
                placeholderTextColor={theme.textSecondary}
                value={draft.notes[0]?.text ?? ''}
                onChangeText={(t) =>
                  setDraft((d) => ({ ...d, notes: t ? [{ id: d.notes[0]?.id ?? newId('n'), text: t, createdAt: d.notes[0]?.createdAt ?? new Date().toISOString() }] : [] }))
                }
                multiline
              />
            </View>

            {/* Voice notes */}
            <View style={styles.field}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Add voice note</ThemedText>
              {draft.voiceNotes.map((n) => (
                <VoicePlayer key={n.id} note={n} onDelete={() => removeVoice(n.id)} />
              ))}
              <VoiceRecorder onRecorded={addVoice} />
            </View>

            {/* Attach photo */}
            <PhotoField label="Attach photo" photos={draft.reminderPhotos} onChange={(p) => setDraft((d) => ({ ...d, reminderPhotos: p }))} />

            <SelectRow label="Interest level" onPress={() => setSheet('interestLevels')} chips={chipsFor('interestLevels', draft.interestLevelId ? [draft.interestLevelId] : [])} />
            <SelectRow label="What they asked about" onPress={() => setSheet('askedAbout')} chips={chipsFor('askedAbout', draft.askedAboutIds)} />
            <LabeledInput label="Quantity needed" value={draft.quantityNeeded ?? ''} onChangeText={(t) => setDraft((d) => ({ ...d, quantityNeeded: t }))} keyboardType="numeric" />
            <SelectRow label="Follow-up action" onPress={() => setSheet('followUpActions')} chips={chipsFor('followUpActions', draft.followUpActionId ? [draft.followUpActionId] : [])} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Select sheets */}
      {sheet ? (
        <SelectSheet
          visible
          title={sheetConfig[sheet].title}
          options={masters[sheet]}
          selectedIds={sheetConfig[sheet].ids}
          multi={sheetConfig[sheet].multi}
          onChange={sheetConfig[sheet].set}
          onClose={() => setSheet(null)}
        />
      ) : null}

      <ImageLightbox uri={zoomUri} onClose={() => setZoomUri(null)} />
    </View>
  );
}

function SelectRow({ label, onPress, chips }: { label: string; onPress: () => void; chips: { id: string; label: string; color?: string }[] }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{label}</ThemedText>
      <Pressable onPress={onPress} style={[styles.selectRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {chips.length ? (
          <View style={styles.chipWrap}>
            {chips.map((c) => (
              <Chip key={c.id} label={c.label} color={c.color} selected />
            ))}
          </View>
        ) : (
          <ThemedText themeColor="textSecondary">Select…</ThemedText>
        )}
        <Ionicons name="chevron-down" size={18} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

function LabeledInput({ label, value, onChangeText, keyboardType }: { label: string; value: string; onChangeText: (t: string) => void; keyboardType?: 'default' | 'numeric' }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{label}</ThemedText>
      <TextInput
        style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.border }]}
        placeholder={label}
        placeholderTextColor={theme.textSecondary}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
      />
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
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16 },
  saveBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: 999 },
  saveText: { color: '#ffffff', fontWeight: '700' },
  dim: { opacity: 0.6 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  cardScans: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center' },
  cardScan: { width: 200, height: 125, borderRadius: Spacing.two },
  zoomHint: { position: 'absolute', right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  checkCard: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2, marginBottom: Spacing.one },
  checkTitle: { fontSize: 15 },
  checkTick: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#27AE60', alignItems: 'center', justifyContent: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Spacing.two + 2, padding: Spacing.three },
  field: { gap: Spacing.one },
  fieldLabel: { paddingHorizontal: Spacing.half },
  input: { borderWidth: 1, borderRadius: Spacing.two + 2, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, fontSize: 15, minHeight: 52 },
  textarea: { borderWidth: 1, borderRadius: Spacing.two + 2, padding: Spacing.three, fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, borderWidth: 1, borderRadius: Spacing.two + 2, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, minHeight: 52 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, flex: 1 },
});
