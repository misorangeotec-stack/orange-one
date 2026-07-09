/**
 * Upload Contact — create (blank / after a scan) or edit a lead. Person info +
 * Company info sections with repeatable fields, categories, voice notes, notes,
 * interest level, "asked about", follow-up action, quantity, team size, photos.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FieldRepeater } from '@/components/leads/FieldRepeater';
import { PhotoField } from '@/components/leads/PhotoField';
import { SectionCard } from '@/components/leads/SectionCard';
import { SelectSheet } from '@/components/leads/SelectSheet';
import { VoicePlayer } from '@/components/leads/VoicePlayer';
import { VoiceRecorder, type RecordedVoice } from '@/components/leads/VoiceRecorder';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/Chip';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { findDuplicate } from '@/lib/leads/dedupe';
import { backfillLocation, peekLocation, warmLocation } from '@/lib/leads/media';
import { consumePendingScan } from '@/lib/leads/pendingScan';
import { autofillFromVoice } from '@/lib/leads/suggestions';
import { newId, useLeads } from '@/lib/leads/store';
import { emptyDraft, emptyPerson, type ContactDraft, type MasterType, type PersonInfo, type CompanyInfo, type VoiceNote } from '@/lib/leads/types';

type SheetKind = MasterType | null;

export default function UploadContactScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { masters, contacts, addContact, updateContact, getContact } = useLeads();
  const params = useLocalSearchParams<{ scanned?: string; front?: string; back?: string; id?: string }>();

  const editingId = typeof params.id === 'string' ? params.id : undefined;

  // Build the initial draft once (edit → existing; scanned → extracted from the
  // camera hand-off; else blank). Lazy initializer so it runs a single time.
  const [draft, setDraft] = useState<ContactDraft>(() =>
    editingId
      ? (getContact(editingId) as ContactDraft) ?? emptyDraft()
      : params.scanned === '1'
        ? consumePendingScan() ?? emptyDraft()
        : emptyDraft()
  );
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [saving, setSaving] = useState(false);

  const setPerson = (patch: Partial<PersonInfo>) => setDraft((d) => ({ ...d, person: { ...d.person, ...patch } }));
  const setCompany = (patch: Partial<CompanyInfo>) => setDraft((d) => ({ ...d, company: { ...d.company, ...patch } }));

  // Extra people printed on the same card.
  const additionalPeople = draft.additionalPeople ?? [];
  const setAdditionalPerson = (i: number, patch: Partial<PersonInfo>) =>
    setDraft((d) => {
      const list = [...(d.additionalPeople ?? [])];
      list[i] = { ...list[i], ...patch };
      return { ...d, additionalPeople: list };
    });
  const addAdditionalPerson = () =>
    setDraft((d) => ({ ...d, additionalPeople: [...(d.additionalPeople ?? []), emptyPerson()] }));
  const removeAdditionalPerson = (i: number) =>
    setDraft((d) => ({ ...d, additionalPeople: (d.additionalPeople ?? []).filter((_, idx) => idx !== i) }));

  // Warm a location fix while the form is filled in — see media.ts. Editing an
  // existing lead never re-tags it, so only bother on create.
  useEffect(() => {
    if (!editingId) warmLocation();
  }, [editingId]);

  const clean = (arr: string[]) => arr.map((s) => s.trim()).filter(Boolean);

  const save = () => {
    setSaving(true);
    let capturedAt = draft.capturedAt ?? null;
    if (!editingId && !capturedAt) capturedAt = peekLocation();
    const cleaned: ContactDraft = {
      ...draft,
      person: {
        ...draft.person,
        mobiles: clean(draft.person.mobiles),
        emails: clean(draft.person.emails),
        jobTitles: clean(draft.person.jobTitles),
      },
      company: {
        ...draft.company,
        mobiles: clean(draft.company.mobiles),
        emails: clean(draft.company.emails),
        websites: clean(draft.company.websites),
        addresses: clean(draft.company.addresses),
      },
      additionalPeople: (() => {
        const kept = (draft.additionalPeople ?? [])
          .map((p) => ({ ...p, name: p.name.trim(), mobiles: clean(p.mobiles), emails: clean(p.emails), jobTitles: clean(p.jobTitles) }))
          .filter((p) => p.name || p.mobiles.length || p.emails.length || p.jobTitles.length);
        return kept.length ? kept : undefined;
      })(),
      capturedAt,
    };
    if (editingId) {
      updateContact(editingId, cleaned);
      setSaving(false);
      router.back();
      return;
    }

    const commit = () => {
      const created = addContact(cleaned);
      if (!capturedAt) backfillLocation(created.id, getContact, updateContact);
      setSaving(false);
      router.replace({ pathname: '/contact/[id]', params: { id: created.id } });
    };

    // Warn if this phone number or email already belongs to another lead — stops
    // duplicates at the source (a new scan of an existing card makes a new id, so
    // id-dedup alone can't catch it).
    const dup = findDuplicate(cleaned, contacts);
    if (dup) {
      setSaving(false);
      const who = dup.person?.name || dup.company?.name || 'an existing lead';
      const at = dup.company?.name && dup.person?.name ? ` — ${dup.company.name}` : '';
      Alert.alert(
        'Possible duplicate',
        `This phone number or email already belongs to ${who}${at}. What would you like to do?`,
        [
          { text: 'Open existing', onPress: () => router.replace({ pathname: '/contact/[id]', params: { id: dup.id } }) },
          { text: 'Save anyway', style: 'destructive', onPress: () => { setSaving(true); commit(); } },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    commit();
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
        notes: fill.noteText
          ? [{ id: newId('n'), text: fill.noteText, createdAt: new Date().toISOString() }]
          : d.notes,
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

  const chipsFor = (type: MasterType, ids: string[]) =>
    masters[type].filter((m) => ids.includes(m.id));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.two, borderBottomColor: theme.border, backgroundColor: theme.background }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <ThemedText type="smallBold" style={styles.headerTitle}>
          {editingId ? 'Edit Contact' : 'Upload Contact'}
        </ThemedText>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, { backgroundColor: Brand.orange }, saving && styles.dim]}>
          <ThemedText style={styles.saveText}>{saving ? 'Saving…' : 'Save card'}</ThemedText>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]} keyboardShouldPersistTaps="handled">
          <View style={styles.inner}>
            {/* Card scans preview */}
            {(draft.cardImages.front || draft.cardImages.back) && (
              <View style={styles.cardScans}>
                {draft.cardImages.front ? <Image source={{ uri: draft.cardImages.front }} style={styles.cardScan} contentFit="cover" /> : null}
                {draft.cardImages.back ? <Image source={{ uri: draft.cardImages.back }} style={styles.cardScan} contentFit="cover" /> : null}
              </View>
            )}

            {/* Deferred-extract banner (card captured offline) */}
            {draft.pendingExtract ? (
              <View style={[styles.banner, { backgroundColor: Brand.orangeSoft, borderColor: Brand.orange }]}>
                <Ionicons name="cloud-offline-outline" size={18} color={Brand.orange} />
                <ThemedText type="small" style={{ flex: 1, color: Brand.navy }}>
                  Card saved. It’ll be read automatically and fill the empty fields when you’re back online.
                </ThemedText>
              </View>
            ) : null}

            {/* Person info */}
            <SectionCard title="Person info">
              <FieldRepeater values={[draft.person.name]} onChange={(v) => setPerson({ name: v[0] ?? '' })} placeholder="Person name" repeatable={false} />
              <FieldRepeater values={draft.person.mobiles} onChange={(v) => setPerson({ mobiles: v })} placeholder="Mobile number" keyboardType="phone-pad" />
              <FieldRepeater values={draft.person.emails} onChange={(v) => setPerson({ emails: v })} placeholder="Email" keyboardType="email-address" />
              <FieldRepeater values={draft.person.jobTitles} onChange={(v) => setPerson({ jobTitles: v })} placeholder="Job title" />

              <SelectRow label="Source" onPress={() => setSheet('source')} chips={chipsFor('source', draft.sourceId ? [draft.sourceId] : [])} />
              <SelectRow label="Categories" onPress={() => setSheet('categories')} chips={chipsFor('categories', draft.categoryIds)} />

              <PhotoField label="Person photo" photos={draft.person.photoUri ? [draft.person.photoUri] : []} onChange={(p) => setPerson({ photoUri: p[0] ?? null })} max={1} />

              {/* Voice notes */}
              <View style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Voice notes</ThemedText>
                {draft.voiceNotes.map((n) => (
                  <VoicePlayer key={n.id} note={n} onDelete={() => removeVoice(n.id)} />
                ))}
                <VoiceRecorder onRecorded={addVoice} />
              </View>

              {/* Notes */}
              <View style={styles.field}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>Notes</ThemedText>
                <TextInput
                  style={[styles.textarea, { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.border }]}
                  placeholder="Notes"
                  placeholderTextColor={theme.textSecondary}
                  value={draft.notes[0]?.text ?? ''}
                  onChangeText={(t) =>
                    setDraft((d) => ({ ...d, notes: t ? [{ id: d.notes[0]?.id ?? newId('n'), text: t, createdAt: d.notes[0]?.createdAt ?? new Date().toISOString() }] : [] }))
                  }
                  multiline
                />
              </View>

              <SelectRow label="Interest level" onPress={() => setSheet('interestLevels')} chips={chipsFor('interestLevels', draft.interestLevelId ? [draft.interestLevelId] : [])} />
              <SelectRow label="What they asked about" onPress={() => setSheet('askedAbout')} chips={chipsFor('askedAbout', draft.askedAboutIds)} />
            </SectionCard>

            {/* Additional contacts — a card may list more than one person */}
            <SectionCard title="Additional contacts">
              {additionalPeople.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
                  Add anyone else printed on the same card.
                </ThemedText>
              ) : null}
              {additionalPeople.map((ap, i) => (
                <View key={i} style={[styles.personBlock, { borderColor: theme.border }]}>
                  <View style={styles.personHead}>
                    <ThemedText type="smallBold">Person {i + 2}</ThemedText>
                    <Pressable onPress={() => removeAdditionalPerson(i)} hitSlop={6}>
                      <Ionicons name="trash-outline" size={20} color="#E5484D" />
                    </Pressable>
                  </View>
                  <FieldRepeater values={[ap.name]} onChange={(v) => setAdditionalPerson(i, { name: v[0] ?? '' })} placeholder="Person name" repeatable={false} />
                  <FieldRepeater values={ap.mobiles} onChange={(v) => setAdditionalPerson(i, { mobiles: v })} placeholder="Mobile number" keyboardType="phone-pad" />
                  <FieldRepeater values={ap.emails} onChange={(v) => setAdditionalPerson(i, { emails: v })} placeholder="Email" keyboardType="email-address" />
                  <FieldRepeater values={ap.jobTitles} onChange={(v) => setAdditionalPerson(i, { jobTitles: v })} placeholder="Job title" />
                </View>
              ))}
              <Pressable onPress={addAdditionalPerson} style={styles.addPersonRow}>
                <Ionicons name="person-add-outline" size={20} color={Brand.orange} />
                <ThemedText style={{ color: Brand.orange, fontWeight: '700' }}>Add person</ThemedText>
              </Pressable>
            </SectionCard>

            {/* Company info */}
            <SectionCard title="Company info">
              <FieldRepeater values={[draft.company.name]} onChange={(v) => setCompany({ name: v[0] ?? '' })} placeholder="Company name" repeatable={false} />
              <FieldRepeater values={draft.company.mobiles} onChange={(v) => setCompany({ mobiles: v })} placeholder="Mobile number" keyboardType="phone-pad" />
              <FieldRepeater values={draft.company.emails} onChange={(v) => setCompany({ emails: v })} placeholder="Email" keyboardType="email-address" />
              <FieldRepeater values={draft.company.websites} onChange={(v) => setCompany({ websites: v })} placeholder="Website" />
              <FieldRepeater values={draft.company.addresses} onChange={(v) => setCompany({ addresses: v })} placeholder="Address" />

              <LabeledInput label="Quantity needed" value={draft.quantityNeeded ?? ''} onChangeText={(t) => setDraft((d) => ({ ...d, quantityNeeded: t }))} />
              <SelectRow label="Follow-up action" onPress={() => setSheet('followUpActions')} chips={chipsFor('followUpActions', draft.followUpActionId ? [draft.followUpActionId] : [])} />
              <LabeledInput label="Team size" value={draft.teamSize ?? ''} onChangeText={(t) => setDraft((d) => ({ ...d, teamSize: t }))} />
            </SectionCard>

            {/* Reminder photos */}
            <PhotoField label="Photos for future reminder" photos={draft.reminderPhotos} onChange={(p) => setDraft((d) => ({ ...d, reminderPhotos: p }))} />
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

function LabeledInput({ label, value, onChangeText }: { label: string; value: string; onChangeText: (t: string) => void }) {
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
  saveBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: 999 },
  saveText: { color: '#ffffff', fontWeight: '700' },
  dim: { opacity: 0.6 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  cardScans: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center' },
  cardScan: { width: 120, height: 76, borderRadius: Spacing.two },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Spacing.two + 2, padding: Spacing.three },
  field: { gap: Spacing.one },
  fieldLabel: { paddingHorizontal: Spacing.half },
  input: { borderWidth: 1, borderRadius: Spacing.two + 2, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, fontSize: 15, minHeight: 52 },
  textarea: { borderWidth: 1, borderRadius: Spacing.two + 2, padding: Spacing.three, fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, borderWidth: 1, borderRadius: Spacing.two + 2, paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, minHeight: 52 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, flex: 1 },
  personBlock: { borderWidth: 1, borderRadius: Spacing.two + 2, padding: Spacing.three, gap: Spacing.two },
  personHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addPersonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
});
