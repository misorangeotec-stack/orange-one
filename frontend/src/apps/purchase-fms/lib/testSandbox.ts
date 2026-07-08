import type { PurchaseEntry, StageState } from "../types";
import { PURCHASE_STAGES } from "../config/stages";
import { nextPlannedDate } from "./plannedDate";

/**
 * Test Mode sandbox logic — kept here (not in the page) so the advancement
 * semantics live in ONE place. `advanceEntryLocal` is the faithful client mirror
 * of the `fms_complete_stage` Supabase RPC: mark the active stage done, activate
 * the next one (with its planned date), and increment the pointer. The only
 * difference is it touches a local in-memory entry instead of the database, so
 * Test Mode can walk an entry through all stages without any writes.
 */

/** A fresh, blank sandbox entry sitting at stage 1 (origin), active. */
export function makeSandboxEntry(): PurchaseEntry {
  const stages: StageState[] = PURCHASE_STAGES.map((d, i) => ({
    key: d.key,
    status: i === 0 ? "active" : "pending",
    plannedDate: null,
    actualDate: null,
    values: {},
  }));
  return {
    id: "TEST",
    code: "TEST-DRAFT",
    createdAt: new Date().toISOString(),
    category: "",
    itemName: "",
    quantity: 0,
    unit: "",
    remarks: "",
    stages,
    currentIndex: 0,
  };
}

/**
 * Complete the entry's active stage with `values` and advance the pipeline,
 * returning a NEW entry (pure — never mutates the input). Mirrors
 * `fms_complete_stage`; no Supabase, no RPC. The origin stage's fields are also
 * lifted into the entry header so the card + the follow-up planned-date rule
 * (which reads share_po.materialDispatchDate) behave exactly as in production.
 */
export function advanceEntryLocal(
  entry: PurchaseEntry,
  values: Record<string, string | number | null>
): PurchaseEntry {
  const idx = entry.currentIndex;
  if (idx >= PURCHASE_STAGES.length) return entry; // already complete

  const stages = entry.stages.map((s) => ({ ...s, values: { ...s.values } }));
  stages[idx] = {
    ...stages[idx],
    status: "done",
    actualDate: new Date().toISOString(),
    values,
  };

  // Lift the origin (stage 1) fields onto the header, like NewOrder does.
  const header =
    idx === 0
      ? {
          category: String(values.category ?? ""),
          itemName: String(values.itemName ?? ""),
          quantity: Number(values.quantity ?? 0) || 0,
          unit: String(values.unit ?? ""),
          remarks: String(values.remarks ?? ""),
        }
      : {};

  const next: PurchaseEntry = {
    ...entry,
    ...header,
    stages,
    currentIndex: idx + 1,
  };

  // Activate the next stage with its planned date (uses the live date engine).
  if (idx + 1 < PURCHASE_STAGES.length) {
    next.stages[idx + 1] = {
      ...next.stages[idx + 1],
      status: "active",
      plannedDate: nextPlannedDate(next, idx + 1),
    };
  }

  return next;
}
