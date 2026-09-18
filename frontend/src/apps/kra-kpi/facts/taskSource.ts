/**
 * Loading Task Management for the KRA / KPI facts (KPI-1) — SERVER ONLY.
 *
 * Tasks and templates come through Task Management's own fetcher, mapped exactly as
 * its screens map them. The bulk-closed ids come from the two sweeps' backup tables,
 * which only the service role can read: this file runs inside the `kpi-facts` edge
 * function, where `@/core/platform/supabase` is the service-role client
 * (supabase/worksnapshot/serverSupabase.ts). In a browser those reads would return
 * nothing, which is why no screen imports this file.
 */
import { supabase } from "@/core/platform/supabase";
import { fetchTaskScoringData } from "@/apps/task-management/data/fetchTaskData";
import type { TaskFactsInput } from "./taskFacts";

/**
 * The two admin sweeps, by their backup tables. Adding a third sweep means adding its
 * table here — a sweep missing from this list reads as ~a thousand late completions.
 */
export const BULK_CLOSE_TABLES = ["task_bulk_close_20260630", "task_bulk_close_af_20260909"] as const;

const PAGE = 1000;

// The sweeps' backup tables are not in the generated Database types (they are admin
// artefacts, never read by a screen), so they are read through an untyped alias — the
// standing convention for tables outside the types (see asset-maintenance/data/assetFetch.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function taskIdsOf(table: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("task_id")
      .order("task_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as { task_id: string }[];
    for (const r of rows) out.push(r.task_id);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadTaskFactsInput(): Promise<TaskFactsInput & { bulkByTable: Record<string, number> }> {
  const [{ tasks, recurringTasks }, ...sweeps] = await Promise.all([
    fetchTaskScoringData(),
    ...BULK_CLOSE_TABLES.map(taskIdsOf),
  ]);
  const bulkByTable: Record<string, number> = {};
  BULK_CLOSE_TABLES.forEach((t, i) => (bulkByTable[t] = sweeps[i].length));
  return { tasks, templates: recurringTasks, bulkClosed: new Set(sweeps.flat()), bulkByTable };
}
