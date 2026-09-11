import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import PillToggle from "@/shared/components/ui/PillToggle";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { TextInput } from "@/shared/components/ui/Form";

import { useDailyReport, PARTY_KIND_LABEL, type MoneyRow, type PurchaseLine } from "../data/dailyReport";
import { useBankAccounts } from "../data/bankAccounts";
import { balanceKey, useBankBalances } from "../data/bankBalances";
import {
  addDays, daysBetween, dmy, fmtKg, fmtLacs, fmtQty, fmtSmart, isSunday, longDate,
  shortDay, timeOfDay, todayIso,
} from "../lib/format";
import { BASIS_NOTE, BLANK_NOTE, entityLabel, entityRank } from "../lib/labels";
import { SALE_TYPE_LABEL, SALE_TYPE_ORDER, type SaleType } from "../lib/saleType";
import {
  allBandsTotal, bandMoney, bankColumns, byParty, cellFor, entityTotal, facilityRows,
  groupSales, inLocation, isBankOnlyLocation, purchaseTotal, salesTotals, saleKind, topShare,
  tradeTotal, TRADE_BANDS,
  type LocationFilter, type PartyTotal,
} from "../lib/aggregate";
import { exportDailyReportXlsx } from "../lib/exportDailyXlsx";
import { downloadDailyReportPdf } from "../lib/exportDailyPdf";
import FactCard, { DetailToggle, type Fact } from "../components/Snapshot";
import { REPORT_LOCATIONS, type BankAccount } from "../types";

/**
 * Daily Report — what the business did today, and what is in the bank.
 *
 * Replaces a hand-made Excel that two people rebuilt every evening. Everything
 * except the bank balances is read from the Tally mirror, which is both faster
 * and more complete than copying rows across: reconciled against the client's
 * own 08-09-2026 sheet, the quantities matched to the kilogram, and the sheet
 * turned out to have dropped a 150 kg customer from its ink table.
 *
 * ⚠ THE COLLECTION AND PAYMENT FIGURES WILL LOOK WRONG AT FIRST, AND ARE NOT.
 *   The old sheet lists trade counterparties only. Tally's own total for the
 *   same day includes inter-company transfers, suspense postings and movement on
 *   our own cash-credit account. On 08-09-2026 that is ₹5.36 L against ₹35.73 L.
 *   Both readings are defensible; showing one of them without saying which is
 *   not. So the rows are BANDED by what the counterparty is, trade first, and
 *   the headline states which total it is quoting.
 */

const LOCATION_OPTIONS: { value: LocationFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...REPORT_LOCATIONS.map((l) => ({ value: l as LocationFilter, label: l })),
];

/** How many days of balance history the bank grid shows. */
const HISTORY_DAYS = 7;

/**
 * Trade rows first, then everything else, each half biggest-first.
 *
 * The table's own sort still works — this is only the order it OPENS in, so the
 * rows behind the headline figure are the ones a reader meets before the
 * inter-company and bank-transfer rows that are not in it.
 */
const tradeFirst = (rows: MoneyRow[]): MoneyRow[] =>
  [...rows].sort((a, b) => {
    const at = TRADE_BANDS.includes(a.kind) ? 0 : 1;
    const bt = TRADE_BANDS.includes(b.kind) ? 0 : 1;
    return at - bt || b.amountLacs - a.amountLacs;
  });

/* ------------------------------------------------------------- money table */

const moneyColumns = (): QueueColumn<MoneyRow>[] => [
  {
    key: "band", header: "Counterparty", alwaysVisible: true,
    cell: (r) => (
      <span
        className={
          r.kind === "customer" || r.kind === "vendor"
            ? "rounded bg-navy/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-navy"
            : "rounded bg-grey/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-grey"
        }
      >
        {PARTY_KIND_LABEL[r.kind]}
      </span>
    ),
    // A badge cell renders a component, so both are declared explicitly.
    sortValue: (r) => PARTY_KIND_LABEL[r.kind],
    filter: { kind: "select", get: (r) => PARTY_KIND_LABEL[r.kind] },
  },
  { key: "party", header: "Party", cell: (r) => r.party, sortValue: (r) => r.party,
    filter: { kind: "text", get: (r) => r.party } },
  { key: "company", header: "Book", cell: (r) => r.company ?? "—",
    sortValue: (r) => r.company ?? "", filter: { kind: "select", get: (r) => r.company ?? "—" } },
  { key: "voucherType", header: "Voucher type", defaultHidden: true,
    cell: (r) => r.voucherType ?? "—", sortValue: (r) => r.voucherType ?? "",
    filter: { kind: "select", get: (r) => r.voucherType ?? "—" } },
  { key: "voucherNo", header: "Voucher no.", defaultHidden: true,
    cell: (r) => <span className="tabular-nums">{r.voucherNo ?? "—"}</span>,
    sortValue: (r) => r.voucherNo ?? "", filter: { kind: "text", get: (r) => r.voucherNo ?? "" } },
  {
    key: "amount", header: "Amount (₹ L)", align: "right",
    cell: (r) => <span className="tabular-nums font-semibold">{fmtLacs(r.amountLacs)}</span>,
    // "1,200.00" sorts before "9.00" as text — money always declares this.
    sortValue: (r) => r.amountLacs,
    filter: { kind: "number", get: (r) => r.amountLacs },
    exportValue: (r) => r.amountLacs,
  },
];

/* ------------------------------------------------------------ sales table */

const partyColumns = (unit: "kg" | "qty"): QueueColumn<PartyTotal>[] => [
  { key: "party", header: "Party", cell: (r) => r.party, sortValue: (r) => r.party,
    filter: { kind: "text", get: (r) => r.party } },
  { key: "company", header: "Entity", cell: (r) => entityLabel(r.company),
    sortValue: (r) => entityRank(r.company), filter: { kind: "select", get: (r) => entityLabel(r.company) } },
  { key: "location", header: "Location", cell: (r) => r.location, sortValue: (r) => r.location,
    filter: { kind: "select", get: (r) => r.location } },
  {
    key: "qty", header: unit === "kg" ? "Qty (kg)" : "Qty", align: "right",
    cell: (r) => <span className="tabular-nums">{unit === "kg" ? fmtKg(r.qty) : fmtQty(r.qty)}</span>,
    sortValue: (r) => r.qty, filter: { kind: "number", get: (r) => r.qty }, exportValue: (r) => r.qty,
  },
  {
    key: "amount", header: "Amount (₹ L)", align: "right",
    // A free-of-charge line carries quantity and no money. A bare 0.00 in a money
    // column reads as a data fault and somebody reports it, so it says FOC.
    cell: (r) =>
      r.foc
        ? <span className="rounded bg-orange/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-orange">FOC</span>
        : <span className="tabular-nums font-semibold">{fmtLacs(r.revenueLacs)}</span>,
    sortValue: (r) => r.revenueLacs,
    filter: { kind: "number", get: (r) => r.revenueLacs },
    exportValue: (r) => r.revenueLacs,
  },
];

const purchaseColumns = (): QueueColumn<PurchaseLine>[] => [
  { key: "party", header: "Supplier", cell: (r) => r.party, sortValue: (r) => r.party,
    filter: { kind: "text", get: (r) => r.party } },
  { key: "item", header: "Item", cell: (r) => r.item, sortValue: (r) => r.item,
    filter: { kind: "text", get: (r) => r.item } },
  { key: "group", header: "Stock group", cell: (r) => r.stockGroup ?? "—",
    sortValue: (r) => r.stockGroup ?? "", filter: { kind: "select", get: (r) => r.stockGroup ?? "—" } },
  { key: "company", header: "Entity", cell: (r) => entityLabel(r.company),
    sortValue: (r) => entityRank(r.company), filter: { kind: "select", get: (r) => entityLabel(r.company) } },
  {
    key: "qty", header: "Qty", align: "right",
    cell: (r) => <span className="tabular-nums">{fmtQty(r.qty)}{r.unit ? ` ${r.unit}` : ""}</span>,
    sortValue: (r) => r.qty, filter: { kind: "number", get: (r) => r.qty }, exportValue: (r) => r.qty,
  },
  {
    key: "amount", header: "Amount (₹ L)", align: "right",
    cell: (r) => <span className="tabular-nums font-semibold">{fmtLacs(r.amountLacs)}</span>,
    sortValue: (r) => r.amountLacs, filter: { kind: "number", get: (r) => r.amountLacs },
    exportValue: (r) => r.amountLacs,
  },
];

/* ---------------------------------------------------------------- section */

/**
 * A section heading carrying its own day total.
 *
 * QueueTable has no footer row, and a pseudo-row would sort with the data. So
 * the total lives here and is labelled "day total" — which stays honest when a
 * reader filters the table, because the table's own row counter moves and this
 * deliberately does not.
 */
function Section({
  title, total, count, children, note,
}: {
  title: string;
  total?: string;
  count?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-navy">
          {title}
          {count && <span className="ml-2 text-[11.5px] font-normal normal-case text-grey">{count}</span>}
        </h2>
        {total && (
          <span className="text-[12.5px] text-grey">
            day total <span className="tabular-nums font-semibold text-navy">{total}</span>
          </span>
        )}
      </div>
      {note && <p className="border-b border-line px-4 py-2 text-[11.5px] text-grey">{note}</p>}
      <div className="p-3">{children}</div>
    </Card>
  );
}

/** Nothing happened, said in a way that distinguishes the three reasons. */
function Nothing({ date, what }: { date: string; what: string }) {
  const today = todayIso();
  const msg = isSunday(date)
    ? `${dmy(date)} is a Sunday — the books are closed.`
    : date === today
      ? `Nothing booked yet today.`
      : `No ${what} were booked on ${dmy(date)}.`;
  return <p className="px-1 py-6 text-center text-[12.5px] text-grey">{msg}</p>;
}

/* ------------------------------------------------------------------- page */

export default function DailyReport() {
  const today = todayIso();
  const [params, setParams] = useSearchParams();

  // Date and location live in the URL so a link — including the one a future
  // scheduled mail will carry — opens the day it reported on, not today.
  const dateParam = params.get("d") ?? "";
  const date = dateParam && dateParam <= today ? dateParam : today;
  const locParam = (params.get("loc") ?? "all") as LocationFilter;
  const loc: LocationFilter = ["all", ...REPORT_LOCATIONS].includes(locParam) ? locParam : "all";

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
  };

  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  // Collapsed by default. The page is meant to answer the day in one screen;
  // the grids are for interrogating it, which is a second, deliberate step.
  const [showDetail, setShowDetail] = useState(false);
  const report = useDailyReport(date);
  const accounts = useBankAccounts();

  const historyFrom = addDays(date, -(HISTORY_DAYS - 1));
  const balances = useBankBalances(historyFrom, date);

  const bankOnly = isBankOnlyLocation(loc);

  /* ---- scoped rows -------------------------------------------------- */
  const sales = useMemo(
    () => (report.data?.sales ?? []).filter((l) => inLocation(loc, l.location)),
    [report.data, loc],
  );
  const purchases = useMemo(
    () => (report.data?.purchases ?? []).filter((p) => inLocation(loc, p.location)),
    [report.data, loc],
  );
  // The day book's voucher list carries a book label, not a location, so a
  // location filter cannot narrow it without guessing. Rather than silently
  // showing all of it under a Surat heading, the money sections say so.
  const money = report.data?.money ?? [];

  const totals = useMemo(() => salesTotals(sales), [sales]);
  const groups = useMemo(() => groupSales(sales), [sales]);
  const received = useMemo(() => bandMoney(money, "in"), [money]);
  const paid = useMemo(() => bandMoney(money, "out"), [money]);
  const approvals = useMemo(() => sales.filter((l) => saleKind(l) === "approval"), [sales]);
  const returns = useMemo(() => sales.filter((l) => saleKind(l) === "negative"), [sales]);

  const purchasedLacs = purchaseTotal(purchases);
  // ⚠ THE HEADLINE IS TRADE ONLY — customers and suppliers — which is what the
  //   sheet this replaces has always shown, and what Ritesh Bhai confirmed on
  //   11-09-2026. Everything else Tally recorded is still on the page, banded
  //   and totalled separately: on 08-09-2026 that is ₹39.18 L of trade inside a
  //   ₹1.32 Cr day, the rest being movement on our own cash-credit account, the
  //   Noida branch, and a suspense posting. Showing the full figure as the
  //   headline would be true and would read as a fivefold jump in collections.
  const receivedLacs = tradeTotal(received);
  const paidLacs = tradeTotal(paid);
  const receivedAllLacs = allBandsTotal(received);
  const paidAllLacs = allBandsTotal(paid);

  /* ---- bank --------------------------------------------------------- */
  const dates = useMemo(() => daysBetween(historyFrom, date), [historyFrom, date]);
  const bankCols = useMemo(
    () => bankColumns(accounts.data ?? [], balances.data ?? new Map(), dates, loc),
    [accounts.data, balances.data, dates, loc],
  );
  const bankByEntity = useMemo(() => {
    const m = new Map<string, BankAccount[]>();
    for (const a of bankCols) {
      const list = m.get(a.entityAlias) ?? [];
      list.push(a);
      m.set(a.entityAlias, list);
    }
    return [...m.entries()].sort((x, y) => entityRank(x[0]) - entityRank(y[0]));
  }, [bankCols]);

  const todayBankTotal = useMemo(() => {
    let sum = 0;
    let anyMissing = false;
    for (const [, rows] of bankByEntity) {
      const t = entityTotal(rows, balances.data ?? new Map(), date);
      if (t.totalLacs == null) anyMissing = true;
      else sum += t.totalLacs;
    }
    return { sum, anyMissing };
  }, [bankByEntity, balances.data, date]);

  const facility = useMemo(
    () => facilityRows(bankCols, balances.data ?? new Map(), date),
    [bankCols, balances.data, date],
  );

  /* ---- KPI ----------------------------------------------------------- */
  const mtdSales = report.data?.mtd.salesLacs ?? 0;
  // ⚠ THE MEDIAN DAY, NOT THE MEAN, and that is not a refinement.
  //   Machine deals are enormous and rare: two high-seas invoices on 02-09-2026
  //   put ₹12.21 Cr into a month whose other days ran ₹45 L to ₹1.25 Cr. The
  //   mean then reads ₹2.50 Cr a day — true, and a description of no day that
  //   has ever occurred. The median says ₹0.92 Cr, which is the business.
  const medianDay = useMemo(() => {
    const xs = [...(report.data?.mtd.dailyNetLacs ?? [])].sort((a, b) => a - b);
    if (xs.length === 0) return 0;
    const mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  }, [report.data]);
  const bankEntered = useMemo(
    () => bankCols.filter((a) => (balances.data ?? new Map()).has(balanceKey(a.id, date))).length,
    [bankCols, balances.data, date],
  );

  // ⚠ UNDER A BANK-ONLY LOCATION THE BUSINESS TILES MUST NOT SHOW A FIGURE.
  //   Delhi has no Tally book, so the only honest answers are "not reported
  //   here". Leaving the all-locations numbers in place under a Delhi filter
  //   would put ₹1.32 Cr of Surat and Noida money on a page headed Delhi, which
  //   is worse than a dash: it is a real figure attributed to the wrong place.
  const na = (label: string, key: string): KpiTile =>
    ({ key, label, value: "—", hint: "Not reported for a banking location" });

  const tiles: KpiTile[] = [
    bankOnly ? na("Sales today", "sales") : {
      key: "sales", label: "Sales today", value: fmtSmart(totals.netLacs),
      hint: `Month to date ${fmtSmart(mtdSales)} · median day ${fmtSmart(medianDay)}`,
    },
    bankOnly ? na("Received today", "received") : {
      key: "received", label: "Received from customers", value: fmtSmart(receivedLacs),
      hint: `${fmtSmart(receivedAllLacs)} in all, including our own transfers`,
    },
    bankOnly ? na("Paid today", "paid") : {
      key: "paid", label: "Paid to suppliers", value: fmtSmart(paidLacs),
      hint: `${fmtSmart(paidAllLacs)} in all, including our own transfers`,
    },
    bankOnly ? na("Purchased today", "purchased") : {
      key: "purchased", label: "Purchased today", value: fmtSmart(purchasedLacs),
      hint: `${purchases.length} ${purchases.length === 1 ? "line" : "lines"} · net of GST`,
    },
    {
      key: "bank", label: "Bank balance", value: todayBankTotal.anyMissing ? "—" : fmtSmart(todayBankTotal.sum),
      // Counted over the accounts ON SCREEN, not over all eleven: under a Delhi
      // filter "0 of 11" names ten accounts this page is not showing.
      hint: `${bankEntered} of ${bankCols.length} account${bankCols.length === 1 ? "" : "s"} entered for ${dmy(date)}`,
      tone: bankCols.length > bankEntered ? "red" : undefined,
      href: `/daily-report/bank-balances?d=${date}`,
    },
  ];

  // ONE input for both exports, built from the same scoped rows the page is
  // rendering. The workbook and the document must never be able to disagree
  // with each other, or with what the reader is looking at.
  const exportInput = (rulesLoaded: boolean) => ({
    date, loc, sales, money, purchases,
    accounts: bankCols,
    balances: balances.data ?? new Map(),
    dates,
    mtdSalesLacs: mtdSales,
    rulesLoaded,
  });

  // Sorted oldest-rebuilt first, so the book that is furthest behind is the one
  // a reader's eye lands on rather than one they have to hunt for.
  const freshness = useMemo(
    () => [...(report.data?.freshness ?? [])].sort((a, b) => (a.builtAt ?? "").localeCompare(b.builtAt ?? "")),
    [report.data],
  );

  /* ---- the snapshot ------------------------------------------------- */

  /**
   * What sold, by product line. FIVE rows where the first cut had four separate
   * tables running to thirty-nine parties between them — and this is the thing a
   * CFO actually reads first.
   */
  const salesFacts: Fact[] = useMemo(() => {
    const rows: Fact[] = groups.map((g) => ({
      key: g.saleType,
      label: SALE_TYPE_LABEL[g.saleType],
      sub: g.saleType === "ink" ? fmtKg(g.qty) : `${fmtQty(g.qty)} units`,
      value: fmtLacs(g.revenueLacs),
    }));
    if (totals.returnsLacs !== 0) {
      rows.push({
        key: "returns", label: "Returns and credit notes", tone: "quiet",
        value: fmtLacs(totals.returnsLacs),
      });
    }
    if (totals.approvalLacs !== 0) {
      rows.push({
        key: "approval", label: "Out on approval", tone: "quiet",
        sub: "not counted as a sale",
        value: fmtLacs(totals.approvalLacs),
      });
    }
    rows.push({ key: "total", label: "Total", tone: "rule", value: fmtLacs(totals.netLacs) });
    return rows;
  }, [groups, totals]);

  /**
   * Money in or out, by what the counterparty is.
   *
   * ⚠ NO "Customers and suppliers" SUBTOTAL ROW. The card's own headline IS that
   *   figure and says so underneath it, so a subtotal repeated it — and on a day
   *   with one trade band and nothing else, the card printed the same number
   *   three times over ("Customer 15.72 / Customers and suppliers 15.72 / All
   *   counterparties 15.72"). Ritesh Bhai read that as three different things
   *   and asked what it meant, which was the right question.
   *
   *   So: the bands, a captioned divider where the excluded ones begin, and an
   *   all-counterparties line ONLY when it differs from the headline.
   */
  const moneyFacts = (bands: ReturnType<typeof bandMoney>, tradeLacs: number, allLacs: number): Fact[] => {
    const trade = bands.filter((b) => TRADE_BANDS.includes(b.kind));
    const other = bands.filter((b) => !TRADE_BANDS.includes(b.kind));
    const row = (b: (typeof bands)[number], quiet: boolean): Fact => ({
      key: b.kind,
      label: PARTY_KIND_LABEL[b.kind],
      sub: `${b.rows.length} ${b.rows.length === 1 ? "entry" : "entries"}`,
      tone: quiet ? "quiet" : undefined,
      value: fmtLacs(b.totalLacs),
    });

    const rows: Fact[] = trade.map((b) => row(b, false));
    if (other.length > 0) {
      rows.push({ key: "sep", label: "Not counted in the figure above", tone: "sep", value: null });
      rows.push(...other.map((b) => row(b, true)));
      rows.push({
        key: "all", label: "Everything Tally recorded", tone: "quiet", value: fmtLacs(allLacs),
      });
    }
    return rows;
  };

  /** Where the bank stands today, one line per entity. */
  const bankFacts: Fact[] = useMemo(
    () =>
      bankByEntity.map(([alias, rows]) => {
        const t = entityTotal(rows, balances.data ?? new Map(), date);
        return {
          key: alias,
          label: entityLabel(alias),
          sub: `${rows.length} ${rows.length === 1 ? "account" : "accounts"}`,
          // Never a partial sum: a dash, and the tooltip names what is missing.
          value:
            t.totalLacs == null
              ? <span className="text-grey-2" title={`Not entered: ${t.missing.join(", ")}`}>—</span>
              : fmtLacs(t.totalLacs),
        };
      }),
    [bankByEntity, balances.data, date],
  );

  // Describes what OPENS, not what was loaded. "176 sales lines" is true and
  // tells a reader nothing about the tables they are about to see; the party
  // count is what they will actually be looking down.
  const detailSummary = [
    `${money.length} receipts and payments`,
    `${groups.reduce((n, g) => n + byParty(g.lines).length, 0)} customers across ${groups.length} product ${groups.length === 1 ? "line" : "lines"}`,
    purchases.length > 0 ? `${purchases.length} purchase lines` : null,
  ].filter(Boolean).join(" · ");

  const loading = report.isLoading;

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- header */}
      {/* Title and controls are SEPARATE ROWS rather than one justify-between
          line. Six controls plus a four-way toggle do not reliably share a row
          with a heading: they wrapped mid-group, putting the back-a-day chevron
          on a line of its own above the date it steps. */}
      <div>
        <h1 className="text-[19px] font-semibold text-navy">Daily Report</h1>
        <p className="mt-1 text-[12.5px] text-grey">
          {longDate(date)}
          {loc !== "all" && <> · {loc}</>}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setParam("d", addDays(date, -1))} aria-label="Previous day">‹</Button>
          <TextInput type="date" value={date} max={today} onChange={(e) => setParam("d", e.target.value)} className="w-44" />
          <Button variant="ghost" size="sm" onClick={() => setParam("d", addDays(date, 1))} disabled={date >= today} aria-label="Next day">›</Button>
          {date !== today && <Button variant="ghost" size="sm" onClick={() => setParam("d", today)}>Today</Button>}
        </div>
        <div className="flex items-center gap-2">
          <PillToggle<LocationFilter>
            value={loc}
            onChange={(v) => setParam("loc", v)}
            options={LOCATION_OPTIONS}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={!report.data || exporting !== null}
            onClick={async () => {
              if (!report.data) return;
              setExporting("xlsx");
              try {
                await exportDailyReportXlsx(exportInput(report.data.rulesLoaded));
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "xlsx" ? "Building…" : "Excel"}
          </Button>
          <Button
            size="sm"
            disabled={!report.data || exporting !== null}
            onClick={async () => {
              if (!report.data) return;
              setExporting("pdf");
              try {
                await downloadDailyReportPdf(exportInput(report.data.rulesLoaded));
              } finally {
                setExporting(null);
              }
            }}
          >
            {exporting === "pdf" ? "Building…" : "Download PDF"}
          </Button>
        </div>
      </div>

      <div className="text-[11.5px] text-grey-2">
        <p>{BASIS_NOTE}</p>
        {/* On the current day this is the difference between "no sales" and "no
            sales YET": the register rebuilds through the evening as the sync
            runs, and nothing else on the page would say the day is partial. */}
        {freshness.length > 0 && (
          <p className="mt-0.5">
            Tally mirror rebuilt{" "}
            {freshness
              .map((f) => `${f.builtAt ? timeOfDay(f.builtAt) : "never"} (${f.label})`)
              .join(" · ")}
          </p>
        )}
      </div>

      {report.isError && (
        <Card className="border-orange/40 p-4 text-[12.5px] text-orange">
          Could not read the Tally mirror: {String(report.error)}
        </Card>
      )}

      {/* A missing ruleset would silently bucket everything as unclassified, so
          it is said out loud rather than left to look like a quiet day. */}
      {report.data && !report.data.rulesLoaded && (
        <Card className="border-orange/40 p-3 text-[12.5px] text-orange">
          The product-line rules could not be read, so every sale below is listed as not yet
          classified. The figures are still correct; only the split by ink, head and machine is
          unavailable.
        </Card>
      )}

      <KpiRow tiles={tiles} />

      {bankOnly && (
        <Card className="border-line bg-page p-3 text-[12.5px] text-grey">
          <span className="font-semibold text-navy">Delhi is a banking location.</span> It has no
          Tally company book of its own — its account sits inside the Orange O Tec Noida book — so
          no sales, purchases or vouchers are reported against it. The bank section below is the
          whole Delhi report.
        </Card>
      )}

      {/* ─────────────────────────────── the snapshot ─────────────────────
          Four aggregate cards, two per row on a wide screen. This is what the
          page is FOR: the day answered before any means of interrogating it. */}
      {!bankOnly && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <FactCard
            title="What sold"
            headline={fmtSmart(totals.netLacs)}
            headlineNote="net of GST"
            facts={salesFacts}
            footer={
              sales.length === 0 && !loading
                ? isSunday(date)
                  ? `${dmy(date)} is a Sunday — the books are closed.`
                  : date === todayIso() ? "Nothing booked yet today." : `Nothing was booked on ${dmy(date)}.`
                : undefined
            }
          />

          <FactCard
            title="Bank, as on this date"
            headline={todayBankTotal.anyMissing ? "—" : fmtSmart(todayBankTotal.sum)}
            headlineNote={`${bankEntered} of ${bankCols.length} entered`}
            facts={bankFacts}
            footer={
              bankEntered < bankCols.length ? (
                <Link to={`/daily-report/bank-balances?d=${date}`} className="font-semibold text-orange">
                  Enter the balances for {dmy(date)} →
                </Link>
              ) : (
                "Every account recorded."
              )
            }
          />

          {/* ⚠ BOTH CARDS STATE THE SAME BASIS IN THE SAME WORDS. They used to
              say "from customers and suppliers" and "to suppliers", which read
              as two different rules for what is one rule, and left a reader
              wondering why a money-OUT card mentioned customers at all. */}
          <FactCard
            title="Money in"
            headline={fmtSmart(receivedLacs)}
            headlineNote="customers and suppliers only"
            facts={moneyFacts(received, receivedLacs, receivedAllLacs)}
            footer="The same basis as the sheet you circulate today. A supplier refunding us counts here too, which is why suppliers appear on both cards."
          />

          <FactCard
            title="Money out"
            headline={fmtSmart(paidLacs)}
            headlineNote="customers and suppliers only"
            facts={moneyFacts(paid, paidLacs, paidAllLacs)}
            footer="The same basis. Moving money onto our own cash-credit account, or across to another of our books, is not a payment to anyone."
          />
        </div>
      )}

      {/* ------------------------------------------------------------ bank */}
      {facility.length > 0 && (
        <Section title="Bank facility" note="Limits come from the bank account master; utilisation and free limit are computed. A dash means an input is not known — a free limit computed from a missing figure would be confidently wrong.">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-grey">
                <th className="px-2 py-2 font-semibold">Account</th>
                <th className="px-2 py-2 text-right font-semibold">CC limit</th>
                <th className="px-2 py-2 text-right font-semibold">Held by bank</th>
                <th className="px-2 py-2 text-right font-semibold">Available CC</th>
                <th className="px-2 py-2 text-right font-semibold">LC / BC limit</th>
                <th className="px-2 py-2 text-right font-semibold">Utilised</th>
                <th className="px-2 py-2 text-right font-semibold">Free limit</th>
              </tr>
            </thead>
            <tbody>
              {facility.map((f) => (
                <tr key={f.account.id} className="border-b border-line/60 last:border-0">
                  <td className="px-2 py-1.5 font-semibold text-navy">{f.account.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtLacs(f.ccLimit)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtLacs(f.heldByBank)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtLacs(f.availableCc)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtLacs(f.lcBcLimit)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtLacs(f.lcBcUtilised)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtLacs(f.lcBcFree)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section
        title="Bank balances"
        count={`${HISTORY_DAYS} days to ${dmy(date)}`}
        note={BLANK_NOTE}
      >
        {bankCols.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12.5px] text-grey">
            No bank accounts for this location.{" "}
            <Link to="/daily-report/bank-accounts" className="font-semibold text-orange">Add one</Link>.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12.5px]">
              <thead>
                {/* Two header rows: the entity band above its own accounts. This
                    is why the grid is hand-built — QueueTable's head is one row
                    of columns plus a filter row, and cannot span. */}
                <tr className="text-[11px] uppercase tracking-wide text-grey">
                  <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left font-semibold">Date</th>
                  {bankByEntity.map(([alias, rows]) => (
                    <th key={alias} colSpan={rows.length + 1} className="border-l border-line px-2 py-1.5 text-center font-semibold text-navy">
                      {entityLabel(alias)}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-grey">
                  <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left font-semibold" />
                  {bankByEntity.map(([alias, rows]) => (
                    <Fragmentish key={alias}>
                      {rows.map((a) => (
                        <th key={a.id} className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{a.name}</th>
                      ))}
                      <th className="whitespace-nowrap border-r border-line px-2 py-1.5 text-right font-semibold text-navy">Total</th>
                    </Fragmentish>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...dates].reverse().map((d) => {
                  const sunday = isSunday(d);
                  return (
                    <tr key={d} className={sunday ? "bg-page/60" : undefined}>
                      <td className={`sticky left-0 z-10 whitespace-nowrap px-2 py-1.5 font-semibold ${sunday ? "bg-page/60 text-grey-2" : "bg-white text-navy"}`}>
                        {shortDay(d)}
                      </td>
                      {bankByEntity.map(([alias, rows]) => {
                        const t = entityTotal(rows, balances.data ?? new Map(), d);
                        return (
                          <Fragmentish key={alias}>
                            {rows.map((a) => {
                              const cell = cellFor(a, balances.data ?? new Map(), d);
                              return (
                                <td key={a.id} className="px-2 py-1.5 text-right tabular-nums">
                                  {cell.kind === "value" ? (
                                    fmtLacs(cell.lacs)
                                  ) : cell.kind === "closed" ? (
                                    <span className="text-grey-2/60" title="Sunday — books closed">—</span>
                                  ) : (
                                    <span className="text-grey-2" title="Not entered">
                                      — <span className="text-orange">•</span>
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="border-r border-line px-2 py-1.5 text-right tabular-nums font-semibold text-navy">
                              {/* Never a partial sum: that is a wrong number that
                                  looks right, and it is the one a CFO quotes. */}
                              {t.totalLacs == null ? (
                                <span
                                  className="text-grey-2"
                                  title={sunday ? "Sunday — books closed" : `Not entered: ${t.missing.join(", ")}`}
                                >
                                  —
                                </span>
                              ) : (
                                fmtLacs(t.totalLacs)
                              )}
                            </td>
                          </Fragmentish>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ─────────────────────────────── the detail ───────────────────────
          Every grid keeps its sort, its cascading filters and its export. What
          changed is that they no longer greet a reader who only wanted the
          day's five numbers. */}
      {!bankOnly && (
        <DetailToggle
          open={showDetail}
          onToggle={() => setShowDetail((v) => !v)}
          summary={detailSummary}
        />
      )}

      {!bankOnly && showDetail && (
        <div className="space-y-4">
          {/* ------------------------------------------------------ money */}
          <Section
            title="Received"
            count={`${money.filter((m) => m.direction === "in").length} receipts`}
            total={`${fmtSmart(receivedLacs)} from customers and suppliers`}
            note={`Every receipt Tally recorded, banded by what the counterparty is. The day total above counts customers and suppliers only — the same basis as the sheet this replaces. All counterparties together come to ${fmtSmart(receivedAllLacs)}, the difference being transfers between our own accounts, inter-company movement and suspense.`}
          >
            {money.filter((m) => m.direction === "in").length === 0 && !loading ? (
              <Nothing date={date} what="receipts" />
            ) : (
              <QueueTable<MoneyRow>
                rows={tradeFirst(money.filter((m) => m.direction === "in"))}
                rowKey={(r) => r.id}
                columns={moneyColumns()}
                loading={loading}
                rowsLabel="receipts"
                initialSort={{ key: "amount", dir: "desc" }}
                exportName={`Daily_Report_Receipts_${date}`}
                exportTitle={`Receipts — ${dmy(date)}`}
                readOnly
              />
            )}
          </Section>

          <Section
            title="Paid"
            count={`${money.filter((m) => m.direction === "out").length} payments`}
            total={`${fmtSmart(paidLacs)} to suppliers`}
            note={`The day total above counts suppliers only. All counterparties together come to ${fmtSmart(paidAllLacs)} — the rest is movement on our own cash-credit accounts and transfers between books. The Counterparty column separates them.`}
          >
            {money.filter((m) => m.direction === "out").length === 0 && !loading ? (
              <Nothing date={date} what="payments" />
            ) : (
              <QueueTable<MoneyRow>
                rows={tradeFirst(money.filter((m) => m.direction === "out"))}
                rowKey={(r) => r.id}
                columns={moneyColumns()}
                loading={loading}
                rowsLabel="payments"
                initialSort={{ key: "amount", dir: "desc" }}
                exportName={`Daily_Report_Payments_${date}`}
                exportTitle={`Payments — ${dmy(date)}`}
                readOnly
              />
            )}
          </Section>

          {/* ------------------------------------------------------ sales */}
          {groups.length === 0 && !loading && (
            <Section title="Sales"><Nothing date={date} what="sales" /></Section>
          )}

          {SALE_TYPE_ORDER.map((t) => {
            const g = groups.find((x) => x.saleType === t);
            if (!g) return null;
            const rows = byParty(g.lines);
            const share = topShare(rows);
            const isInk = t === "ink";
            return (
              <Section
                key={t}
                title={SALE_TYPE_LABEL[t]}
                count={`${rows.length} ${rows.length === 1 ? "party" : "parties"} · ${isInk ? fmtKg(g.qty) : fmtQty(g.qty)}`}
                total={fmtSmart(g.revenueLacs)}
                note={
                  t === "other"
                    ? "These lines carry a voucher type no product-line rule covers yet. They are listed rather than dropped; add a rule on ConnectWave and they move into the section above."
                    : rows.length > 5
                      ? `Top 5 customers ${fmtSmart(share.topLacs)} of ${fmtSmart(share.totalLacs)} (${share.pct.toFixed(0)}%).`
                      : undefined
                }
              >
                <QueueTable<PartyTotal>
                  rows={rows}
                  rowKey={(r) => `${r.party}|${r.company}|${r.location}`}
                  columns={partyColumns(isInk ? "kg" : "qty")}
                  loading={loading}
                  rowsLabel="parties"
                  initialSort={{ key: "amount", dir: "desc" }}
                  exportName={`Daily_Report_${SALE_TYPE_LABEL[t].replace(/\s+/g, "_")}_${date}`}
                  exportTitle={`${SALE_TYPE_LABEL[t]} — ${dmy(date)}`}
                  readOnly
                />
              </Section>
            );
          })}

          {/* Head and machine movement, as the reference sheet prints it: one
              line per despatch, and whether it left on an invoice or a challan. */}
          {(["head", "machine"] as SaleType[]).map((t) => {
            const lines = sales.filter((l) => l.saleType === t && saleKind(l) !== "negative");
            if (lines.length === 0) return null;
            return (
              <Section
                key={`${t}-outward`}
                title={`${SALE_TYPE_LABEL[t]} outward`}
                count={`${fmtQty(lines.reduce((s, l) => s + l.qty, 0))} units`}
              >
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-grey">
                      <th className="px-2 py-2 font-semibold">Particular</th>
                      <th className="px-2 py-2 font-semibold">Type</th>
                      <th className="px-2 py-2 text-right font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-b border-line/60 last:border-0">
                        <td className="px-2 py-1.5">{l.party}_{l.item}</td>
                        <td className="px-2 py-1.5">
                          <span className={l.paper === "DC" ? "text-orange" : "text-grey"}>{l.paper}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtQty(l.qty)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold text-navy">
                      <td className="px-2 py-2">Total</td>
                      <td />
                      <td className="px-2 py-2 text-right tabular-nums">
                        {fmtQty(lines.reduce((s, l) => s + l.qty, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            );
          })}

          {approvals.length > 0 && (
            <Section
              title="Out on approval"
              count={`${approvals.length} ${approvals.length === 1 ? "line" : "lines"}`}
              total={fmtSmart(approvals.reduce((s, l) => s + l.revenueLacs, 0))}
              note="Goods that have left on approval. NOT counted as a sale above — the client's own sheet excludes them too — but shown here so nothing leaves the building unrecorded."
            >
              <table className="w-full text-[12.5px]">
                <tbody>
                  {approvals.map((l) => (
                    <tr key={l.id} className="border-b border-line/60 last:border-0">
                      <td className="px-2 py-1.5">{l.party}</td>
                      <td className="px-2 py-1.5 text-grey">{l.item}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtQty(l.qty)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtLacs(l.revenueLacs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* The reconciliation line. Without it the visible sections sum to
              slightly less than the headline and nobody can see where the
              difference went — which is the fastest way to lose a CFO's trust. */}
          {!loading && sales.length > 0 && (
            <p className="px-1 text-[12px] text-grey">
              {groups.map((g) => `${SALE_TYPE_LABEL[g.saleType]} ${fmtLacs(g.revenueLacs)}`).join(" + ")}
              {returns.length > 0 && ` − returns ${fmtLacs(Math.abs(totals.returnsLacs))}`}
              {" = "}
              <span className="font-semibold text-navy">{fmtSmart(totals.netLacs)}</span>
              {" "}— the Sales today tile.
            </p>
          )}

          {/* -------------------------------------------------- purchases */}
          <Section
            title="Purchases"
            count={`${purchases.length} ${purchases.length === 1 ? "line" : "lines"}`}
            total={fmtSmart(purchasedLacs)}
          >
            {purchases.length === 0 && !loading ? (
              <Nothing date={date} what="purchases" />
            ) : (
              <QueueTable<PurchaseLine>
                rows={purchases}
                rowKey={(r) => r.id}
                columns={purchaseColumns()}
                loading={loading}
                rowsLabel="lines"
                initialSort={{ key: "amount", dir: "desc" }}
                exportName={`Daily_Report_Purchases_${date}`}
                exportTitle={`Purchases — ${dmy(date)}`}
                readOnly
              />
            )}
          </Section>

        </div>
      )}
    </div>
  );
}
/** A keyed fragment, so the two-level bank header can group cells per entity. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
