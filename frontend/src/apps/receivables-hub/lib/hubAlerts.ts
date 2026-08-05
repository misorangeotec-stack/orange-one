import type { Customer, CustomerDetail } from "./types";

/**
 * The Alerts engine — "what needs attention today", computed in the browser from data
 * `useAppData` has already loaded.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT INLINE IN THE PAGE
 *   The same rules have to run in three places over time: this page, the Dashboard's
 *   "needs attention" strip, and (phase 4) the server-side daily email. Pure functions over
 *   `Customer[]` + `CustomerDetail` keep the rule in ONE place, so the email can never quietly
 *   disagree with the screen about who is going critical.
 *
 * WHY IT IS NOT `dashboard.alerts`
 *   The hub already has an `AlertItem[]` on DashboardData, fed by the old Python pipeline's
 *   dashboard.json. BOTH live fetchers now return `alerts: []` (connectwaveFetcher.ts:494,
 *   supabaseFetcher.ts:266) — that feed is dead. These alerts are derived instead, so they work
 *   on whichever source the hub is pointed at.
 *
 * EVERY RULE IS ARITHMETIC. No model, no scoring, no training. That is deliberate: the alerts
 * have to be explainable to the salesperson being asked to act on them, and every threshold
 * below is a number someone can argue with.
 */

/* ── The thresholds. All in one place so they are arguable. ──────────────────── */

/**
 * A customer turns "critical" in this app at >180 overdue days OR >100% credit utilisation.
 * Mirrors `categorizeRisk` in useAppData / connectwaveFetcher — if that rule ever moves, this
 * must move with it or the alert stops predicting the thing it claims to predict.
 */
export const CRITICAL_OD_DAYS = 180;
export const CRITICAL_UTIL_PCT = 100;

/** How far ahead "going critical" looks. 30 days = one collection cycle. */
export const GOING_CRITICAL_WINDOW_DAYS = 30;

/** Utilisation at which the limit door starts to matter. Below this the next invoice can't breach. */
export const NEAR_LIMIT_PCT = 85;

/** An account is "bad" for the new-bill alert past this many overdue days. */
export const BAD_ACCOUNT_OD_DAYS = 120;

/** How recent a bill has to be to count as "new". */
export const NEW_BILL_WINDOW_DAYS = 7;

/* ── Types ──────────────────────────────────────────────────────────────────── */

export type HubAlertType = "going_critical" | "new_bill_bad_account";
export type HubAlertSeverity = "critical" | "high" | "medium";

export interface HubAlert {
  /** Stable within a render: `${type}:${customerId}`. Used as the React key and the seen-flag key. */
  id: string;
  type: HubAlertType;
  severity: HubAlertSeverity;

  /** Tally ledger name — the link key for /customer/:id everywhere in the hub. */
  customer: string;
  customerId: string;
  company: string;
  location: string;
  salesPerson: string;
  category: string;

  /** Context, always meaningful. */
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  utilization: number;
  creditLimit: number;

  /** Why this row is here, in one line the salesperson can read out loud. */
  reason: string;

  /** Lower = act sooner. Sort key within a type. */
  urgency: number;

  /* going_critical */
  /** Days until >180 overdue days. null when only the credit-limit door is open. */
  daysToCritical?: number | null;
  /** Σ pending of bills sitting at 150–180 days — the money that actually crosses the line. */
  crossingAmount?: number;
  /** creditLimit − outstanding. Negative is impossible here (already-critical rows are excluded). */
  headroom?: number | null;

  /* new_bill_bad_account */
  billCount?: number;
  billAmount?: number;
  latestBillRef?: string;
  latestBillDate?: string;
}

export interface HubAlertDef {
  type: HubAlertType;
  title: string;
  /** One line: why anyone should care. Shown under the block heading. */
  blurb: string;
  /** The rule in plain English. Shown in the block so nobody has to guess what triggered it. */
  rule: string;
  /** Which figure the block's ₹ header totals. */
  amountLabel: string;
}

export const HUB_ALERT_DEFS: HubAlertDef[] = [
  {
    type: "going_critical",
    title: "Going critical",
    blurb:
      "Not critical yet — but will be within a month unless someone calls. These are the ones still worth chasing.",
    rule: `Oldest unpaid bill is ${CRITICAL_OD_DAYS - GOING_CRITICAL_WINDOW_DAYS + 1}–${CRITICAL_OD_DAYS} days overdue (crosses ${CRITICAL_OD_DAYS} within ${GOING_CRITICAL_WINDOW_DAYS} days), or credit limit is ${NEAR_LIMIT_PCT}–${CRITICAL_UTIL_PCT}% used (the next invoice breaches it). Customers already critical are excluded — they belong to the Risk Register.`,
    amountLabel: "crossing 180 days",
  },
  {
    type: "new_bill_bad_account",
    title: "New bill to a bad account",
    blurb:
      "We invoiced someone we should probably have held. Caught the morning after, instead of at month-end.",
    rule: `A bill dated in the last ${NEW_BILL_WINDOW_DAYS} days, to a customer who is already past ${BAD_ACCOUNT_OD_DAYS} overdue days, over their credit limit, or Red Marked.`,
    amountLabel: "newly billed",
  },
];

export const HUB_ALERT_DEF_BY_TYPE: Record<HubAlertType, HubAlertDef> = HUB_ALERT_DEFS.reduce(
  (acc, d) => { acc[d.type] = d; return acc; },
  {} as Record<HubAlertType, HubAlertDef>,
);

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Shared identity fields, so the two builders can't drift on how a customer is described. */
function baseOf(c: Customer) {
  return {
    customer: c.name,
    customerId: c.id,
    company: c.company,
    location: c.location,
    salesPerson: c.salesPerson || "—",
    category: c.category || "—",
    outstanding: c.outstanding,
    overdue: c.overdue,
    maxOverdueDays: c.maxOverdueDays,
    utilization: c.utilization,
    creditLimit: c.creditLimit,
  };
}

/**
 * `asOfDate` (ISO) minus n days, as ISO. The window is anchored on the SNAPSHOT date, never on
 * the browser clock: if the nightly refresh has not run, "the last 7 days" must still mean the
 * last 7 days of data we actually hold, or the alert silently empties out on a stale snapshot.
 */
export function isoDaysBefore(asOfIso: string, days: number): string {
  const d = new Date(`${asOfIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/* ── Rule 1 — going critical ────────────────────────────────────────────────── */

export function buildGoingCritical(
  customers: Customer[],
  detailById: Record<string, CustomerDetail>,
): HubAlert[] {
  const out: HubAlert[] = [];

  for (const c of customers) {
    if (c.outstanding <= 0) continue;

    const od = c.maxOverdueDays;
    const util = c.utilization;

    // Already there — nothing to prevent. The Risk Register owns these.
    if (od > CRITICAL_OD_DAYS || util > CRITICAL_UTIL_PCT) continue;

    // Ageing door: 181 − od. od = 180 → 1 day left; od = 151 → 30 days left.
    const rawDays = CRITICAL_OD_DAYS + 1 - od;
    const ageingDoor = rawDays >= 1 && rawDays <= GOING_CRITICAL_WINDOW_DAYS;
    const daysToCritical = ageingDoor ? rawDays : null;

    // Limit door: close enough that the next invoice tips them over.
    const limitDoor = c.creditLimit > 0 && util >= NEAR_LIMIT_PCT && util <= CRITICAL_UTIL_PCT;

    if (!ageingDoor && !limitDoor) continue;

    // The money that actually crosses the line — Σ pending of bills already in the last
    // 30 days before 180. Far more honest than quoting the customer's whole overdue, most of
    // which may be nowhere near the boundary.
    let crossingAmount = 0;
    const detail = detailById[c.id];
    if (detail) {
      for (const inv of detail.invoices) {
        if (inv.pending <= 0) continue;
        if (inv.overdueDays >= CRITICAL_OD_DAYS - GOING_CRITICAL_WINDOW_DAYS && inv.overdueDays <= CRITICAL_OD_DAYS) {
          crossingAmount += inv.pending;
        }
      }
    }

    const reasons: string[] = [];
    if (ageingDoor) reasons.push(`${daysToCritical} day${daysToCritical === 1 ? "" : "s"} from 180 days overdue`);
    if (limitDoor) reasons.push(`${util.toFixed(0)}% of credit limit used`);

    const severity: HubAlertSeverity =
      (daysToCritical !== null && daysToCritical <= 10) || util >= 97
        ? "critical"
        : (daysToCritical !== null && daysToCritical <= 20) || util >= 92
        ? "high"
        : "medium";

    // Sort key. Days-left is the sharper signal, so it wins; limit-only rows are ranked by how
    // little headroom is left, mapped onto the same 0-30 scale.
    const urgency = daysToCritical ?? Math.round(((CRITICAL_UTIL_PCT - util) / (CRITICAL_UTIL_PCT - NEAR_LIMIT_PCT)) * GOING_CRITICAL_WINDOW_DAYS);

    out.push({
      id: `going_critical:${c.id}`,
      type: "going_critical",
      severity,
      ...baseOf(c),
      reason: reasons.join(" · "),
      urgency,
      daysToCritical,
      crossingAmount,
      headroom: c.creditLimit > 0 ? c.creditLimit - c.outstanding : null,
    });
  }

  // Soonest first; ties broken by the biggest amount crossing.
  return out.sort((a, b) => a.urgency - b.urgency || (b.crossingAmount ?? 0) - (a.crossingAmount ?? 0));
}

/* ── Rule 2 — new bill to a bad account ─────────────────────────────────────── */

export function buildNewBillToBadAccount(
  customers: Customer[],
  detailById: Record<string, CustomerDetail>,
  asOfDate: string,
): HubAlert[] {
  if (!asOfDate) return [];
  const windowStart = isoDaysBefore(asOfDate, NEW_BILL_WINDOW_DAYS);
  if (!windowStart) return [];

  const out: HubAlert[] = [];

  for (const c of customers) {
    // Why is this account bad? Most severe reason wins the label.
    const overLimit = c.creditLimit > 0 && c.utilization > CRITICAL_UTIL_PCT;
    const deepOverdue = c.maxOverdueDays > BAD_ACCOUNT_OD_DAYS;
    if (!c.blocked && !overLimit && !deepOverdue) continue;

    const detail = detailById[c.id];
    if (!detail) continue;

    // ISO dates compare correctly as strings, so no Date objects in the hot loop.
    const fresh = detail.invoices.filter((inv) => inv.date && inv.date >= windowStart);
    if (!fresh.length) continue;

    const billAmount = fresh.reduce((s, inv) => s + inv.amount, 0);
    const latest = fresh.reduce((a, b) => (b.date > a.date ? b : a), fresh[0]);

    const flags: string[] = [];
    if (c.blocked) flags.push("Red Mark");
    if (overLimit) flags.push(`over limit (${c.utilization.toFixed(0)}%)`);
    if (deepOverdue) flags.push(`${c.maxOverdueDays} days overdue`);

    const severity: HubAlertSeverity = c.blocked ? "critical" : overLimit ? "high" : "high";

    out.push({
      id: `new_bill_bad_account:${c.id}`,
      type: "new_bill_bad_account",
      severity,
      ...baseOf(c),
      reason: `${fresh.length} new bill${fresh.length === 1 ? "" : "s"} — account is ${flags.join(", ")}`,
      // Biggest new exposure first: this alert is about money we just added to a bad account.
      urgency: -billAmount,
      billCount: fresh.length,
      billAmount,
      latestBillRef: latest.number || latest.billRefName || "",
      latestBillDate: latest.date,
    });
  }

  return out.sort((a, b) => (b.billAmount ?? 0) - (a.billAmount ?? 0));
}

/* ── The one entry point the page (and later the email) calls ───────────────── */

export interface BuildAlertsInput {
  customers: Customer[];
  detailById: Record<string, CustomerDetail>;
  asOfDate: string;
}

export function buildHubAlerts({ customers, detailById, asOfDate }: BuildAlertsInput): HubAlert[] {
  return [
    ...buildGoingCritical(customers, detailById),
    ...buildNewBillToBadAccount(customers, detailById, asOfDate),
  ];
}

/** The ₹ a block totals in its header — each type has its own idea of "at stake". */
export function alertAmount(a: HubAlert): number {
  return a.type === "going_critical" ? a.crossingAmount ?? 0 : a.billAmount ?? 0;
}
