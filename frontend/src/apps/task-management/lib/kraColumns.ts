/**
 * A task row's KRA fields (20270107130000), read straight off its columns.
 *
 * ⚠ ITS OWN FILE, AND BROWSER-FREE, ON PURPOSE. fetchTaskData maps every task row
 *   through this, and fetchTaskData is compiled into the nightly server bundles
 *   (fmsRanking, kpiFacts, workSnapshot). Those builds refuse any graph that reaches
 *   browser storage or Vite's env object. When this lived in kraTasks.ts, beside that
 *   file's localhost test store, the KPI bundle could not be rebuilt at all
 *   (found 06-10-2026). Keep anything browser-only out of this file.
 */
export interface KraTaskFields {
  kraId: string | null;
  kraWeight: number | null;
  kraCompletionWeight: number | null;
  reviewRating: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function kraFieldsFromRow(r: any): KraTaskFields {
  return {
    kraId: r.kra_id ?? null,
    kraWeight: r.kra_weight == null ? null : Number(r.kra_weight),
    kraCompletionWeight: r.kra_completion_weight == null ? null : Number(r.kra_completion_weight),
    reviewRating: r.review_rating ?? null,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ?? null,
  };
}
