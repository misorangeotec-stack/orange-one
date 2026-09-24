/**
 * Where the lab's ACTUALS come from (KPI-3, read-only). Nothing here writes.
 *
 * Three sources, in order of how much they can be trusted:
 *
 *  1 · `kpi_report` — the live scorecard's own RPC. It is SECURITY DEFINER, it checks
 *      the caller itself, and every figure in it already carries the owning module's
 *      due dates. Anything the lab can take from here, it takes from here: no due date
 *      is re-derived in this folder, which is the whole reason the recruitment lines
 *      can be scored at all.
 *
 *  2 · Read-only selects against the New Recruitment tables, for the two or three
 *      figures no step carries (CVs per requisition, closure TAT). Best effort: these
 *      run under the caller's own RLS, so someone outside HR sees "no access" rather
 *      than a misleading zero — the difference matters and the page shows it.
 *
 *  3 · Nothing at all, for the lines the hub cannot answer yet. Those lines
 *      take a typed figure, held in the browser (lib/manual.ts), never the database.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { fetchKpiReport, type KpiReport } from "@/apps/kra-kpi/data/report";
import type { HrMetric } from "../framework/types";

// Untyped alias for tables and RPCs outside the generated Database types — the
// standing convention here (see asset-maintenance/data/assetFetch.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** One measured figure, with the sentence that explains where it came from. */
export interface Measured {
  value: number | null;
  detail: string;
}

export const noData = (why: string): Measured => ({ value: null, detail: why });

/** Sum the named rows of one module out of a kpi_report, then divide as the line asks. */
export function fromKpiReport(
  report: KpiReport | null,
  module: string,
  rowKeys: string[],
  basis: "doneOfGiven" | "onTimeOfDone",
): Measured {
  if (!report) return noData("No nightly run has been written yet.");
  const rows = report.rows.filter((r) => r.module === module && (rowKeys.length === 0 || rowKeys.includes(r.row_key)));
  if (rows.length === 0) return noData("No work of this kind was due in the period.");
  const given = rows.reduce((s, r) => s + r.given, 0);
  const done = rows.reduce((s, r) => s + r.done, 0);
  const onTime = rows.reduce((s, r) => s + r.on_time, 0);
  if (basis === "doneOfGiven") {
    if (given === 0) return noData("Nothing was due in the period, so there is no completion rate.");
    return { value: (done / given) * 100, detail: `${done} of ${given} done · ${rows.length} row${rows.length === 1 ? "" : "s"}` };
  }
  // The sheet's own base for an on-time line: divided by work DONE, not work given.
  if (done === 0) return noData("Nothing was completed in the period, so there is no on-time rate.");
  return { value: (onTime / done) * 100, detail: `${onTime} of ${done} completed were on time` };
}

/** The window a date must fall in, as PostgREST bounds. `to` is inclusive. */
const dayAfter = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

interface ReqRow {
  id: string;
  hr_approved_at: string | null;
  request_date: string | null;
  closed_at: string | null;
  status?: string | null;
}

/** Requisitions this person raised or was the HR approver on, approved in the window. */
async function approvedRequisitions(from: string, to: string): Promise<ReqRow[]> {
  const { data, error } = await db
    .from("fms_hr_requisitions")
    .select("id, hr_approved_at, request_date, closed_at")
    .gte("hr_approved_at", from)
    .lt("hr_approved_at", dayAfter(to));
  if (error) throw new Error(error.message);
  return (data ?? []) as ReqRow[];
}

/**
 * The recruitment figures no FMS step carries.
 *
 * ⚠ These are NOT scoped to one person. The recruitment tables record the requisition,
 *    not who chased it, and on 21-09-2026 one HR executive works them all — so for
 *    Saloni the figure is hers. The moment a second recruiter exists this is wrong, and
 *    the row says so on screen rather than quietly attributing the team's work to one
 *    person. Scoping it properly needs an owner on the requisition.
 */
export async function fetchHrMetric(metric: HrMetric, from: string, to: string, param: number | null): Promise<Measured> {
  if (metric === "cv_per_requisition" || metric === "shortlist_per_requisition") {
    const reqs = await approvedRequisitions(from, to);
    if (reqs.length === 0) return noData("No requisition was approved in this period.");
    const ids = reqs.map((r) => r.id);
    let q = db.from("fms_hr_candidates").select("id, requisition_id").in("requisition_id", ids);
    if (metric === "shortlist_per_requisition") q = q.not("hr_shortlisted_at", "is", null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const n = (data ?? []).length;
    const word = metric === "cv_per_requisition" ? "CVs" : "shortlisted";
    return {
      value: n / reqs.length,
      detail: `${n} ${word} across ${reqs.length} requisition${reqs.length === 1 ? "" : "s"} approved in the period`,
    };
  }

  // closure_within_tat — the share of roles closed inside the typed TAT.
  //
  // ⚠ `status = "closed"` IS THE WHOLE POINT OF THIS FILTER. `closed_at` is stamped on a
  //   CANCELLED requisition too, and on 23-09-2026 every single row carrying one was a
  //   cancellation — nothing has ever reached "closed". Selecting on the timestamp alone
  //   scored cancellations as successful closures, on the largest line of the sheet
  //   (10%). "No requisition was closed" is the honest output and matches what the
  //   Weekly Review Report says at A1.4.
  if (param === null || param <= 0) return noData("Type the approved TAT in days to measure this.");
  const { data, error } = await db
    .from("fms_hr_requisitions")
    .select("id, hr_approved_at, request_date, closed_at, status")
    .eq("status", "closed")
    .gte("closed_at", from)
    .lt("closed_at", dayAfter(to));
  if (error) throw new Error(error.message);
  const closed = ((data ?? []) as ReqRow[]).filter((r) => r.closed_at);
  if (closed.length === 0) {
    return noData('No requisition reached "closed" in this period. Cancellations carry a closed_at too and are deliberately not counted.');
  }
  const days = closed.map((r) => {
    // Approval starts the clock; a requisition never approved falls back to its raise date.
    const start = r.hr_approved_at ?? r.request_date;
    if (!start) return null;
    return (Date.parse(r.closed_at!) - Date.parse(start)) / 86_400_000;
  });
  const usable = days.filter((d): d is number => d !== null);
  if (usable.length === 0) return noData("The requisitions closed in this period carry no approval or raise date.");
  const within = usable.filter((d) => d <= param).length;
  const avg = usable.reduce((s, d) => s + d, 0) / usable.length;
  return {
    value: (within / usable.length) * 100,
    detail: `${within} of ${usable.length} closed within ${param} days · they averaged ${avg.toFixed(0)} days`,
  };
}

export interface LabData {
  report: KpiReport | null;
  hr: Partial<Record<HrMetric, Measured>>;
  /** Set when the recruitment tables refused the read — not the same as "no rows". */
  hrError: string | null;
}

/**
 * One fetch for the whole page: the live report, then the recruitment figures.
 *
 * `params` is in the key because `closure_within_tat` is computed from the TAT a reader
 * types; change the number and the figure must be re-read, not served from the cache.
 */
export function useLabData(person: string, from: string, to: string, params: Record<string, number | null>) {
  const tat = params["1A.5"] ?? null;
  return useQuery<LabData>({
    queryKey: ["kpi-lab", person, from, to, tat],
    enabled: !!person && !!from && !!to,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const report = await fetchKpiReport(person, from, to);
      const hr: Partial<Record<HrMetric, Measured>> = {};
      let hrError: string | null = null;
      try {
        const [cv, shortlist, closure] = await Promise.all([
          fetchHrMetric("cv_per_requisition", from, to, null),
          fetchHrMetric("shortlist_per_requisition", from, to, null),
          fetchHrMetric("closure_within_tat", from, to, tat),
        ]);
        hr.cv_per_requisition = cv;
        hr.shortlist_per_requisition = shortlist;
        hr.closure_within_tat = closure;
      } catch (e) {
        // A non-HR reader is refused by RLS. Say that, rather than showing zeros.
        hrError = e instanceof Error ? e.message : String(e);
      }
      return { report, hr, hrError };
    },
  });
}
