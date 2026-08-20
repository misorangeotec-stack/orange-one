/**
 * The dispatch board: what was billed, what left the plant, and the gap.
 *
 * This screen used to answer "how is the workflow doing" — due today, where work
 * is stuck, throughput per step. That question is better answered by the Control
 * Center (`/monitoring`), which carries the same rail, the same open-work table
 * and the variance card. Nothing was lost by moving it; one line survives here,
 * linking across, so the overdue alarm does not disappear with the cards.
 *
 * What had no home anywhere was the operational question: an invoice was raised
 * this morning — did the material actually go?
 *
 * ⚠ EVERY FIGURE IS A ROUND, NOT AN ORDER, and comes from `lib/dispatchBoard`.
 *   See that file for why the order header cannot be read directly.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import PillToggle from "@/shared/components/ui/PillToggle";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DateRangeFilter, { type DateRange } from "@/shared/components/ui/DateRangeFilter";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { queueRollup } from "@/shared/lib/fmsDashboard";
import { monthEndOf, monthStartOf, todayIso, weekEndOf, weekStartOf } from "@/shared/lib/time";
import { DISPATCH_QK } from "../data/dispatchFetch";
import { useDispatchStore } from "../store";
import { STEPS } from "../lib/steps";
import { dmy, isBillHeld, isCreditHeld, stepHoldLabel, stepHoldReason } from "../lib/format";
import type { DispatchOrder, OrderLine } from "../types";
import CompanyBreakdown from "../components/CompanyBreakdown";
import DispatchTrend from "../components/DispatchTrend";
import StatusPill, { OutcomePill } from "../components/StatusPill";
import {
  companyBlocks, consignmentsOf, daysSince, dominantUnit, inRange, notGone, perDay,
  qtyLabel, qtyNum, sumQty,
  type Consignment, type ConsignmentState,
} from "../lib/dispatchBoard";

const B = "/order-to-dispatch";

type Preset = "today" | "week" | "month" | "custom";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

/**
 * Which KPI the table below is currently showing.
 *
 * ⚠ THE TILES ARE FILTERS, NOT LINKS, and that is the point of this type. They
 *   used to navigate to the step queue behind each number — which only works for
 *   someone who owns that step. A salesperson looking at "On hold" was sent to a
 *   credit queue that answers Access Denied. Everyone who may see an order may
 *   see it in this table, so the drill-down happens here.
 *
 * "all" is the resting state: the board as it reads before anything is picked.
 */
type Focus = "all" | "punched" | "billed" | "awaiting" | "dispatched" | "onHold" | "billHold";

/**
 * Three of the tiles count ORDERS, not consignments, and no filter can bridge
 * that — a just-punched order, a credit-held one and one whose bill is parked
 * all have no invoice and no gate pass, so `consignmentsOf` never emits a row
 * for them. The table therefore swaps its row model with the tile, rather than
 * pretending one shape fits both.
 */
const ORDER_FOCUS: Focus[] = ["punched", "onHold", "billHold"];

/*
  One name for one condition. "Billed but not yet through the gate" is the KPI
  tile, the table tab and this row state, and it used to be worded differently in
  all three — which is how a reader ends up believing they are three conditions.
*/
const STATE_LABEL: Record<ConsignmentState, string> = {
  billed: "Awaiting dispatch",
  dispatched: "Dispatched",
  delivered: "Delivered",
  returned: "Returned",
  // The order was cancelled after this invoice was raised, and the invoice is
  // still live in Tally until somebody unwinds it. The row stays in the billed
  // figures because the invoice is real — this is what stops it reading as a
  // clean sale while it is on its way out.
  reversing: "Being reversed",
};

const STATE_BADGE: Record<ConsignmentState, string> = {
  billed: "bg-[#FFF7E6] text-yellow",
  dispatched: "bg-[#EAF1FE] text-blue",
  delivered: "bg-[#E8F7EE] text-ryg-green",
  returned: "bg-[#FDECEC] text-ryg-red",
  reversing: "bg-[#FDECEC] text-ryg-red",
};

/** Long-form date for the subtitle, so what is being counted is never in doubt. */
const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

/**
 * A quantity as a KPI headline — the number full size, its unit small beside it.
 *
 * ⚠ QUANTITY IS THE HEADLINE ON EVERY TILE NOW, and the consignment count has
 *   moved down into the hint. The tiles used to lead with the count, which
 *   answered "how many pieces of paper did we raise" rather than "how much
 *   material moved" — the second is the question the plant actually asks.
 *
 * Only the LARGEST unit is set full size, because the tile is one line wide and
 * "2,425 KGS · 200 LTR" at 30px does not fit. A second unit is flagged with a
 * "+1" and spelled out in full in the hint below, so nothing is silently dropped.
 */
function QtyValue({ q }: { q: Record<string, number> }) {
  const parts = Object.entries(q).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (parts.length === 0) return <span className="text-grey-2">—</span>;
  const [unit, n] = parts[0];
  return (
    <span className="whitespace-nowrap tabular-nums">
      {qtyNum(n)}
      {unit !== "—" && (
        <span className="ml-1 text-[0.5em] font-semibold uppercase tracking-wide text-grey">{unit}</span>
      )}
      {parts.length > 1 && (
        <span className="ml-1.5 align-top text-[0.4em] font-semibold text-grey-2">+{parts.length - 1}</span>
      )}
    </span>
  );
}

/** The tile's supporting line: the count, prefixed by the full split when a tile's
 *  headline had to collapse more than one unit into a "+N". */
const qtyHint = (q: Record<string, number>, tail: string): string => {
  const units = Object.entries(q).filter(([, n]) => n > 0).length;
  return units > 1 ? `${qtyLabel(q, 4)} · ${tail}` : tail;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Quantity across ORDER LINES, split by unit — the order-level counterpart of
 * `sumQty`, which measures consignments.
 *
 * ⚠ Two tiles here describe orders that have not become consignments yet: one
 *   just punched, one credit is holding. Neither has a `shipQty` to sum, so
 *   `sumQty` cannot see them at all — hence a second summer rather than a reuse.
 *
 * Keys units exactly as `consignmentsOf` does, "—" for a line whose unit was
 * never set, so `QtyValue` renders these tiles identically to the four beside
 * them. Cages, KGS and PCS stay separate: 500 KGS + 3 CAGES is not 503.
 */
const lineQty = (
  orders: DispatchOrder[],
  pick: (l: OrderLine) => number,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const o of orders) {
    for (const l of o.lines) {
      const q = pick(l);
      if (q <= 0) continue;
      const unit = (l.unit ?? "").trim() || "—";
      out[unit] = (out[unit] ?? 0) + q;
    }
  }
  return out;
};

/** What one order still owes, split by unit — the per-row form of `lineQty`. */
const pendingByUnit = (o: DispatchOrder): Record<string, number> =>
  lineQty([o], (l) => Math.max((Number(l.quantity) || 0) - (Number(l.dispatchedQty) || 0), 0));

/**
 * One comparable number for a quantity split — FOR ORDERING AND FILTERING ONLY.
 *
 * ⚠ NEVER RENDER THIS. It adds KGS to PCS, which is exactly the sum `qtyByUnit`
 *   exists to prevent showing anyone. A sort and a min–max box both need a single
 *   scalar per row, and neither ever puts the scalar on screen; the cell prints
 *   the honest split. `dispatchBoard.qtyIn` is what the visible figures use.
 */
const qtyAcross = (q: Record<string, number>): number =>
  Object.values(q).reduce((a, n) => a + n, 0);

export default function Dashboard() {
  const s = useDispatchStore();
  const qc = useQueryClient();

  const [preset, setPreset] = useState<Preset>("today");
  const [custom, setCustom] = useState<DateRange>(() => ({ from: todayIso(), to: todayIso() }));
  const [focus, setFocus] = useState<Focus>("all");
  const tableRef = useRef<HTMLDivElement>(null);

  /**
   * Clicking the tile you are already looking through puts the board back.
   *
   * ⚠ IT ALSO SCROLLS TO THE TABLE. The tiles sit above a company breakdown and
   *   a trend chart, so on any normal screen the list they filter is off the
   *   bottom — the tile would ring, the rows would change, and nothing the
   *   reader could see would move. Only on SELECT: scrolling down after someone
   *   has just cleared the filter would drag them away from the tiles they are
   *   plainly still reading.
   */
  const pick = (f: Focus) => {
    const next = focus === f ? "all" : f;
    setFocus(next);
    if (next === "all") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    tableRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  /**
   * The range is derived on EVERY render, never seeded into state.
   *
   * A dashboard left open on a screen overnight would otherwise keep counting
   * yesterday as "today" until someone reloaded it — which is exactly the case
   * this screen is meant to serve.
   *
   * ⚠ `todayIso()` IS UTC, AND THAT IS DELIBERATE. The invoice and gate-out dates
   *   are stamped by Postgres as `current_date` on a UTC database (verified), so
   *   UTC is the basis that AGREES with the stored values. Using the local
   *   helper would, between 00:00 and 05:30 IST, ask for a date the server had
   *   not started stamping yet and show an empty board.
   */
  const range: DateRange = useMemo(() => {
    const t = todayIso();
    if (preset === "today") return { from: t, to: t };
    if (preset === "week") return { from: weekStartOf(t), to: weekEndOf(t) };
    if (preset === "month") return { from: monthStartOf(t), to: monthEndOf(t) };
    return custom;
  }, [preset, custom]);

  /** Refresh when the tab regains focus — see the note at the effect below. */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void qc.invalidateQueries({ queryKey: DISPATCH_QK });
      }
    };
    /*
     * ⚠ SCOPED TO THIS PAGE ON PURPOSE. `store.tsx` sets `refetchOnWindowFocus:
     *   false` with a comment about the cost of the multi-table fetch, and that
     *   setting is shared by every dispatch screen. Flipping it there to make
     *   one dashboard live would quietly change eight other pages, so the
     *   listener lives here and dies with the component.
     */
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [qc]);

  /**
   * Orders PUNCHED in the range — raised on the system, whatever date the person
   * typed on the form.
   *
   * ⚠ `submittedAt`, not `orderDate`. "Punched today" is a question about data
   *   entry, and the two part company exactly when it matters: yesterday's order
   *   keyed in this morning is today's work and would vanish from this tile if it
   *   were dated by the form field instead.
   *
   * ⚠ Range-scoped like Dispatched and Sales bills beside it, so the date picker
   *   governs all three. The picker opens on Today, which is the asked-for view.
   */
  const punched = useMemo(() => {
    if (!range.from || !range.to) return [];
    return s.orders.filter((o) => {
      const d = (o.submittedAt ?? "").slice(0, 10);
      return !!d && d >= range.from! && d <= range.to!;
    });
  }, [s.orders, range]);
  const punchedQty = useMemo(() => lineQty(punched, (l) => Number(l.quantity) || 0), [punched]);

  const all = useMemo(() => consignmentsOf(s.orders), [s.orders]);

  const dispatched = useMemo(() => inRange(all, range, "dispatched"), [all, range]);
  const billed = useMemo(() => inRange(all, range, "billed"), [all, range]);
  /** Of what was billed IN THIS RANGE, what has still not left. */
  /** Everything still sitting in the plant, whenever it was billed. */
  const backlog = useMemo(() => notGone(all), [all]);

  const oldestWait = useMemo(() => {
    const t = todayIso();
    return backlog.reduce(
      (m, c) => (c.invoiceDateIso ? Math.max(m, daysSince(c.invoiceDateIso, t)) : m),
      0,
    );
  }, [backlog]);

  const returnedCount = dispatched.filter((c) => c.state === "returned").length;

  /* Quantity is what every tile leads with, so each set's split is computed once. */
  const dispatchedQty = useMemo(() => sumQty(dispatched), [dispatched]);
  const billedQty = useMemo(() => sumQty(billed), [billed]);
  const backlogQty = useMemo(() => sumQty(backlog), [backlog]);

  /*
   * A tile is a doorway only for someone who may walk through it. The two queues
   * these link to are owner-gated at the route now, so an unconditional href would
   * hand a non-owner a number that opens on Access Denied. `KpiTile.href` is
   * optional — without one the tile renders plain, which is the honest answer.
   */
  const gateOutHref = s.canSeeQueue("gate_out") ? `${B}/queues/gate-out` : undefined;
  const salesBillHref = s.canSeeQueue("sales_bill") ? `${B}/queues/sales-bill` : undefined;
  const creditHref = s.canSeeQueue("credit_check") ? `${B}/queues/credit-check` : undefined;

  /**
   * Orders parked at a step, and how long the oldest has waited.
   *
   * TWO SEPARATE LISTS, NEVER ONE. Credit holding an order and billing holding
   * its invoice are different backlogs owned by different desks; a single "on
   * hold" number would let one desk's problem hide inside the other's.
   *
   * Read off `s.orders` rather than a queue, so each tile counts every held
   * order this person can see — the dashboard is a summary of the operation, not
   * of one step's inbox.
   */
  const held = useMemo(() => s.orders.filter(isCreditHeld), [s.orders]);
  const billHeld = useMemo(() => s.orders.filter(isBillHeld), [s.orders]);
  /*
    What is actually stuck: the quantity STILL OWED on a held order, not what was
    originally ordered. On a part-shipped order that has looped back to credit,
    the quantity already delivered is not being held by anybody.
  */
  const pendingQty = (rows: DispatchOrder[]) =>
    lineQty(rows, (l) => Math.max((Number(l.quantity) || 0) - (Number(l.dispatchedQty) || 0), 0));
  const heldQty = useMemo(() => pendingQty(held), [held]);
  const billHeldQty = useMemo(() => pendingQty(billHeld), [billHeld]);

  /** Days since the OLDEST hold was placed — the one worth chasing. */
  const oldestSince = (rows: DispatchOrder[], since: (o: DispatchOrder) => string | null) =>
    rows.reduce((worst, o) => {
      const at = since(o);
      if (!at) return worst;
      const days = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000));
      return Math.max(worst, days);
    }, 0);
  const oldestHold = useMemo(() => oldestSince(held, (o) => o.ccDecidedAt), [held]);
  const oldestBillHold = useMemo(() => oldestSince(billHeld, (o) => o.sbHoldAt), [billHeld]);

  /*
    ORDERED AS THE WORK FLOWS: punched → billed → waiting to go → gone, with the
    exception parked at the end. A row that runs in process order can be read
    left to right as the state of the day; the previous order led with the
    outcome, which made the row a scoreboard rather than a pipeline.

    ⚠ NO `href` ON ANY OF THEM. Every tile is a filter for the table below —
      see `Focus`. The step queues they used to link to are owner-gated, so the
      link was a dead end for exactly the people the number was meant to inform.
  */
  const tiles: KpiTile[] = [
    {
      key: "punched",
      label: "New sales orders",
      value: <QtyValue q={punchedQty} />,
      hint: qtyHint(punchedQty, `${plural(punched.length, "order")} punched`),
      onSelect: () => pick("punched"),
      selected: focus === "punched",
    },
    {
      key: "billed",
      label: "Sales bills raised",
      value: <QtyValue q={billedQty} />,
      hint: qtyHint(billedQty, `${plural(billed.length, "invoice")} raised`),
      onSelect: () => pick("billed"),
      selected: focus === "billed",
    },
    {
      key: "backlog",
      label: "Awaiting dispatch",
      value: <QtyValue q={backlogQty} />,
      /*
        ⚠ ALL DATES, unlike the three tiles beside it, and the hint says so —
          one differently-scoped tile in a row is a classic way to mislead.

        This REPLACED a pair: "Billed, not gone" asked the same question inside
        the date filter, so a bill raised four days ago and still sitting was
        invisible on it while the tile next door counted it. Two tiles, one
        question, two answers — the range-scoped one is the one that could not
        show the backlog it was named after, so it went.
      */
      hint: qtyHint(
        backlogQty,
        `${plural(backlog.length, "consignment")} · billed, still in the plant · all dates${
          oldestWait > 0 ? ` · oldest ${oldestWait}d` : ""
        }`,
      ),
      tone: oldestWait >= 3 ? "red" : undefined,
      onSelect: () => pick("awaiting"),
      selected: focus === "awaiting",
    },
    {
      key: "dispatched",
      label: "Dispatched",
      value: <QtyValue q={dispatchedQty} />,
      hint: qtyHint(
        dispatchedQty,
        `${plural(dispatched.length, "consignment")} · left the gate${
          returnedCount ? ` · ${returnedCount} returned` : ""
        }`,
      ),
      size: "hero",
      onSelect: () => pick("dispatched"),
      selected: focus === "dispatched",
    },
    {
      key: "creditHold",
      // "Credit on hold", not "On hold": there are two holds on this board now,
      // and a tile that only says "On hold" is the one somebody reads as both.
      label: "Credit on hold",
      /*
        Leads with QUANTITY, like every tile beside it — how many cages credit is
        sitting on is the operational question; the order count is the footnote.

        ⚠ NOT range-scoped, for the same reason "Awaiting dispatch" is not: a hold
          placed three weeks ago is precisely the one worth chasing, and a "today"
          view would hide it.
      */
      value: <QtyValue q={heldQty} />,
      hint: held.length
        ? qtyHint(
            heldQty,
            `${plural(held.length, "order")} · credit not released${
              oldestHold > 0 ? ` · oldest ${oldestHold}d` : ""
            }`,
          )
        : "nothing held",
      tone: oldestHold >= 7 ? "red" : undefined,
      onSelect: () => pick("onHold"),
      selected: focus === "onHold",
    },
    {
      key: "billHold",
      label: "Bill on hold",
      /*
        The same tile one step down the chain, and not range-scoped for the same
        reason: an invoice nobody has raised for three weeks is exactly the one
        worth chasing, and a "today" view would hide it.
      */
      value: <QtyValue q={billHeldQty} />,
      hint: billHeld.length
        ? qtyHint(
            billHeldQty,
            `${plural(billHeld.length, "order")} · invoice not raised${
              oldestBillHold > 0 ? ` · oldest ${oldestBillHold}d` : ""
            }`,
          )
        : "nothing held",
      tone: oldestBillHold >= 7 ? "red" : undefined,
      onSelect: () => pick("billHold"),
      selected: focus === "billHold",
    },
  ];

  /**
   * The unit every bar and the trend chart are sized in — see `dominantUnit`.
   * Derived from what is actually in the range, not hard-coded to KGS, so a range
   * that happens to be all LTR still draws bars in proportion to each other.
   */
  const unit = useMemo(() => dominantUnit(dispatched), [dispatched]);

  /**
   * One block per selling company, each carrying its own sites and customers.
   *
   * ⚠ THE OLD FLAT CARDS WERE GENUINELY AMBIGUOUS, not just cluttered. Both
   *   companies run a site named SURAT-HOJIWALA, so "Dispatched by location"
   *   listed that name twice with nothing to tell them apart, and the customer
   *   list never said which company had billed whom.
   */
  const blocks = useMemo(
    () =>
      companyBlocks(
        dispatched,
        (k) => s.masterName("company", k === "—" ? null : k),
        (k) => s.masterName("company_location", k === "—" ? null : k),
        (k) => s.customerName(k),
      ),
    [dispatched, s],
  );

  const trend = useMemo(() => perDay(dispatched, range, "dispatched", unit), [dispatched, range, unit]);
  const multiDay = !!range.from && !!range.to && range.from !== range.to;

  /**
   * The table shows everything that touched the range on EITHER date, so a
   * consignment billed yesterday and dispatched today is present under both
   * questions rather than falling between them.
   */
  const tableRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: Consignment[] = [];
    for (const c of [...dispatched, ...billed]) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      rows.push(c);
    }
    /*
      ⚠ AWAITING DISPATCH IS ALL-DATES, so it cannot be served by filtering the
        range rows above — the whole point of that tile is the bill raised four
        days ago that still has not left, which is not in today's range at all.
        It reads `backlog` directly.
    */
    if (focus === "awaiting") return backlog;
    if (focus === "dispatched") return dispatched;
    if (focus === "billed") return billed;
    return rows;
  }, [dispatched, billed, backlog, focus]);

  /**
   * The order-level counterpart, for the two tiles that count orders.
   *
   * Held orders are all-dates like their tile; punched orders follow the range
   * like theirs. Each list is exactly what its number counted, so the table can
   * never disagree with the tile above it.
   */
  const orderRows = useMemo(
    () =>
      focus === "onHold" ? held
      : focus === "billHold" ? billHeld
      : focus === "punched" ? punched
      : [],
    [focus, held, billHeld, punched],
  );

  /*
   * ⚠ EVERY LIST FILTER HERE IS `multiselect`, NOT `select`, AND THAT IS THE
   *   WHOLE POINT OF IT. A plain <select> gives a native dropdown you can only
   *   scroll — with a few hundred customers, finding one meant hunting down the
   *   list by eye. `MultiSelect` opens with a search box (it shows one past six
   *   options) and lets several values be ticked at once, so "these three
   *   customers" is one filter rather than three passes over the table.
   *
   *   The date and quantity columns had NO filter at all, which is why the three
   *   numbers people most want to narrow by — when it was billed, when it left,
   *   how much of it — were the three you could not narrow by. `QueueTable`
   *   already knows how to render a date range and a min–max; they simply were
   *   never asked for here.
   */
  const columns: QueueColumn<Consignment>[] = [
    {
      key: "order",
      header: "Order",
      cell: (c) => (
        <Link to={`${B}/orders/${c.orderId}`} className="font-semibold text-navy hover:text-orange">
          {c.orderNo}
          {c.roundNo > 1 && <span className="text-grey-2 font-normal"> · R{c.roundNo}</span>}
        </Link>
      ),
      sortValue: (c) => c.orderNo,
      filter: { kind: "text", get: (c) => c.orderNo },
      alwaysVisible: true,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (c) => <span className="text-grey">{s.customerName(c.customerId)}</span>,
      sortValue: (c) => s.customerName(c.customerId),
      filter: { kind: "multiselect", get: (c) => s.customerName(c.customerId) },
    },
    {
      key: "customerLocation",
      header: "Customer location",
      cell: (c) => <span className="text-grey">{c.customerLocation ?? "—"}</span>,
      sortValue: (c) => c.customerLocation ?? "",
      filter: { kind: "multiselect", get: (c) => c.customerLocation ?? "—" },
      defaultHidden: true,
    },
    {
      key: "company",
      header: "Company",
      cell: (c) => <span className="text-grey">{s.masterName("company", c.companyId)}</span>,
      sortValue: (c) => s.masterName("company", c.companyId),
      filter: { kind: "multiselect", get: (c) => s.masterName("company", c.companyId) },
    },
    {
      key: "site",
      header: "Dispatch location",
      cell: (c) => <span className="text-grey">{s.masterName("company_location", c.locationId)}</span>,
      sortValue: (c) => s.masterName("company_location", c.locationId),
      filter: { kind: "multiselect", get: (c) => s.masterName("company_location", c.locationId) },
    },
    {
      key: "invoice",
      header: "Invoice no.",
      cell: (c) => <span className="text-grey">{c.invoiceNo ?? "—"}</span>,
      sortValue: (c) => c.invoiceNo ?? "",
      filter: { kind: "text", get: (c) => c.invoiceNo ?? "" },
    },
    {
      key: "invoiceDate",
      header: "Invoice date",
      cell: (c) => <span className="text-grey whitespace-nowrap">{dmy(c.invoiceDateIso)}</span>,
      sortValue: (c) => c.invoiceDateIso ?? "",
      filter: { kind: "date", get: (c) => c.invoiceDateIso ?? "" },
      exportValue: (c) => (c.invoiceDateIso ? dmy(c.invoiceDateIso) : ""),
    },
    {
      key: "gatePass",
      header: "Gate pass no.",
      cell: (c) => <span className="text-grey">{c.gpNo ?? "—"}</span>,
      sortValue: (c) => c.gpNo ?? "",
      filter: { kind: "text", get: (c) => c.gpNo ?? "" },
      defaultHidden: true,
    },
    {
      key: "gateOut",
      header: "Gate out",
      cell: (c) =>
        c.gateOutIso ? (
          <span className="text-grey whitespace-nowrap">{dmy(c.gateOutIso)}</span>
        ) : (
          <span className="text-ryg-red font-semibold whitespace-nowrap">Not yet</span>
        ),
      sortValue: (c) => c.gateOutIso ?? "9999-12-31",
      // ⚠ A "Not yet" row has no date, so it matches NO gate-out range — asking
      //   "what left between the 1st and the 7th" must not answer with things
      //   that have not left at all. The "Awaiting dispatch" tab is how you ask
      //   for those.
      filter: { kind: "date", get: (c) => c.gateOutIso ?? "" },
      exportValue: (c) => (c.gateOutIso ? dmy(c.gateOutIso) : "Not yet"),
    },
    {
      key: "qty",
      header: "Quantity",
      // The measure the board is about, so it is set like one: right-aligned and
      // navy, not another grey field among the reference numbers.
      cell: (c) => (
        <span className="font-semibold text-navy tabular-nums whitespace-nowrap">{qtyLabel(c.qtyByUnit, 3)}</span>
      ),
      align: "right",
      sortValue: (c) => qtyAcross(c.qtyByUnit),
      // ⚠ ADDS ACROSS UNITS, which nothing DISPLAYED here is allowed to do. It is
      //   confined to filtering and sorting, where the number is never shown and
      //   a single comparable value is the only way to have a min–max at all; the
      //   sort has always worked this way. The cell keeps printing the true split.
      filter: { kind: "number", get: (c) => qtyAcross(c.qtyByUnit) },
      exportValue: (c) => qtyLabel(c.qtyByUnit, 3),
    },
    {
      key: "state",
      header: "Status",
      cell: (c) => (
        <span
          className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATE_BADGE[c.state]}`}
        >
          {STATE_LABEL[c.state]}
        </span>
      ),
      sortValue: (c) => STATE_LABEL[c.state],
      filter: { kind: "multiselect", get: (c) => STATE_LABEL[c.state] },
    },
  ];

  /**
   * Columns for the two ORDER-level tiles.
   *
   * Deliberately not the consignment columns minus a few: invoice no., gate pass
   * and gate-out date do not exist yet for these rows, and a table of "—" reads
   * as missing data rather than as a stage not reached. What an order at this
   * point does have is who it is for, when it was raised, how much is owed and
   * why it is sitting — so that is what it shows.
   */
  const orderColumns: QueueColumn<DispatchOrder>[] = [
    {
      key: "order",
      header: "Order",
      cell: (o) => (
        <Link to={`${B}/orders/${o.id}`} className="font-semibold text-navy hover:text-orange">
          {o.orderNo}
          {o.roundNo > 1 && <span className="text-grey-2 font-normal"> · R{o.roundNo}</span>}
        </Link>
      ),
      sortValue: (o) => o.orderNo,
      filter: { kind: "text", get: (o) => o.orderNo },
      alwaysVisible: true,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (o) => <span className="text-grey">{s.customerName(o.customerId)}</span>,
      sortValue: (o) => s.customerName(o.customerId),
      filter: { kind: "multiselect", get: (o) => s.customerName(o.customerId) },
    },
    {
      key: "customerLocation",
      header: "Customer location",
      cell: (o) => <span className="text-grey">{o.customerLocation ?? "—"}</span>,
      sortValue: (o) => o.customerLocation ?? "",
      filter: { kind: "multiselect", get: (o) => o.customerLocation ?? "—" },
      defaultHidden: true,
    },
    {
      key: "company",
      header: "Company",
      cell: (o) => <span className="text-grey">{s.masterName("company", o.companyId)}</span>,
      sortValue: (o) => s.masterName("company", o.companyId),
      filter: { kind: "multiselect", get: (o) => s.masterName("company", o.companyId) },
    },
    {
      key: "site",
      header: "Dispatch location",
      cell: (o) => <span className="text-grey">{s.masterName("company_location", o.locationId)}</span>,
      sortValue: (o) => s.masterName("company_location", o.locationId),
      filter: { kind: "multiselect", get: (o) => s.masterName("company_location", o.locationId) },
    },
    {
      key: "orderDate",
      header: "Order date",
      cell: (o) => <span className="text-grey whitespace-nowrap">{dmy(o.orderDate)}</span>,
      sortValue: (o) => o.orderDate ?? "",
      filter: { kind: "date", get: (o) => o.orderDate ?? "" },
      exportValue: (o) => (o.orderDate ? dmy(o.orderDate) : ""),
    },
    {
      key: "raisedOn",
      header: "Punched on",
      // The date the tile counted on — see `punched`. Distinct from the order
      // date above, which is whatever the person typed on the form.
      cell: (o) => <span className="text-grey whitespace-nowrap">{dmy(o.submittedAt)}</span>,
      sortValue: (o) => o.submittedAt ?? "",
      filter: { kind: "date", get: (o) => (o.submittedAt ?? "").slice(0, 10) },
      exportValue: (o) => (o.submittedAt ? dmy(o.submittedAt) : ""),
      defaultHidden: true,
    },
    {
      key: "qty",
      header: "Pending",
      /*
        PENDING, not ordered — it is what the tile above measured, and on a
        part-shipped order that looped back it is the only honest figure: the
        quantity already delivered is not waiting on anybody.
      */
      cell: (o) => (
        <span className="font-semibold text-navy tabular-nums whitespace-nowrap">
          {qtyLabel(pendingByUnit(o), 3)}
        </span>
      ),
      align: "right",
      sortValue: (o) => qtyAcross(pendingByUnit(o)),
      filter: { kind: "number", get: (o) => qtyAcross(pendingByUnit(o)) },
      exportValue: (o) => qtyLabel(pendingByUnit(o), 3),
    },
    {
      key: "hold",
      header: "Hold reason",
      // ONE COLUMN, EITHER HOLD. This table is shared by both hold tiles, and a
      // column hard-wired to the credit remark would sit empty on the whole of
      // the Bill on hold list — the one list where the reason is the point.
      cell: (o) => {
        const why = stepHoldReason(o);
        return why ? (
          <span className="text-[12.5px] text-grey">{why}</span>
        ) : (
          <span className="text-grey-2">—</span>
        );
      },
      sortValue: (o) => stepHoldReason(o) ?? "",
      filter: { kind: "text", get: (o) => stepHoldReason(o) ?? "" },
    },
    {
      key: "status",
      header: "Status",
      cell: (o) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusPill status={o.status} />
          {stepHoldLabel(o) && <OutcomePill label={stepHoldLabel(o)!} tone="yellow" />}
        </span>
      ),
      sortValue: (o) => o.status,
      filter: { kind: "multiselect", get: (o) => stepHoldLabel(o) ?? o.status },
    },
  ];

  /* The overdue alarm the old monitoring cards used to carry, reduced to one line. */
  const pipelineSteps = useMemo(() => STEPS.filter((st) => !st.noQueue), []);
  const { counts } = useMemo(
    () => queueRollup(s.queueEntries, pipelineSteps, todayLocalIso()),
    [s.queueEntries, pipelineSteps],
  );

  const showOrders = ORDER_FOCUS.includes(focus);
  /* The heading names what is on screen, so the table cannot be read as the
     wrong list once a tile has narrowed it. */
  const tableTitle =
    focus === "punched" ? "New sales orders"
    : focus === "onHold" ? "Credit on hold"
    : focus === "billHold" ? "Bill on hold"
    : focus === "billed" ? "Sales bills raised"
    : focus === "awaiting" ? "Awaiting dispatch"
    : focus === "dispatched" ? "Dispatched"
    : "Consignments";

  const rangeSubtitle =
    range.from && range.to
      ? range.from === range.to
        ? longDate(range.from)
        : `${dmy(range.from)} — ${dmy(range.to)}`
      : "Pick a date range";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Order to Dispatch</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">{rangeSubtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* The Control Center is coordinator-only, so the alarm that leads there is
              shown to coordinators only — otherwise it counts work across steps the
              reader cannot open and links somewhere that Access Denies. */}
          {s.canMonitor && counts.delayed > 0 && (
            <Link
              to={`${B}/monitoring`}
              className="text-[12.5px] font-semibold text-ryg-red hover:underline whitespace-nowrap"
            >
              {counts.delayed} delayed across all steps →
            </Link>
          )}
          <PillToggle<Preset> value={preset} onChange={setPreset} options={PRESETS} />
          {/* Only when Custom is chosen: the four presets ARE the control, and a
              second always-visible date box would just ask the same question twice. */}
          {preset === "custom" && (
            <DateRangeFilter value={custom} onChange={setCustom} align="right" className="w-[230px]" />
          )}
        </div>
      </div>

      <KpiRow tiles={tiles} />

      {/*
        ONE CARD PER SELLING COMPANY, each carrying its own sites and customers —
        replacing the three flat cards that sat here. See `CompanyBreakdown`.
      */}
      <CompanyBreakdown
        blocks={blocks}
        unit={unit}
        emptyLabel="Nothing left the plant in this range."
      />

      {/* A one-bar chart is noise, so a single-day range gets no chart at all. */}
      {multiDay && <DispatchTrend data={trend} unit={unit} />}

      {/* `scroll-mt` keeps the heading clear of the sticky topbar when `pick`
          scrolls here — without it the title lands underneath the chrome and the
          table appears to start mid-way down. */}
      <div ref={tableRef} className="scroll-mt-24">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
          <h3 className={SECTION_HEADING_CLASS}>{tableTitle}</h3>
          {focus !== "all" && (
            <button
              type="button"
              onClick={() => setFocus("all")}
              className="text-[12.5px] font-semibold text-orange hover:underline"
            >
              Clear filter
            </button>
          )}
        </div>

        {/*
          TWO ROW MODELS, ONE CARD. The three consignment tiles answer "what
          moved"; the two order tiles answer "what has not moved yet", and those
          orders have no consignment to render — see `ORDER_FOCUS`. Swapping the
          table is what lets every tile drill down without inventing empty
          invoice and gate-pass columns for rows that cannot have them.
        */}
        {showOrders ? (
          <QueueTable<DispatchOrder>
            rows={orderRows}
            rowKey={(o) => o.id}
            columns={orderColumns}
            columnPicker={{ storageKey: "dispatch.dashboard.orders" }}
            rowsLabel="orders"
            initialSort={{ key: "orderDate", dir: "desc" }}
            emptyTitle={
              focus === "onHold" ? "Nothing on credit hold"
              : focus === "billHold" ? "No bills on hold"
              : "Nothing punched in this range"
            }
            emptyMessage={
              focus === "onHold" ? "Orders credit is holding will appear here."
              : focus === "billHold" ? "Orders whose invoice is being held back will appear here."
              : "Orders raised in the selected dates will appear here."
            }
            exportName={
              focus === "onHold" ? "Order_To_Dispatch_On_Hold"
              : focus === "billHold" ? "Order_To_Dispatch_Bill_On_Hold"
              : "Order_To_Dispatch_New_Orders"
            }
          />
        ) : (
          <QueueTable<Consignment>
            rows={tableRows}
            rowKey={(c) => c.key}
            columns={columns}
            // Namespaced so the reader's column choice here cannot collide with
            // another table that happens to use the same column keys.
            columnPicker={{ storageKey: "dispatch.dashboard.consignments" }}
            rowsLabel="consignments"
            initialSort={{ key: "invoiceDate", dir: "desc" }}
            emptyTitle="Nothing in this range"
            emptyMessage="Sales bills and gate entries recorded in the selected dates will appear here."
            exportName="Order_To_Dispatch_Consignments"
          />
        )}
      </Card>
      </div>
    </div>
  );
}
