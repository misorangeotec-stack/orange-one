import type { Priority, RequestStatus } from "../types";

export type Tone = "grey" | "blue" | "orange" | "green" | "red" | "yellow";

/**
 * One place decides the words and the colour for a request's status.
 *
 * ⚠ THE LABELS ARE WRITTEN FOR THE READER, NOT FOR THE SCHEMA. `under_validation`
 *   is a database word; "With HR" is what the person waiting actually wants to
 *   know. The keys stay as stored — they are persisted on every row — and only
 *   this map moves if the wording changes.
 */
export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_validation: "With HR",
  returned: "Sent back",
  proposed: "Awaiting HR Head",
  hr_approved: "Awaiting Management",
  approved: "Approved",
  rejected: "Rejected",
  trainer_finalised: "Trainer confirmed",
  scheduled: "Scheduled",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<RequestStatus, Tone> = {
  draft: "grey",
  submitted: "blue",
  under_validation: "blue",
  returned: "yellow",
  proposed: "orange",
  hr_approved: "orange",
  approved: "green",
  rejected: "red",
  trainer_finalised: "green",
  scheduled: "green",
  closed: "grey",
  cancelled: "grey",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  high: "red",
  medium: "yellow",
  low: "grey",
};

/** dd-mmm-yyyy, the format every other screen in the hub uses. */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Indian-format rupees.
 *
 * ⚠ RETURNS "—" FOR NULL, NOT "₹0". A training with no cost entered yet and a
 *   training that is genuinely free are different facts, and printing ₹0 for the
 *   first is how a budget report ends up understating what was spent.
 */
export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
