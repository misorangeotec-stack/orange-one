/**
 * markType.ts — Red Mark vs Legal. Pure and dependency-free, so the fetcher, the types and the
 * category helpers can all import it without a cycle.
 */

/**
 * The two kinds of customer on the Red Mark + Legal master (ext_redmark.mark_type, 21-10-2026).
 * Both are "Red Mark" in the old sense — `blocked`, the badge, the KPI — and the type only splits
 * them. Only an UNCLEARED row gives a customer a type; a cleared case has none.
 */
export type MarkType = "redmark" | "legal";
export const MARK_TYPES: MarkType[] = ["redmark", "legal"];
export const MARK_LABEL: Record<MarkType, string> = { redmark: "Red Mark", legal: "Legal" };
/** "Red Mark" / "Legal" (any case) → the stored value; null for anything else. */
export function parseMarkType(v: unknown): MarkType | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return s === "redmark" ? "redmark" : s === "legal" ? "legal" : null;
}

/** A customer's types — a consolidated row or group can hold both. */
export function markTypesOf(c: { markType?: MarkType; markTypes?: MarkType[] }): MarkType[] {
  if (c.markTypes?.length) return c.markTypes;
  return c.markType ? [c.markType] : [];
}

