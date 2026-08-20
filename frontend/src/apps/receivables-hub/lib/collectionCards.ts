/**
 * The Collection report's KPI numbers and the words on its cards — with no React in sight.
 *
 * WHY THIS FILE EXISTS
 *   These rules used to live inside `CollectionPerformanceReport.tsx` as hooks, which is fine
 *   until something has to build the report with nobody logged in. The scheduled send (RC-2) runs
 *   on Deno at 08:00, and a server cannot import a React page. Rather than reimplement the cards
 *   for the mail — which is how a mailed report and an on-screen report start disagreeing about
 *   the same customer — the numbers and the wording moved here and BOTH sides read them.
 *
 * WHAT STAYED BEHIND, AND WHY
 *   A card also carries an icon and an `explain` tooltip written in JSX. Those are presentation,
 *   they mean nothing in a PDF, and `toPdfKpi` already threw them away. So the page keeps them,
 *   keyed by `CardFact.id`, and layers them onto what this file returns. The split is exactly:
 *   this file decides WHICH cards exist, what they say and what they are worth; the page decides
 *   what they look like.
 *
 * ⚠ THE `id` IS THE CONTRACT, NOT THE LABEL. Two modes both show a card labelled "Outstanding
 *   Locked" and their tooltips differ, so ids are namespaced by mode (`zero:outstanding` vs
 *   `dormant:outstanding`). Matching on the printed label would break the moment somebody rewords
 *   a card — the same reason `PdfKpi` carries `key` rather than matching on `label`.
 */

import { totalsOf, pctOf, ZERO_EPS, DETERIORATION_PP, type ZCRow, type ZCFocus } from "./collections";
import { sumOutstanding } from "./receivables";
import type { ConsolidatedCustomer } from "./types";
import { fmtINRMoney } from "./utils";

/** Which of the three reports is being drawn. `dormant` asks the sales question, not the payment one. */
export type ZCMode = "zero" | "threshold" | "dormant";

const pctText = (v: number | null): string => (v === null ? "—" : `${v.toFixed(1)}%`);

// ── The numbers ─────────────────────────────────────────────────────────────────────

/** Everything the cards read. One shape, so a card cannot quietly depend on a stray closure. */
export interface ZCKpis {
  count: number;
  eligibleCount: number;
  outstanding: number;
  sharePct: number;
  overdue: number;
  /** The gross bill total behind `overdue`, so a card can say the figure is net rather than leave
   *  the reader to discover it in the drill-down. */
  overdueGross: number;
  onAccount: number;
  over180: number;
  neverPaid: number;
  neverPaidOutstanding: number;
  stillBuying: number;
  salesInWindow: number;
  collectionPct: number | null;
  collected: number;
  collectible: number;
  shortfall: number;
  deteriorating: number;
  bounced: number;
  chequeReturns: number;
  paidNothing: number;
  paidNothingOutstanding: number;
  wentQuiet: number;
  wentQuietOutstanding: number;
  neverSold: number;
  neverSoldOutstanding: number;
}

/**
 * The report's KPI numbers over a given set of rows and a given eligible pool.
 *
 * A FUNCTION of both, rather than of the screen's state, because the per-salesperson extract has
 * to state THAT salesperson's position. Handing a rep a file whose cards read "219 customers,
 * ₹21.06 Cr" above a table of their own 59 is not a scoped report, it is a mislabelled one. The
 * screen calls it once with the full row set; the exporter calls it again per rep, with that rep's
 * pool.
 */
export function computeKpis(src: ZCRow[], pool: ConsolidatedCustomer[], target: number): ZCKpis {
  const t = totalsOf(src, target);
  const eligibleOutstanding = sumOutstanding(pool);
  const neverPaidOutstanding = src
    .filter((r) => r.facts.lastReceiptDate === null)
    .reduce((s, r) => s + r.customer.outstanding, 0);
  // The dormant report's damning subset: stopped buying AND stopped paying. The money on
  // these is what "dead and stuck" actually costs.
  const paidNothingOutstanding = src
    .filter((r) => r.facts.collected < ZERO_EPS)
    .reduce((s, r) => s + r.customer.outstanding, 0);
  const wentQuietOutstanding = src
    .filter((r) => r.facts.salesInPrior > 0.5 && r.facts.salesInWindow <= 0.5)
    .reduce((s, r) => s + r.customer.outstanding, 0);
  const neverSoldOutstanding = src
    .filter((r) => r.facts.lastSaleMonth === null)
    .reduce((s, r) => s + r.customer.outstanding, 0);
  return {
    count: src.length,
    eligibleCount: pool.length,
    outstanding: t.outstanding,
    sharePct: eligibleOutstanding > 0 ? (t.outstanding / eligibleOutstanding) * 100 : 0,
    overdue: t.overdue,
    overdueGross: t.overdueGross,
    onAccount: t.onAccount,
    over180: t.over180,
    neverPaid: t.neverPaid,
    neverPaidOutstanding,
    stillBuying: t.stillBuying,
    salesInWindow: t.salesInWindow,
    // Weighted, never an average of percentages.
    collectionPct: pctOf(t.collected, t.collectible),
    collected: t.collected,
    collectible: t.collectible,
    shortfall: t.shortfall,
    deteriorating: t.deteriorating,
    bounced: t.bounced,
    chequeReturns: t.chequeReturns,
    // Dormant
    paidNothing: t.zeroCollectors,
    paidNothingOutstanding,
    wentQuiet: t.wentQuiet,
    wentQuietOutstanding,
    neverSold: t.neverSold,
    neverSoldOutstanding,
  };
}

// ── The cards ───────────────────────────────────────────────────────────────────────

/**
 * A card's stable identity, namespaced by the report it belongs to.
 *
 * Three reports show a card called "Outstanding Locked" and each explains itself differently, so
 * the mode is part of the id. See the file header.
 */
export type CardId =
  | "zero:count" | "zero:outstanding" | "zero:overdue" | "zero:never" | "zero:buying" | "zero:over180"
  | "threshold:count" | "threshold:collectionPct" | "threshold:shortfall" | "threshold:outstanding"
  | "threshold:buying" | "threshold:deteriorating" | "threshold:bounced" | "threshold:never"
  | "dormant:count" | "dormant:outstanding" | "dormant:overdue" | "dormant:paidNothing"
  | "dormant:wentQuiet" | "dormant:neverSold";

/** One card, as far as the numbers are concerned. The page adds the icon and the tooltip. */
export interface CardFact {
  id: CardId;
  label: string;
  value: string;
  sub: string;
  /** `null` = a summary card describing the WHOLE list; clicking it clears every lens. */
  focusKey: ZCFocus | null;
  /** The underlying magnitude — a card with nothing behind it isn't worth a click. */
  count: number;
  /** Why the card is inert, when that isn't obvious (e.g. no prior period this FY). */
  disabledHint?: string;
}

/** The bits of the screen's state the wording depends on. Everything else comes from `kpis`. */
export interface CardContext {
  mode: ZCMode;
  /** The threshold report's bar, as a percentage. Printed in labels and copy. */
  threshold: number;
  /** The shortfall target, as a percentage. */
  target: number;
  /** False when this fiscal year has no earlier months, which makes two cards inert. */
  hasPrior: boolean;
  /** What the prior period is called, e.g. "Apr-26 – Jun-26". */
  priorLabel: string;
  /** The first month in the available data, e.g. "Apr-25". */
  horizonLabel: string;
}

const money = (n: number) => fmtINRMoney(n);

/**
 * The cards for one report, in the order they are shown.
 *
 * Identical output to the definitions this replaced, card for card and string for string — the
 * screen must not change when this file lands.
 */
export function cardFactsFor(kpis: ZCKpis, ctx: CardContext): CardFact[] {
  const { mode, threshold, target, hasPrior, horizonLabel } = ctx;

  const zeroCards: CardFact[] = [
    {
      id: "zero:count", label: "Zero-Collection Customers", focusKey: null,
      value: String(kpis.count),
      sub: `of ${kpis.eligibleCount} who owe money`,
      count: kpis.count,
    },
    {
      id: "zero:outstanding", label: "Outstanding Locked", focusKey: null,
      value: fmtINRMoney(kpis.outstanding),
      sub: `${kpis.sharePct.toFixed(1)}% of in-scope outstanding`,
      count: kpis.count,
    },
    {
      id: "zero:overdue", label: "Overdue Locked", focusKey: "overdue",
      value: fmtINRMoney(kpis.overdue),
      sub: kpis.onAccount > 0.5
        ? `past due date · less On Account ${fmtINRMoney(kpis.onAccount)}`
        : "already past due date",
      count: kpis.overdue,
    },
    {
      id: "zero:never", label: "Never Paid", focusKey: "never",
      value: String(kpis.neverPaid),
      sub: `${fmtINRMoney(kpis.neverPaidOutstanding)} · no receipt ever`,
      count: kpis.neverPaid,
    },
    {
      id: "zero:buying", label: "Still Buying", focusKey: "buying",
      value: String(kpis.stillBuying),
      sub: `${fmtINRMoney(kpis.salesInWindow)} billed in period`,
      count: kpis.stillBuying,
    },
    {
      id: "zero:over180", label: "> 180 Days", focusKey: "over180",
      value: fmtINRMoney(kpis.over180),
      sub: "oldest, hardest money",
      count: kpis.over180,
    },
  ];

  const thresholdCards: CardFact[] = [
    {
      id: "threshold:count", label: `Customers Below ${threshold}%`, focusKey: null,
      value: String(kpis.count),
      sub: `of ${kpis.eligibleCount} who owe money`,
      count: kpis.count,
    },
    {
      id: "threshold:collectionPct", label: "Collection %", focusKey: null,
      value: pctText(kpis.collectionPct),
      sub: `${fmtINRMoney(kpis.collected)} of ${fmtINRMoney(kpis.collectible)} collectible`,
      count: kpis.count,
    },
    {
      // The headline. A % can't be summed up a roll-up; this can — and it is the number
      // management acts on: "₹X would have come in had everyone hit the target."
      id: "threshold:shortfall", label: `Shortfall vs ${target}%`, focusKey: null,
      value: fmtINRMoney(kpis.shortfall),
      sub: "money that didn't come in",
      count: kpis.count,
    },
    {
      id: "threshold:outstanding", label: "Outstanding Locked", focusKey: null,
      value: fmtINRMoney(kpis.outstanding),
      sub: `${kpis.sharePct.toFixed(1)}% of in-scope outstanding`,
      count: kpis.count,
    },
    {
      id: "threshold:buying", label: "Still Buying", focusKey: "buying",
      value: String(kpis.stillBuying),
      sub: `${fmtINRMoney(kpis.salesInWindow)} billed in period`,
      count: kpis.stillBuying,
    },
    {
      id: "threshold:deteriorating", label: "Deteriorating", focusKey: "deteriorating",
      value: String(kpis.deteriorating),
      sub: hasPrior ? `fell > ${DETERIORATION_PP}pp vs prior period` : "no prior period in this FY",
      count: hasPrior ? kpis.deteriorating : 0,
      disabledHint: hasPrior
        ? undefined
        : "This fiscal year has no earlier months to compare against. Pick a shorter period.",
    },
    {
      id: "threshold:bounced", label: "Bounced", focusKey: "bounced",
      value: String(kpis.bounced),
      sub: `${fmtINRMoney(kpis.chequeReturns)} of cheques returned`,
      count: kpis.bounced,
    },
    {
      id: "threshold:never", label: "Never Paid", focusKey: "never",
      value: String(kpis.neverPaid),
      sub: `${fmtINRMoney(kpis.neverPaidOutstanding)} · no receipt ever`,
      count: kpis.neverPaid,
    },
  ];

  /**
   * The dormant report asks the SALES question, so its cards rank a dead account, not a bad
   * payer. "Still Buying" is deliberately absent: it is false for every row by construction —
   * that is the predicate — so the card would read 0 on every screen, forever.
   */
  const dormantCards: CardFact[] = [
    {
      id: "dormant:count", label: "Dormant Customers", focusKey: null,
      value: String(kpis.count),
      sub: `of ${kpis.eligibleCount} who owe money`,
      count: kpis.count,
    },
    {
      id: "dormant:outstanding", label: "Outstanding Locked", focusKey: null,
      value: fmtINRMoney(kpis.outstanding),
      sub: `${kpis.sharePct.toFixed(1)}% of in-scope outstanding`,
      count: kpis.count,
    },
    {
      id: "dormant:overdue", label: "Overdue Locked", focusKey: "overdue",
      value: fmtINRMoney(kpis.overdue),
      sub: "already past due date",
      count: kpis.overdue,
    },
    {
      id: "dormant:paidNothing", label: "Paid Nothing Either", focusKey: "paidNothing",
      value: String(kpis.paidNothing),
      sub: `${fmtINRMoney(kpis.paidNothingOutstanding)} · dead and stuck`,
      count: kpis.paidNothing,
    },
    {
      id: "dormant:wentQuiet", label: "Recently Gone Quiet", focusKey: "wentQuiet",
      value: String(kpis.wentQuiet),
      sub: hasPrior
        ? `${fmtINRMoney(kpis.wentQuietOutstanding)} · were buying before`
        : "no prior period in this FY",
      count: hasPrior ? kpis.wentQuiet : 0,
      disabledHint: hasPrior
        ? undefined
        : "This period has no earlier months to compare against. Pick a shorter period.",
    },
    {
      id: "dormant:neverSold", label: "Never Sold in Horizon", focusKey: "neverSold",
      value: String(kpis.neverSold),
      sub: `${fmtINRMoney(kpis.neverSoldOutstanding)} · nothing billed since ${horizonLabel}`,
      count: kpis.neverSold,
    },
  ];

  return mode === "dormant" ? dormantCards : mode === "zero" ? zeroCards : thresholdCards;
}

/**
 * A card projected to the plain shape the PDF renderer understands.
 *
 * Lives here rather than in the page because the scheduled send needs it and has no page. The
 * screen's own cards project through the same function, so the mailed KPI strip and the on-screen
 * one cannot describe the same card differently.
 */
export function toPdfKpi(c: CardFact): { label: string; value: string; sub: string; alarm: boolean; key?: string } {
  return {
    label: c.label,
    value: c.value,
    sub: c.sub,
    // The card's own alarm styling isn't a field — a card is "bad news" when it is a lens onto a
    // problem subset rather than a summary of the whole list.
    alarm: c.focusKey !== null,
    // The lens key, carried so the PDF can give a card its own appendix page WITHOUT matching on
    // the printed label. `never` and `over180` get one; the rest are carried and ignored.
    key: c.focusKey ?? undefined,
  };
}
