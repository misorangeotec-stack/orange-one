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

import type { MoneyRow, PurchaseLine } from "../data/dailyReport";
import { PARTY_KIND_LABEL } from "../data/dailyReport";
import {
  bandMoney, byParty, cellFor, entityTotal, facilityRows, groupSales, saleKind, salesTotals,
  tradeTotal,
  type LocationFilter,
} from "./aggregate";
import { SALE_TYPE_LABEL, SALE_TYPE_ORDER } from "./saleType";
import { BASIS_NOTE, BLANK_NOTE, entityLabel, entityRank } from "./labels";
import { dmy, isSunday, longDate } from "./format";
import type { BankAccount, BankBalance } from "../types";
import type { SaleLine } from "../data/dailyReport";

export interface DailyXlsxInput {
  date: string;
  loc: LocationFilter;
  sales: SaleLine[];
  money: MoneyRow[];
  purchases: PurchaseLine[];
  accounts: BankAccount[];
  balances: Map<string, BankBalance>;
  /** Oldest first — the same window the screen's grid shows. */
  dates: string[];
  mtdSalesLacs: number;
  /** Books whose register could not be read, if any. */
  rulesLoaded: boolean;
}

/**
 * Receipts or payments, banded.
 *
 * Rows arrive grouped by counterparty band, trade first, and the preamble
 * carries each band's total above the header — so a reader who only wants "what
 * did customers actually pay us" has it without filtering.
 */
const moneySheet = (
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
      { header: "Book", width: 22, value: (r) => r.company ?? "" },
      { header: "Voucher type", width: 20, value: (r) => r.voucherType ?? "" },
      { header: "Voucher no.", width: 18, value: (r) => r.voucherNo ?? "" },
      { header: "Amount (₹ L)", width: 14, value: (r) => Number(r.amountLacs.toFixed(2)) },
    ],
    preamble: [
      [`${sheetName} — ${dmy(dateIso)}`],
      ...bands.map((b) => [PARTY_KIND_LABEL[b.kind], Number(b.totalLacs.toFixed(2))]),
      ["All counterparties", Number(bands.reduce((s, b) => s + b.totalLacs, 0).toFixed(2))],
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

  sheets.push(moneySheet(d.money, "in", "Receipts", d.date));
  sheets.push(moneySheet(d.money, "out", "Payments", d.date));

  /* ---- one sheet per product line -------------------------------------- */
  for (const t of SALE_TYPE_ORDER) {
    const g = groups.find((x) => x.saleType === t);
    if (!g) continue;
    const rows = byParty(g.lines);
    sheets.push({
      // Excel caps a tab name at 31 characters.
      sheetName: SALE_TYPE_LABEL[t].slice(0, 31),
      rows,
      columns: [
        { header: "Party", width: 46, value: (r) => r.party },
        { header: "Entity", width: 34, value: (r) => entityLabel(r.company) },
        { header: "Location", width: 12, value: (r) => r.location },
        { header: t === "ink" ? "Qty (kg)" : "Qty", width: 12, value: (r) => r.qty },
        // A free-of-charge party has quantity and no money. Writing 0.00 into a
        // money column would read as a real zero-value sale; the word does not.
        { header: "Amount (₹ L)", width: 14, value: (r) => (r.foc ? "FOC" : Number(r.revenueLacs.toFixed(2))) },
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
  const facility = facilityRows(bankCols, d.balances, d.date);
  if (facility.length > 0) {
    const blank = (n: number | null) => (n == null ? "—" : Number(n.toFixed(2)));
    sheets.push({
      sheetName: "Bank facility",
      rows: facility,
      columns: [
        { header: "Account", width: 18, value: (f) => f.account.name },
        { header: "Entity", width: 34, value: (f) => entityLabel(f.account.entityAlias) },
        { header: "CC limit", width: 12, value: (f) => blank(f.ccLimit) },
        { header: "Held by bank", width: 14, value: (f) => blank(f.heldByBank) },
        { header: "Available CC", width: 14, value: (f) => blank(f.availableCc) },
        { header: "LC / BC limit", width: 14, value: (f) => blank(f.lcBcLimit) },
        { header: "Utilised", width: 12, value: (f) => blank(f.lcBcUtilised) },
        { header: "Free limit", width: 12, value: (f) => blank(f.lcBcFree) },
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
      "Goods out on approval are listed but NOT counted as sales.",
      "The headline received and paid figures count CUSTOMERS AND SUPPLIERS ONLY, the same basis as the sheet this replaces. Every other counterparty — transfers between our own accounts, inter-company movement, cash and suspense — is listed and totalled separately on the Receipts and Payments sheets.",
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
