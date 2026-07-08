/**
 * Leads store — per-user, offline-first, sync-aware.
 *
 * The local AsyncStorage cache is the UI source of truth (instant + fully
 * offline). Mutations stamp `updatedAt` and mark the record dirty in a persisted
 * outbox; a debounced/triggered sync cycle flushes to Supabase and pulls back
 * (see sync.ts). Deferred AI: cards/voice captured offline are queued and
 * processed at the start of each sync cycle when the network is available.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useSync } from '@/hooks/use-sync';
import { findDuplicates } from './dedupe';
import { extractCardDraft } from './extractCard';
import { bytesBase64FromUri } from './media';
import { defaultMasters } from './masters';
import { autofillFromVoice } from './suggestions';
import { transcribeVoice } from './transcribe';
import {
  clearUserCache,
  dedupeById,
  EPOCH,
  emptyOutbox,
  flush,
  loadCache,
  loadOutbox,
  mergeContacts,
  type Outbox,
  pull,
  saveContactsCache,
  saveCursor,
  saveMastersCache,
  saveOutbox,
} from './sync';
import type { Contact, ContactDraft, Masters, MasterType, VoiceNote } from './types';

export function newId(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Legacy (Phase-1, pre-login) keys — imported once on first login.
const LEGACY_CONTACTS = 'orange-one-leads.contacts.v1';
const LEGACY_MASTERS = 'orange-one-leads.masters.v1';

type LeadsContextValue = {
  ready: boolean;
  contacts: Contact[];
  masters: Masters;
  getContact: (id: string) => Contact | undefined;
  addContact: (draft: ContactDraft) => Contact;
  updateContact: (id: string, draft: ContactDraft) => void;
  deleteContact: (id: string) => void;
  labelOf: (type: MasterType, id?: string | null) => string;
  // Sync surface
  syncing: boolean;
  pendingCount: number; // records not yet pushed (outbox)
  pendingAiCount: number; // cards/voice awaiting network AI
  lastSyncedAt: string | null;
  syncStep: string | null; // current phase while syncing (for visibility)
  syncError: string | null; // last sync error message, if any
  isPending: (id: string) => boolean;
  syncNow: () => void;
};

const LeadsContext = createContext<LeadsContextValue | null>(null);

const nowIso = () => new Date().toISOString();

export function LeadsProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();

  const [ready, setReady] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [masters, setMasters] = useState<Masters>(() => defaultMasters());
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingAiCount, setPendingAiCount] = useState(0);
  // Reactive list of not-yet-synced contact ids — drives isPending() so the
  // Drafts badge and the Drafts screen always agree (a ref can't trigger re-renders).
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncStep, setSyncStep] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const mastersRef = useRef(masters);
  mastersRef.current = masters;
  const outboxRef = useRef<Outbox>(emptyOutbox());
  const mastersUpdatedAtRef = useRef<string>(EPOCH);
  const cursorRef = useRef<string>(EPOCH);
  const syncingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recomputePending = useCallback(() => {
    const o = outboxRef.current;
    setPendingCount(o.contactIds.length + Object.keys(o.deletes).length);
    const ids = new Set(o.contactIds);
    let ai = 0;
    for (const c of contactsRef.current) {
      const pv = c.voiceNotes.filter((v) => v.status === 'pending').length;
      // Draft (shown in Drafts, hidden from Home) if it owes AI, is a held
      // duplicate awaiting a decision, or is otherwise unsynced.
      if (c.pendingExtract || pv > 0 || c.duplicateOf) ids.add(c.id);
      ai += (c.pendingExtract ? 1 : 0) + pv;
    }
    setPendingAiCount(ai);
    setPendingIds(Array.from(ids));
  }, []);

  // ---- Load per-user cache on login / clear on logout ----------------------
  useEffect(() => {
    let active = true;
    (async () => {
      setReady(false);
      syncingRef.current = false; // clear any stuck guard from a prior wedged run
      setSyncing(false);
      if (!userId) {
        setContacts([]);
        setMasters(defaultMasters());
        outboxRef.current = emptyOutbox();
        return;
      }
      const cache = await loadCache(userId);
      const outbox = await loadOutbox(userId);
      if (!active) return;
      outboxRef.current = outbox;

      if (cache) {
        const deduped = dedupeById(cache.contacts);
        setContacts(deduped);
        if (deduped.length !== cache.contacts.length) saveContactsCache(userId, deduped); // heal on disk
        setMasters(cache.masters ?? defaultMasters());
        mastersUpdatedAtRef.current = cache.mastersUpdatedAt;
        cursorRef.current = cache.cursor;
      } else {
        // First login on this device: import any Phase-1 local data, else start fresh.
        const legacyContacts = await importLegacy();
        const seededMasters = defaultMasters();
        setContacts(legacyContacts);
        setMasters(seededMasters);
        mastersUpdatedAtRef.current = nowIso();
        cursorRef.current = EPOCH;
        outboxRef.current = {
          contactIds: legacyContacts.map((c) => c.id),
          deletes: {},
          masters: false,
        };
        await Promise.all([
          saveContactsCache(userId, legacyContacts),
          saveMastersCache(userId, seededMasters, mastersUpdatedAtRef.current),
          saveOutbox(userId, outboxRef.current),
        ]);
      }
      recomputePending();
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [userId, recomputePending]);

  // ---- Persist contacts/masters on change ----------------------------------
  useEffect(() => {
    if (!ready || !userId) return;
    saveContactsCache(userId, contacts);
    recomputePending();
  }, [contacts, ready, userId, recomputePending]);
  useEffect(() => {
    if (!ready || !userId) return;
    saveMastersCache(userId, masters, mastersUpdatedAtRef.current);
  }, [masters, ready, userId]);

  // ---- Dirty tracking + debounced sync -------------------------------------
  const persistOutbox = useCallback(() => {
    if (userId) saveOutbox(userId, outboxRef.current);
    recomputePending();
  }, [userId, recomputePending]);

  const scheduleSync = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSyncRef.current?.('start'), 1500);
  }, []);

  const markContactDirty = useCallback(
    (id: string) => {
      const o = outboxRef.current;
      if (!o.contactIds.includes(id)) o.contactIds.push(id);
      delete o.deletes[id];
      persistOutbox();
      scheduleSync();
    },
    [persistOutbox, scheduleSync]
  );

  // ---- Contact CRUD --------------------------------------------------------
  const getContact = useCallback((id: string) => contactsRef.current.find((c) => c.id === id), []);

  const addContact = useCallback(
    (draft: ContactDraft): Contact => {
      const now = nowIso();
      const contact: Contact = { ...draft, id: draft.id ?? newId('c'), capturedOn: now, updatedAt: now };
      setContacts((prev) => [contact, ...prev]);
      markContactDirty(contact.id);
      return contact;
    },
    [markContactDirty]
  );

  const updateContact = useCallback(
    (id: string, draft: ContactDraft) => {
      setContacts((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...draft, id, capturedOn: c.capturedOn, updatedAt: nowIso() } : c))
      );
      markContactDirty(id);
    },
    [markContactDirty]
  );

  const deleteContact = useCallback(
    (id: string) => {
      const existing = contactsRef.current.find((c) => c.id === id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      const o = outboxRef.current;
      o.contactIds = o.contactIds.filter((x) => x !== id);
      if (existing) o.deletes[id] = { ...existing, updatedAt: nowIso() };
      persistOutbox();
      scheduleSync();
    },
    [persistOutbox, scheduleSync]
  );

  // ---- Masters (read-only) -------------------------------------------------
  // Masters are admin-managed globally (web portal) and pulled read-only; the app
  // no longer edits or pushes them. See sync.ts pull() → app_lead_masters_global.
  const labelOf = useCallback(
    (type: MasterType, id?: string | null) => (id && mastersRef.current[type].find((i) => i.id === id)?.label) || '',
    []
  );

  // ---- Sync cycle ----------------------------------------------------------
  const runSyncRef = useRef<((reason: string) => void) | undefined>(undefined);

  const runSync = useCallback(async () => {
    if (!userId || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);

    // Failsafe: no matter what awaits below hang, the UI never stays stuck on
    // "Syncing…". Fires after 120s, resets the flags, lets the next trigger retry.
    const finish = () => {
      syncingRef.current = false;
      setSyncing(false);
      setSyncStep(null);
      recomputePending();
    };
    const watchdog = setTimeout(finish, 120000);

    const doFlush = async () => {
      setSyncStep('Uploading leads');
      const byId = new Map(contactsRef.current.map((c) => [c.id, c]));
      const { outbox: nextOutbox, error } = await flush(userId, byId, outboxRef.current);
      outboxRef.current = nextOutbox;
      await saveOutbox(userId, nextOutbox);
      recomputePending();
      if (error) setSyncError(error);
    };

    try {
      // 1) Push whatever we have NOW — leads land in seconds, before (slow) AI.
      await doFlush();

      // 2) Deferred AI (online only; slow; must never block the push above).
      setSyncStep('Reading cards & voice');
      const { contacts: enriched, changed } = await processDeferredAI(contactsRef.current, mastersRef.current);
      if (changed.length) {
        setContacts(enriched);
        contactsRef.current = enriched;
        for (const id of changed) {
          if (!outboxRef.current.contactIds.includes(id)) outboxRef.current.contactIds.push(id);
        }
        persistOutbox();
        await doFlush(); // push the enriched rows
      }

      // 3) Pull remote changes + merge.
      setSyncStep('Downloading');
      const res = await pull(userId, cursorRef.current);
      if (res.rows.length) {
        const merged = mergeContacts(contactsRef.current, res.rows);
        setContacts(merged);
        contactsRef.current = merged;
        await saveContactsCache(userId, merged);
      }
      if (res.masters && res.mastersUpdatedAt && new Date(res.mastersUpdatedAt) > new Date(mastersUpdatedAtRef.current)) {
        setMasters(res.masters);
        mastersRef.current = res.masters;
        mastersUpdatedAtRef.current = res.mastersUpdatedAt;
        await saveMastersCache(userId, res.masters, res.mastersUpdatedAt);
      }
      cursorRef.current = res.cursor;
      await saveCursor(userId, res.cursor);
      setLastSyncedAt(nowIso());
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(watchdog);
      finish();
    }
  }, [userId, persistOutbox, recomputePending]);

  runSyncRef.current = runSync;
  // Stable trigger: a fresh arrow here would change useSync's effect deps every
  // render, re-firing the "sync on start" effect in a loop (network churn +
  // "Syncing…" that never settles). The ref keeps it pointing at the latest runSync.
  const triggerSync = useCallback(() => runSyncRef.current?.('trigger'), []);
  useSync(userId ?? null, ready, triggerSync);

  const isPending = useCallback((id: string) => pendingIds.includes(id), [pendingIds]);

  const value = useMemo<LeadsContextValue>(
    () => ({
      ready,
      contacts,
      masters,
      getContact,
      addContact,
      updateContact,
      deleteContact,
      labelOf,
      syncing,
      pendingCount,
      pendingAiCount,
      lastSyncedAt,
      syncStep,
      syncError,
      isPending,
      syncNow: () => runSyncRef.current?.('manual'),
    }),
    [ready, contacts, masters, getContact, addContact, updateContact, deleteContact, labelOf, syncing, pendingCount, pendingAiCount, lastSyncedAt, syncStep, syncError, isPending]
  );

  return <LeadsContext.Provider value={value}>{children}</LeadsContext.Provider>;
}

export function useLeads(): LeadsContextValue {
  const ctx = useContext(LeadsContext);
  if (!ctx) throw new Error('useLeads must be used within a LeadsProvider');
  return ctx;
}

// ---- Helpers ---------------------------------------------------------------

async function importLegacy(): Promise<Contact[]> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_CONTACTS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Contact[];
    await AsyncStorage.multiRemove([LEGACY_CONTACTS, LEGACY_MASTERS, 'orange-one-leads.seeded.v1']).catch(() => {});
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

const allEmpty = (a: string[]) => a.filter(Boolean).length === 0;

/** Fill a contact's EMPTY person/company fields from an extracted draft. */
function fillFromExtract(c: Contact, ex: ContactDraft): Contact {
  const person = { ...c.person };
  if (!person.name && ex.person.name) person.name = ex.person.name;
  if (allEmpty(person.mobiles) && ex.person.mobiles.filter(Boolean).length) person.mobiles = ex.person.mobiles;
  if (allEmpty(person.emails) && ex.person.emails.filter(Boolean).length) person.emails = ex.person.emails;
  if (allEmpty(person.jobTitles) && ex.person.jobTitles.filter(Boolean).length) person.jobTitles = ex.person.jobTitles;
  const company = { ...c.company };
  if (!company.name && ex.company.name) company.name = ex.company.name;
  if (allEmpty(company.mobiles) && ex.company.mobiles.filter(Boolean).length) company.mobiles = ex.company.mobiles;
  if (allEmpty(company.emails) && ex.company.emails.filter(Boolean).length) company.emails = ex.company.emails;
  if (allEmpty(company.websites) && ex.company.websites.filter(Boolean).length) company.websites = ex.company.websites;
  if (allEmpty(company.addresses) && ex.company.addresses.filter(Boolean).length) company.addresses = ex.company.addresses;
  // Extra people printed on the card — only fill when the contact has none yet.
  const additionalPeople =
    c.additionalPeople && c.additionalPeople.length ? c.additionalPeople : ex.additionalPeople;
  return { ...c, person, company, additionalPeople };
}

// Reads a local file OR a Supabase storage path (lead-media/...). The storage-path
// case is what lets card extraction run on a device that pulled the lead and has
// no local copy of the image (see bytesBase64FromUri).
const base64Of = (uri: string): Promise<string | null> => bytesBase64FromUri(uri);

// Give up on a card read / voice transcription after this many failed online
// attempts so an unreadable card/audio can never wedge the card on "Processing…"
// forever. Attempts only tick on real sync cycles, so this spans several tries.
const MAX_AI_ATTEMPTS = 5;

/**
 * Process cards/voice captured offline. Only runs when online; each item is
 * independent and keyed by id, so failures simply stay pending for next time
 * (up to MAX_AI_ATTEMPTS, after which it stops retrying and leaves "Processing…").
 */
async function processDeferredAI(
  list: Contact[],
  masters: Masters
): Promise<{ contacts: Contact[]; changed: string[] }> {
  const net = await NetInfo.fetch();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const anyWork = list.some((c) => c.pendingExtract || c.voiceNotes.some((v) => v.status === 'pending'));
  if (!online || !anyWork) return { contacts: list, changed: [] };

  const out = [...list];
  const changed = new Set<string>();

  for (let i = 0; i < out.length; i++) {
    let c = out[i];
    let touched = false;

    // Deferred card extraction.
    if (c.pendingExtract && (c.cardImages.front || c.cardImages.back)) {
      let extracted = false;
      try {
        const front = c.cardImages.front ? { uri: c.cardImages.front, base64: await base64Of(c.cardImages.front) } : null;
        const back = c.cardImages.back ? { uri: c.cardImages.back, base64: await base64Of(c.cardImages.back) } : null;
        const res = await extractCardDraft(front, back);
        if (res.ok) {
          c = { ...fillFromExtract(c, res.draft), pendingExtract: false, extractAttempts: undefined };
          touched = true;
          extracted = true;
          // Now that the card is read, check whether it duplicates an existing
          // contact (by phone/email). Compare against everyone EXCEPT this draft
          // and any other still-held duplicate. If matched, hold it for the user
          // to resolve on the Duplicate card screen (see sync.flush skip).
          const others = out.filter((o) => o.id !== c.id && !o.duplicateOf);
          const dup = findDuplicates(c, others)[0];
          if (dup) c = { ...c, duplicateOf: dup.id };
        }
      } catch {
        /* handled below */
      }
      if (!extracted) {
        // Count the failed attempt; give up (stop showing "Processing…") after the cap.
        const n = (c.extractAttempts ?? 0) + 1;
        c = { ...c, extractAttempts: n, ...(n >= MAX_AI_ATTEMPTS ? { pendingExtract: false } : {}) };
        touched = true;
      }
    }

    // Deferred voice transcription.
    if (c.voiceNotes.some((v) => v.status === 'pending')) {
      const notes: VoiceNote[] = [];
      for (const v of c.voiceNotes) {
        if (v.status !== 'pending') {
          notes.push(v);
          continue;
        }
        const r = await transcribeVoice(v.uri);
        if (r.ok) {
          const nv: VoiceNote = {
            ...v,
            transcript: r.data?.transcript || null,
            summary: r.data?.summary || null,
            suggestedInterest: r.data?.suggestedInterest || null,
            followUps: r.data?.followUps ?? [],
            status: 'done',
          };
          notes.push(nv);
          touched = true;
          // Auto-fill empty interest/follow-up/notes from the note.
          const fill = autofillFromVoice(nv, masters, {
            interest: !!c.interestLevelId,
            followUp: !!c.followUpActionId,
            notes: !!c.notes[0]?.text,
          });
          c = {
            ...c,
            interestLevelId: fill.interestLevelId ?? c.interestLevelId,
            followUpActionId: fill.followUpActionId ?? c.followUpActionId,
            notes: fill.noteText ? [{ id: newId('n'), text: fill.noteText, createdAt: nowIso() }] : c.notes,
          };
        } else {
          // Count the failed attempt; mark 'failed' (terminal, no longer "pending"
          // → card leaves "Processing…") once the cap is hit. Persisted via touched.
          const n = (v.transcribeAttempts ?? 0) + 1;
          notes.push({ ...v, transcribeAttempts: n, ...(n >= MAX_AI_ATTEMPTS ? { status: 'failed' as const } : {}) });
          touched = true;
        }
      }
      c = { ...c, voiceNotes: notes };
    }

    if (touched) {
      out[i] = { ...c, updatedAt: nowIso() };
      changed.add(out[i].id);
    }
  }
  return { contacts: out, changed: [...changed] };
}

export { clearUserCache };
