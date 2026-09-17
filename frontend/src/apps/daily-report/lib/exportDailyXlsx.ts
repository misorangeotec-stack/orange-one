/**
 * Daily Report → one workbook for the day.
 *
 * Every figure here comes from `lib/aggregate.ts`, the same module the screen
 * reads. That is not tidiness: a spreadsheet emailed to a director outlives the
 * screen it came from, and a workbook that recomputed its own totals would
 * eventually disagree with the page without anyone being able to say which was
 * wrong.
 *
 * The About sheet is load-bearing for the same reason. Whoever opens this in a
 * fortnight will not have the page in front of them, so the basis of the
 * numbers travels with the file.
 */

import { exportSheetsToXlsx, GROUP_ROW_STYLE, type ExportSheet } from "@/shared/lib/exportXlsx";

/**
 * Sheets are heterogeneous by design — each carries its own row type and its
 * columns are only ever applied to its own rows. The shared helper types the
 * array the same way and for the same reason.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySheet = ExportSheet<any>;

import type { MoneyRow, PartyKind, PurchaseLine } from "../data/dailyReport";
import { PARTY_KIND_LABEL } from "../data/dailyReport";
import {
  bandMoney, cellFoc, cellFor, companyColumnLabel, entityTotal, FACILITY_BALANCE_NOTE, facilityRows,
  foldList, groupSales, pivotCompanies, pivotMoney, pivotSales, saleKind, salesTotals, tradeTotal,
  type LocationFilter, type PivotRow,
} from "./aggregate";
import { SALE_TYPE_LABEL, SALE_TYPE_ORDER } from "./saleType";
import { BASIS_NOTE, BLANK_NOTE, entityLabel, entityRank } from "./labels";
import { dmy, isSunday, longDate } from "./format";
import type { BankAccount, BankBalance, CcLimit } from "../types";
import type { SaleLine } from "../data/dailyReport";

export interface DailyXlsxInput {
  date: string;
  loc: LocationFilter;
  sales: SaleLine[];
  money: MoneyRow[];
  purchases: PurchaseLine[];
  accounts: BankAccount[];
  balances: Map<string, BankBalance>;
  /**
   * EVERY account, whatever the location filter — the credit facility is per
   * company, so its available balance must not shrink to one location's cash.
   */
  facilityAccounts: BankAccount[];
  /** The day's stored credit-limit blocks, sparse. */
  ccLimits: Map<string, CcLimit>;
  /** Oldest first — the same window the screen's grid shows. */
  dates: string[];
  mtdSalesLacs: number;
  /** Books whose register could not be read, if any. */
  rulesLoaded: boolean;
}

const lacs = (n: number) => Number(n.toFixed(2));

/**
 * Receipts or payments, VOUCHER BY VOUCHER, banded.
 *
 * The screen and the PDF now show one line per party; this sheet is where the
 * voucher numbers, voucher types and books still live, so nothing the old
 * tables showed is lost. Rows arrive grouped by counterparty band, trade first,
 * and the preamble carries each band's total above the header.
 */
const voucherSheet = (
  rows: MoneyRow[],
  direction: "in" | "out",
  sheetName: string,
  dateIso: string,
): ExportSheet<MoneyRow> => {
  const bands = bandMoney(rows, direction);
  return {
    sheetName,
    rows: bands.flatMap((b) => b.rows),
    columns: [
      { header: "Counterparty", width: 16, value: (r) => PARTY_KIND_LABEL[r.kind] },
      { header: "Party", width: 46, value: (r) => r.party },
      { header: "Company", width: 14, value: (r) => r.entity || "Unmapped" },
      { header: "Location", width: 10, value: (r) => r.location },
      { header: "Book", width: 22, value: (r) => r.company ?? "" },
      { header: "Voucher type", width: 20, value: (r) => r.voucherType ?? "" },
      { header: "Voucher no.", width: 18, value: (r) => r.voucherNo ?? "" },
      { header: "Amount (₹ L)", width: 14, value: (r) => lacs(r.amountLacs) },
    ],
    preamble: [
      [`${sheetName} — ${dmy(dateIso)}`],
      ...bands.map((b) => [PARTY_KIND_LABEL[b.kind], lacs(b.totalLacs)]),
      ["All counterparties", lacs(bands.reduce((s, b) => s + b.totalLacs, 0))],
      [],
    ],
  };
};

/**
 * Receipts or payments, ONE LINE PER PARTY, with the companies across the top —
 * the same shape as the screen and the PDF, but every party listed.
 *
 * ⚠ THE TOTALS ARE IN THE PREAMBLE, NOT IN A ROW. The sheet carries an
 *   autofilter; a TOTAL written as a data row is sorted into the middle of the
 *   list and hidden by the first filter, which is the very thing this workbook
 *   is for.
 */
const partySheet = (
  rows: MoneyRow[],
  direction: "in" | "out",
  sheetName: string,
  dateIso: string,
): ExportSheet<{ kind: PartyKind; row: PivotRow }> => {
  const bands = bandMoney(rows, direction).map((b) => ({ band: b, rows: pivotMoney(b.rows) }));
  const companies = pivotCompanies(...bands.map((b) => b.rows));
  const trade = tradeTotal(bands.map((b) => b.band));
  return {
    sheetName,
    rows: bands.flatMap((b) => b.rows.map((row) => ({ kind: b.band.kind, row }))),
    columns: [
      { header: "Counterparty", width: 16, value: (r) => PARTY_KIND_LABEL[r.kind] },
      { header: "Party", width: 46, value: (r) => r.row.party },
      ...companies.map((co) => ({
        header: `${companyColumnLabel(co)} (₹ L)`, width: 16,
        value: (r: { row: PivotRow }) => (r.row.cells[co.alias] ? lacs(r.row.cells[co.alias].amountLacs) : ""),
      })),
      { header: "Total (₹ L)", width: 14, value: (r) => lacs(r.row.amountLacs) },
      { header: "Entries", width: 9, value: (r) => r.row.entries },
    ],
    preamble: [
      [`${sheetName} — ${dmy(dateIso)} — one line per party`],
      ["Customers and suppliers (the headline figure)", lacs(trade)],
      ...bands.map((b) => [`${PARTY_KIND_LABEL[b.band.kind]} — ${b.rows.length} ${b.rows.length === 1 ? "party" : "parties"}`, lacs(b.band.totalLacs)]),
      ["All counterparties", lacs(bands.reduce((s, b) => s + b.band.totalLacs, 0))],
      [],
    ],
  };
};

export async function exportDailyReportXlsx(d: DailyXlsxInput): Promise<void> {
  const totals = salesTotals(d.sales);
  const groups = groupSales(d.sales);
  const received = bandMoney(d.money, "in");
  const paid = bandMoney(d.money, "out");
  const bankCols = d.accounts;

  /* ---- Summary --------------------------------------------------------- */
  interface SummaryRow { label: string; value: number | string; note: string }
  const summary: SummaryRow[] = [
    { label: "Sales (net of returns, excludes goods on approval)", value: Number(totals.netLacs.toFixed(2)), note: "₹ lakhs" },
    { label: "  of which returns and credit notes", value: Number(totals.returnsLacs.toFixed(2)), note: "already deducted above" },
    { label: "Goods out on approval (not a sale)", value: Number(totals.approvalLacs.toFixed(2)), note: "shown for completeness" },
    // Trade first, because that is the headline the report quotes; the full
    // figure follows it rather than replacing it.
    { label: "Received from customers and suppliers", value: Number(tradeTotal(received).toFixed(2)), note: "the basis the old sheet used" },
    ...received.map((b) => ({ label: `  ${PARTY_KIND_LABEL[b.kind]}`, value: Number(b.totalLacs.toFixed(2)), note: "" })),
    { label: "Received — all counterparties", value: Number(received.reduce((s, b) => s + b.totalLacs, 0).toFixed(2)), note: "includes our own transfers and inter-company" },
    { label: "Paid to suppliers", value: Number(tradeTotal(paid).toFixed(2)), note: "the basis the old sheet used" },
    ...paid.map((b) => ({ label: `  ${PARTY_KIND_LABEL[b.kind]}`, value: Number(b.totalLacs.toFixed(2)), note: "" })),
    { label: "Paid — all counterparties", value: Number(paid.reduce((s, b) => s + b.totalLacs, 0).toFixed(2)), note: "includes our own transfers and inter-company" },
    { label: "Purchased", value: Number(d.purchases.reduce((s, p) => s + p.amountLacs, 0).toFixed(2)), note: "net of GST" },
    { label: "Month to date — sales", value: Number(d.mtdSalesLacs.toFixed(2)), note: "same rule as the day figure" },
    ...groups.map((g) => ({
      label: `Sales — ${SALE_TYPE_LABEL[g.saleType]}`,
      value: Number(g.revenueLacs.toFixed(2)),
      note: g.saleType === "ink" ? `${Math.round(g.qty)} kg` : `${g.qty} units`,
    })),
  ];

  const sheets: AnySheet[] = [];

  sheets.push({
    sheetName: "Summary",
    rows: summary,
    columns: [
      { header: "Figure", width: 52, value: (r) => r.label },
      { header: "₹ lakhs", width: 14, value: (r) => r.value },
      { header: "Note", width: 40, value: (r) => r.note },
    ],
    // A total row band on the two headline lines, so the eye lands on them.
    rowStyle: (r) => (r.label.startsWith("  ") ? undefined : GROUP_ROW_STYLE),
    preamble: [
      [`Daily Report — ${longDate(d.date)}`],
      [d.loc === "all" ? "All locations" : `${d.loc} only`],
      [BASIS_NOTE],
      [],
    ],
  });

  /* ---- one sheet per product line -------------------------------------- */
  //
  // ⚠ EVERY CUSTOMER, UNFOLDED (decided 17-09-2026). The screen and the PDF fold
  //   a long list to the customers making up 80% of it; this workbook is where
  //   finance filters and pivots, so it lists them all, in the same shape — one
  //   row per customer, the companies across the top — with the TOTAL in the
  //   preamble, where a filter cannot hide it.
  const salePivots = new Map(groups.map((g) => [g.saleType, pivotSales(g.lines)] as const));
  const saleCompanies = pivotCompanies(...salePivots.values());
  for (const t of SALE_TYPE_ORDER) {
    const g = groups.find((x) => x.saleType === t);
    if (!g) continue;
    const fold = foldList(salePivots.get(t) ?? []);
    const unit = t === "ink" ? "kg" : "Qty";
    sheets.push({
      // Excel caps a tab name at 31 characters.
      sheetName: SALE_TYPE_LABEL[t].slice(0, 31),
      rows: fold.all,
      columns: [
        { header: "Customer", width: 46, value: (r: PivotRow) => r.party },
        ...saleCompanies.flatMap((co) => [
          { header: `${companyColumnLabel(co)} ${unit}`, width: 14, value: (r: PivotRow) => r.cells[co.alias]?.qty ?? "" },
          {
            header: `${companyColumnLabel(co)} (₹ L)`, width: 16,
            // A cell that went entirely free has quantity and no money. Writing
            // 0.00 would read as a real zero-value sale; the word does not.
            value: (r: PivotRow) => {
              const c = r.cells[co.alias];
              return !c ? "" : cellFoc(c) === "all" ? "FOC" : lacs(c.amountLacs);
            },
          },
        ]),
        { header: `Total ${unit}`, width: 12, value: (r: PivotRow) => r.qty },
        { header: "Total (₹ L)", width: 14, value: (r: PivotRow) => lacs(r.amountLacs) },
        { header: `Free of charge ${unit}`, width: 16, value: (r: PivotRow) => (r.focQty > 0 ? r.focQty : "") },
      ],
      preamble: [
        [`${SALE_TYPE_LABEL[t]} — ${dmy(d.date)} — what sold, before returns, every customer`],
        [`TOTAL — ${fold.all.length} customers`, `${Math.round(fold.total.qty * 1000) / 1000} ${t === "ink" ? "kg" : "units"}`, lacs(fold.total.amountLacs)],
        ...(fold.total.focQty > 0
          ? [["of which free of charge", `${Math.round(fold.total.focQty * 1000) / 1000} ${t === "ink" ? "kg" : "units"}`, "counted in quantity, never in amount"]]
          : []),
        [],
      ],
    });
  }

  /* ---- head and machine movement, as the old sheet printed it ----------- */
  const outward = d.sales.filter(
    (l) => (l.saleType === "head" || l.saleType === "machine") && saleKind(l) !== "negative",
  );
  if (outward.length > 0) {
    sheets.push({
      sheetName: "Outward",
      rows: outward,
      // Annotated because AnySheet's row type is `any`, and an unannotated `l`
      // then indexes SALE_TYPE_LABEL with an implicit any.
      columns: [
        { header: "Particular", width: 62, value: (l: SaleLine) => `${l.party}_${l.item}` },
        { header: "Product line", width: 14, value: (l: SaleLine) => SALE_TYPE_LABEL[l.saleType] },
        { header: "Type", width: 8, value: (l: SaleLine) => l.paper },
        { header: "Entity", width: 34, value: (l: SaleLine) => entityLabel(l.company) },
        { header: "Qty", width: 10, value: (l: SaleLine) => l.qty },
      ],
    });
  }

  /* ---- money, in the same order as the PDF: in, then out ---------------- */
  sheets.push(partySheet(d.money, "in", "Receipts", d.date));
  sheets.push(voucherSheet(d.money, "in", "Receipt vouchers", d.date));
  sheets.push(partySheet(d.money, "out", "Payments", d.date));
  sheets.push(voucherSheet(d.money, "out", "Payment vouchers", d.date));

  if (d.purchases.length > 0) {
    sheets.push({
      sheetName: "Purchases",
      rows: d.purchases,
      columns: [
        { header: "Supplier", width: 46, value: (p) => p.party },
        { header: "Item", width: 46, value: (p) => p.item },
        { header: "Stock group", width: 28, value: (p) => p.stockGroup ?? "" },
        { header: "Entity", width: 34, value: (p) => entityLabel(p.company) },
        { header: "Qty", width: 12, value: (p) => p.qty },
        { header: "Unit", width: 8, value: (p) => p.unit ?? "" },
        { header: "Amount (₹ L)", width: 14, value: (p) => Number(p.amountLacs.toFixed(2)) },
      ],
    });
  }

  /* ---- bank facility ---------------------------------------------------- */
  // Per company, from every account — never the location-filtered bankCols.
  const facility = facilityRows(d.facilityAccounts, d.balances, d.ccLimits, d.date);
  if (facility.length > 0) {
    // A dash, never 0: a blank figure written as zero reads as a withdrawn limit
    // in a file somebody sums.
    const blank = (n: number | null) => (n == null ? "—" : Number(n.toFixed(2)));
    sheets.push({
      sheetName: "Bank facility",
      rows: facility,
      // The client's sheet column order.
      columns: [
        { header: "Company", width: 34, value: (f) => entityLabel(f.entityAlias) },
        { header: "Bank", width: 10, value: (f) => f.bank },
        { header: "CC limit (₹ L)", width: 14, value: (f) => blank(f.ccLimit) },
        { header: "Available balance (₹ L)", width: 22, value: (f) => blank(f.availableBalance) },
        { header: "LC / BC limit (₹ L)", width: 18, value: (f) => blank(f.lcBcLimit) },
        { header: "Utilised (₹ L)", width: 14, value: (f) => blank(f.lcBcUtilised) },
        { header: "Free limit (₹ L)", width: 16, value: (f) => blank(f.lcBcFree) },
        { header: "Held by bank (₹ L)", width: 18, value: (f) => blank(f.heldByBank) },
        { header: "Available CC limit (₹ L)", width: 22, value: (f) => blank(f.availableCc) },
      ],
      preamble: [
        [`Bank facility — ${dmy(d.date)}`],
        ["Per company, whatever the location filter. Free limit = LC / BC limit − utilised. Available CC limit = CC limit − held by bank."],
        [FACILITY_BALANCE_NOTE],
        [],
      ],
    });
  }

  /* ---- the balance matrix ----------------------------------------------- */
  const byEntity = new Map<string, BankAccount[]>();
  for (const a of bankCols) {
    const list = byEntity.get(a.entityAlias) ?? [];
    list.push(a);
    byEntity.set(a.entityAlias, list);
  }
  const entities = [...byEntity.entries()].sort((x, y) => entityRank(x[0]) - entityRank(y[0]));

  interface MatrixRow { iso: string; cells: (number | string)[] }
  const matrixRows: MatrixRow[] = [...d.dates].reverse().map((iso) => {
    const cells: (number | string)[] = [];
    for (const [, rows] of entities) {
      for (const a of rows) {
        const c = cellFor(a, d.balances, iso);
        // The three states survive into Excel as three different cell values —
        // a number, a dash, or the word. Writing 0 for a day nobody recorded
        // would understate cash in a file somebody sums.
        cells.push(c.kind === "value" ? Number(c.lacs.toFixed(2)) : c.kind === "closed" ? "closed" : "—");
      }
      const t = entityTotal(rows, d.balances, iso);
      cells.push(t.totalLacs == null ? "—" : Number(t.totalLacs.toFixed(2)));
    }
    return { iso, cells };
  });

  const matrixCols = [
    { header: "Date", width: 14, value: (r: MatrixRow) => dmy(r.iso) + (isSunday(r.iso) ? " (Sun)" : "") },
    ...entities.flatMap(([alias, rows]) => [
      ...rows.map((a, i) => ({
        header: `${entityLabel(alias)} — ${a.name}`,
        width: 16,
        value: (r: MatrixRow) => r.cells[colIndex(entities, alias, i)],
      })),
      {
        header: `${entityLabel(alias)} — TOTAL`,
        width: 16,
        value: (r: MatrixRow) => r.cells[colIndex(entities, alias, rows.length)],
      },
    ]),
  ];

  sheets.push({
    sheetName: "Bank balances",
    rows: matrixRows,
    columns: matrixCols,
    // The date column must survive scrolling to the eleventh account — the one
    // case the opt-in pane fix in exportXlsx exists for.
    freezeCols: 1,
  });

  await exportSheetsToXlsx({
    fileName: `Daily_Report_${dmy(d.date)}`,
    title: `Daily Report — ${longDate(d.date)}`,
    sheets,
    filters: [d.loc === "all" ? "All locations" : `Location: ${d.loc}`],
    notes: [
      BASIS_NOTE,
      BLANK_NOTE,
      "Outward includes delivery challans, which move goods but are not invoices. The Type column says SALE or DC.",
      "Goods out on approval are shown on the Summary but NOT counted as sales.",
      "Goods sent free of charge count in quantity, never in amount. A company cell that went entirely free says FOC.",
      "The product-line sheets and the Receipts and Payments sheets list EVERY customer, one row per customer with the companies across the top. The screen and the PDF fold a list of more than 10 to the customers making up 80% of it; this workbook does not. Totals sit above each header so a filter cannot hide them.",
      "The headline received and paid figures count CUSTOMERS AND SUPPLIERS ONLY, the same basis as the sheet this replaces. Every other counterparty — transfers between our own accounts, inter-company movement, cash and suspense — is listed and totalled separately on the Receipts and Payments sheets. The voucher-by-voucher detail is on Receipt vouchers and Payment vouchers.",
      ...(d.rulesLoaded
        ? []
        : ["⚠ The product-line rules could not be read, so every sale is filed under Not yet classified. The amounts are still correct."]),
    ],
  });
}

/** Flat index of an entity's nth cell inside the matrix row. */
function colIndex(entities: [string, BankAccount[]][], alias: string, n: number): number {
  let i = 0;
  for (const [a, rows] of entities) {
    if (a === alias) return i + n;
    i += rows.length + 1;
  }
  return i + n;
}
