/**
 * Domain types for Orange One Leads (Phase 1, local/mock).
 * These are the single source of truth the UI reads/writes through `store.tsx`.
 * In Phase 2 the same shapes map onto Supabase tables (app_lead_*).
 */

/** A configurable master item (category, interest level, asked-about, follow-up). */
export type MasterItem = {
  id: string;
  label: string;
  /** Optional accent color (used by interest levels). */
  color?: string;
  /** Sort order within its list. */
  order: number;
  /**
   * Soft-delete flag set by the web admin. ABSENT MEANS ACTIVE — seeded items
   * carry no `active` key, so never test `=== true`; use `pickable()`.
   * Inactive items are hidden from the CAPTURE pickers only. They must stay
   * resolvable everywhere a stored value is displayed (a lead captured before the
   * item was retired still has to show its label).
   */
  active?: boolean;
};

export type MasterType = 'source' | 'categories' | 'interestLevels' | 'askedAbout' | 'followUpActions';

export type Masters = Record<MasterType, MasterItem[]>;

export type Note = {
  id: string;
  text: string;
  createdAt: string; // ISO
};

export type VoiceNote = {
  id: string;
  uri: string; // local file uri from expo-audio recorder
  durationMs: number;
  /** English transcript (Deepgram STT → Claude translate). */
  transcript?: string | null;
  /** Claude analysis of the note. */
  summary?: string | null;
  suggestedInterest?: string | null;
  followUps?: string[];
  /** Transcription lifecycle: pending = queued (offline), waiting for network. */
  status?: 'pending' | 'processing' | 'done' | 'failed';
  /** Failed online transcription attempts; at MAX_AI_ATTEMPTS the note goes 'failed'. */
  transcribeAttempts?: number;
  createdAt: string; // ISO
};

export type PersonInfo = {
  name: string;
  photoUri?: string | null;
  mobiles: string[];
  emails: string[];
  jobTitles: string[];
};

export type CompanyInfo = {
  name: string;
  logoUri?: string | null;
  mobiles: string[];
  emails: string[];
  websites: string[];
  addresses: string[];
};

export type CapturedAt = {
  lat?: number;
  lng?: number;
  address: string;
};

export type Contact = {
  id: string;
  person: PersonInfo;
  /** Extra people printed on the same card (a card can list multiple contacts).
   *  The primary is `person`; these are everyone else. Unbounded. */
  additionalPeople?: PersonInfo[];
  company: CompanyInfo;
  /** Where the lead came from — e.g. the exhibition name. Single master item. */
  sourceId?: string | null;
  categoryIds: string[];
  interestLevelId?: string | null;
  askedAboutIds: string[];
  followUpActionId?: string | null;
  quantityNeeded?: string;
  teamSize?: string;
  notes: Note[];
  voiceNotes: VoiceNote[];
  /** Business-card scans. */
  cardImages: { front?: string | null; back?: string | null };
  /** Extra photos captured for a future reminder. */
  reminderPhotos: string[];
  capturedAt?: CapturedAt | null;
  /** True when a card was captured offline and still needs AI extraction. */
  pendingExtract?: boolean;
  /** Failed online extraction attempts; at MAX_AI_ATTEMPTS we stop retrying. */
  extractAttempts?: number;
  /**
   * Set by the background read when this freshly-scanned card matches an existing
   * contact (by phone/email): the id of that existing contact. While set, the
   * draft is held out of Home + the server, awaiting the user's decision on the
   * Duplicate card screen. Cleared ("Continue anyway") or the draft is deleted
   * ("Yes, it's a duplicate").
   */
  duplicateOf?: string | null;
  capturedOn: string; // ISO
  updatedAt: string; // ISO
};

/** The editable draft used by the Upload Contact form (create + edit). */
export type ContactDraft = Omit<Contact, 'id' | 'capturedOn' | 'updatedAt'> & {
  id?: string;
};

export const emptyPerson = (): PersonInfo => ({
  name: '',
  photoUri: null,
  mobiles: [''],
  emails: [''],
  jobTitles: [''],
});

export const emptyCompany = (): CompanyInfo => ({
  name: '',
  logoUri: null,
  mobiles: [''],
  emails: [''],
  websites: [''],
  addresses: [''],
});

export const emptyDraft = (): ContactDraft => ({
  person: emptyPerson(),
  company: emptyCompany(),
  sourceId: null,
  categoryIds: [],
  interestLevelId: null,
  askedAboutIds: [],
  followUpActionId: null,
  quantityNeeded: '',
  teamSize: '',
  notes: [],
  voiceNotes: [],
  cardImages: { front: null, back: null },
  reminderPhotos: [],
  capturedAt: null,
});
