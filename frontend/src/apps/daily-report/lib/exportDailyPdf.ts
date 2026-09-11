/**
 * The Daily Report, as a document.
 *
 * This is the thing that gets forwarded. It is drawn vectorially through the
 * shared pdfBrand primitives rather than rasterised, so the text stays
 * selectable and the type stays crisp when a director zooms in on a phone.
 *
 * THREE ENTRY POINTS, AND THE THIRD IS THE POINT.
 *   `dailyReportPdfBlob` exists from day one even though nothing calls it yet.
 *   Phase 2 emails this document every evening; having the Blob boundary already
 *   drawn is what makes that a backend job rather than a rewrite of this file.
 *
 * Every figure comes from `lib/aggregate.ts` — the same module the screen reads.
 * A document that recomputed its own totals would eventually disagree with the
 * page it claims to be a copy of.
 */

import jsPDF from "jspdf";
import {
  CONTENT_W, MARGIN, PAGE_H,
  drawTable, footer, headerBand, loadBrandAssets, metaStrip, noteBlock, noteBlockHeight,
  pageWash, registerBrandFonts, sectionHeading, statCard,
  type Ctx,
} from "@/shared/lib/pdfBrand";
import { formatDateTime } from "@/shared/lib/time";

import { PARTY_KIND_LABEL } from "../data/dailyReport";
import type { MoneyRow } from "../data/dailyReport";
import {
  bandMoney, byParty, cellFor, entityTotal, facilityRows, groupSales, saleKind, salesTotals,
  tradeTotal,
  type PartyTotal,
} from "./aggregate";
import { SALE_TYPE_LABEL, SALE_TYPE_ORDER } from "./saleType";
import { BASIS_NOTE, BLANK_NOTE, entityLabel, entityRank } from "./labels";
import { dmy, fmtLacs, fmtMoney, isSunday, longDate, shortDay } from "./format";
import type { DailyXlsxInput } from "./exportDailyXlsx";

/** The same input the workbook takes — one shape, one set of figures. */
export type DailyPdfInput = DailyXlsxInput;

const money = (n: number | null | undefined) => (n == null ? "—" : fmtLacs(n));

/** "Tuesday" — the long date's weekday alone, for the meta strip's note line. */
const weekday = (iso: string) => longDate(iso).split(",")[0];

export async function buildDailyReportPdf(d: DailyPdfInput): Promise<jsPDF> {
  const assets = await loadBrandAssets();
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  registerBrandFonts(pdf, assets);
  const ctx: Ctx = { pdf, assets, totalPagesToken: "{tp}" };
  const generatedAt = formatDateTime(new Date().toISOString());
  const note = `${d.loc === "all" ? "All locations" : d.loc} · sales net of GST`;

  let page = 1;
  const newPage = (): number => {
    footer(ctx, page, generatedAt, note);
    pdf.addPage();
    page += 1;
    pageWash(pdf);
    return headerBand(ctx, { tag: "Daily Report", compact: true, note }) + 14;
  };

  pageWash(pdf);
  let y = headerBand(ctx, { tag: "Daily Report", note }) + 16;

  /* ---- what this is, and on what basis ---------------------------------- */
  y = metaStrip(pdf, MARGIN, y, CONTENT_W, [
    // The full "Tuesday, 8 September 2026" does not fit a quarter-width meta
    // cell, and metaStrip ellipsizes: it printed "Tuesday, 8 September…", losing
    // the year. The weekday moves to the note line, where it has room.
    { label: "Report date", value: dmy(d.date), note: weekday(d.date) },
    { label: "Location", value: d.loc === "all" ? "All" : d.loc,
      note: d.loc === "Delhi" ? "banking only — no Tally book" : undefined },
    { label: "Sales basis", value: "Net of GST", note: "taxable value" },
    { label: "Amounts", value: "₹ lakhs", note: "unless a unit is shown" },
  ]) + 14;

  /* ---- the five headline figures ---------------------------------------- */
  const totals = salesTotals(d.sales);
  const received = bandMoney(d.money, "in");
  const paid = bandMoney(d.money, "out");
  // Trade only on the cards, matching the screen. The full figure is the card's
  // own sub-line and every band's subtotal is in the table below.
  const receivedLacs = tradeTotal(received);
  const paidLacs = tradeTotal(paid);
  const receivedAllLacs = received.reduce((s, b) => s + b.totalLacs, 0);
  const paidAllLacs = paid.reduce((s, b) => s + b.totalLacs, 0);
  const purchasedLacs = d.purchases.reduce((s, p) => s + p.amountLacs, 0);

  const byEntity = new Map<string, typeof d.accounts>();
  for (const a of d.accounts) {
    const list = byEntity.get(a.entityAlias) ?? [];
    list.push(a);
    byEntity.set(a.entityAlias, list);
  }
  const entities = [...byEntity.entries()].sort((x, y2) => entityRank(x[0]) - entityRank(y2[0]));

  let bankSum = 0;
  let bankIncomplete = false;
  for (const [, rows] of entities) {
    const t = entityTotal(rows, d.balances, d.date);
    if (t.totalLacs == null) bankIncomplete = true;
    else bankSum += t.totalLacs;
  }
  const entered = d.accounts.filter((a) => d.balances.has(`${a.id}|${d.date}`)).length;

  const cards = [
    { label: "Sales today", value: fmtMoney(totals.netLacs), sub: `MTD ${fmtMoney(d.mtdSalesLacs)}` },
    { label: "Received", value: fmtMoney(receivedLacs), sub: `${fmtMoney(receivedAllLacs)} in all` },
    { label: "Paid", value: fmtMoney(paidLacs), sub: `${fmtMoney(paidAllLacs)} in all` },
    { label: "Purchased", value: fmtMoney(purchasedLacs), sub: "net of GST" },
    {
      label: "Bank balance",
      // A partial sum is a wrong number that looks right. The dash is the honest
      // answer whenever an account in scope has no figure for the day.
      value: bankIncomplete ? "—" : fmtMoney(bankSum),
      sub: `${entered} of ${d.accounts.length} entered`,
      alarm: entered < d.accounts.length,
    },
  ];
  const gap = 8;
  const cw = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
  for (let i = 0; i < cards.length; i++) statCard(pdf, MARGIN + i * (cw + gap), y, cw, 52, cards[i]);
  y += 52 + 16;

  /* ---- what sold, in five lines ------------------------------------------ */
  //
  // The same summary the screen opens on, and for the same reason: a reader
  // should have the day's shape before the first party list, not after four of
  // them. The detail tables still follow.
  const groupsForSummary = groupSales(d.sales);
  if (groupsForSummary.length > 0) {
    type SumRow = { label: string; qty: string; amount: number; total?: boolean; quiet?: boolean };
    const rows: SumRow[] = groupsForSummary.map((g) => ({
      label: SALE_TYPE_LABEL[g.saleType],
      qty: g.saleType === "ink" ? `${Math.round(g.qty).toLocaleString("en-IN")} kg` : `${g.qty} units`,
      amount: g.revenueLacs,
    }));
    if (totals.returnsLacs !== 0) {
      rows.push({ label: "Returns and credit notes", qty: "", amount: totals.returnsLacs, quiet: true });
    }
    if (totals.approvalLacs !== 0) {
      rows.push({ label: "Out on approval — not a sale", qty: "", amount: totals.approvalLacs, quiet: true });
    }
    rows.push({ label: "Total", qty: "", amount: totals.netLacs, total: true });

    y = sectionHeading(pdf, MARGIN, y, fmtMoney(totals.netLacs), "What sold") + 4;
    y = drawTable<SumRow>(pdf, {
      x: MARGIN, y, width: CONTENT_W,
      rows,
      rowH: 14, bodySize: 8, maxY: PAGE_H - 56, onNewPage: newPage,
      showHeader: false,
      rowKind: (r) => (r.total ? "total" : r.quiet ? "muted" : "normal"),
      columns: [
        { header: "", width: 3.4, value: (r) => r.label },
        { header: "", width: 1.4, value: (r) => r.qty },
        { header: "", width: 1.2, align: "right", value: (r) => fmtLacs(r.amount) },
      ],
    }) + 16;
  }

  /* ---- money ------------------------------------------------------------- */
  /** A banded money table row: a real voucher, or a band's subtotal. */
  type MoneyTableRow = MoneyRow | { subtotal: string; amountLacs: number };
  const isSubtotal = (r: MoneyTableRow): r is { subtotal: string; amountLacs: number } =>
    "subtotal" in r;

  const drawMoney = (title: string, eyebrow: string, bands: typeof received, total: number) => {
    if (bands.length === 0) return;
    y = sectionHeading(pdf, MARGIN, y, eyebrow, title) + 4;
    // Banded: every band's own rows, then its subtotal, so the trade half can be
    // read off the page without anyone doing arithmetic in their head.
    const rows: MoneyTableRow[] = [];
    for (const b of bands) {
      rows.push(...b.rows);
      rows.push({ subtotal: `${PARTY_KIND_LABEL[b.kind]} total`, amountLacs: b.totalLacs });
    }
    rows.push({ subtotal: "All counterparties", amountLacs: total });

    y = drawTable<MoneyTableRow>(pdf, {
      x: MARGIN, y, width: CONTENT_W,
      rows,
      rowH: 13,
      bodySize: 7.2,
      maxY: PAGE_H - 56,
      onNewPage: newPage,
      rowKind: (r) =>
        isSubtotal(r) ? (r.subtotal === "All counterparties" ? "grand" : "subtotal") : "normal",
      columns: [
        {
          header: "Counterparty", width: 1.3,
          // The subtotal label spans the three text columns it sits across;
          // without the span it would ellipsize inside a narrow cell while two
          // empty ones sat beside it.
          span: (r) => (isSubtotal(r) ? 3 : 1),
          value: (r) => (isSubtotal(r) ? r.subtotal : PARTY_KIND_LABEL[r.kind]),
        },
        { header: "Party", width: 3.4, value: (r) => (isSubtotal(r) ? "" : r.party) },
        { header: "Book", width: 1.6, value: (r) => (isSubtotal(r) ? "" : r.company ?? "—") },
        { header: "₹ L", width: 0.9, align: "right", value: (r) => fmtLacs(r.amountLacs) },
      ],
    }) + 14;
  };

  drawMoney("Received", "Money in", received, receivedAllLacs);
  drawMoney("Paid", "Money out", paid, paidAllLacs);

  /* ---- sales, one block per product line --------------------------------- */
  const groups = groupSales(d.sales);
  for (const t of SALE_TYPE_ORDER) {
    const g = groups.find((x) => x.saleType === t);
    if (!g) continue;
    const rows = byParty(g.lines);
    const unit = t === "ink" ? `${Math.round(g.qty).toLocaleString("en-IN")} kg` : `${g.qty} units`;
    if (y > PAGE_H - 150) y = newPage();
    y = sectionHeading(pdf, MARGIN, y, `${unit} · ${fmtMoney(g.revenueLacs)}`, SALE_TYPE_LABEL[t]) + 4;

    type Row = PartyTotal | { total: true; qty: number; revenueLacs: number };
    const body: Row[] = [...rows, { total: true, qty: g.qty, revenueLacs: g.revenueLacs }];
    y = drawTable<Row>(pdf, {
      x: MARGIN, y, width: CONTENT_W,
      rows: body,
      rowH: 13,
      bodySize: 7.2,
      maxY: PAGE_H - 56,
      onNewPage: newPage,
      // The top five are the question the old sheet's heading was reaching for.
      rowKind: (r) => ("total" in r ? "total" : rows.indexOf(r as PartyTotal) < 5 ? "big" : "normal"),
      columns: [
        { header: "Party", width: 3.6,
          value: (r) => ("total" in r ? "Total" : (r as PartyTotal).party) },
        { header: "Entity", width: 2.2,
          value: (r) => ("total" in r ? "" : entityLabel((r as PartyTotal).company)) },
        { header: "Location", width: 1.0,
          value: (r) => ("total" in r ? "" : (r as PartyTotal).location) },
        { header: t === "ink" ? "Qty (kg)" : "Qty", width: 1.0, align: "right",
          value: (r) => String(Math.round("total" in r ? r.qty : (r as PartyTotal).qty)) },
        { header: "₹ L", width: 1.0, align: "right",
          // FOC carries quantity and no money; 0.00 in a money column reads as a
          // fault, so the word says what it is.
          value: (r) =>
            "total" in r ? fmtLacs(r.revenueLacs)
              : (r as PartyTotal).foc ? "FOC" : fmtLacs((r as PartyTotal).revenueLacs) },
      ],
    }) + 14;
  }

  /* ---- head and machine movement ----------------------------------------- */
  const outward = d.sales.filter(
    (l) => (l.saleType === "head" || l.saleType === "machine") && saleKind(l) !== "negative",
  );
  if (outward.length > 0) {
    if (y > PAGE_H - 140) y = newPage();
    const qty = outward.reduce((s, l) => s + l.qty, 0);
    y = sectionHeading(pdf, MARGIN, y, `${qty} units`, "Heads and machines outward") + 4;
    y = drawTable(pdf, {
      x: MARGIN, y, width: CONTENT_W,
      rows: outward,
      rowH: 13, bodySize: 7.2, maxY: PAGE_H - 56, onNewPage: newPage,
      columns: [
        { header: "Particular", width: 5.2, value: (l) => `${l.party}_${l.item}` },
        { header: "Line", width: 1.2, value: (l) => SALE_TYPE_LABEL[l.saleType] },
        // SALE or DC — whether the goods left on an invoice or on a challan.
        { header: "Type", width: 0.7, value: (l) => l.paper },
        { header: "Qty", width: 0.7, align: "right", value: (l) => String(l.qty) },
      ],
    }) + 14;
  }

  /* ---- purchases ---------------------------------------------------------- */
  if (d.purchases.length > 0) {
    if (y > PAGE_H - 140) y = newPage();
    y = sectionHeading(pdf, MARGIN, y, fmtMoney(purchasedLacs), "Purchases") + 4;
    y = drawTable(pdf, {
      x: MARGIN, y, width: CONTENT_W,
      rows: d.purchases,
      rowH: 13, bodySize: 7.2, maxY: PAGE_H - 56, onNewPage: newPage,
      columns: [
        { header: "Supplier", width: 2.6, value: (p) => p.party },
        { header: "Item", width: 3.0, value: (p) => p.item },
        { header: "Qty", width: 1.0, align: "right", value: (p) => `${p.qty}${p.unit ? ` ${p.unit}` : ""}` },
        { header: "₹ L", width: 0.9, align: "right", value: (p) => fmtLacs(p.amountLacs) },
      ],
    }) + 14;
  }

  /* ---- bank facility ------------------------------------------------------ */
  const facility = facilityRows(d.accounts, d.balances, d.date);
  if (facility.length > 0) {
    if (y > PAGE_H - 140) y = newPage();
    y = sectionHeading(pdf, MARGIN, y, "limits from the account master", "Bank facility") + 4;
    y = drawTable(pdf, {
      x: MARGIN, y, width: CONTENT_W,
      rows: facility,
      rowH: 13, bodySize: 7.2, maxY: PAGE_H - 56, onNewPage: newPage,
      columns: [
        { header: "Account", width: 1.6, value: (f) => f.account.name },
        { header: "CC limit", width: 1.0, align: "right", value: (f) => money(f.ccLimit) },
        { header: "Held", width: 1.0, align: "right", value: (f) => money(f.heldByBank) },
        { header: "Available", width: 1.1, align: "right", value: (f) => money(f.availableCc) },
        { header: "LC/BC", width: 1.0, align: "right", value: (f) => money(f.lcBcLimit) },
        { header: "Utilised", width: 1.0, align: "right", value: (f) => money(f.lcBcUtilised) },
        { header: "Free", width: 1.0, align: "right", value: (f) => money(f.lcBcFree) },
      ],
    }) + 14;
  }

  /* ---- the definitions, while there is still room ------------------------ */
  const notes = [
    BASIS_NOTE,
    BLANK_NOTE,
    "The Received and Paid figures on the cards count CUSTOMERS AND SUPPLIERS ONLY, the same basis as the sheet this replaces. The tables below list every counterparty, with a subtotal per band and the full figure at the foot.",
    "Goods out on approval are not counted as sales.",
    ...(d.rulesLoaded ? [] : ["The product-line rules could not be read, so sales are filed under Not yet classified. The amounts are still correct."]),
  ];
  const nh = noteBlockHeight(pdf, CONTENT_W, notes);
  if (y + nh > PAGE_H - 56) y = newPage();
  y = noteBlock(pdf, { x: MARGIN, y, width: CONTENT_W, title: "How to read this", lines: notes }) + 10;

  /* ---- the balance matrix, LAST and in landscape -------------------------- */
  //
  // ⚠ NOTHING PORTRAIT MAY FOLLOW THIS. jsPDF's orientation is sticky: once a
  //   landscape page is added, every later bare addPage() stays landscape. The
  //   matrix is here because eleven accounts plus three entity totals will not
  //   read at 7pt across a 527pt portrait content width.
  footer(ctx, page, generatedAt, note);
  pdf.addPage("a4", "landscape");
  page += 1;
  pageWash(pdf);
  const lw = pdf.internal.pageSize.getWidth() - MARGIN * 2;
  const lh = pdf.internal.pageSize.getHeight();
  let ly = headerBand(ctx, { tag: "Bank balances", compact: true, note }) + 14;

  interface MRow { iso: string }
  const mrows: MRow[] = [...d.dates].reverse().map((iso) => ({ iso }));

  // ⚠ ONE TABLE PER ENTITY, STACKED — NOT one wide grid.
  //   Eleven accounts plus three entity totals is fifteen columns. Even in
  //   landscape that is ~51pt each, and `drawTable` ELLIPSIZES rather than
  //   wrapping: the first cut printed "AXIS CC 0…", "Orange O Te…" and clipped
  //   the last account's heading to a single letter. On screen a truncated
  //   header is recoverable by widening the window; on paper it is simply lost.
  //   Two to six columns per entity leaves every heading room to print whole.
  for (const [alias, rows] of entities) {
    const needed = 30 + (mrows.length + 1) * 14;
    if (ly + needed > lh - 56) {
      footer(ctx, page, generatedAt, note);
      pdf.addPage("a4", "landscape");
      page += 1;
      pageWash(pdf);
      ly = headerBand(ctx, { tag: "Bank balances", compact: true, note }) + 14;
    }

    ly = sectionHeading(
      pdf, MARGIN, ly,
      `${d.dates.length} days to ${dmy(d.date)} · ₹ lakhs`,
      entityLabel(alias),
    ) + 4;

    ly = drawTable<MRow>(pdf, {
      x: MARGIN, y: ly,
      // Half the sheet at most: a three-column table stretched across a
      // landscape page puts its figures a hand's width from their own date.
      width: Math.min(lw, 150 + rows.length * 78),
      rows: mrows,
      rowH: 14,
      bodySize: 7.6,
      headerSize: 7,
      maxY: lh - 56,
      // A Sunday is muted rather than marked, because its blanks mean "closed",
      // not "nobody recorded this" — and the note block on the previous page
      // says so in words.
      rowKind: (r) => (isSunday(r.iso) ? "muted" : "normal"),
      columns: [
        { header: "Date", width: 1.5, value: (r) => shortDay(r.iso) },
        ...rows.map((a) => ({
          header: a.name,
          width: 1.0,
          align: "right" as const,
          value: (r: MRow) => {
            const c = cellFor(a, d.balances, r.iso);
            return c.kind === "value" ? fmtLacs(c.lacs) : "—";
          },
        })),
        {
          header: "Total",
          width: 1.05,
          align: "right" as const,
          // Never a partial sum — a dash where any account in this entity has no
          // figure for the day.
          value: (r: MRow) => {
            const t = entityTotal(rows, d.balances, r.iso);
            return t.totalLacs == null ? "—" : fmtLacs(t.totalLacs);
          },
        },
      ],
    }) + 16;
  }

  footer(ctx, page, generatedAt, note);
  pdf.putTotalPages(ctx.totalPagesToken);
  return pdf;
}

export async function downloadDailyReportPdf(d: DailyPdfInput): Promise<void> {
  const pdf = await buildDailyReportPdf(d);
  pdf.save(`Daily_Report_${dmy(d.date)}.pdf`);
}

/**
 * The same document as a Blob — the upload-and-attach path Phase 2 will use to
 * mail this every evening. Nothing calls it yet, and that is deliberate.
 */
export async function dailyReportPdfBlob(d: DailyPdfInput): Promise<Blob> {
  const pdf = await buildDailyReportPdf(d);
  return pdf.output("blob");
}
