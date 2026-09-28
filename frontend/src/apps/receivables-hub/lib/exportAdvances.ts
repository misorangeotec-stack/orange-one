import * as XLSX from "xlsx-js-style";
import { GRAND_TOTAL_STYLE, HEADER_STYLE, SUBTOTAL_STYLE, styleRow } from "./xlsxStyle";
import { formatDateDMY } from "./utils";
import { groupBySalesperson, type AdvanceRow, type Explanation } from "./advancesReport";
import type { SuspenseReceipt } from "./suspenseReceipts";

/**
 * The Advances Not Applied workbook (RC-18) — the rows the viewer is looking at, filters applied.
 *
 *   Advances       one row per customer, grouped by salesperson with a subtotal per group
 *   Entries        what makes up each customer's figure, one line each; a customer's lines sum to
 *                  its Unapplied credit on the Advances sheet, to the paisa
 *   Related party  the group-company ledgers, kept out of the Advances total exactly as on screen
 *   Suspense       receipts into the SUSPENSE ledgers, which name no customer
 *
 * Amounts keep their paise: ₹0.50 is real money on two ledgers, and a rounded workbook would not add
 * up to the screen.
 */

export interface AdvancesExportInput {
  asOfIso: string;
  asOnLabel: string;
  /** Filtered and sorted, as the grids show them. */
  main: AdvanceRow[];
  related: AdvanceRow[];
  grouped: boolean;
  explanations: Map<string, Explanation>;
  /** null when the suspense receipts could not be read. */
  suspense: SuspenseReceipt[] | null;
  suspenseError?: string;
}

const paise = (n: number) => Math.round(n * 100) / 100;

const DEFINITION =
  "Unapplied credit = money a customer has paid that no open invoice has absorbed: received with no bill " +
  "named (Tagged to no bill), plus credit sitting on a named reference such as an advance (On a named ref). " +
  "It is NOT capped at overdue, so it is larger than the Collection Report's On Account, which counts only " +
  "the part that offsets overdue — that figure is the last column. Live from Tally as on the date above.";

const CUSTOMER_HEADER = [
  "Salesperson", "Customer", "Company", "Location", "Collection team",
  "Unapplied credit", "Tagged to no bill", "of which manual Other Payment", "On a named ref",
  "Named in Tally", "₹ named in Tally", "Open bills", "Pending on open bills", "Outstanding",
  "On Account (Collection Report)",
];
const MONEY_FROM = 5;

function customerRow(r: AdvanceRow, e: Explanation | undefined): (string | number)[] {
  return [
    r.salesPerson || "—", r.customer, r.company, r.location, r.collectionTeam || "—",
    paise(r.unapplied), paise(r.untagged), paise(r.manual), paise(r.namedRef),
    e?.status ?? "", paise(e?.namedInTally ?? 0), r.openBills.length, paise(r.openPending),
    paise(r.outstanding), paise(r.onAccount),
  ];
}

function totalsRow(label: string, rows: AdvanceRow[], explanations: Map<string, Explanation>): (string | number)[] {
  const sum = (get: (r: AdvanceRow) => number) => paise(rows.reduce((s, r) => s + get(r), 0));
  return [
    label, "", "", "", "",
    sum((r) => r.unapplied), sum((r) => r.untagged), sum((r) => r.manual), sum((r) => r.namedRef),
    "", sum((r) => explanations.get(r.ledgerId)?.namedInTally ?? 0), sum((r) => r.openBills.length),
    sum((r) => r.openPending), sum((r) => r.outstanding), sum((r) => r.onAccount),
  ];
}

/** A customer sheet: title, definition, header, rows (grouped or not), grand total. */
function customerSheet(
  title: string, note: string, rows: AdvanceRow[], grouped: boolean, explanations: Map<string, Explanation>,
): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [[title], [note], [], CUSTOMER_HEADER];
  const subtotalAt: number[] = [];
  if (grouped) {
    for (const g of groupBySalesperson(rows)) {
      for (const r of g.rows) aoa.push(customerRow(r, explanations.get(r.ledgerId)));
      subtotalAt.push(aoa.length);
      aoa.push(totalsRow(`Subtotal — ${g.name} (${g.rows.length} customer${g.rows.length === 1 ? "" : "s"})`, g.rows, explanations));
    }
  } else {
    for (const r of rows) aoa.push(customerRow(r, explanations.get(r.ledgerId)));
  }
  aoa.push(totalsRow(`Total (${rows.length} customer${rows.length === 1 ? "" : "s"})`, rows, explanations));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 16 }, { wch: 36 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    { wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 18 },
  ];
  styleRow(ws, 0, CUSTOMER_HEADER.length, HEADER_STYLE);
  styleRow(ws, 3, CUSTOMER_HEADER.length, HEADER_STYLE);
  for (const r of subtotalAt) styleRow(ws, r, CUSTOMER_HEADER.length, SUBTOTAL_STYLE);
  styleRow(ws, aoa.length - 1, CUSTOMER_HEADER.length, GRAND_TOTAL_STYLE);
  moneyFormat(ws, 4, aoa.length - 1, MONEY_FROM, CUSTOMER_HEADER.length - 1, [11]);
  return ws;
}

/** Two-decimal number format on a block of cells, except integer columns. */
function moneyFormat(ws: XLSX.WorkSheet, r0: number, r1: number, c0: number, c1: number, intCols: number[] = []) {
  const sheet = ws as Record<string, { t?: string; z?: string }>;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t === "n") cell.z = intCols.includes(c) ? "#,##0" : "#,##0.00";
    }
  }
}

export function exportAdvancesXlsx(input: AdvancesExportInput): void {
  const { asOnLabel, main, related, grouped, explanations, suspense } = input;
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, customerSheet(
    `Advances Not Applied — as on ${asOnLabel}${grouped ? " (grouped by salesperson)" : ""}`,
    `${DEFINITION} Related-party ledgers and suspense receipts are on their own sheets and are not in this total.`,
    main, grouped, explanations,
  ), "Advances");

  // ── Entries: what makes up each figure ──
  const eHeader = ["Section", "Salesperson", "Customer", "Company", "Location", "Part", "Date", "Entry", "Amount"];
  const eAoa: (string | number)[][] = [
    [`Advances Not Applied — what makes up each figure, as on ${asOnLabel}`],
    [
      "One line per voucher Tally holds behind the money tagged to no bill, plus one labelled line for whatever " +
      "those vouchers do not explain (usually an opening balance keyed with no bill breakup), plus each credit " +
      "sitting on a named reference. A customer's lines add up to its Unapplied credit on the Advances sheet.",
    ],
    [],
    eHeader,
  ];
  let entriesTotal = 0;
  for (const [section, rows] of [["Customers", main], ["Related party", related]] as const) {
    for (const r of rows) {
      for (const l of explanations.get(r.ledgerId)?.lines ?? []) {
        eAoa.push([
          section, r.salesPerson || "—", r.customer, r.company, r.location,
          l.kind === "namedRef" ? "On a named ref" : "Tagged to no bill",
          l.date ? formatDateDMY(l.date) : "", l.label, paise(l.amount),
        ]);
        entriesTotal += l.amount;
      }
    }
  }
  eAoa.push(["Total (customers and related party)", "", "", "", "", "", "", "", paise(entriesTotal)]);
  const ews = XLSX.utils.aoa_to_sheet(eAoa);
  ews["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 34 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 12 }, { wch: 70 }, { wch: 16 }];
  styleRow(ews, 0, eHeader.length, HEADER_STYLE);
  styleRow(ews, 3, eHeader.length, HEADER_STYLE);
  styleRow(ews, eAoa.length - 1, eHeader.length, GRAND_TOTAL_STYLE);
  moneyFormat(ews, 4, eAoa.length - 1, 8, 8);
  XLSX.utils.book_append_sheet(wb, ews, "Entries");

  XLSX.utils.book_append_sheet(wb, customerSheet(
    `Related party — group-company balances, as on ${asOnLabel}`,
    `Ledgers whose salesperson is RELATED PARTY. Not a customer advance, and not in the Advances total. ${DEFINITION}`,
    related, false, explanations,
  ), "Related party");

  // ── Suspense ──
  const sHeader = ["Date", "Company", "Location", "Tally book", "Ledger", "Voucher type", "Voucher no.", "Narration", "Amount"];
  const sAoa: (string | number)[][] = [
    [`Suspense — receipts that name no customer, as on ${asOnLabel}`],
    [
      "Money received into a SUSPENSE ledger, in every Tally book including closed financial years. Money in only: " +
      "the debit balances on the suspense ledgers are payments and opening entries, not advances.",
    ],
    [],
    sHeader,
  ];
  if (suspense) {
    for (const s of suspense) {
      sAoa.push([
        s.date ? formatDateDMY(s.date) : "", s.company, s.location, s.book, s.ledger, s.voucherType,
        s.voucherNo ?? "", s.narration ?? "", paise(s.amount),
      ]);
    }
    sAoa.push([`Total (${suspense.length} receipt${suspense.length === 1 ? "" : "s"})`, "", "", "", "", "", "", "",
      paise(suspense.reduce((t, s) => t + s.amount, 0))]);
  } else {
    sAoa.push([`The suspense receipts could not be read${input.suspenseError ? `: ${input.suspenseError}` : ""}.`]);
  }
  const sws = XLSX.utils.aoa_to_sheet(sAoa);
  sws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 44 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 70 }, { wch: 14 }];
  styleRow(sws, 0, sHeader.length, HEADER_STYLE);
  styleRow(sws, 3, sHeader.length, HEADER_STYLE);
  if (suspense) {
    styleRow(sws, sAoa.length - 1, sHeader.length, GRAND_TOTAL_STYLE);
    moneyFormat(sws, 4, sAoa.length - 1, 8, 8);
  }
  XLSX.utils.book_append_sheet(wb, sws, "Suspense");

  XLSX.writeFile(wb, `advances-not-applied-${input.asOfIso || "today"}.xlsx`);
}
