/**
 * Labels, tones and small formatters for the Complaint (RM/FG) FMS.
 *
 * ⚠ THIS FILE IS WHERE THE RM/FG DIRECTION LIVES, and it must stay the only place.
 *   The row carries ONE party/invoice/lot block (types/index.ts explains why); what
 *   changes between a Finished Good and a Raw Material complaint is the WORDS on
 *   it and which side of `mst_parties` the picker offers. Spell that in a second
 *   place and the form and the grid will eventually disagree about what a column
 *   is called.
 */
import type {
  CauseGroup,
  ComplaintType,
  RequestStatus,
  ResolutionType,
  Severity,
} from "../types";

/* ----------------------------- the RM/FG labels --------------------------- */

export const lotLabelOf = (t: ComplaintType): string =>
  t === "finished_good" ? "FG Lot No." : "RM Lot No.";

export const partyRoleOf = (t: ComplaintType): string =>
  t === "finished_good" ? "Customer" : "Vendor";

export const partyLabelOf = (t: ComplaintType): string => `${partyRoleOf(t)} Name`;

export const invoiceLabelOf = (t: ComplaintType): string =>
  t === "finished_good" ? "Sales Invoice No." : "Purchase Invoice No.";

export const invoiceDateLabelOf = (t: ComplaintType): string =>
  t === "finished_good" ? "Sales Invoice Date" : "Purchase Invoice Date";

/**
 * Which `mst_parties` flag the picker filters on. Both flags may be true on one
 * row — we buy from and sell to some firms — so this narrows the list rather than
 * partitioning it.
 */
export const partyFlagOf = (t: ComplaintType): "is_customer" | "is_vendor" =>
  t === "finished_good" ? "is_customer" : "is_vendor";

/* --------------------------------- statuses ------------------------------- */

export const STATUS_LABEL: Record<RequestStatus, string> = {
  awaiting_plant: "With the plant",
  awaiting_service: "With the service team",
  awaiting_approval: "Awaiting management approval",
  awaiting_service_close: "Back with the service team",
  awaiting_management_review: "Awaiting management review",
  closed: "Closed",
  on_hold: "On hold",
  cancelled: "Cancelled",
  // Retired — see RequestStatus. Labelled so an old row still reads sensibly.
  awaiting_acknowledge: "Awaiting acknowledgement (retired)",
  awaiting_investigation: "Under investigation (retired)",
  awaiting_capa: "Awaiting CAPA (retired)",
  awaiting_resolution: "Awaiting resolution (retired)",
  awaiting_confirmation: "Awaiting confirmation (retired)",
  awaiting_close: "Awaiting close (retired)",
  rejected: "Rejected (retired)",
};

/** Badge classes. Terminal states are grey; `rejected` is red because it is a verdict. */
export const STATUS_TONE: Record<RequestStatus, string> = {
  awaiting_plant: "bg-orange/10 text-orange",
  awaiting_service: "bg-blue-50 text-blue-700",
  awaiting_approval: "bg-violet-50 text-violet-700",
  awaiting_service_close: "bg-blue-50 text-blue-700",
  awaiting_management_review: "bg-emerald-50 text-emerald-700",
  closed: "bg-grey-1 text-grey-2",
  on_hold: "bg-grey-1 text-grey-2",
  cancelled: "bg-grey-1 text-grey-2",
  awaiting_acknowledge: "bg-grey-1 text-grey-2",
  awaiting_investigation: "bg-grey-1 text-grey-2",
  awaiting_capa: "bg-grey-1 text-grey-2",
  awaiting_resolution: "bg-grey-1 text-grey-2",
  awaiting_confirmation: "bg-grey-1 text-grey-2",
  awaiting_close: "bg-grey-1 text-grey-2",
  rejected: "bg-red-50 text-red-700",
};

/** The statuses that are over — nothing is owed on them by anyone. */
export const TERMINAL_STATUSES: RequestStatus[] = ["closed", "cancelled", "rejected"];

export const isTerminal = (s: RequestStatus): boolean => TERMINAL_STATUSES.includes(s);

/**
 * Open means "still owed", and `on_hold` IS open — it is parked, not finished.
 * The Master Report's deny-list agrees: on_hold is deliberately absent from
 * `closed_statuses`, because hiding a held complaint is how one is never chased.
 */
export const isOpen = (s: RequestStatus): boolean => !isTerminal(s);

/* ------------------------------ badge palettes ---------------------------- */

/**
 * Badge classes for the RM/FG column and the type distribution.
 *
 * Two neutral-but-distinct tones rather than good/bad ones: neither side of the
 * split is the "bad" one — a raw-material complaint is us complaining, and a
 * finished-good one is a customer complaining to us.
 */
export const COMPLAINT_TYPE_TONE: Record<ComplaintType, string> = {
  finished_good: "bg-blue-50 text-blue-700",
  raw_material: "bg-violet-50 text-violet-700",
};

/** Badge classes for the root-cause Pareto. `party_side` is the one that isn't ours. */
export const CAUSE_GROUP_TONE: Record<CauseGroup, string> = {
  material: "bg-amber-50 text-amber-700",
  process: "bg-red-50 text-red-700",
  handling: "bg-orange/10 text-orange",
  storage: "bg-blue-50 text-blue-700",
  transport: "bg-violet-50 text-violet-700",
  party_side: "bg-grey-1 text-grey-2",
};

/* --------------------------------- severity ------------------------------- */

export const SEVERITY_TONE: Record<Severity, string> = {
  critical: "bg-red-50 text-red-700",
  major: "bg-amber-50 text-amber-700",
  minor: "bg-grey-1 text-grey-2",
};

/** Worst first — a severity column sorts by damage, not alphabetically. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

/* -------------------------------- resolution ------------------------------ */

/**
 * What the free-text `resReference` holds, in the words of the chosen resolution.
 * "Reference" alone tells the resolver nothing about what to type.
 */
export const RESOLUTION_REFERENCE_LABEL: Record<ResolutionType, string> = {
  replace: "Replacement LOT no.",
  credit_note: "Credit note no.",
  rework: "Rework job card no.",
  no_action: "Reference",
};

/* --------------------------------- dates ---------------------------------- */

export { formatDate as dmy, formatDateTime } from "@/shared/lib/time";

/**
 * How long the complaint has been alive, counted from when the problem was
 * NOTICED rather than from when somebody got round to raising it. That gap is
 * often the whole story, which is why the raise panel asks for it separately.
 *
 * Returns null when the row predates the field or it was never filled.
 */
export function ageDays(issueIdentifiedAt: string | null, now: Date = new Date()): number | null {
  if (!issueIdentifiedAt) return null;
  const from = new Date(issueIdentifiedAt);
  if (Number.isNaN(from.getTime())) return null;
  const ms = now.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** The subject line an email or a page title uses for one complaint. */
export const complaintSubject = (complaintNo: string, partyName: string | null): string =>
  partyName ? `${complaintNo} · ${partyName}` : complaintNo;

/**
 * "A date in the future" is wrong for every date this module collects: a problem
 * was noticed, an invoice was raised, a step was completed — all of them in the
 * past. Returns the error text, or "" when the value is fine.
 */
export function futureDateError(value: string | null, label: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return `${label} is not a valid date.`;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return d.getTime() > today.getTime() ? `${label} cannot be in the future.` : "";
}
