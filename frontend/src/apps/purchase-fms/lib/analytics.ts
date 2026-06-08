import type { PurchaseEntry } from "../types";
import { PURCHASE_STAGES, STAGE_COUNT } from "../config/stages";

/**
 * Pure aggregations for the Reports screen, computed over the in-memory entries.
 * Every function takes `scope` — the set of stage keys the viewer may see (all 9
 * for admins; a manager's owned subset otherwise). Stage-centric metrics are
 * restricted to scoped stages; end-to-end metrics (completed count, cycle time)
 * are global since they span the whole pipeline.
 */

export const ALL_STAGE_KEYS = PURCHASE_STAGES.map((s) => s.key);

const STAGE_INDEX: Record<string, number> = Object.fromEntries(PURCHASE_STAGES.map((s, i) => [s.key, i]));

const dayNum = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
const daysBetween = (aIso: string, bIso: string) => Math.round((dayNum(bIso) - dayNum(aIso)) / 86400000);
const todayIso = () => new Date().toISOString().slice(0, 10);

export const isComplete = (e: PurchaseEntry) => e.currentIndex >= STAGE_COUNT;
const activeKey = (e: PurchaseEntry) => (isComplete(e) ? null : PURCHASE_STAGES[e.currentIndex]?.key ?? null);

export interface OverviewStats {
  active: number;
  completed: number;
  overdue: number;
  onTimePct: number | null;
  avgCycleDays: number | null;
}

export function overview(entries: PurchaseEntry[], scope: string[]): OverviewStats {
  const inScope = new Set(scope);
  let active = 0;
  let overdue = 0;
  const today = todayIso();
  for (const e of entries) {
    const k = activeKey(e);
    if (k && inScope.has(k)) {
      active++;
      const planned = e.stages[e.currentIndex]?.plannedDate;
      if (planned && planned < today) overdue++;
    }
  }

  // End-to-end metrics (global).
  const done = entries.filter(isComplete);
  const completed = done.length;
  const cycles = done
    .map((e) => {
      const last = e.stages[STAGE_COUNT - 1]?.actualDate;
      return last ? daysBetween(e.createdAt, last) : null;
    })
    .filter((n): n is number => n != null && n >= 0);
  const avgCycleDays = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null;

  const ot = stageOnTime(entries, scope);
  const totOn = ot.reduce((a, r) => a + r.onTime, 0);
  const totSamples = ot.reduce((a, r) => a + r.onTime + r.delayed, 0);
  const onTimePct = totSamples ? Math.round((totOn / totSamples) * 100) : null;

  return { active, completed, overdue, onTimePct, avgCycleDays };
}

export interface DistributionRow {
  key: string;
  label: string;
  count: number;
}

/** Entries currently sitting at each scoped stage, plus a Completed bucket (full scope only). */
export function pipelineDistribution(entries: PurchaseEntry[], scope: string[]): DistributionRow[] {
  const inScope = new Set(scope);
  const rows: DistributionRow[] = PURCHASE_STAGES.filter((s) => inScope.has(s.key)).map((s) => ({
    key: s.key,
    label: s.short,
    count: entries.filter((e) => !isComplete(e) && e.currentIndex === STAGE_INDEX[s.key]).length,
  }));
  if (scope.length === ALL_STAGE_KEYS.length) {
    rows.push({ key: "__completed", label: "Completed", count: entries.filter(isComplete).length });
  }
  return rows;
}

export interface TurnaroundRow {
  key: string;
  label: string;
  avgDays: number | null;
  samples: number;
}

/** Average days spent in each scoped stage (actual − previous actual; stage 1 = created → actual). */
export function stageTurnaround(entries: PurchaseEntry[], scope: string[]): TurnaroundRow[] {
  const inScope = new Set(scope);
  return PURCHASE_STAGES.filter((s) => inScope.has(s.key)).map((s) => {
    const idx = STAGE_INDEX[s.key]!;
    const durations: number[] = [];
    for (const e of entries) {
      const st = e.stages[idx];
      if (!st || st.status !== "done" || !st.actualDate) continue;
      const prevActual = idx === 0 ? e.createdAt : e.stages[idx - 1]?.actualDate;
      if (!prevActual) continue;
      const d = daysBetween(prevActual, st.actualDate);
      if (d >= 0) durations.push(d);
    }
    return {
      key: s.key,
      label: s.short,
      samples: durations.length,
      avgDays: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
    };
  });
}

export interface OnTimeRow {
  key: string;
  label: string;
  onTime: number;
  delayed: number;
  pct: number | null;
}

/** On-time vs delayed (actual ≤ planned) per scoped stage. */
export function stageOnTime(entries: PurchaseEntry[], scope: string[]): OnTimeRow[] {
  const inScope = new Set(scope);
  return PURCHASE_STAGES.filter((s) => inScope.has(s.key)).map((s) => {
    const idx = STAGE_INDEX[s.key]!;
    let onTime = 0;
    let delayed = 0;
    for (const e of entries) {
      const st = e.stages[idx];
      if (!st || st.status !== "done" || !st.actualDate || !st.plannedDate) continue;
      if (dayNum(st.actualDate) <= dayNum(st.plannedDate)) onTime++;
      else delayed++;
    }
    const total = onTime + delayed;
    return { key: s.key, label: s.short, onTime, delayed, pct: total ? Math.round((onTime / total) * 100) : null };
  });
}

export interface OverdueRow {
  entry: PurchaseEntry;
  stageTitle: string;
  stageKey: string;
  plannedDate: string;
  daysOverdue: number;
}

/** In-progress entries whose active (scoped) stage is past its planned date. */
export function overdueEntries(entries: PurchaseEntry[], scope: string[]): OverdueRow[] {
  const inScope = new Set(scope);
  const today = todayIso();
  const rows: OverdueRow[] = [];
  for (const e of entries) {
    const k = activeKey(e);
    if (!k || !inScope.has(k)) continue;
    const st = e.stages[e.currentIndex];
    if (!st?.plannedDate || st.plannedDate >= today) continue;
    rows.push({
      entry: e,
      stageKey: k,
      stageTitle: PURCHASE_STAGES[e.currentIndex]?.title ?? k,
      plannedDate: st.plannedDate,
      daysOverdue: daysBetween(st.plannedDate, today),
    });
  }
  return rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/** The scoped stage with the highest average turnaround (the bottleneck), if any. */
export function bottleneck(rows: TurnaroundRow[]): TurnaroundRow | null {
  const withData = rows.filter((r) => r.avgDays != null && r.samples > 0);
  if (!withData.length) return null;
  return withData.reduce((max, r) => (r.avgDays! > (max.avgDays ?? -1) ? r : max));
}
