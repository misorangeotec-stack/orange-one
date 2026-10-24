/**
 * fundFlowPlan.ts — "Changes after plan": what was added, removed and changed after the CFO
 * approved the month's plan (user, 24-Oct-2026). One builder for the page, the Excel sheet and
 * the PDF, so the three always list the same lines and the same totals.
 *
 * Every figure is in rupees at the month's CURRENT std rate and net of what earlier months paid,
 * so neither a rate change nor a last-month payment shows up as a change of plan.
 */
import { HEAD_META, lineValues, planBridge, type PlanBridge } from "./fundFlowCalc";
import type { FfLine, FfMonth } from "./fundFlow";

export type PlanChangeKind = "added" | "removed" | "changed" | "removal_asked";

export interface PlanChangeRow {
  kind: PlanChangeKind;
  sheet: string;
  name: string;
  /** In the approved plan (0 for an addition). */
  plan: number;
  /** Approved now (0 for a removal, 0 for an addition the CFO has not approved). */
  approved: number;
  /** The budget the team has typed now. */
  budget: number;
  /** approved − plan: what this line moved the approved total by. */
  effect: number;
  status: string;
  remarks: string | null;
}

const nameOf = (l: FfLine) => l.party || l.description || l.line_type || HEAD_META[l.head].label;

export function planChanges(m: FfMonth, lines: FfLine[], removed: FfLine[]): { rows: PlanChangeRow[]; bridge: PlanBridge } {
  const rate = m.std_rate;
  const fx = (l: FfLine) => (l.currency === "USD" ? rate : 1);
  const planInr = (l: FfLine) => (l.plan_unit == null ? 0 : (l.plan_unit - (l.paid_before ?? 0)) * fx(l));
  const rows: PlanChangeRow[] = [];

  for (const l of lines) {
    const v = lineValues(l, rate, true);
    const plan = planInr(l);
    if (l.plan_unit == null) {
      rows.push({
        kind: "added", sheet: HEAD_META[l.head].sheet, name: nameOf(l), plan: 0, approved: v.approvedInr, budget: v.budgetInr,
        effect: v.approvedInr, status: l.approved_at ? (l.changed_after_approval ? "Approved, changed since — awaiting CFO" : "Approved by CFO") : "Awaiting CFO",
        remarks: l.remarks,
      });
    } else if (l.delete_requested) {
      rows.push({
        kind: "removal_asked", sheet: HEAD_META[l.head].sheet, name: nameOf(l), plan, approved: v.approvedInr, budget: v.budgetInr,
        effect: v.approvedInr - plan, status: "Removal asked — awaiting CFO", remarks: l.remarks,
      });
    } else if (Math.abs(v.approvedInr - plan) > 0.5 || l.changed_after_approval) {
      rows.push({
        kind: "changed", sheet: HEAD_META[l.head].sheet, name: nameOf(l), plan, approved: v.approvedInr, budget: v.budgetInr,
        effect: v.approvedInr - plan,
        status: l.changed_after_approval ? "Budget changed — awaiting CFO" : "Changed, approved by CFO", remarks: l.remarks,
      });
    }
  }
  for (const l of removed) {
    const plan = planInr(l);
    rows.push({
      kind: "removed", sheet: HEAD_META[l.head].sheet, name: nameOf(l), plan, approved: 0, budget: 0, effect: -plan,
      status: `Removed ${l.updated_at ? new Date(l.updated_at).toLocaleDateString("en-GB") : ""}`, remarks: l.remarks,
    });
  }
  const order: Record<PlanChangeKind, number> = { added: 0, removed: 1, removal_asked: 2, changed: 3 };
  rows.sort((a, b) => order[a.kind] - order[b.kind] || Math.abs(b.effect) - Math.abs(a.effect));

  const bridge = planBridge([
    ...lines.map((l) => ({
      head: l.head, currency: l.currency, plan_unit: l.plan_unit, paid_before: l.paid_before, values: lineValues(l, rate, true),
      awaiting: !l.approved_at, changed: l.changed_after_approval, deleteRequested: l.delete_requested,
    })),
    ...removed.map((l) => ({ head: l.head, currency: l.currency, plan_unit: l.plan_unit, paid_before: l.paid_before, deleted: true })),
  ], rate);
  return { rows, bridge };
}

export const KIND_LABEL: Record<PlanChangeKind, string> = {
  added: "Added after plan", removed: "Removed from plan", removal_asked: "Removal asked", changed: "Amount changed",
};
