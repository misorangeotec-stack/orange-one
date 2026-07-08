/**
 * Pure transforms for the Leads Dashboard: filtering, KPI aggregates, and the
 * series each chart needs. Kept side-effect free so pages stay thin and this is
 * easy to reason about. All aggregates operate on the FILTERED lead set.
 */

import { dayKey } from "@/shared/lib/date";
import type { Lead, MasterItem, Masters, MasterType } from "./types";

// ---- label helpers ---------------------------------------------------------

export function labelOf(masters: Masters, type: MasterType, id: string | null | undefined): string {
  if (!id) return "";
  return masters[type].find((m) => m.id === id)?.label ?? "";
}
export function colorOf(masters: Masters, type: MasterType, id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return masters[type].find((m) => m.id === id)?.color;
}

/** Interest levels that count as "hot" (ready-to-buy / very-interested). */
export function hotInterestIds(masters: Masters): Set<string> {
  return new Set(masters.interestLevels.filter((m) => /ready|very/i.test(m.label)).map((m) => m.id));
}

// ---- filters ---------------------------------------------------------------

export interface LeadFilters {
  from: string | null; // yyyy-mm-dd inclusive (captured date)
  to: string | null; // yyyy-mm-dd inclusive
  salespeople: string[]; // userIds
  categories: string[];
  interests: string[];
  askedAbout: string[];
  followUps: string[];
  hasVoice: "" | "yes" | "no";
  company: string;
  locations: string[];
}

export const emptyFilters = (): LeadFilters => ({
  from: null, to: null, salespeople: [], categories: [], interests: [], askedAbout: [], followUps: [], hasVoice: "", company: "", locations: [],
});

/** A filter key string so usePagination resets to page 1 when filters change. */
export const filtersKey = (f: LeadFilters): string => JSON.stringify(f);

/** Human-readable active-filter labels (for export + active-filter chips). */
export function describeFilters(f: LeadFilters, masters: Masters, salesName: (id: string) => string): string[] {
  const out: string[] = [];
  if (f.from || f.to) out.push(`Captured: ${f.from ?? "…"} → ${f.to ?? "…"}`);
  if (f.salespeople.length) out.push(`Salesperson: ${f.salespeople.map(salesName).join(", ")}`);
  if (f.interests.length) out.push(`Interest: ${f.interests.map((id) => labelOf(masters, "interestLevels", id)).join(", ")}`);
  if (f.categories.length) out.push(`Category: ${f.categories.map((id) => labelOf(masters, "categories", id)).join(", ")}`);
  if (f.askedAbout.length) out.push(`Asked about: ${f.askedAbout.map((id) => labelOf(masters, "askedAbout", id)).join(", ")}`);
  if (f.followUps.length) out.push(`Follow-up: ${f.followUps.map((id) => labelOf(masters, "followUpActions", id)).join(", ")}`);
  if (f.locations.length) out.push(`Location: ${f.locations.join(", ")}`);
  if (f.hasVoice) out.push(`Voice note: ${f.hasVoice === "yes" ? "Yes" : "No"}`);
  if (f.company.trim()) out.push(`Search: "${f.company.trim()}"`);
  return out;
}

const intersects = (a: string[], b: string[]) => a.some((x) => b.includes(x));

export function applyFilters(leads: Lead[], f: LeadFilters): Lead[] {
  const company = f.company.trim().toLowerCase();
  return leads.filter((l) => {
    const dk = dayKey(l.capturedOn);
    if (f.from && (!dk || dk < f.from)) return false;
    if (f.to && (!dk || dk > f.to)) return false;
    if (f.salespeople.length && !f.salespeople.includes(l.userId)) return false;
    if (f.categories.length && !intersects(l.categoryIds, f.categories)) return false;
    if (f.interests.length && !(l.interestLevelId && f.interests.includes(l.interestLevelId))) return false;
    if (f.askedAbout.length && !intersects(l.askedAboutIds, f.askedAbout)) return false;
    if (f.followUps.length && !(l.followUpActionId && f.followUps.includes(l.followUpActionId))) return false;
    if (f.hasVoice === "yes" && !l.hasVoice) return false;
    if (f.hasVoice === "no" && l.hasVoice) return false;
    if (f.locations.length && !f.locations.includes(l.location)) return false;
    if (company && !(l.companyName.toLowerCase().includes(company) || l.personName.toLowerCase().includes(company))) return false;
    return true;
  });
}

// ---- KPIs ------------------------------------------------------------------

export interface Kpis {
  total: number;
  today: number;
  thisWeek: number;
  uniqueCompanies: number;
  hot: number;
  followUpPct: number;
  voicePct: number;
  avgPerSalesperson: number;
  topCategory: { label: string; count: number } | null;
}

export function computeKpis(leads: Lead[], masters: Masters, now: Date): Kpis {
  const todayKey = dayKey(now);
  // Monday-anchored week start.
  const weekStart = new Date(now);
  const dow = (weekStart.getDay() + 6) % 7; // 0 = Monday
  weekStart.setDate(weekStart.getDate() - dow);
  weekStart.setHours(0, 0, 0, 0);
  const weekKey = dayKey(weekStart);

  const hot = hotInterestIds(masters);
  const companies = new Set<string>();
  const salespeople = new Set<string>();
  const catCounts = new Map<string, number>();
  let today = 0, thisWeek = 0, hotCount = 0, withFollow = 0, withVoice = 0;

  for (const l of leads) {
    if (l.companyName) companies.add(l.companyName.toLowerCase());
    salespeople.add(l.userId);
    const dk = dayKey(l.capturedOn);
    if (dk && todayKey && dk === todayKey) today++;
    if (dk && weekKey && dk >= weekKey) thisWeek++;
    if (l.interestLevelId && hot.has(l.interestLevelId)) hotCount++;
    if (l.followUpActionId) withFollow++;
    if (l.hasVoice) withVoice++;
    for (const c of l.categoryIds) catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }

  let topCategory: Kpis["topCategory"] = null;
  for (const [id, count] of catCounts) {
    if (!topCategory || count > topCategory.count) topCategory = { label: labelOf(masters, "categories", id) || "—", count };
  }

  const total = leads.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return {
    total,
    today,
    thisWeek,
    uniqueCompanies: companies.size,
    hot: hotCount,
    followUpPct: pct(withFollow),
    voicePct: pct(withVoice),
    avgPerSalesperson: salespeople.size ? Math.round((total / salespeople.size) * 10) / 10 : 0,
    topCategory,
  };
}

// ---- chart series ----------------------------------------------------------

export interface Point { name: string; value: number; color?: string; key?: string }

/** Leads per day across the filtered set (chronological). */
export function leadsOverTime(leads: Lead[]): { date: string; count: number }[] {
  const by = new Map<string, number>();
  for (const l of leads) {
    const k = dayKey(l.capturedOn);
    if (k) by.set(k, (by.get(k) ?? 0) + 1);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
}

/** Leads per salesperson, desc. */
export function bySalesperson(leads: Lead[]): Point[] {
  const by = new Map<string, { name: string; count: number }>();
  for (const l of leads) {
    const cur = by.get(l.userId) ?? { name: l.salesperson, count: 0 };
    cur.count++; cur.name = l.salesperson;
    by.set(l.userId, cur);
  }
  return [...by.entries()].map(([key, v]) => ({ name: v.name, value: v.count, key })).sort((a, b) => b.value - a.value);
}

/** Distribution across a master list (interest / category / asked-about). */
function byMaster(leads: Lead[], masters: Masters, type: MasterType, pick: (l: Lead) => string[]): Point[] {
  const counts = new Map<string, number>();
  for (const l of leads) for (const id of pick(l)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return (masters[type] as MasterItem[])
    .map((m) => ({ name: m.label, value: counts.get(m.id) ?? 0, color: m.color, key: m.id }))
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);
}

export const interestDistribution = (leads: Lead[], masters: Masters): Point[] =>
  byMaster(leads, masters, "interestLevels", (l) => (l.interestLevelId ? [l.interestLevelId] : []));
export const categoryBreakdown = (leads: Lead[], masters: Masters): Point[] =>
  byMaster(leads, masters, "categories", (l) => l.categoryIds);
export const askedAboutBreakdown = (leads: Lead[], masters: Masters): Point[] =>
  byMaster(leads, masters, "askedAbout", (l) => l.askedAboutIds);

/** Follow-up funnel: all → follow-up set → hot interest. */
export function followUpFunnel(leads: Lead[], masters: Masters): Point[] {
  const hot = hotInterestIds(masters);
  return [
    { name: "All leads", value: leads.length },
    { name: "Follow-up set", value: leads.filter((l) => l.followUpActionId).length },
    { name: "Hot interest", value: leads.filter((l) => l.interestLevelId && hot.has(l.interestLevelId)).length },
  ];
}

/** Leads grouped by capture location (top locations, desc). */
export function byLocation(leads: Lead[]): Point[] {
  const by = new Map<string, number>();
  for (const l of leads) if (l.location) by.set(l.location, (by.get(l.location) ?? 0) + 1);
  return [...by.entries()].map(([name, value]) => ({ name, value, key: name })).sort((a, b) => b.value - a.value).slice(0, 10);
}

/** Capture activity by hour of day (0–23). */
export function captureByHour(leads: Lead[]): { hour: string; count: number }[] {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}`.padStart(2, "0"), count: 0 }));
  for (const l of leads) {
    if (!l.capturedOn) continue;
    const d = new Date(l.capturedOn);
    if (!isNaN(d.getTime())) buckets[d.getHours()].count++;
  }
  return buckets;
}
