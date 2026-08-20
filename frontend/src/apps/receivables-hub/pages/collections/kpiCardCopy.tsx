/**
 * The icon and the hover explanation for every KPI card on the Collection reports.
 *
 * WHY IT IS SEPARATE FROM THE CARDS THEMSELVES
 *   `lib/collectionCards.ts` decides which cards exist, what they say and what they are worth,
 *   and it has to stay free of React so the scheduled send can build the same report on a server.
 *   This is everything that only means something on a screen. Keyed by `CardFact.id`, so a card
 *   and its explanation are matched by identity rather than by their printed label — which would
 *   break the moment somebody rewords "> 180 Days".
 *
 *   Both maps are exhaustive over `CardId`. Adding a card to the report without writing its
 *   explanation is a type error, not a blank tooltip discovered in a meeting.
 */

import type { ReactNode } from "react";
import {
  Ban, CalendarClock, Percent, ShoppingCart, Target, TrendingDown, Undo2, UserX, Wallet,
} from "lucide-react";
import { DETERIORATION_PP } from "@hub/lib/collections";
import type { CardContext, CardId, ZCKpis } from "@hub/lib/collectionCards";
import { fmtINRMoney } from "@hub/lib/utils";

const money = (n: number) => fmtINRMoney(n);

export const CARD_ICONS: Record<CardId, typeof UserX> = {
  "zero:count": UserX,
  "zero:outstanding": Wallet,
  "zero:overdue": TrendingDown,
  "zero:never": Ban,
  "zero:buying": ShoppingCart,
  "zero:over180": CalendarClock,

  "threshold:count": UserX,
  "threshold:collectionPct": Percent,
  "threshold:shortfall": Target,
  "threshold:outstanding": Wallet,
  "threshold:buying": ShoppingCart,
  "threshold:deteriorating": TrendingDown,
  "threshold:bounced": Undo2,
  "threshold:never": Ban,

  "dormant:count": UserX,
  "dormant:outstanding": Wallet,
  "dormant:overdue": TrendingDown,
  "dormant:paidNothing": Ban,
  "dormant:wentQuiet": ShoppingCart,
  "dormant:neverSold": CalendarClock,
};

export const CARD_EXPLAIN: Record<CardId, (kpis: ZCKpis, ctx: CardContext) => ReactNode> = {
  // ── Zero-collection ───────────────────────────────────────────────────────────────
  "zero:count": (kpis) => (
    <>
      Customers who owe you money and paid <strong>nothing at all</strong> in this period:
      no receipt voucher and no manual Other Payment.
      <br />
      <br />
      <strong>{kpis.count}</strong> of the <strong>{kpis.eligibleCount}</strong> customers who
      currently owe you money. Ledgers with the same name are merged, so one customer with
      three company ledgers counts once.
    </>
  ),
  "zero:outstanding": (kpis) => (
    <>
      The total these zero-collection customers owe you is <strong>{money(kpis.outstanding)}</strong>.
      <br />
      <br />
      That is <strong>{kpis.sharePct.toFixed(1)}%</strong> of everything owed by customers in
      scope. The higher this is, the more your problem is concentrated in people who aren’t
      paying at all.
    </>
  ),
  "zero:overdue": (kpis) => (
    <>
      How much of that money is <strong>already past its due date</strong>. You had a
      contractual right to it and it still hasn’t come.
      <br />
      <br />
      The rest of the Outstanding is still inside its credit period.
      {kpis.onAccount > 0.5 && (
        <>
          <br />
          <br />
          <strong>This figure is net.</strong> The bills themselves come to{" "}
          {money(kpis.overdueGross)}, but {money(kpis.onAccount)} of that has already been paid
          as <strong>On Account</strong>: advances, credit notes and receipts that settle no
          specific bill, so they cannot be knocked off any one invoice.{" "}
          {money(kpis.overdueGross)} − {money(kpis.onAccount)} = {money(kpis.overdue)}.
        </>
      )}
    </>
  ),
  "zero:never": (kpis) => (
    <>
      Of those, how many have <strong>never made a single payment</strong>: not one receipt
      since the data begins (01-04-2025). They hold {money(kpis.neverPaidOutstanding)}.
      <br />
      <br />
      This is a write-off or legal conversation, not a follow-up call.
    </>
  ),
  "zero:buying": (kpis) => (
    <>
      How many of these non-payers you are <strong>still billing</strong>. You invoiced them{" "}
      <strong>{money(kpis.salesInWindow)}</strong> during the very period in which they paid
      you nothing.
      <br />
      <br />
      This is the card that gets a decision made, and it’s a <strong>credit</strong> decision, not
      a collections one.
    </>
  ),
  "zero:over180": () => (
    <>
      Money on bills more than <strong>180 days past due</strong>: the oldest and hardest to
      recover.
      <br />
      <br />
      The longer a receivable sits here, the less of it you typically get back.
    </>
  ),

  // ── Below threshold ───────────────────────────────────────────────────────────────
  "threshold:count": (kpis, ctx) => (
    <>
      Worked out <strong>for each customer separately</strong>:
      <br />
      <br />
      <span className="font-mono text-[10px] leading-relaxed block">
        Collectible = what they owed at the start
        <br />
        &nbsp;&nbsp;&nbsp;&nbsp;+ what you billed them since
        <br />
        Collected&nbsp;&nbsp; = what they actually paid
        <br />
        <br />
        Collected ÷ Collectible &lt; {ctx.threshold}% → listed
      </span>
      <br />
      <strong>{kpis.count}</strong> of the <strong>{kpis.eligibleCount}</strong> customers who
      currently owe you money. Bounced cheques don’t count as payment; customers with nothing
      to collect are excluded, not scored 0%.
    </>
  ),
  "threshold:collectionPct": (kpis) => (
    <>
      Together these {kpis.count} customers could have paid{" "}
      <strong>{money(kpis.collectible)}</strong>. They paid{" "}
      <strong>{money(kpis.collected)}</strong>.
      <br />
      <br />
      So roughly <strong>{kpis.collectionPct === null ? "—" : Math.round(kpis.collectionPct)} paise
      in every rupee</strong>.
      <br />
      <br />
      This is <strong>weighted</strong>: total collected ÷ total collectible, not the average
      of their individual percentages, which would let a tiny customer count as much as a
      ₹1 Cr one.
    </>
  ),
  "threshold:shortfall": (kpis, ctx) => (
    <>
      <strong>The number to take to a review meeting.</strong>
      <br />
      <br />
      If every one of these {kpis.count} customers had simply hit <strong>{ctx.target}%</strong>,
      another <strong>{money(kpis.shortfall)}</strong> would have landed in the bank this
      period.
      <br />
      <br />
      It’s added up <strong>customer by customer</strong>, so a good payer can’t quietly cancel
      out a bad one. Unlike a percentage, it totals correctly under every salesperson, group
      and company in the table below.
    </>
  ),
  "threshold:outstanding": (kpis) => (
    <>
      The total these under-payers owe you is <strong>{money(kpis.outstanding)}</strong>, which is{" "}
      <strong>{kpis.sharePct.toFixed(1)}%</strong> of everything owed by customers in scope.
      <br />
      <br />
      This is the “how bad is it really” card. A high share means the problem isn’t a long tail
      of small defaulters; it’s sitting where most of your money already is.
    </>
  ),
  "threshold:buying": (kpis) => (
    <>
      How many of these poor payers you are <strong>still billing</strong>. You invoiced them{" "}
      <strong>{money(kpis.salesInWindow)}</strong> during the very period in which they were
      under-paying you.
      <br />
      <br />
      The most actionable card here. It’s a <strong>credit</strong> decision, not a collections
      one.
    </>
  ),
  "threshold:deteriorating": (_kpis, ctx) =>
    ctx.hasPrior ? (
      <>
        These customers <strong>used to pay better</strong>. Their collection % fell by more than{" "}
        {DETERIORATION_PP} percentage points versus the previous period of the same length
        ({ctx.priorLabel}).
        <br />
        <br />
        Something changed <strong>recently</strong>, so it is worth a call before it hardens. This is what
        separates a customer who just went quiet from a chronic non-payer.
      </>
    ) : (
      <>
        Compares each customer’s collection % against the previous period of the same length.
        <br />
        <br />
        <strong>Unavailable here:</strong> this fiscal year has no earlier months to compare
        against, so Prior % and Δ read as a dash. Pick a shorter period to enable it.
      </>
    ),
  "threshold:bounced": (kpis, ctx) => (
    <>
      They “paid”, and the cheque <strong>came back</strong>.{" "}
      <strong>{money(kpis.chequeReturns)}</strong> of cheques returned in this period.
      <br />
      <br />
      A bounced cheque is not a collection. Without this check, several of these customers would
      look like they had paid and would <strong>never appear on this report at all</strong>,
      so a customer is listed if they fall below {ctx.threshold}% on <em>either</em> the gross or the
      net-of-bounces figure.
    </>
  ),
  "threshold:never": (kpis) => (
    <>
      Not a single payment <strong>ever</strong>: no receipt since the data begins
      (01-04-2025). They hold <strong>{money(kpis.neverPaidOutstanding)}</strong>.
      <br />
      <br />
      A write-off or legal conversation, not a follow-up call.
    </>
  ),

  // ── Dormant ───────────────────────────────────────────────────────────────────────
  "dormant:count": (kpis) => (
    <>
      Customers who owe you money and have billed <strong>nothing at all</strong> in this
      period. You are no longer selling to them, but they are still holding your cash.
      <br />
      <br />
      <strong>{kpis.count}</strong> of the <strong>{kpis.eligibleCount}</strong> customers who
      currently owe you money. Ledgers with the same name are merged, so one customer with
      three company ledgers counts once.
    </>
  ),
  "dormant:outstanding": (kpis) => (
    <>
      The total these dormant customers owe you is <strong>{money(kpis.outstanding)}</strong>,
      which is <strong>{kpis.sharePct.toFixed(1)}%</strong> of everything owed by customers in
      scope.
      <br />
      <br />
      This is money tied up in relationships that have <strong>already ended</strong>. It will
      not be recovered by selling them more.
    </>
  ),
  "dormant:overdue": () => (
    <>
      How much of that dormant money is <strong>already past its due date</strong>.
      <br />
      <br />
      The rest is still inside its credit period, so a customer can have stopped buying and
      still not be late yet.
    </>
  ),
  "dormant:paidNothing": (kpis) => (
    <>
      Of these dormant customers, how many also paid you <strong>nothing</strong> in the
      period. They hold <strong>{money(kpis.paidNothingOutstanding)}</strong>.
      <br />
      <br />
      <strong>The list that matters.</strong> The others are dormant but still clearing their
      balance; these have stopped buying <em>and</em> stopped paying. Nothing is coming back
      on its own.
    </>
  ),
  "dormant:wentQuiet": (kpis, ctx) =>
    ctx.hasPrior ? (
      <>
        They were buying in the <strong>previous</strong> period of the same length ({ctx.priorLabel})
        and have billed nothing since. They hold <strong>{money(kpis.wentQuietOutstanding)}</strong>.
        <br />
        <br />
        <strong>The ones you can still save.</strong> A customer who went quiet last quarter is a
        sales call; one who has been dead for two years is a collections problem.
      </>
    ) : (
      <>
        Compares billing against the previous period of the same length.
        <br />
        <br />
        <strong>Unavailable here:</strong> there are no earlier months to compare against. Pick a
        shorter period to enable it.
      </>
    ),
  "dormant:neverSold": (kpis, ctx) => (
    <>
      Not a single sale <strong>anywhere in the available data</strong>, which begins{" "}
      {ctx.horizonLabel}. They hold <strong>{money(kpis.neverSoldOutstanding)}</strong>.
      <br />
      <br />
      This does <strong>not</strong> mean they never bought from you, only that they haven’t
      since the data starts. The balance is a leftover from an older relationship, and it is
      the oldest, hardest money on this report.
    </>
  ),
};
