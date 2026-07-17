/**
 * Types for the Leads Dashboard. These mirror the shapes the mobile Leads app
 * writes into `app_leads.payload` (see mobile/src/lib/leads/types.ts) plus the
 * `app_lead_masters_global.masters` jsonb. The dashboard only READS them.
 */

export interface MasterItem {
  id: string;
  label: string;
  color?: string;
  order?: number;
  /**
   * Soft-delete flag; ABSENT MEANS ACTIVE (seeded items carry no `active` key).
   * The dashboard deliberately does NOT filter on this — it charts history, and a
   * deactivated master with existing leads must still appear or the numbers lie.
   * Only the mobile capture pickers hide inactive items.
   */
  active?: boolean;
}

export type MasterType = "source" | "categories" | "interestLevels" | "askedAbout" | "followUpActions";
export type Masters = Record<MasterType, MasterItem[]>;

export interface PersonInfo {
  name: string;
  photoUri?: string | null;
  mobiles: string[];
  emails: string[];
  jobTitles: string[];
}

export interface VoiceNote {
  id?: string;
  uri?: string | null; // storage path / url of the recorded audio
  durationMs?: number;
  transcript?: string | null;
  summary?: string | null;
  suggestedInterest?: string | null;
  followUps?: string[];
  status?: "pending" | "processing" | "done" | "failed";
}

/** The nested Contact object stored in app_leads.payload. Parsed defensively. */
export interface LeadPayload {
  person?: PersonInfo;
  additionalPeople?: PersonInfo[];
  company?: { name?: string; mobiles?: string[]; emails?: string[]; websites?: string[]; addresses?: string[] };
  sourceId?: string | null;
  categoryIds?: string[];
  interestLevelId?: string | null;
  askedAboutIds?: string[];
  followUpActionId?: string | null;
  quantityNeeded?: string;
  teamSize?: string;
  notes?: { text?: string }[];
  voiceNotes?: VoiceNote[];
  cardImages?: { front?: string | null; back?: string | null };
  capturedAt?: { lat?: number; lng?: number; address?: string } | null;
  capturedOn?: string;
}

/** Normalized, dashboard-friendly view of one lead (row columns + parsed payload). */
export interface Lead {
  id: string;
  userId: string;
  salesperson: string; // resolved display name (falls back to email / short id)
  personName: string;
  jobTitle: string; // primary person's first job title
  companyName: string;
  sourceId: string | null;
  interestLevelId: string | null;
  followUpActionId: string | null;
  categoryIds: string[];
  askedAboutIds: string[];
  mobiles: string[];
  emails: string[];
  /** all person names on the card (primary first). */
  people: string[];
  /** primary + additional people count on the card. */
  peopleCount: number;
  hasVoice: boolean;
  location: string; // capturedAt.address or ""
  capturedOn: string | null; // ISO
  updatedAt: string;
  // ---- media (raw storage paths / urls; resolved to signed urls at view time) ----
  /** Business-card scans (front, then back), non-empty entries only. */
  cardImages: string[];
  /** Captured person photos, labelled by the person's name. */
  photos: { label: string; uri: string }[];
  /** Voice notes that have playable audio, with their transcript/summary. */
  voiceNotes: { uri: string; transcript: string | null; summary: string | null; status: string | null }[];
  /** True when there is any card image or person photo to view. */
  hasPhotos: boolean;
}
