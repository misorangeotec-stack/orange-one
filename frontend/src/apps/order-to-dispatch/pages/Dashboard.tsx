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
import RankBars from "../components/RankBars";
import DispatchTrend from "../components/DispatchTrend";
import {
  consignmentsOf, daysSince, inRange, notGone, perDay, qtyLabel, rankBy, sumQty,
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
};

const STATE_BADGE: Record<ConsignmentState, string> = {
  billed: "bg-[#FFF7E6] text-yellow",
  dispatched: "bg-[#EAF1FE] text-blue",
  delivered: "bg-[#E8F7EE] text-ryg-green",
  returned: "bg-[#FDECEC] text-ryg-red",
};

/** Long-form date for the subtitle, so what is being counted is never in doubt. */
const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

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

  const tiles: KpiTile[] = [
    {
      key: "dispatched",
      label: "Dispatched",
      value: dispatched.length,
      hint: `${qtyLabel(sumQty(dispatched))} · left the gate${returnedCount ? ` · ${returnedCount} returned` : ""}`,
      size: "hero",
      href: `${B}/queues/gate-out`,
    },
    {
      key: "billed",
      label: "Sales bills raised",
      value: billed.length,
      hint: `${qtyLabel(sumQty(billed))} · invoices raised`,
      href: `${B}/queues/sales-bill`,
    },
    {
      key: "notGone",
      label: "Billed, not gone",
      value: billedNotGone.length,
      hint: `${qtyLabel(sumQty(billedNotGone))} · still in the plant`,
      tone: billedNotGone.length > 0 ? "red" : undefined,
      href: `${B}/queues/gate-out`,
    },
    {
      key: "backlog",
      label: "Awaiting gate out",
      value: backlog.length,
      // ⚠ NOT range-scoped, unlike the three tiles beside it. A bill raised four
      //   days ago and still not gone is the real operational problem and would
      //   be invisible in a "today" view. The hint says so, because one
      //   differently-scoped tile in a row is a classic way to mislead.
      hint: `${qtyLabel(sumQty(backlog))} · all dates${oldestWait > 0 ? ` · oldest ${oldestWait}d` : ""}`,
      tone: oldestWait >= 3 ? "red" : undefined,
      href: `${B}/queues/gate-out`,
    },
  ];

  const byCompany = useMemo(
    () => rankBy(dispatched, (c) => c.companyId ?? "—", (k) => s.masterName("company", k === "—" ? null : k)),
    [dispatched, s],
  );
  const byCustomer = useMemo(
    () => rankBy(dispatched, (c) => c.customerId, (k) => s.customerName(k)),
    [dispatched, s],
  );

  const trend = useMemo(() => perDay(dispatched, range, "dispatched"), [dispatched, range]);
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
      filter: { kind: "select", get: (c) => s.customerName(c.customerId) },
    },
    {
      key: "customerLocation",
      header: "Customer location",
      cell: (c) => <span className="text-grey">{c.customerLocation ?? "—"}</span>,
      sortValue: (c) => c.customerLocation ?? "",
      filter: { kind: "select", get: (c) => c.customerLocation ?? "—" },
      defaultHidden: true,
    },
    {
      key: "company",
      header: "Company",
      cell: (c) => <span className="text-grey">{s.masterName("company", c.companyId)}</span>,
      sortValue: (c) => s.masterName("company", c.companyId),
      filter: { kind: "select", get: (c) => s.masterName("company", c.companyId) },
    },
    {
      key: "site",
      header: "Dispatch location",
      cell: (c) => <span className="text-grey">{s.masterName("company_location", c.locationId)}</span>,
      sortValue: (c) => s.masterName("company_location", c.locationId),
      filter: { kind: "select", get: (c) => s.masterName("company_location", c.locationId) },
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
      exportValue: (c) => (c.gateOutIso ? dmy(c.gateOutIso) : "Not yet"),
    },
    {
      key: "qty",
      header: "Quantity",
      cell: (c) => <span className="text-grey tabular-nums whitespace-nowrap">{qtyLabel(c.qtyByUnit, 3)}</span>,
      sortValue: (c) => Object.values(c.qtyByUnit).reduce((a, n) => a + n, 0),
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
      filter: { kind: "select", get: (c) => STATE_LABEL[c.state] },
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
          {counts.delayed > 0 && (
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

      <div className="grid gap-4 lg:grid-cols-2">
        <RankBars
          title="Dispatched by company"
          rows={byCompany}
          emptyLabel="Nothing left the plant in this range."
        />
        <RankBars
          title="Dispatched by customer"
          rows={byCustomer}
          emptyLabel="Nothing left the plant in this range."
        />
      </div>

      {/* A one-bar chart is noise, so a single-day range gets no chart at all. */}
      {multiDay && <DispatchTrend data={trend} />}

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
