/**
 * Capture + load the frozen month-start snapshot for the Monthly Collection Report (v2).
 *
 * Stored in the writable identity Supabase project (table receivables_due_snapshot) via
 * the core client — NOT the read-only receivables client — because capture WRITES. Only
 * admins may write (enforced by RLS); reads are open to any signed-in user.
 *
 * What we freeze (per customer per month):
 *   opening_outstanding  = previous month-end outstanding (already frozen in the trend)
 *   due_upto             = bills due by month-end as known at capture (overdue + coming-due)
 *   due_soon             = the not-yet-overdue portion of due_upto (coming due before EOM)
 * Received / Pending / Collection % are NOT frozen — the report computes them live.
 */
import { supabase } from "@/core/platform/supabase";
import type { Customer, CustomerDetail } from "@hub/lib/types";
import { computeOpenDue, startMonthOpening } from "./collectionMetrics";

export interface DueSnapshotRow {
  customerId: string;
  customerName: string | null;
  company: string | null;
  location: string | null;
  salesperson: string | null;
  opening: number;
  due: number;
  dueSoon: number;
  capturedAt: string | null;
}

/** Load the frozen snapshot for a month into a Map keyed by customer_id. Empty map on error. */
export async function loadSnapshot(month: string): Promise<Map<string, DueSnapshotRow>> {
  const out = new Map<string, DueSnapshotRow>();
  if (!month) return out;
  const { data, error } = await supabase
    .from("receivables_due_snapshot")
    .select("customer_id, customer_name, company, location, salesperson, opening_outstanding, due_upto, due_soon, captured_at")
    .eq("month", month);
  if (error || !data) return out;
  for (const r of data) {
    out.set(r.customer_id, {
      customerId: r.customer_id,
      customerName: r.customer_name,
      company: r.company,
      location: r.location,
      salesperson: r.salesperson,
      opening: Number(r.opening_outstanding) || 0,
      due: Number(r.due_upto) || 0,
      dueSoon: Number(r.due_soon) || 0,
      capturedAt: r.captured_at,
    });
  }
  return out;
}

/** When was a month's snapshot last captured? null = never. */
export async function snapshotCapturedAt(month: string): Promise<string | null> {
  if (!month) return null;
  const { data, error } = await supabase
    .from("receivables_due_snapshot")
    .select("captured_at")
    .eq("month", month)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.captured_at;
}

/**
 * Freeze (upsert) the month-start figures for EVERY customer that carries a non-zero
 * opening or due. Idempotent on (month, customer_id) — re-capturing overwrites, which is
 * why the caller confirms before re-capturing a month that already has rows.
 */
export async function captureMonthSnapshot(opts: {
  month: string;
  prevMonth: string | null;
  asOfMonth: string;
  asOfDate: string;
  allCustomers: Customer[];
  customerDetail: Record<string, CustomerDetail>;
  capturedBy: string | null;
}): Promise<{ count: number }> {
  const { month, asOfMonth, asOfDate, allCustomers, customerDetail, capturedBy } = opts;
  const rows = allCustomers.map((c) => {
    const detail = customerDetail[c.id];
    const opening = startMonthOpening(c, detail, month, asOfMonth, asOfDate);
    const { due, dueSoon } = computeOpenDue(c, detail, month, asOfMonth, asOfDate);
    return {
      month,
      customer_id: c.id,
      customer_name: c.name,
      company: c.company,
      location: c.location,
      salesperson: c.salesPerson,
      opening_outstanding: Math.round(opening),
      due_upto: Math.round(due),
      due_soon: Math.round(dueSoon),
      captured_by: capturedBy,
    };
  }).filter((r) => r.opening_outstanding !== 0 || r.due_upto !== 0);

  // Chunked upsert so a few-hundred-row capture stays within request limits.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("receivables_due_snapshot")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "month,customer_id" });
    if (error) throw new Error(error.message);
  }
  return { count: rows.length };
}
