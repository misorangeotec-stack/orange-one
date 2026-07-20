import { supabase } from "@/core/platform/supabase";
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import type { Followup, FollowupEntityType, FollowupInput, FollowupOutcome, FollowupPatch } from "./followupTypes";

/**
 * Read/write layer for the customer follow-up log.
 *
 * WHERE THE DATA LIVES (2026-07-20): the follow-up table was moved to the ConnectWave (TallyCopilot)
 * project so all receivables data — live and pipeline — shares one store. ConnectWave is anon and
 * sessionless from the browser (auth.uid() is null there), so the split mirrors musterApi.ts:
 *
 *   READS  → the ConnectWave ANON client directly (the table is anon-readable there, team-wide).
 *   WRITES → the `followups-write` Edge Function on the IDENTITY project, which verifies the caller's
 *            login there and then writes to ConnectWave with ITS service key. The browser never holds
 *            write access to another project's data. Authorization (insert = any signed-in user;
 *            edit/delete = own-or-admin) is enforced inside that function.
 *
 * The wire shape (columns, the newest-first ordering, entity keying) is unchanged from the old
 * identity-project table, so the hook / modal / worklist derive everything exactly as before.
 */

const TABLE = "receivables_followups";
const PAGE = 1000;

interface FollowupRow {
  id: string;
  entity_type: string;
  entity_name: string;
  remarks: string;
  outcome: string;
  next_followup_date: string | null;
  promised_amount: number | null;
  promised_date: string | null;
  outstanding_at_entry: number | null;
  overdue_at_entry: number | null;
  salesperson: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toFollowup(r: FollowupRow): Followup {
  return {
    id: r.id,
    entityType: r.entity_type as FollowupEntityType,
    entityName: r.entity_name,
    remarks: r.remarks,
    outcome: r.outcome as FollowupOutcome,
    nextFollowupDate: r.next_followup_date,
    promisedAmount: r.promised_amount,
    promisedDate: r.promised_date,
    outstandingAtEntry: r.outstanding_at_entry,
    overdueAtEntry: r.overdue_at_entry,
    salesperson: r.salesperson,
    createdBy: r.created_by ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Every follow-up, newest first, read from the ConnectWave anon client.
 *
 * Paged with .range() and a TOTAL order — `created_at desc, id desc` — because Postgres guarantees no
 * row order without an ORDER BY and a non-unique key (created_at alone) breaks ties arbitrarily, which
 * can dup one row across pages and drop another. The compound order is deterministic and keeps the
 * newest-first contract latestByEntity() depends on. (Same paging rule as musterApi.fetchAll.)
 */
export async function fetchFollowups(): Promise<Followup[]> {
  const cw = getConnectwaveSupabase();
  const out: FollowupRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await cw
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as FollowupRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.map(toFollowup);
}

/** Invoke followups-write and surface the REAL server error message (mirrors musterApi/adminUserApi). */
async function invokeFollowups<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("followups-write", { body });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) detail = String(parsed.error);
      } catch {
        /* body wasn't JSON — keep the generic message */
      }
    }
    throw new Error(detail);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

/**
 * Log a new follow-up. The Edge Function stamps created_by from the caller's JWT, so `createdBy` in the
 * input is ignored here (kept in the signature so callers need not change).
 */
export async function insertFollowup(input: FollowupInput & { createdBy: string }): Promise<string> {
  const { row } = await invokeFollowups<{ row: { id: string } }>({
    action: "insert",
    entity_type: input.entityType,
    entity_name: input.entityName,
    remarks: input.remarks,
    outcome: input.outcome,
    next_followup_date: input.nextFollowupDate,
    promised_amount: input.promisedAmount,
    promised_date: input.promisedDate,
    outstanding_at_entry: input.outstandingAtEntry,
    overdue_at_entry: input.overdueAtEntry,
    salesperson: input.salesperson,
  });
  return row.id;
}

/**
 * Correct an existing entry. Only the conversation fields are editable — the entity and the frozen
 * at-entry context are history and must not be rewritten. The function enforces own-or-admin.
 */
export async function updateFollowup(id: string, patch: FollowupPatch): Promise<void> {
  await invokeFollowups({
    action: "update",
    id,
    remarks: patch.remarks,
    outcome: patch.outcome,
    next_followup_date: patch.nextFollowupDate,
    promised_amount: patch.promisedAmount,
    promised_date: patch.promisedDate,
  });
}

export async function deleteFollowup(id: string): Promise<void> {
  await invokeFollowups({ action: "delete", id });
}
