import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import PillToggle from "@/shared/components/ui/PillToggle";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { TextInput } from "@/shared/components/ui/Form";

import { useDailyReport, PARTY_KIND_LABEL, type PurchaseLine } from "../data/dailyReport";
import { useBankAccounts } from "../data/bankAccounts";
import { balanceKey, useBankBalances } from "../data/bankBalances";
import { useCcLimits } from "../data/ccLimits";
import {
  addDays, daysBetween, dmy, fmtKg, fmtLacs, fmtQty, fmtMoney, isSunday, longDate,
  shortDay, timeOfDay, todayIso,
} from "../lib/format";
import { BASIS_NOTE, BLANK_NOTE, entityLabel, entityRank, listNoun } from "../lib/labels";
import { SALE_TYPE_LABEL, SALE_TYPE_ORDER, type SaleType } from "../lib/saleType";
import {
  allBandsTotal, bandMoney, bankColumns, cellFor, companyColumnLabel, entityTotal,
  FACILITY_BALANCE_NOTE, facilityRows, groupSales, inLocation,
  isBankOnlyLocation, pivotCompanies, pivotMoney, pivotSales, purchaseTotal, salesTotals, saleKind,
  tradeTotal, TRADE_BANDS,
  type LocationFilter, type MoneyBand, type PivotCompany,
} from "../lib/aggregate";
import { exportDailyReportXlsx } from "../lib/exportDailyXlsx";
import { downloadDailyReportPdf } from "../lib/exportDailyPdf";
import FactCard, { KpiSkeleton, LoadingNote, type Fact } from "../components/Snapshot";
import PivotGrid from "../components/PivotGrid";
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

/* ------------------------------------------------------------ money lists */

/**
 * Money in or out, band by band — one folded list per band.
 *
 * ⚠ THE FOLD RUNS PER BAND, NOT OVER THE WHOLE LIST. Folding across bands would
 *   put a bank transfer and a customer receipt into the same "Remaining" line,
 *   which is exactly the mixing the headline refuses. The bands that are not in
 *   the headline stay visibly apart, below their own divider.
 */
function MoneyDetail({
  bands, companies,
}: {
  bands: MoneyBand[];
  companies: PivotCompany[];
}) {
  const trade = bands.filter((b) => TRADE_BANDS.includes(b.kind));
  const other = bands.filter((b) => !TRADE_BANDS.includes(b.kind));
  const band = (b: MoneyBand) => {
    const rows = pivotMoney(b.rows);
    return (
      <div key={b.kind} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-navy">
            {PARTY_KIND_LABEL[b.kind]}
            <span className="ml-2 text-[11.5px] font-normal normal-case text-grey">
              {rows.length} {listNoun(b.kind, rows.length)} · {b.rows.length} {b.rows.length === 1 ? "entry" : "entries"}
            </span>
          </h3>
          <span className="text-[12.5px] text-grey">
            band total <span className="tabular-nums font-semibold text-navy">{fmtMoney(b.totalLacs)}</span>
          </span>
        </div>
        <PivotGrid rows={rows} companies={companies} unit={null} noun={b.kind} />
      </div>
    );
  };
  return (
    <div className="space-y-5">
      {trade.map(band)}
      {other.length > 0 && (
        <>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">
              Not counted in the figure above
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
          {other.map(band)}
        </>
      )}
    </div>
  );
}

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
  title, total, totalLabel = "day total", count, children, note,
}: {
  title: string;
  total?: string;
  /** What `total` is. "day total" unless the figure is something narrower — see the sales blocks. */
  totalLabel?: string;
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
            {totalLabel} <span className="tabular-nums font-semibold text-navy">{total}</span>
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
  const navigate = useNavigate();

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
  // WHICH block is open, or none. Deliberately not a boolean: "all of them at
  // once" is the state this page is not allowed to be in.
  const [openSection, setOpenSection] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const report = useDailyReport(date);
  const accounts = useBankAccounts();

  const historyFrom = addDays(date, -(HISTORY_DAYS - 1));
  const balances = useBankBalances(historyFrom, date);
  const ccLimits = useCcLimits(date, date);

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
  // ⚠ MONEY FOLLOWS THE LOCATION FILTER TOO, since 17-09-2026. It used not to:
  //   a voucher carried only its book's label, and narrowing on that would have
  //   meant parsing "O-tec — Surat". Each row now carries the location of its
  //   book from ext_company_map (toMoneyRows), so a Surat filter shows Surat's
  //   receipts rather than all five books' under a Surat heading. Delhi has no
  //   book, so it empties by construction, exactly like sales.
  const money = useMemo(
    () => (report.data?.money ?? []).filter((m) => inLocation(loc, m.location)),
    [report.data, loc],
  );

  const totals = useMemo(() => salesTotals(sales), [sales]);
  const groups = useMemo(() => groupSales(sales), [sales]);
  const received = useMemo(() => bandMoney(money, "in"), [money]);
  const paid = useMemo(() => bandMoney(money, "out"), [money]);

  /* ---- the lists behind the cards, one row per customer -------------- */
  // Company columns are taken across a whole block, so the Ink table and the
  // Print heads table put O-tec in the same place.
  const salePivots = useMemo(
    () => new Map(groups.map((g) => [g.saleType, pivotSales(g.lines)] as const)),
    [groups],
  );
  const saleCompanies = useMemo(() => pivotCompanies(...salePivots.values()), [salePivots]);
  const receivedCompanies = useMemo(() => pivotCompanies(...received.map((b) => pivotMoney(b.rows))), [received]);
  const paidCompanies = useMemo(() => pivotCompanies(...paid.map((b) => pivotMoney(b.rows))), [paid]);
  // A book missing from ext_company_map would otherwise be a column that reads
  // like a real company. Named once, above the detail, wherever it appears.
  const unmapped = useMemo(
    () => [...new Set([...saleCompanies, ...receivedCompanies, ...paidCompanies]
      .filter((c) => c.unmapped).map(companyColumnLabel))],
    [saleCompanies, receivedCompanies, paidCompanies],
  );
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

  // ⚠ EVERY LOCATION, NOT bankCols. A credit facility is sanctioned to a
  //   company, so its available balance is the whole company's cash; under a
  //   Surat filter, bankCols would make it Orange O Tec's Surat cash under the
  //   company's name. The same list goes to both exports.
  const facilityAccounts = useMemo(
    () => bankColumns(accounts.data ?? [], balances.data ?? new Map(), [date], "all"),
    [accounts.data, balances.data, date],
  );
  const facility = useMemo(
    () => facilityRows(facilityAccounts, balances.data ?? new Map(), ccLimits.data ?? new Map(), date),
    [facilityAccounts, balances.data, ccLimits.data, date],
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
      key: "sales", label: "Sales today", value: fmtMoney(totals.netLacs),
      hint: `Month to date ${fmtMoney(mtdSales)} · median day ${fmtMoney(medianDay)}`,
    },
    bankOnly ? na("Received today", "received") : {
      key: "received", label: "Received from customers", value: fmtMoney(receivedLacs),
      hint: `${fmtMoney(receivedAllLacs)} in all, including our own transfers`,
    },
    bankOnly ? na("Paid today", "paid") : {
      key: "paid", label: "Paid to suppliers", value: fmtMoney(paidLacs),
      hint: `${fmtMoney(paidAllLacs)} in all, including our own transfers`,
    },
    bankOnly ? na("Purchased today", "purchased") : {
      key: "purchased", label: "Purchased today", value: fmtMoney(purchasedLacs),
      hint: `${purchases.length} ${purchases.length === 1 ? "line" : "lines"} · net of GST`,
      onSelect: purchases.length > 0 ? () => openDetail("purchases") : undefined,
    },
    {
      key: "bank", label: "Bank balance", value: todayBankTotal.anyMissing ? "—" : fmtMoney(todayBankTotal.sum),
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
    facilityAccounts,
    ccLimits: ccLimits.data ?? new Map(),
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
      value: fmtMoney(g.revenueLacs),
      onSelect: () => openDetail(`sale-${g.saleType}`),
      action: `See the ${g.parties} ${listNoun("sales", g.parties)} behind this`,
    }));
    if (totals.returnsLacs !== 0) {
      rows.push({
        key: "returns", label: "Returns and credit notes", tone: "quiet",
        value: fmtMoney(totals.returnsLacs),
      });
    }
    if (totals.approvalLacs !== 0) {
      rows.push({
        key: "approval", label: "Out on approval", tone: "quiet",
        sub: "not counted as a sale",
        value: fmtMoney(totals.approvalLacs),
        onSelect: () => openDetail("approval"),
        action: "See what went out on approval",
      });
    }
    rows.push({ key: "total", label: "Total", tone: "rule", value: fmtMoney(totals.netLacs) });
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
  const moneyFacts = (
    bands: ReturnType<typeof bandMoney>,
    tradeLacs: number,
    allLacs: number,
    sectionId: string,
  ): Fact[] => {
    const trade = bands.filter((b) => TRADE_BANDS.includes(b.kind));
    const other = bands.filter((b) => !TRADE_BANDS.includes(b.kind));
    const row = (b: (typeof bands)[number], quiet: boolean): Fact => {
      // Counted in PARTIES, because the list behind the row is one line per party.
      const n = new Set(b.rows.map((r) => r.party)).size;
      return {
        key: b.kind,
        label: PARTY_KIND_LABEL[b.kind],
        sub: `${n} ${listNoun(b.kind, n)}`,
        tone: quiet ? "quiet" : undefined,
        value: fmtMoney(b.totalLacs),
        onSelect: () => openDetail(sectionId),
        action: `See the ${n} ${listNoun(b.kind, n)} behind this`,
      };
    };

    const rows: Fact[] = trade.map((b) => row(b, false));
    if (other.length > 0) {
      rows.push({ key: "sep", label: "Not counted in the figure above", tone: "sep", value: null });
      rows.push(...other.map((b) => row(b, true)));
      rows.push({
        key: "all", label: "Everything Tally recorded", tone: "quiet", value: fmtMoney(allLacs),
        onSelect: () => openDetail(sectionId),
        action: "See every entry",
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
          onSelect: () => navigate(`/daily-report/bank-balances?d=${date}`),
          action: `Enter or correct ${entityLabel(alias)}'s balances for ${dmy(date)}`,
          // Never a partial sum: a dash, and the tooltip names what is missing.
          value:
            t.totalLacs == null
              ? <span className="text-grey-2" title={`Not entered: ${t.missing.join(", ")}`}>—</span>
              : fmtMoney(t.totalLacs),
        };
      }),
    [bankByEntity, balances.data, date],
  );

  /**
   * Open one block, or close it again if it is the one already open.
   *
   * The scroll is deferred two frames: the block does not exist in the DOM until
   * the state change has rendered, so scrolling in the same tick finds nothing
   * and silently does nothing — which reads as a dead click.
   */
  const openDetail = (sectionId: string) => {
    setOpenSection((cur) => (cur === sectionId ? null : sectionId));
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      ),
    );
  };

  /** What the open block is called, for the line above it. */
  const sectionLabel = (id: string): string => {
    if (id === "received") return "every receipt";
    if (id === "paid") return "every payment";
    if (id === "approval") return "goods out on approval";
    if (id === "purchases") return "purchases";
    const t = id.replace(/^sale-/, "") as SaleType;
    return SALE_TYPE_LABEL[t] ? SALE_TYPE_LABEL[t].toLowerCase() : id;
  };

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

      {loading ? <KpiSkeleton /> : <KpiRow tiles={tiles} />}

      {loading && (
        <LoadingNote>
          Reading the Tally mirror — five company books, a few seconds.
        </LoadingNote>
      )}

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
            headline={fmtMoney(totals.netLacs)}
            headlineNote="net of GST"
            facts={salesFacts}
            loading={loading}
            onRow={(f) => f.onSelect?.()}
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
            headline={todayBankTotal.anyMissing ? "—" : fmtMoney(todayBankTotal.sum)}
            headlineNote={`${bankEntered} of ${bankCols.length} entered`}
            facts={bankFacts}
            loading={accounts.isLoading}
            onRow={(f) => f.onSelect?.()}
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
            headline={fmtMoney(receivedLacs)}
            headlineNote="customers and suppliers only"
            facts={moneyFacts(received, receivedLacs, receivedAllLacs, "received")}
            loading={loading}
            onRow={(f) => f.onSelect?.()}
            footer="The same basis as the sheet you circulate today. A supplier refunding us counts here too, which is why suppliers appear on both cards."
          />

          <FactCard
            title="Money out"
            headline={fmtMoney(paidLacs)}
            headlineNote="customers and suppliers only"
            facts={moneyFacts(paid, paidLacs, paidAllLacs, "paid")}
            loading={loading}
            onRow={(f) => f.onSelect?.()}
            footer="The same basis. Moving money onto our own cash-credit account, or across to another of our books, is not a payment to anyone."
          />
        </div>
      )}

      {/* ------------------------------------------------------------ bank */}
      {/* Per COMPANY, whatever the location filter, and in the client's sheet
          column order. Every figure — including the three worked out — comes
          from facilityRows, which the PDF and the workbook also call. */}
      {!accounts.isLoading && (
        <Section
          title="Bank facility"
          count="per company · ₹ lakhs"
          note={`A facility is sanctioned to a company, so this block is the same under every location filter. ${FACILITY_BALANCE_NOTE} Free limit and available CC limit are worked out, and show a dash while an input is missing — a figure computed from a blank would be confidently wrong.`}
        >
          {ccLimits.isError ? (
            <p className="px-1 py-4 text-center text-[12.5px] text-orange">
              Could not read the credit limits: {String(ccLimits.error)}
            </p>
          ) : facility.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12.5px] text-grey">
              {isSunday(date) ? `${dmy(date)} is a Sunday — the books are closed. ` : `No credit facility was recorded for ${dmy(date)}. `}
              <Link to={`/daily-report/bank-balances?d=${date}`} className="font-semibold text-orange">
                Enter it under each company on Bank balances →
              </Link>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-grey">
                    <th className="px-2 py-2 font-semibold">Company</th>
                    <th className="px-2 py-2 font-semibold">Bank</th>
                    <th className="px-2 py-2 text-right font-semibold">CC limit</th>
                    <th className="px-2 py-2 text-right font-semibold">Available balance</th>
                    <th className="px-2 py-2 text-right font-semibold">LC / BC limit</th>
                    <th className="px-2 py-2 text-right font-semibold">Utilised</th>
                    <th className="px-2 py-2 text-right font-semibold">Free limit</th>
                    <th className="px-2 py-2 text-right font-semibold">Held by bank</th>
                    <th className="px-2 py-2 text-right font-semibold">Available CC limit</th>
                  </tr>
                </thead>
                <tbody>
                  {facility.map((f) => (
                    <tr key={`${f.entityAlias}|${f.bank}`} className="border-b border-line/60 last:border-0">
                      <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-navy">{entityLabel(f.entityAlias)}</td>
                      <td className="px-2 py-1.5 text-grey">{f.bank}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtLacs(f.ccLimit)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                        {f.availableBalance == null ? (
                          <span className="text-grey-2" title={`Not entered: ${f.balanceMissing.join(", ")}`}>—</span>
                        ) : (
                          fmtLacs(f.availableBalance)
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtLacs(f.lcBcLimit)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtLacs(f.lcBcUtilised)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtLacs(f.lcBcFree)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtLacs(f.heldByBank)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmtLacs(f.availableCc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
          ⚠ ONE BLOCK AT A TIME, AND ONLY WHEN ASKED FOR.
            The first cut had a single "Show the detail" toggle that opened all
            twelve grids at once. Ritesh Bhai's word for that was "the dump",
            and he was right: clicking Print heads to see five customers
            unrolled thirty-nine ink parties, forty receipts and everything
            else beneath them. A summary row now opens ITS OWN block and
            nothing else; clicking the same row again closes it.

            Every block keeps its sort, its cascading filters and its export —
            what changed is how many of them a reader has to walk past. */}
      {!bankOnly && openSection && (
        <div ref={detailRef} className="scroll-mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-grey">
              Showing <span className="font-semibold text-navy">{sectionLabel(openSection)}</span> for {dmy(date)}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setOpenSection(null)}>Close</Button>
          </div>

          {unmapped.length > 0 && (
            <Card className="border-orange/40 p-3 text-[12.5px] text-orange">
              {unmapped.join(", ")}: a Tally book that is not in the company map, so its rows sit in a
              column of their own rather than under their company. Tag it in Outstanding Dashboard →
              Settings → Masters → Companies &amp; Locations.
            </Card>
          )}

          {openSection === "received" && (
      <Section
        title="Received"
        count={`${money.filter((m) => m.direction === "in").length} receipts`}
        total={`${fmtMoney(receivedLacs)} from customers and suppliers`}
        note={`Every receipt Tally recorded${loc === "all" ? "" : ` in ${loc}`}, one line per party, banded by what the counterparty is and folded band by band. The day total counts customers and suppliers only — the same basis as the sheet this replaces. All counterparties together come to ${fmtMoney(receivedAllLacs)}, the difference being transfers between our own accounts, inter-company movement and suspense.`}
      >
        {loading ? (
          <LoadingNote>Reading the day book…</LoadingNote>
        ) : received.length === 0 ? (
          <Nothing date={date} what="receipts" />
        ) : (
          <MoneyDetail key={`${date}|${loc}`} bands={received} companies={receivedCompanies} />
        )}
      </Section>
          )}

          {openSection === "paid" && (
      <Section
        title="Paid"
        count={`${money.filter((m) => m.direction === "out").length} payments`}
        total={`${fmtMoney(paidLacs)} to customers and suppliers`}
        note={`Every payment Tally recorded${loc === "all" ? "" : ` in ${loc}`}, one line per party, banded and folded band by band. The day total counts customers and suppliers only. All counterparties together come to ${fmtMoney(paidAllLacs)} — the rest is movement on our own cash-credit accounts and transfers between books. Purchases are a separate figure, on the Purchased tile, and are never added in here.`}
      >
        {loading ? (
          <LoadingNote>Reading the day book…</LoadingNote>
        ) : paid.length === 0 ? (
          <Nothing date={date} what="payments" />
        ) : (
          <MoneyDetail key={`${date}|${loc}`} bands={paid} companies={paidCompanies} />
        )}
      </Section>
          )}

          {openSection === "approval" && (
      <Section
        title="Out on approval"
        count={`${approvals.length} ${approvals.length === 1 ? "line" : "lines"}`}
        total={fmtMoney(approvals.reduce((s, l) => s + l.revenueLacs, 0))}
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

          {openSection === "purchases" && (
      <Section
        title="Purchases"
        count={`${purchases.length} ${purchases.length === 1 ? "line" : "lines"}`}
        total={fmtMoney(purchasedLacs)}
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
          )}

          {/* A product line opens its own customers, and — for heads and
              machines — the despatch list beside it, because "who bought" and
              "what physically left" are two different questions about the same
              goods and the sheet this replaces prints both. */}
          {SALE_TYPE_ORDER.filter((t) => openSection === `sale-${t}`).map((t) => {
            const g = groups.find((x) => x.saleType === t);
            if (!g) return null;
            const rows = salePivots.get(t) ?? [];
            const isInk = t === "ink";
            // Despatch lines for this product line — one row per thing that
            // physically left, which is a different question from who bought.
            const outwardLines =
              t === "head" || t === "machine"
                ? sales.filter((l) => l.saleType === t && saleKind(l) !== "negative")
                : [];
            return (
              <div key={t} className="space-y-3">
        <Section
          key={t}
          title={SALE_TYPE_LABEL[t]}
          count={`${rows.length} ${listNoun("sales", rows.length)} · ${isInk ? fmtKg(g.qty) : `${fmtQty(g.qty)} units`}`}
          total={fmtMoney(g.revenueLacs)}
          // ⚠ NOT THE FIGURE ON THE CARD'S TOTAL ROW, AND IT SAYS SO. This list
          //   is what SOLD; the day's sales figure is net of returns across
          //   every product line. A reader footing this TOTAL against the
          //   headline must be told why the two differ, not left to find out.
          totalLabel="sold, before returns"
          note={[
            t === "other"
              ? "These lines carry a voucher type no product-line rule covers yet. They are listed rather than dropped; add a rule on ConnectWave and they move into the section above."
              : "",
            totals.returnsLacs !== 0
              ? `The day's sales figure, ${fmtMoney(totals.netLacs)}, is net of ${fmtMoney(Math.abs(totals.returnsLacs))} of returns and credit notes across every product line.`
              : "",
            g.focQty > 0
              ? `${isInk ? fmtKg(g.focQty) : `${fmtQty(g.focQty)} units`} went free of charge: counted in quantity, never in amount, and never folded.`
              : "",
          ].filter(Boolean).join(" ") || undefined}
        >
          <PivotGrid
            key={`${date}|${loc}|${t}`}
            rows={rows}
            companies={saleCompanies}
            unit={isInk ? "kg" : "qty"}
            noun="sales"
          />
        </Section>
        {outwardLines.length > 0 && (
        <Section
          key={`${t}-outward`}
          title={`${SALE_TYPE_LABEL[t]} outward`}
          count={`${fmtQty(outwardLines.reduce((n, l) => n + l.qty, 0))} units`}
          note="What physically left the building, on an invoice (SALE) or on a delivery challan (DC)."
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
              {outwardLines.map((l) => (
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
                  {fmtQty(outwardLines.reduce((n, l) => n + l.qty, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
        )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
/** A keyed fragment, so the two-level bank header can group cells per entity. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
