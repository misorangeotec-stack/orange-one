/**
 * Customer follow-up log — shared types.
 *
 * A follow-up is one payment-chase conversation with a customer (or a customer group):
 * what was discussed, how it went, an optional promise-to-pay, and when to chase next.
 *
 * ENTITY KEY: follow-ups hang off the customer/group NAME, never off `Customer.id`.
 * `Customer.id` is a pipeline surrogate ("C0001") that renumbers on every reprocess and
 * turns into a Tally GUID under the Live (Tally) source — anything keyed off it would
 * silently detach. The name is the hub's stable natural key (it's what /customer/:id and
 * /group/:id carry, and what consolidateByName / consolidateByGroup merge on).
 */

export type FollowupEntityType = "customer" | "group";

export type FollowupOutcome =
  | "connected"
  | "no_response"
  | "promised_payment"
  | "payment_disputed"
  | "partial_received"
  | "escalated"
  | "other";

export interface Followup {
  id: string;
  entityType: FollowupEntityType;
  entityName: string;
  remarks: string;
  outcome: FollowupOutcome;
  /** null = no further follow-up scheduled (the chase is closed). */
  nextFollowupDate: string | null; // "YYYY-MM-DD"
  promisedAmount: number | null;
  promisedDate: string | null; // "YYYY-MM-DD"
  /** Frozen at the time of the call, so history reads true after the pipeline moves the numbers. */
  outstandingAtEntry: number | null;
  overdueAtEntry: number | null;
  salesperson: string | null;
  createdBy: string;
  createdAt: string; // ISO timestamptz
  updatedAt: string;
}

/** What the user fills in. The frozen-context fields are stamped by the caller, not typed here. */
export interface FollowupInput {
  entityType: FollowupEntityType;
  entityName: string;
  remarks: string;
  outcome: FollowupOutcome;
  nextFollowupDate: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  outstandingAtEntry: number | null;
  overdueAtEntry: number | null;
  salesperson: string | null;
}

/** Editable subset — the frozen context and the entity are never re-written. */
export type FollowupPatch = Pick<
  FollowupInput,
  "remarks" | "outcome" | "nextFollowupDate" | "promisedAmount" | "promisedDate"
>;

export const OUTCOME_OPTIONS: { value: FollowupOutcome; label: string }[] = [
  { value: "connected", label: "Connected" },
  { value: "no_response", label: "No response" },
  { value: "promised_payment", label: "Promised payment" },
  { value: "partial_received", label: "Partial received" },
  { value: "payment_disputed", label: "Payment disputed" },
  { value: "escalated", label: "Escalated" },
  { value: "other", label: "Other" },
];

const OUTCOME_LABELS = Object.fromEntries(
  OUTCOME_OPTIONS.map((o) => [o.value, o.label]),
) as Record<FollowupOutcome, string>;

export function outcomeLabel(o: FollowupOutcome): string {
  return OUTCOME_LABELS[o] ?? o;
}

/** Tailwind classes for the outcome badge — green = good news, red = bad, grey = neutral. */
export function outcomeBadgeClass(o: FollowupOutcome): string {
  switch (o) {
    case "promised_payment":
    case "partial_received":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "payment_disputed":
    case "escalated":
      return "bg-red-50 text-red-700 border-red-200";
    case "no_response":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/** Stable map key for an entity. */
export function entityKey(type: FollowupEntityType, name: string): string {
  return `${type}:${name}`;
}

/**
 * The most recent entry per entity — the row that defines that customer's OPEN
 * follow-up. There is no status column by design: logging a new follow-up
 * supersedes the previous one, and a null `nextFollowupDate` means "no further
 * chase".
 *
 * Pure, and shared by `useFollowups` (the Hub's own worklist) and the home
 * screen's My Work provider, so the two can never disagree about what is open.
 *
 * REQUIRES `rows` newest-first — the first row seen per key wins. That is the
 * order `fetchFollowups()` returns (`order("created_at", { ascending: false })`).
 */
export function latestByEntity(rows: Followup[]): Map<string, Followup> {
  const map = new Map<string, Followup>();
  for (const f of rows) {
    const key = entityKey(f.entityType, f.entityName);
    if (!map.has(key)) map.set(key, f);
  }
  return map;
}

/**
 * Today as "YYYY-MM-DD" in LOCAL time.
 *
 * `new Date().toISOString()` is UTC — in IST (UTC+5:30) that returns *yesterday* for
 * every entry made before 05:30 local, which would park a fresh follow-up in "Overdue".
 * Build the string from the local calendar fields instead.
 */
export function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Where a scheduled follow-up sits relative to today. Date strings compare lexicographically. */
export type DueBucket = "overdue" | "today" | "upcoming";

export function dueBucketFor(nextDate: string, today = todayISO()): DueBucket {
  if (nextDate < today) return "overdue";
  if (nextDate === today) return "today";
  return "upcoming";
}
