import { supabase } from "@/core/platform/supabase";
import type { Category, Designation, PurchaseEntry, StageState, StepOwner } from "../types";

/**
 * Phase-3 read layer for Purchase FMS. Loads the generic FMS engine rows for the
 * `purchase` workflow from the identity Supabase project and maps them into the
 * exact domain shapes the screens already consume (see types/index.ts). All reads
 * run under RLS (authenticated read). Mirrors the parallel-fetch + map style of
 * core/platform/liveDirectory.ts.
 */

export const PURCHASE_WORKFLOW_KEY = "purchase";

export interface FmsData {
  workflowId: string;
  entries: PurchaseEntry[];
  categories: Category[];
  designations: Designation[];
  stepOwners: StepOwner[];
}

type JsonObj = Record<string, string | number | null>;

const asValues = (v: unknown): JsonObj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonObj) : {};

export async function fetchFmsData(): Promise<FmsData> {
  // 1. Resolve the workflow id.
  const wfRes = await supabase
    .from("fms_workflows")
    .select("id,key")
    .eq("key", PURCHASE_WORKFLOW_KEY)
    .maybeSingle();
  if (wfRes.error) throw new Error(wfRes.error.message);
  if (!wfRes.data) throw new Error("Purchase FMS workflow not found — apply the Phase-2 seed migration.");
  const workflowId = wfRes.data.id as string;

  // 2. Everything else in parallel.
  const [stepsRes, optionsRes, desigRes, entriesRes, stagesRes] = await Promise.all([
    supabase
      .from("fms_workflow_steps")
      .select("id,step_index,key,owner_employee_ids,owner_employee_names,department_id,designation_id")
      .eq("workflow_id", workflowId)
      .order("step_index"),
    supabase
      .from("fms_field_options")
      .select("id,option_set,label,meta,sort_order")
      .eq("workflow_id", workflowId)
      .eq("option_set", "category")
      .order("sort_order"),
    supabase.from("designations").select("id,name,sort_order").order("sort_order"),
    supabase
      .from("fms_entries")
      .select("id,code,current_step_index,status,summary,created_at")
      .eq("workflow_id", workflowId),
    supabase
      .from("fms_entry_stages")
      .select("entry_id,step_index,status,planned_date,actual_date,values"),
  ]);

  for (const res of [stepsRes, optionsRes, desigRes, entriesRes, stagesRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const steps = stepsRes.data ?? [];

  // step_index -> stage key (the engine's canonical ordering).
  const keyByIndex = new Map<number, string>();
  for (const s of steps) keyByIndex.set(s.step_index as number, s.key as string);

  // Categories from the dynamic 'category' option set.
  const categories: Category[] = (optionsRes.data ?? []).map((o) => ({
    id: o.id as string,
    name: o.label as string,
    unit: (asValues(o.meta).unit as string) ?? "",
  }));

  const designations: Designation[] = (desigRes.data ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
  }));

  // One StepOwner per workflow step (keyed by step key).
  const stepOwners: StepOwner[] = steps.map((s) => ({
    stepKey: s.key as string,
    departmentId: (s.department_id as string | null) ?? null,
    designationId: (s.designation_id as string | null) ?? null,
    employeeIds: (s.owner_employee_ids as string[] | null) ?? [],
    employeeNames: (s.owner_employee_names as string[] | null) ?? [],
  }));

  // Group stage rows by entry, then build the ordered stages[] per entry.
  const stagesByEntry = new Map<string, typeof stagesRes.data>();
  for (const row of stagesRes.data ?? []) {
    const list = stagesByEntry.get(row.entry_id as string) ?? [];
    list.push(row);
    stagesByEntry.set(row.entry_id as string, list);
  }

  const entries: PurchaseEntry[] = (entriesRes.data ?? []).map((e) => {
    const rows = (stagesByEntry.get(e.id as string) ?? [])
      .slice()
      .sort((a, b) => (a.step_index as number) - (b.step_index as number));
    const stages: StageState[] = rows.map((r) => ({
      key: keyByIndex.get(r.step_index as number) ?? String(r.step_index),
      status: r.status as StageState["status"],
      plannedDate: (r.planned_date as string | null) ?? null,
      actualDate: (r.actual_date as string | null) ?? null,
      values: asValues(r.values),
    }));
    // Header fields denormalised from the origin stage (always present).
    const header = { ...asValues(rows[0]?.values), ...asValues(e.summary) };
    return {
      id: e.id as string,
      code: e.code as string,
      createdAt: e.created_at as string,
      category: String(header.category ?? ""),
      itemName: String(header.itemName ?? ""),
      quantity: Number(header.quantity ?? 0),
      unit: String(header.unit ?? ""),
      remarks: String(header.remarks ?? ""),
      currentIndex: e.current_step_index as number,
      stages,
    };
  });

  // Newest first (matches the mock's prepend-on-create ordering).
  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  return { workflowId, entries, categories, designations, stepOwners };
}
