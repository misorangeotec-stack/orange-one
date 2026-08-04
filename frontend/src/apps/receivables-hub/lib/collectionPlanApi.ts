import { supabase } from "@/core/platform/supabase";
import { getConnectwaveSupabase } from "./connectwaveSupabase";
import { isMonthLabel, type CollectionPlan, type CollectionPlanInput, type PlanEntityType } from "./collectionPlanTypes";

/**
 * Read/write layer for the monthly collection plan.
 *
 * THIS FILE IS THE STORAGE SEAM. Everything above it — collectionPlanTypes, useCollectionPlan,
 * the report page, the modal — is written against these four functions and knows nothing about
 * which project the rows live in. Moving the plan to the identity project later means rewriting
 * the four bodies here and swapping the DDL; nothing else in the app moves.
 *
 * WHERE THE DATA LIVES: the ConnectWave (TallyCopilot) project, alongside receivables_followups
 * and the ext_* muster tables, so all receivables user-content shares one store. ConnectWave is
 * anon and sessionless from the browser (auth.uid() is null there), so the split mirrors
 * followupsApi.ts exactly:
 *
 *   READS  → the ConnectWave ANON client directly (the table is anon-readable there, team-wide).
 *   WRITES → the `collection-plan-write` Edge Function on the IDENTITY project, which verifies the
 *            caller's login there and then writes to ConnectWave with ITS service key. The browser
 *            never holds write access to another project's data. Authorization (upsert = any
 *            signed-in user, because a plan is a SHARED cell a manager may revise; delete =
 *            author-or-admin) is enforced inside that function.
 */

const TABLE = "receivables_collection_plan";
const PAGE = 1000;

interface PlanRow {
  id: string;
  month: string;
  entity_type: string;
  entity_name: string;
  planned_amount: number | null;
  expected_date: string | null;
  note: string | null;
  salesperson: string | null;
  due_at_plan: number | null;
  outstanding_at_plan: number | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_by: string | null;
  updated_by_email: string | null;
  updated_at: string;
  revision: number | null;
}

function toCollectionPlan(r: PlanRow): CollectionPlan {
  return {
    id: r.id,
    month: r.month,
    entityType: r.entity_type as PlanEntityType,
    entityName: r.entity_name,
    plannedAmount: r.planned_amount ?? 0,
    expectedDate: r.expected_date,
    note: r.note,
    salesperson: r.salesperson,
    dueAtPlan: r.due_at_plan,
    outstandingAtPlan: r.outstanding_at_plan,
    createdBy: r.created_by,
    createdByEmail: r.created_by_email,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedByEmail: r.updated_by_email,
    updatedAt: r.updated_at,
    revision: r.revision ?? 1,
  };
}

/**
 * Every plan row for the given month labels, read from the ConnectWave anon client.
 *
 * Paged with .range() and a TOTAL order — `entity_name, id` — because Postgres guarantees no row
 * order without an ORDER BY, and a non-unique key breaks ties arbitrarily, which can dup one row
 * across pages and drop another. (supabaseFetcher.ts documents a measured 13% error from exactly
 * that mistake.)
 *
 * ⚠️ NEVER order by `month`: it is a text LABEL, so 'Feb-27' sorts before 'Mar-26'. Ordering is
 * only ever needed for stable paging here; display order is sequenced in TS via monthLabelToOrdinal.
 */
export async function fetchCollectionPlans(months: string[]): Promise<CollectionPlan[]> {
  if (months.length === 0) return [];
  const cw = getConnectwaveSupabase();
  const out: PlanRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await cw
      .from(TABLE)
      .select("*")
      .in("month", months)
      .order("entity_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PlanRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out.map(toCollectionPlan);
}

/**
 * Call the write door, surfacing the server's real message.
 *
 * functions.invoke() reports a non-2xx as a generic "Edge Function returned a non-2xx status
 * code" and hides the body on `error.context`; without this unwrapping every validation failure
 * would reach the user as that one useless sentence. (Copied from followupsApi.invokeFollowups.)
 */
async function invokePlan<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("collection-plan-write", { body });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) detail = String(parsed.error);
      } catch { /* body wasn't JSON — keep the generic message */ }
    }
    throw new Error(detail);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

/** Shape one input for the wire. Shared by the single and batch paths so they can never drift. */
function toWire(input: CollectionPlanInput): Record<string, unknown> {
  return {
    month: input.month,
    entity_type: input.entityType,
    entity_name: input.entityName,
    planned_amount: input.plannedAmount,
    expected_date: input.expectedDate,
    note: input.note,
    salesperson: input.salesperson,
    due_at_plan: input.dueAtPlan,
    outstanding_at_plan: input.outstandingAtPlan,
  };
}

/**
 * Create-or-revise one plan cell.
 *
 * A zero (or negative) amount DELETES the row rather than storing 0, so "no row" is the single
 * representation of "unplanned" — otherwise a cleared plan and a deliberate plan-to-collect-nothing
 * would be indistinguishable, and every roll-up would have to special-case which one it was
 * looking at.
 *
 * Addressed by (month, entityType, entityName), never by id: the UI edits a cell and must not
 * care whether a row already exists.
 */
export async function upsertCollectionPlan(input: CollectionPlanInput): Promise<void> {
  if (!isMonthLabel(input.month)) throw new Error(`"${input.month}" is not a MMM-YY month label`);
  if (!(input.plannedAmount > 0)) {
    await deleteCollectionPlan(input.month, input.entityType, input.entityName);
    return;
  }
  await invokePlan({ action: "upsert", ...toWire(input) });
}

/** One round trip for a whole month's plan. Returns the number of rows written. */
export async function upsertCollectionPlans(entries: CollectionPlanInput[]): Promise<number> {
  const writable = entries.filter((e) => e.plannedAmount > 0);
  for (const e of writable) {
    if (!isMonthLabel(e.month)) throw new Error(`"${e.month}" is not a MMM-YY month label`);
  }
  if (writable.length === 0) return 0;
  const { count } = await invokePlan<{ count: number }>({
    action: "upsert_many",
    entries: writable.map(toWire),
  });
  return count;
}

/** Clear a plan. Tolerates "already gone" — the caller's desired end state either way. */
export async function deleteCollectionPlan(
  month: string, type: PlanEntityType, name: string,
): Promise<void> {
  try {
    await invokePlan({ action: "delete", month, entity_type: type, entity_name: name });
  } catch (e) {
    // The function 404s when there is no row. Clearing an already-unplanned cell is a no-op, not
    // an error the user should see; anything else still propagates.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/^no plan for /.test(msg)) throw e;
  }
}
