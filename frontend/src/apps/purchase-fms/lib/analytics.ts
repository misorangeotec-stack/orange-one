import type { PurchaseEntry } from "../types";
import { PURCHASE_STAGES, STAGE_COUNT } from "../config/stages";
import { monthKey } from "@/shared/lib/time";

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

// ---- end-to-end (global) trend & value metrics ----

/** PO value (incl. GST) captured at the Share-PO stage; 0 until the entry reaches it. */
export function poValue(e: PurchaseEntry): number {
  const v = e.stages.find((s) => s.key === "share_po")?.values?.totalGstValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface ThroughputRow {
  key: string;
  label: string;
  raised: number;
  completed: number;
}

/** Orders raised (by createdAt) vs completed (by last-stage actualDate) per month, last N months. */
export function monthlyThroughput(entries: PurchaseEntry[], months = 6): ThroughputRow[] {
  const now = new Date();
  const buckets: ThroughputRow[] = [];
  const index = new Map<string, ThroughputRow>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
    const row = { key, label, raised: 0, completed: 0 };
    buckets.push(row);
    index.set(key, row);
  }
  for (const e of entries) {
    const r = index.get(monthKey(e.createdAt));
    if (r) r.raised++;
    if (isComplete(e)) {
      const last = e.stages[STAGE_COUNT - 1]?.actualDate;
      const c = last && index.get(monthKey(last));
      if (c) c.completed++;
    }
  }
  return buckets;
}

export interface ValueRow {
  key: string;
  label: string;
  value: number;
}

/** Total PO value across all entries that have reached Share-PO. */
export function totalPoValue(entries: PurchaseEntry[]): number {
  return entries.reduce((sum, e) => sum + poValue(e), 0);
}

/** PO value summed by category, highest first. */
export function spendByCategory(entries: PurchaseEntry[]): ValueRow[] {
  const acc = new Map<string, number>();
  for (const e of entries) {
    const v = poValue(e);
    if (!v || !e.category) continue;
    acc.set(e.category, (acc.get(e.category) ?? 0) + v);
  }
  return [...acc.entries()]
    .map(([label, value]) => ({ key: label, label, value }))
    .sort((a, b) => b.value - a.value);
}

/** Top vendors by PO value (vendor captured at the Approval stage). */
export function topVendors(entries: PurchaseEntry[], n = 5): ValueRow[] {
  const acc = new Map<string, number>();
  for (const e of entries) {
    const v = poValue(e);
    const vendor = String(e.stages.find((s) => s.key === "approval")?.values?.vendorName ?? "").trim();
    if (!v || !vendor) continue;
    acc.set(vendor, (acc.get(vendor) ?? 0) + v);
  }
  return [...acc.entries()]
    .map(([label, value]) => ({ key: label, label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

export interface StatusBreakdown {
  completed: number;
  onTrack: number;
  overdue: number;
}

/** Mutually-exclusive entry counts: completed / in-progress on-track / in-progress overdue. */
export function statusBreakdown(entries: PurchaseEntry[]): StatusBreakdown {
  const today = todayIso();
  let completed = 0, onTrack = 0, overdue = 0;
  for (const e of entries) {
    if (isComplete(e)) { completed++; continue; }
    const planned = e.stages[e.currentIndex]?.plannedDate;
    if (planned && planned < today) overdue++;
    else onTrack++;
  }
  return { completed, onTrack, overdue };
}
