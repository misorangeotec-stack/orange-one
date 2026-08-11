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
import { useEffect, useMemo, useState } from "react";
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
import { dmy } from "../lib/format";
import CompanyBreakdown from "../components/CompanyBreakdown";
import DispatchTrend from "../components/DispatchTrend";
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

type Tab = "all" | "dispatched" | "notGone";

const STATE_LABEL: Record<ConsignmentState, string> = {
  billed: "Billed, not gone",
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
  const [tab, setTab] = useState<Tab>("all");

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

  const all = useMemo(() => consignmentsOf(s.orders), [s.orders]);

  const dispatched = useMemo(() => inRange(all, range, "dispatched"), [all, range]);
  const billed = useMemo(() => inRange(all, range, "billed"), [all, range]);
  /** Of what was billed IN THIS RANGE, what has still not left. */
  const billedNotGone = useMemo(() => notGone(billed), [billed]);
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
  const notGoneQty = useMemo(() => sumQty(billedNotGone), [billedNotGone]);
  const backlogQty = useMemo(() => sumQty(backlog), [backlog]);

  /*
   * A tile is a doorway only for someone who may walk through it. The two queues
   * these link to are owner-gated at the route now, so an unconditional href would
   * hand a non-owner a number that opens on Access Denied. `KpiTile.href` is
   * optional — without one the tile renders plain, which is the honest answer.
   */
  const gateOutHref = s.canSeeQueue("gate_out") ? `${B}/queues/gate-out` : undefined;
  const salesBillHref = s.canSeeQueue("sales_bill") ? `${B}/queues/sales-bill` : undefined;

  const tiles: KpiTile[] = [
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
      href: gateOutHref,
    },
    {
      key: "billed",
      label: "Sales bills raised",
      value: <QtyValue q={billedQty} />,
      hint: qtyHint(billedQty, `${plural(billed.length, "invoice")} raised`),
      href: salesBillHref,
    },
    {
      key: "notGone",
      label: "Billed, not gone",
      value: <QtyValue q={notGoneQty} />,
      hint: qtyHint(notGoneQty, `${plural(billedNotGone.length, "consignment")} · still in the plant`),
      tone: billedNotGone.length > 0 ? "red" : undefined,
      href: gateOutHref,
    },
    {
      key: "backlog",
      label: "Awaiting gate out",
      value: <QtyValue q={backlogQty} />,
      // ⚠ NOT range-scoped, unlike the three tiles beside it. A bill raised four
      //   days ago and still not gone is the real operational problem and would
      //   be invisible in a "today" view. The hint says so, because one
      //   differently-scoped tile in a row is a classic way to mislead.
      hint: qtyHint(
        backlogQty,
        `${plural(backlog.length, "consignment")} · all dates${oldestWait > 0 ? ` · oldest ${oldestWait}d` : ""}`,
      ),
      tone: oldestWait >= 3 ? "red" : undefined,
      href: gateOutHref,
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
    if (tab === "dispatched") return rows.filter((c) => !!c.gateOutIso);
    if (tab === "notGone") return rows.filter((c) => !c.gateOutIso);
    return rows;
  }, [dispatched, billed, tab]);

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
      //   that have not left at all. The "Billed, not gone" tab is how you ask
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

  /* The overdue alarm the old monitoring cards used to carry, reduced to one line. */
  const pipelineSteps = useMemo(() => STEPS.filter((st) => !st.noQueue), []);
  const { counts } = useMemo(
    () => queueRollup(s.queueEntries, pipelineSteps, todayLocalIso()),
    [s.queueEntries, pipelineSteps],
  );

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

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
          <h3 className={SECTION_HEADING_CLASS}>Consignments</h3>
          <PillToggle<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: "All" },
              { value: "dispatched", label: "Dispatched" },
              { value: "notGone", label: "Billed, not gone" },
            ]}
          />
        </div>

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
      </Card>
    </div>
  );
}
