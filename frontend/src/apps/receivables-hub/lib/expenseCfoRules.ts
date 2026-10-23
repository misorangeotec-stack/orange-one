import {
  ENTITY_LABEL, TIE_TOLERANCE, fmtCr, monthLabel, sum,
  type ExpLine, type ExpType, type TieRow, type ExpenseCfoData,
} from "./expenseCfo";

/**
 * Expense Analysis (CFO) — the analysis rules.
 *
 * Ported from the refresh-expenses skill (`PL and BS\.claude\skills\refresh-expenses\scripts\`),
 * so a group flagged in the Excel the CFO already knows is flagged here for the same reason:
 *   AUDIT FLAG   build_analysis_sheets.py  _sort_and_highlight_summary  (:890-946)
 *   Must Review  build_analysis_sheets.py  review_rating                (:183-201) + roll-up (:784-813)
 *   Pareto       build_analysis_sheets.py  highlight_month_pareto       (:217-284)
 *   REMARKS      remark_logic.py           draft_remark
 * The month-on-month variance and its "nature" are new to this report.
 */

// ── AUDIT FLAG and Must Review ───────────────────────────────────────────────────────────────

const gkey = (t: ExpType, mg: string) => `${t}|${mg}`;

/** (exp type, main group) → the AUDIT FLAG reasons, exactly as the Excel words them. */
export function auditFlags(lines: readonly ExpLine[]): Map<string, string[]> {
  const mgTotal = new Map<string, number>();
  const vendor = new Map<string, Map<string, number>>();
  for (const l of lines) {
    const k = gkey(l.expType, l.mainGroup);
    mgTotal.set(k, (mgTotal.get(k) ?? 0) + l.amount);
    if (!vendor.has(k)) vendor.set(k, new Map());
    const v = vendor.get(k)!;
    v.set(l.party, (v.get(l.party) ?? 0) + l.amount);
  }
  const grandAbs = [...mgTotal.values()].reduce((s, v) => s + Math.abs(v), 0);
  const top5 = new Set([...mgTotal.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map((e) => e[0]));

  const out = new Map<string, string[]>();
  for (const [k, total] of mgTotal) {
    const reasons: string[] = [];
    if (top5.has(k) && grandAbs) reasons.push(`Top-5 cost driver - ${Math.round(Math.abs(total) / grandAbs * 100)}% of total spend`);
    const vs = [...(vendor.get(k)?.entries() ?? [])];
    if (vs.length && total) {
      const [name, amt] = vs.reduce((a, b) => (total < 0 ? (b[1] < a[1] ? b : a) : (b[1] > a[1] ? b : a)));
      const share = Math.abs(amt) / Math.abs(total) * 100;
      if (share > 70) reasons.push(`${Math.round(share)}% concentrated in one ledger (${name})`);
    }
    const mg = k.split("|")[1];
    if (mg === "Direct Expenses" || mg === "Indirect Expenses") reasons.push("Catch-all bucket name - review the underlying postings");
    if (reasons.length) out.set(k, reasons);
  }
  return out;
}

export const flagText = (flags: Map<string, string[]>, t: ExpType, mg: string): string =>
  (flags.get(gkey(t, mg)) ?? []).join("; ");

export type Review = "HIGH" | "MEDIUM" | "LOW";

export function reviewRating(reasons: readonly string[]): Review {
  if (!reasons.length) return "LOW";
  return reasons.some((r) => r.includes("Top-5 cost driver")) || reasons.length > 1 ? "HIGH" : "MEDIUM";
}

export interface SheetEntry { id: string; name: string; description: string; review: Review; mainGroup?: string }

/** Index rows, with each analysis sheet's rating rolled up the way the Excel rolls it. */
export function sheetIndex(lines: readonly ExpLine[], flags: Map<string, string[]>): SheetEntry[] {
  const indirectGroups = [...new Set(lines.filter((l) => l.expType === "INDIRECT").map((l) => l.mainGroup))]
    .sort((a, b) => (a === "ADVERTISEMENT" ? -1 : b === "ADVERTISEMENT" ? 1 : a.localeCompare(b)));
  const reasonsFor = (pred: (t: ExpType, mg: string) => boolean) =>
    [...flags.entries()].filter(([k]) => { const [t, mg] = k.split("|"); return pred(t as ExpType, mg); })
      .flatMap(([k, r]) => r.map((x) => `${k.split("|")[1]}: ${x}`));
  const all = reasonsFor(() => true);
  const entries: SheetEntry[] = [
    { id: "analytics", name: "Analytics", description: "One-page view: trend, mix, movers and CFO notes", review: reviewRating(all) },
    { id: "summary", name: "Summary", description: "Direct and Indirect by main group, month-wise, with AUDIT FLAG", review: reviewRating(all) },
    { id: "company", name: "COMPANY WISE", description: "Summary split by legal entity", review: reviewRating(all) },
    { id: "direct", name: "Direct", description: "Direct expenses by main group and ledger", review: reviewRating(reasonsFor((t) => t === "DIRECT")) },
    { id: "component", name: "Direct by Component", description: "Direct expenses by component (Head, Ink, Machine, Spare, Fabric)", review: reviewRating(reasonsFor((t) => t === "DIRECT")) },
    { id: "indirect", name: "Indirect Exp", description: "Indirect expenses by main group and sub-group", review: reviewRating(reasonsFor((t) => t === "INDIRECT")) },
    // Not "Other Expenses": Colorix has an indirect Tally group of exactly that name with its own sheet.
    { id: "other", name: "Other (Valuation & Exchange)", description: "Inventory valuation and exchange-rate gain/loss - kept out of direct cost", review: reviewRating(reasonsFor((t) => t === "OTHER")) },
    ...indirectGroups.map((mg): SheetEntry => ({
      id: `group:${mg}`, name: mg, mainGroup: mg, description: `${mg} - vendor-wise, with REMARKS and 80% Pareto`,
      review: reviewRating(reasonsFor((t, g) => t === "INDIRECT" && g === mg)),
    })),
    { id: "variance", name: "MoM Variance", description: "Month-on-month increase / decrease, its nature and drivers", review: "LOW" },
    { id: "tb", name: "TB Reconciliation", description: "Report against Tally's own Trial Balance, per company", review: "LOW" },
    { id: "raw", name: "RAW DATA", description: "Every expense line behind the report", review: "LOW" },
  ];
  // HIGH first, then MEDIUM, then LOW (user, 23-Oct-2026); the order inside each band is kept.
  const rank: Record<Review, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return entries.map((e, i) => ({ e, i })).sort((a, b) => rank[a.e.review] - rank[b.e.review] || a.i - b.i).map((x) => x.e);
}

// ── Pareto ───────────────────────────────────────────────────────────────────────────────────

export const PARETO_SHARE = 0.8;

/** Parties making up the top 80% of a month's spend, by absolute value, the crossing one included. */
export function paretoSet(byParty: ReadonlyMap<string, number>): Set<string> {
  const ranked = [...byParty.entries()].filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const total = ranked.reduce((s, [, v]) => s + Math.abs(v), 0);
  const out = new Set<string>();
  let run = 0;
  for (const [p, v] of ranked) {
    if (run >= total * PARETO_SHARE) break;
    out.add(p);
    run += Math.abs(v);
  }
  return out;
}

// ── REMARKS ──────────────────────────────────────────────────────────────────────────────────

const MONTH_TOKENS = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*[-\s]?\d{2,4}/g;

function normalizeNarration(t: string): string {
  return t.toUpperCase()
    .replace(MONTH_TOKENS, " ")
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, " ")
    .replace(/\bFY\s?\d{2,4}[-/]\d{2,4}\b/g, " ")
    .replace(/[\d,]+\.?\d*\s*%?/g, " ")
    .replace(/[^A-Z& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleClean(s: string, max: number): string {
  s = s.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 3);
  const sp = cut.lastIndexOf(" ");
  return `${sp > 0 ? cut.slice(0, sp) : cut}...`;
}

/** remark_logic.draft_remark: one short line covering every distinct reason in a vendor's narrations. */
export function draftRemark(narrations: readonly string[], fallback = "Refer ledger/voucher for details"): string {
  const ns = narrations.map((n) => n.trim()).filter((n) => n && n.toUpperCase() !== "ROUND OFF");
  if (!ns.length) return fallback;
  const clusters = new Map<string, string>();
  for (const n of ns) {
    const core = normalizeNarration(n);
    if (!core) continue;
    const prev = clusters.get(core);
    if (prev === undefined || n.length > prev.length) clusters.set(core, n);
  }
  const themes = [...clusters.values()];
  if (!themes.length) return "Recurring monthly charge - no descriptive narration in ledger";
  if (themes.length === 1) return titleClean(themes[0], 140);
  const parts: string[] = [];
  let len = 0;
  for (const th of themes) {
    const piece = titleClean(th, 70);
    if (len + piece.length > 190 && parts.length) break;
    parts.push(piece);
    len += piece.length;
  }
  return parts.join("; ");
}

// ── Month-on-month variance ──────────────────────────────────────────────────────────────────

export type Nature =
  | "New cost" | "Stopped" | "One-off voucher" | "New vendor" | "Reversal / credit"
  | "Provision / journal" | "Quarterly / annual bill" | "Volume change";

export interface Driver { label: string; change: number; narration: string }

export interface VarianceRow {
  expType: ExpType;
  mainGroup: string;
  gl?: string;              // set on GL-level rows
  prev: number;
  cur: number;
  change: number;
  pct: number | null;       // null = "n/m": no positive base to measure against
  direction: "Increase" | "Decrease" | "No change";
  nature: Nature | "";
  drivers: Driver[];
  material: boolean;
}

export interface Materiality { amount: number; pct: number }
export const DEFAULT_MATERIALITY: Materiality = { amount: 50000, pct: 20 };

const vchKey = (l: ExpLine) => `${l.date}|${l.voucherType}|${l.voucherNo}|${l.party}`;
const isJournal = (l: ExpLine) => /journal/i.test(l.voucherType);
const NIL = 0.5;

function natureOf(prevLines: ExpLine[], curLines: ExpLine[], history: ExpLine[], change: number, months: string[], cur: string): Nature | "" {
  const prev = sum(prevLines), now = sum(curLines);
  if (Math.abs(change) < NIL) return "";
  if (Math.abs(prev) < NIL) return "New cost";
  if (Math.abs(now) < NIL) return "Stopped";
  const half = Math.abs(change) * 0.5;

  // One voucher explains half the move: a new bill this month (increase), or last month's bill
  // that did not recur (decrease).
  const side = change > 0 ? curLines : prevLines;
  const vch = new Map<string, number>();
  for (const l of side) vch.set(vchKey(l), (vch.get(vchKey(l)) ?? 0) + l.amount);
  if ([...vch.values()].some((v) => v >= half)) return "One-off voucher";

  if (change > 0) {
    const seen = new Set(history.map((l) => l.party));
    const fresh = curLines.filter((l) => !seen.has(l.party));
    if (Math.abs(sum(fresh)) >= half) return "New vendor";
  } else {
    const credits = curLines.filter((l) => l.amount < 0);
    if (Math.abs(sum(credits)) >= half) return "Reversal / credit";
  }
  const jDelta = sum(curLines.filter(isJournal)) - sum(prevLines.filter(isJournal));
  if (Math.sign(jDelta) === Math.sign(change) && Math.abs(jDelta) >= half) return "Provision / journal";

  // The biggest driver bills every 3rd or 12th month rather than monthly.
  const top = topDrivers(prevLines, curLines, change, 1)[0];
  if (top) {
    const billed = months.filter((m) => m <= cur && [...history, ...curLines].some((l) => l.party === top.label && l.month === m && Math.abs(l.amount) > NIL));
    const idx = billed.map((m) => months.indexOf(m));
    const gaps = idx.slice(1).map((v, i) => v - idx[i]);
    if (gaps.length && gaps.every((g) => g === 3 || g === 12)) return "Quarterly / annual bill";
    if (billed.length === 1 && months.indexOf(cur) >= 3) return "Quarterly / annual bill";
  }
  return "Volume change";
}

function topDrivers(prevLines: ExpLine[], curLines: ExpLine[], change: number, n: number): Driver[] {
  const d = new Map<string, { change: number; narr: string }>();
  for (const l of prevLines) { const x = d.get(l.party) ?? { change: 0, narr: "" }; x.change -= l.amount; d.set(l.party, x); }
  for (const l of curLines) {
    const x = d.get(l.party) ?? { change: 0, narr: "" };
    x.change += l.amount;
    if (l.narration && Math.abs(l.amount) > NIL && !x.narr) x.narr = l.narration;
    d.set(l.party, x);
  }
  return [...d.entries()]
    .filter(([, v]) => Math.sign(v.change) === Math.sign(change) && Math.abs(v.change) > NIL)
    .sort((a, b) => Math.abs(b[1].change) - Math.abs(a[1].change))
    .slice(0, n)
    .map(([label, v]) => ({ label, change: v.change, narration: v.narr }));
}

/**
 * Change from `prevMonth` to `curMonth` for every main group (and every GL when `byGl`).
 * Control: the `change` column sums exactly to the movement in the month totals.
 */
export function monthVariance(
  lines: readonly ExpLine[], months: string[], prevMonth: string, curMonth: string,
  mat: Materiality, byGl = false,
): VarianceRow[] {
  const keyOf = (l: ExpLine) => `${l.expType}|${l.mainGroup}${byGl ? `|${l.gl}` : ""}`;
  const groups = new Map<string, ExpLine[]>();
  for (const l of lines) {
    if (l.month > curMonth) continue;
    const k = keyOf(l);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(l);
  }
  const prevIdx = months.indexOf(prevMonth);
  const window3 = new Set(months.slice(Math.max(0, prevIdx - 2), prevIdx + 1));
  const rows: VarianceRow[] = [];
  for (const [k, ls] of groups) {
    const prevLines = ls.filter((l) => l.month === prevMonth);
    const curLines = ls.filter((l) => l.month === curMonth);
    const prev = sum(prevLines), cur = sum(curLines), change = cur - prev;
    if (Math.abs(prev) < 0.005 && Math.abs(cur) < 0.005) continue;
    const [t, mg, gl] = k.split("|");
    const pct = prev > NIL ? (change / prev) * 100 : null;
    rows.push({
      expType: t as ExpType, mainGroup: mg, gl, prev, cur, change, pct,
      direction: Math.abs(change) < 0.005 ? "No change" : change > 0 ? "Increase" : "Decrease",
      nature: natureOf(prevLines, curLines, ls.filter((l) => window3.has(l.month)), change, months, curMonth),
      drivers: topDrivers(prevLines, curLines, change, 3),
      material: Math.abs(change) >= mat.amount || (pct !== null && Math.abs(pct) >= mat.pct),
    });
  }
  return rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

// ── TB reconciliation ────────────────────────────────────────────────────────────────────────

export interface TbStatus { tied: boolean; gaps: TieRow[]; asOf: string; capturedAt: string }

export function tbStatus(data: ExpenseCfoData): TbStatus {
  const gaps = data.ties.filter((t) => Math.abs(t.gap) > TIE_TOLERANCE);
  const first = data.ties[0];
  return { tied: gaps.length === 0, gaps, asOf: first?.asOf ?? "", capturedAt: first?.capturedAt ?? "" };
}

/** Bridge from this report (equal to the TB) to the old Excel's basis, which drops Sales vouchers. */
export function bridge(lines: readonly ExpLine[]): { label: string; amount: number }[] {
  const total = sum(lines);
  const sales = sum(lines.filter((l) => l.isSalesVch));
  return [
    { label: "Expense per this report (= Tally TB)", amount: total },
    { label: "Less: expense lines posted through Sales vouchers", amount: -sales },
    { label: "Expense on the old Excel basis (refresh-expenses skill)", amount: total - sales },
  ];
}

// ── CFO notes ────────────────────────────────────────────────────────────────────────────────

export function cfoNotes(lines: readonly ExpLine[], months: string[], tb: TbStatus, flags: Map<string, string[]>): string[] {
  const notes: string[] = [];
  const total = sum(lines);
  const direct = sum(lines.filter((l) => l.expType === "DIRECT"));
  const other = sum(lines.filter((l) => l.expType === "OTHER"));
  notes.push(`Total expense ${fmtCr(total)} for ${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}: ` +
    `Direct ${fmtCr(direct)}, Indirect ${fmtCr(total - direct - other)}, Other (inventory valuation + exchange) ${fmtCr(other)}.`);
  if (months.length >= 2) {
    const [p, c] = months.slice(-2);
    // The movers leave out Other: a valuation or exchange swing is not a cost decision.
    const var_ = monthVariance(lines.filter((l) => l.expType !== "OTHER"), months, p, c, DEFAULT_MATERIALITY);
    const mv = sum(lines.filter((l) => l.month === c)) - sum(lines.filter((l) => l.month === p));
    notes.push(`${monthLabel(c)} is ${fmtCr(Math.abs(mv))} ${mv >= 0 ? "higher" : "lower"} than ${monthLabel(p)}.`);
    const up = var_.find((v) => v.change > 0);
    const down = var_.find((v) => v.change < 0);
    if (up) notes.push(`Largest increase: ${up.mainGroup} +${fmtCr(up.change)} (${up.nature || "—"}${up.drivers[0] ? `, led by ${up.drivers[0].label}` : ""}).`);
    if (down) notes.push(`Largest decrease: ${down.mainGroup} ${fmtCr(down.change)} (${down.nature || "—"}${down.drivers[0] ? `, led by ${down.drivers[0].label}` : ""}).`);
  }
  const conc = [...flags.values()].flat().filter((r) => r.includes("concentrated")).length;
  if (conc) notes.push(`${conc} main group${conc > 1 ? "s are" : " is"} more than 70% dependent on a single ledger - see AUDIT FLAG.`);
  notes.push(tb.tied
    ? `Ties to Tally's Trial Balance for all companies (as at ${tb.asOf}).`
    : `NOT tied to Tally's Trial Balance: ${tb.gaps.length} line(s) differ - see TB Reconciliation before relying on these figures.`);
  return notes;
}

export const entityName = (e: string): string => ENTITY_LABEL[e] ?? e;
