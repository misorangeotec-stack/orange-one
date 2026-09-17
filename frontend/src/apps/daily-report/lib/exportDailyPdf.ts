/**
 * The Daily Report, as a document.
 *
 * This is the thing that gets forwarded. It is drawn vectorially through the
 * shared pdfBrand primitives rather than rasterised, so the text stays
 * selectable and the type stays crisp when a director zooms in on a phone.
 *
 * THE SHAPE — asked for by Ritesh Bhai on 16-09-2026 and settled 17-09-2026, on
 * the model of the zero-collections report (`exportCollectionsPdf.ts`):
 *
 *   Page 1 is ONLY a summary: the five headline cards, the four block summaries
 *   (What sold · Bank · Money in · Money out) and the credit facility. Every
 *   figure on it is a link to the page behind it.
 *   Then ONE PAGE PER BLOCK, each starting on a fresh sheet, each with a
 *   "Back to Home" link: What sold · Money in · Money out · Bank. A short block
 *   leaves white space — that is the point, not a layout fault.
 *
 * WHY THE LISTS FOLD, AND WHY THEY STILL ADD UP
 *   Above FOLD_MIN customers a list names those making up FOLD_SHARE of its total
 *   and folds the rest into one "Remaining N" line, followed by a TOTAL — so a
 *   page lists the few that matter and still foots to the figure on page one.
 *   Free-of-charge customers are never folded. The rule is `foldList` in
 *   aggregate.ts; the screen and the workbook read the same function. The
 *   workbook lists every customer.
 *
 * WHY LINKS ARE DEFERRED
 *   Page 1 is drawn before the pages it points at exist, so it cannot know their
 *   numbers. Link rectangles are recorded while drawing and stamped at the end by
 *   `applyDeferredLinks`.
 *
 * THE BLOB ENTRY POINT IS DELIBERATE. `dailyReportPdfBlob` exists so that
 * emailing this every evening (DR-3) is a backend job rather than a rewrite of
 * this file.
 *
 * Every figure comes from `lib/aggregate.ts` — the same module the screen reads.
 * A document that recomputed its own totals would eventually disagree with the
 * page it claims to be a copy of.
 */

import jsPDF from "jspdf";
import {
  BRAND, CONTENT_W, MARGIN,
  applyDeferredLinks, contentW, drawTable, footer, headerBand, homeIcon, loadBrandAssets,
  metaStrip, noteBlock, noteBlockHeight, pageH, pageWash, registerBrandFonts, sectionHeading,
  statCard, text, widthOf, wrapText,
  type Ctx, type DeferredLink, type PdfColumn, type RowKind,
} from "@/shared/lib/pdfBrand";
import { formatDateTime } from "@/shared/lib/time";

import { PARTY_KIND_LABEL, type PartyKind } from "../data/dailyReport";
import {
  bandMoney, cellFoc, cellFor, companyColumnLabel, entityTotal, FACILITY_BALANCE_NOTE,
  facilityRows, foldList, FOLD_MIN, FOLD_SHARE, groupSales, isBankOnlyLocation, pivotCompanies,
  pivotMoney, pivotSales, saleKind, salesTotals, tradeTotal, TRADE_BANDS,
  type MoneyBand, type PivotCell, type PivotCompany, type PivotRow,
} from "./aggregate";
import { SALE_TYPE_LABEL, SALE_TYPE_ORDER } from "./saleType";
import { BASIS_NOTE, BLANK_NOTE, entityLabel, entityRank, listNoun } from "./labels";
import { dmy, fmtLacs, fmtMoney, isSunday, longDate, shortDay, todayIso } from "./format";
import type { DailyXlsxInput } from "./exportDailyXlsx";

/** The same input the workbook takes — one shape, one set of figures. */
export type DailyPdfInput = DailyXlsxInput;

const money = (n: number | null | undefined) => (n == null ? "—" : fmtLacs(n));

/** "Tuesday" — the long date's weekday alone, for the meta strip's note line. */
const weekday = (iso: string) => longDate(iso).split(",")[0];

/** The deferred-link keys of the four pages behind page one. */
type PageKey = "sold" | "in" | "out" | "bank";

export async function buildDailyReportPdf(d: DailyPdfInput): Promise<jsPDF> {
  const assets = await loadBrandAssets();
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  registerBrandFonts(pdf, assets);
  const ctx: Ctx = { pdf, assets, totalPagesToken: "{tp}" };
  const generatedAt = formatDateTime(new Date().toISOString());
  const note = `${d.loc === "all" ? "All locations" : d.loc} · sales net of GST`;
  const bankOnly = isBankOnlyLocation(d.loc);

  const links: DeferredLink[] = [];
  const pageOf = new Map<PageKey, number>();

  /** Bottom of the drawable area on the CURRENT page, clear of the footer rule. */
  const floor = () => pageH(pdf) - 56;

  let page = 1;
  let orientation: "portrait" | "landscape" = "portrait";

  /**
   * "Back to Home", on every page but the first — including continuation pages,
   * so a reader three pages into a long list is one click from the summary.
   * Drawn, not typed: Poppins carries no arrow or house glyph.
   */
  const homeLink = (baseline: number): number => {
    const label = "Back to Home";
    const w = widthOf(pdf, label, 7.6, true);
    homeIcon(pdf, MARGIN + 4, baseline - 3, 8.5, BRAND.orange);
    text(pdf, label, MARGIN + 13, baseline, { size: 7.6, bold: true, color: BRAND.orange });
    pdf.link(MARGIN - 2, baseline - 10, w + 18, 14, { pageNumber: 1 });
    return baseline;
  };

  /**
   * Close the page in hand and open the next, with its chrome.
   *
   * ⚠ ORIENTATION IS ALWAYS PASSED. jsPDF's orientation is sticky: a bare
   *   addPage() after a landscape page is landscape too. The Bank page is last
   *   for that reason, and this passes it explicitly anyway.
   */
  const openPage = (o: "portrait" | "landscape"): number => {
    footer(ctx, page, generatedAt, note);
    pdf.addPage("a4", o);
    page += 1;
    orientation = o;
    pageWash(pdf);
    const top = headerBand(ctx, { tag: "Daily Report", compact: true, note }) + 18;
    return homeLink(top) + 16;
  };
  const continuePage = (): number => openPage(orientation);
  const ensureRoom = (y: number, needed: number): number => (y + needed <= floor() ? y : continuePage());

  /** A detail page's own title and the sentence under it. */
  const pageTitle = (y: number, title: string, sub: string): number => {
    text(pdf, title, MARGIN, y, { size: 16, bold: true });
    let ty = y + 15;
    for (const line of wrapText(pdf, sub, contentW(pdf), 8)) {
      text(pdf, line, MARGIN, ty, { size: 8, color: BRAND.grey });
      ty += 11;
    }
    return ty + 10;
  };

  /** A paragraph in the body — the words a page prints INSTEAD of an empty table. */
  const paragraph = (y: number, s: string): number => {
    let py = y;
    for (const line of wrapText(pdf, s, contentW(pdf), 9)) {
      py = ensureRoom(py, 14);
      text(pdf, line, MARGIN, py, { size: 9, color: BRAND.grey });
      py += 13;
    }
    return py + 6;
  };

  /**
   * Why a block has nothing to show, said in words.
   *
   * ⚠ DELHI IS NOT A BOOK. Its account lives inside the Orange O Tec Noida book,
   *   so What sold and Money are empty by construction under a Delhi filter. An
   *   empty table there reads as a failed query, and someone reports it.
   */
  const emptyReason = (what: string): string =>
    bankOnly
      ? `Delhi is a banking location. It has no Tally company book of its own (its account sits inside the Orange O Tec Noida book), so no ${what} are reported against it. The Bank page is the whole Delhi report.`
      : isSunday(d.date)
        ? `${dmy(d.date)} is a Sunday. The books are closed.`
        : d.date === todayIso()
          ? "Nothing booked yet today."
          : `No ${what} were booked on ${dmy(d.date)}.`;

  /** The same reason in a few words, for a half-width summary line on page one. */
  const shortEmpty = (what: string): string =>
    isSunday(d.date) ? "Sunday: the books are closed"
      : d.date === todayIso() ? "Nothing booked yet today"
        : `No ${what} booked on ${dmy(d.date)}`;

  /* ------------------------------------------------------------ figures */
  const totals = salesTotals(d.sales);
  const groups = groupSales(d.sales);
  const received = bandMoney(d.money, "in");
  const paid = bandMoney(d.money, "out");
  // Trade only on the cards, matching the screen: the sheet this replaces has
  // always shown customers and suppliers, and Ritesh Bhai confirmed it 11-09-2026.
  const receivedLacs = tradeTotal(received);
  const paidLacs = tradeTotal(paid);
  const receivedAllLacs = received.reduce((s, b) => s + b.totalLacs, 0);
  const paidAllLacs = paid.reduce((s, b) => s + b.totalLacs, 0);
  const purchasedLacs = d.purchases.reduce((s, p) => s + p.amountLacs, 0);
  const approvals = d.sales.filter((l) => saleKind(l) === "approval");

  const salePivots = new Map(groups.map((g) => [g.saleType, pivotSales(g.lines)] as const));
  const saleCompanies = pivotCompanies(...salePivots.values());
  const receivedCompanies = pivotCompanies(...received.map((b) => pivotMoney(b.rows)));
  const paidCompanies = pivotCompanies(...paid.map((b) => pivotMoney(b.rows)));
  const unmapped = [...new Set([...saleCompanies, ...receivedCompanies, ...paidCompanies]
    .filter((c) => c.unmapped).map(companyColumnLabel))];

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

  // Per company, from EVERY account — never the location-filtered d.accounts. A
  // facility is sanctioned to a company, not to one of its locations.
  const facility = facilityRows(d.facilityAccounts, d.balances, d.ccLimits, d.date);

  const notes = [
    BASIS_NOTE,
    BLANK_NOTE,
    "The Received and Paid figures count CUSTOMERS AND SUPPLIERS ONLY, the same basis as the sheet this replaces. Every other counterparty is listed on the Money pages below its own divider and is not in that figure.",
    `A list of more than ${FOLD_MIN} names the customers making up ${Math.round(FOLD_SHARE * 100)}% of its total and folds the rest into one Remaining line; its TOTAL still adds up to the figure on page one. The Excel workbook lists every customer.`,
    "Goods sent free of charge are counted in quantity, never in amount, and are never folded. Goods out on approval are not counted as sales.",
    ...(facility.length > 0
      ? [`The credit facility is per company, whatever the location. ${FACILITY_BALANCE_NOTE} Free limit is LC/BC limit less utilised; available CC limit is CC limit less held by bank.`]
      : []),
    ...(unmapped.length > 0
      ? [`${unmapped.join(", ")}: a Tally book missing from the company map, so its rows sit in a column of their own. Tag it in Settings → Masters → Companies & Locations.`]
      : []),
    ...(d.rulesLoaded ? [] : ["The product-line rules could not be read, so sales are filed under Not yet classified. The amounts are still correct."]),
  ];

  /* ================================================================ page 1 */
  pageWash(pdf);
  let y = headerBand(ctx, { tag: "Daily Report", note }) + 16;

  y = metaStrip(pdf, MARGIN, y, CONTENT_W, [
    // The full "Tuesday, 8 September 2026" does not fit a quarter-width meta
    // cell, and metaStrip ellipsizes: it printed "Tuesday, 8 September…", losing
    // the year. The weekday moves to the note line, where it has room.
    { label: "Report date", value: dmy(d.date), note: weekday(d.date) },
    { label: "Location", value: d.loc === "all" ? "All" : d.loc,
      note: bankOnly ? "banking only — no Tally book" : undefined },
    { label: "Sales basis", value: "Net of GST", note: "taxable value" },
    { label: "Amounts", value: "₹ lakhs", note: "unless a unit is shown" },
  ]) + 14;

  /* ---- the five headline cards, each a link -------------------------- */
  // Short: a card's sub-line is a fifth of the page wide.
  const na = "banking location";
  const cards: { label: string; value: string; sub: string; alarm?: boolean; key: PageKey }[] = [
    { key: "sold", label: "Sales today", value: bankOnly ? "—" : fmtMoney(totals.netLacs),
      sub: bankOnly ? na : `MTD ${fmtMoney(d.mtdSalesLacs)}` },
    { key: "in", label: "Received", value: bankOnly ? "—" : fmtMoney(receivedLacs),
      sub: bankOnly ? na : `${fmtMoney(receivedAllLacs)} in all` },
    { key: "out", label: "Paid", value: bankOnly ? "—" : fmtMoney(paidLacs),
      sub: bankOnly ? na : `${fmtMoney(paidAllLacs)} in all` },
    { key: "out", label: "Purchased", value: bankOnly ? "—" : fmtMoney(purchasedLacs),
      sub: bankOnly ? na : "net of GST" },
    {
      key: "bank",
      // "Bank", not "Bank balance": a linked card gives part of its label row to
      // the SEE LIST marker, and at a fifth of the page "BANK BALANCE" printed as
      // "BANK BALAN…".
      label: "Bank",
      // A partial sum is a wrong number that looks right. The dash is the honest
      // answer whenever an account in scope has no figure for the day.
      value: bankIncomplete ? "—" : fmtMoney(bankSum),
      sub: `${entered} of ${d.accounts.length} entered`,
      alarm: entered < d.accounts.length,
    },
  ];
  const gap = 8;
  const cw = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
  cards.forEach((c, i) => {
    const cx = MARGIN + i * (cw + gap);
    statCard(pdf, cx, y, cw, 52, { label: c.label, value: c.value, sub: c.sub, alarm: c.alarm, link: true });
    links.push({ key: c.key, page: 1, x: cx, y, w: cw, h: 52 });
  });
  y += 52 + 16;

  /* ---- the four block summaries, two by two -------------------------- */
  interface FactRow { label: string; sub?: string; value: string; kind?: RowKind; link?: boolean }

  /**
   * One summary block. Every figure links to its page.
   *
   * ⚠ NO onNewPage, ON PURPOSE AND SAFELY. A block is at most ten rows (seven
   *   product lines plus returns, approval and total; or seven bands plus the
   *   divider and the all-counterparties line), so the grid ends near 540pt of a
   *   786pt page. Page one must never spill.
   */
  const facts = (x: number, fy: number, width: number, eyebrow: string, title: string, rows: FactRow[], key: PageKey): number => {
    const top = sectionHeading(pdf, x, fy, eyebrow, title) + 4;
    // The count and figure columns are sized from what they print; the label takes
    // the rest. Fixed shares cut "23 customers" to "23 custome…" on a busy day.
    const SIZE = 7.4;
    const fits = (pick: (r: FactRow) => string | undefined) =>
      Math.max(24, ...rows.filter((r) => r.value || r.sub).map((r) => widthOf(pdf, pick(r) ?? "", SIZE, r.kind === "total") + 12));
    const subW = fits((r) => r.sub);
    const valueW = fits((r) => r.value);
    return drawTable<FactRow>(pdf, {
      x, y: top, width, rows,
      rowH: 14, bodySize: SIZE, showHeader: false, maxY: floor(), linkSink: links,
      rowKind: (r) => r.kind ?? "normal",
      columns: [
        {
          header: "", width: width - subW - valueW, value: (r) => r.label,
          // A row with no figure (a divider, a "nothing booked" line) spans the
          // empty columns beside it rather than ellipsizing inside its own.
          span: (r) => (!r.value && !r.sub ? 3 : 1),
          linkKey: (r) => (r.link === false ? undefined : key),
        },
        { header: "", width: subW, value: (r) => r.sub ?? "" },
        { header: "", width: valueW, align: "right", value: (r) => r.value, linkKey: (r) => (r.link === false || !r.value ? undefined : key) },
      ],
    });
  };

  const naRow: FactRow[] = [{ label: "Not reported for a banking location", value: "", kind: "muted", link: false }];

  const soldRows: FactRow[] = bankOnly ? naRow : [
    ...groups.map((g): FactRow => ({
      label: SALE_TYPE_LABEL[g.saleType],
      sub: g.saleType === "ink" ? `${Math.round(g.qty).toLocaleString("en-IN")} kg` : `${g.qty} units`,
      value: fmtLacs(g.revenueLacs),
    })),
    ...(totals.returnsLacs !== 0 ? [{ label: "Returns and credit notes", value: fmtLacs(totals.returnsLacs), kind: "muted" as const }] : []),
    ...(totals.approvalLacs !== 0 ? [{ label: "Out on approval, not a sale", value: fmtLacs(totals.approvalLacs), kind: "muted" as const }] : []),
    ...(groups.length === 0 && totals.returnsLacs === 0
      ? [{ label: shortEmpty("sales"), value: "", kind: "muted" as const, link: false }]
      : [{ label: "Total", value: fmtLacs(totals.netLacs), kind: "total" as const }]),
  ];

  const moneyRows = (bands: MoneyBand[], allLacs: number, what: string): FactRow[] => {
    if (bankOnly) return naRow;
    if (bands.length === 0) return [{ label: shortEmpty(what), value: "", kind: "muted", link: false }];
    const row = (b: MoneyBand, quiet: boolean): FactRow => {
      const n = new Set(b.rows.map((r) => r.party)).size;
      return { label: PARTY_KIND_LABEL[b.kind], sub: `${n} ${listNoun(b.kind, n)}`, value: fmtLacs(b.totalLacs), kind: quiet ? "muted" : "normal" };
    };
    const trade = bands.filter((b) => TRADE_BANDS.includes(b.kind));
    const other = bands.filter((b) => !TRADE_BANDS.includes(b.kind));
    return [
      ...trade.map((b) => row(b, false)),
      ...(other.length > 0
        ? [
            { label: "Not counted in the figure above", value: "", kind: "band" as const, link: false },
            ...other.map((b) => row(b, true)),
            { label: "Everything Tally recorded", value: fmtLacs(allLacs), kind: "muted" as const },
          ]
        : []),
    ];
  };

  const bankRows: FactRow[] = entities.length === 0
    ? [{ label: "No bank accounts for this location", value: "", kind: "muted", link: false }]
    : [
        ...entities.map(([alias, rows]): FactRow => {
          const t = entityTotal(rows, d.balances, d.date);
          return { label: entityLabel(alias), sub: `${rows.length} ${rows.length === 1 ? "account" : "accounts"}`, value: money(t.totalLacs) };
        }),
        { label: "Total", value: bankIncomplete ? "—" : fmtLacs(bankSum), kind: "total" },
      ];

  const colGap = 16;
  const colW = (CONTENT_W - colGap) / 2;
  const rightX = MARGIN + colW + colGap;

  const row1 = Math.max(
    facts(MARGIN, y, colW, bankOnly ? "—" : `${fmtMoney(totals.netLacs)} · net of returns`, "What sold", soldRows, "sold"),
    facts(
      rightX, y, colW,
      entities.length === 0 ? "no accounts" : bankIncomplete ? `${entered} of ${d.accounts.length} entered` : fmtMoney(bankSum),
      "Bank, as on this date", bankRows, "bank",
    ),
  );
  y = row1 + 16;
  const row2 = Math.max(
    facts(MARGIN, y, colW, bankOnly ? "—" : `${fmtMoney(receivedLacs)} · customers and suppliers`, "Money in", moneyRows(received, receivedAllLacs, "receipts"), "in"),
    facts(rightX, y, colW, bankOnly ? "—" : `${fmtMoney(paidLacs)} · customers and suppliers`, "Money out", moneyRows(paid, paidAllLacs, "payments"), "out"),
  );
  y = row2 + 18;

  /* ---- the credit facility, in brief ---------------------------------- */
  y = sectionHeading(pdf, MARGIN, y, "per company · ₹ lakhs", "Credit facility") + 4;
  if (facility.length === 0) {
    const s = isSunday(d.date)
      ? `${dmy(d.date)} is a Sunday. The books are closed.`
      : `No credit facility was recorded for ${dmy(d.date)}.`;
    text(pdf, s, MARGIN, y + 10, { size: 8, color: BRAND.grey });
    y += 22;
  } else {
    y = drawTable(pdf, {
      x: MARGIN, y, width: CONTENT_W,
      rows: facility,
      rowH: 14, bodySize: 7.4, maxY: floor(), linkSink: links,
      // Only ever a handful of companies, but a table that could spill must be
      // able to: without onNewPage drawTable silently STOPS at the page foot.
      onNewPage: continuePage,
      columns: [
        { header: "Company", width: 2.6, value: (f) => entityLabel(f.entityAlias), linkKey: () => "bank" },
        { header: "Bank", width: 0.7, value: (f) => f.bank },
        { header: "Available balance", width: 1.2, align: "right", value: (f) => money(f.availableBalance), linkKey: () => "bank" },
        { header: "LC/BC free limit", width: 1.2, align: "right", value: (f) => money(f.lcBcFree), linkKey: () => "bank" },
        { header: "Available CC limit", width: 1.2, align: "right", value: (f) => money(f.availableCc), linkKey: () => "bank" },
      ],
    }) + 14;
  }

  // The definitions go under the summary when they fit, and at the very end of
  // the document when they do not — never half off the bottom of a page.
  let notesDrawn = false;
  if (y + noteBlockHeight(pdf, CONTENT_W, notes) <= floor()) {
    noteBlock(pdf, { x: MARGIN, y, width: CONTENT_W, title: "How to read this", lines: notes });
    notesDrawn = true;
  }

  /**
   * A table of LINES — purchases, goods on approval, heads outward — whose text
   * columns wrap instead of ellipsizing.
   *
   * drawTable cuts a long cell to "…", and supplier names on this report run to
   * "ORANGE O TEC ENTERPRISES PVT LTD-SURAT (PURCHASE)". A wrapped column carries
   * its extra lines on continuation rows; the figures stay on the first line.
   */
  const drawLines = <T,>(
    startY: number,
    rows: T[],
    cols: { header: string; width: number; align?: "right"; text: (r: T) => string; wrap?: boolean }[],
  ): number => {
    const SIZE = 7.2;
    const width = contentW(pdf);
    const total = cols.reduce((s, c) => s + c.width, 0);
    const pts = cols.map((c) => (c.width / total) * width);
    const lines: string[][] = [];
    for (const r of rows) {
      const cells = cols.map((c, i) => (c.wrap ? wrapText(pdf, c.text(r), pts[i] - 12, SIZE) : [c.text(r)]));
      const n = Math.max(1, ...cells.map((x) => x.length));
      for (let k = 0; k < n; k++) lines.push(cells.map((x) => x[k] ?? ""));
    }
    return drawTable<string[]>(pdf, {
      x: MARGIN, y: startY, width, rows: lines,
      rowH: 13, bodySize: SIZE, maxY: floor(), onNewPage: continuePage,
      columns: cols.map((c, i) => ({ header: c.header, width: c.width, align: c.align, value: (l: string[]) => l[i] })),
    }) + 14;
  };

  /* ========================================================= pivot tables */

  /** One printed line of a folded list. `cont` marks the second line of a wrapped name. */
  interface PRow {
    kind: "named" | "remaining" | "foc" | "total";
    label: string;
    cell: (alias: string) => PivotCell | undefined;
    all: PivotCell;
    cont?: boolean;
  }

  /**
   * Draw one list with the fold applied.
   *
   * Row order is the decision of 17-09-2026: the named rows biggest first, then
   * the Remaining line, then every customer who was ONLY free of charge, then
   * the TOTAL — which is named + Remaining + free, in every column.
   *
   * ⚠ drawTable ELLIPSIZES; IT NEVER WRAPS. A customer name cut to "SHREE
   *   NANDESHWAR PROCESS…" is the one thing on this page a reader cannot
   *   reconstruct, and the longest real name in FY 2026-27 is 52 characters. So
   *   every figure column is measured from what it will actually print, the
   *   name takes the rest, the type steps down once if the longest name still
   *   does not fit, and a name that STILL does not fit wraps onto a second line.
   */
  const drawPivot = (
    startY: number,
    rows: PivotRow[],
    companies: PivotCompany[],
    unit: "kg" | "qty" | null,
    noun: PartyKind | "sales",
  ): number => {
    const fold = foldList(rows);
    const cellOf = (r: PivotRow) => (alias: string) => r.cells[alias];
    const whole = (t: { qty: number; amountLacs: number; focQty: number }): PivotCell =>
      ({ qty: t.qty, amountLacs: t.amountLacs, focQty: t.focQty });

    const base: PRow[] = [
      ...fold.named.map((r): PRow => ({ kind: "named", label: r.party, cell: cellOf(r), all: whole(r) })),
      ...(fold.remaining
        ? [{
            kind: "remaining" as const,
            label: `Remaining ${fold.remaining.count} ${listNoun(noun, fold.remaining.count)}`,
            cell: (a: string) => fold.remaining?.cells[a],
            all: whole(fold.remaining),
          }]
        : []),
      ...fold.focOnly.map((r): PRow => ({ kind: "foc", label: r.party, cell: cellOf(r), all: whole(r) })),
      { kind: "total", label: "TOTAL", cell: (a) => fold.total.cells[a], all: whole(fold.total) },
    ];

    const q = (n: number) => (unit === "kg" ? Math.round(n).toLocaleString("en-IN") : Number(n.toFixed(3)).toLocaleString("en-IN"));
    const qtyStr = (c: PivotCell | undefined) =>
      !c ? "" : `${q(c.qty)}${cellFoc(c) === "part" ? ` (${q(c.focQty)} FOC)` : ""}`;
    // FOC, never 0.00: a free cell carries quantity and no money, and a bare zero
    // in a money column reads as a data fault.
    const amtStr = (c: PivotCell | undefined) =>
      !c ? "" : unit !== null && cellFoc(c) === "all" ? "FOC" : fmtLacs(c.amountLacs);

    const showTotals = companies.length > 1;
    const unitWord = unit === "kg" ? "kg" : "Qty";
    const numeric: { header: string; value: (r: PRow) => string }[] = [
      ...companies.flatMap((co) => {
        const label = companyColumnLabel(co);
        const amount = { header: `${label} ₹ L`, value: (r: PRow) => (r.cont ? "" : amtStr(r.cell(co.alias))) };
        return unit === null
          ? [amount]
          : [{ header: `${label} ${unitWord}`, value: (r: PRow) => (r.cont ? "" : qtyStr(r.cell(co.alias))) }, amount];
      }),
      ...(showTotals
        ? [
            ...(unit === null ? [] : [{ header: `Total ${unitWord}`, value: (r: PRow) => (r.cont ? "" : qtyStr(r.all)) }]),
            { header: "Total ₹ L", value: (r: PRow) => (r.cont ? "" : amtStr(r.all)) },
          ]
        : []),
    ];

    const HEADER_SIZE = 6.6;
    const width = contentW(pdf);
    const bold = (r: PRow) => r.kind === "total";
    const layout = (size: number) => {
      const widths = numeric.map((c) =>
        Math.max(
          34,
          widthOf(pdf, c.header, HEADER_SIZE, true) + 12,
          ...base.map((r) => widthOf(pdf, c.value(r), size, bold(r)) + 12),
        ),
      );
      const nameW = width - widths.reduce((s, w) => s + w, 0);
      const longest = Math.max(...base.map((r) => widthOf(pdf, r.label, size, bold(r)) + 12));
      return { widths, nameW, longest };
    };
    let size = 7.2;
    let lay = layout(size);
    if (lay.longest > lay.nameW) {
      size = 6.6;
      lay = layout(size);
    }

    // Wrap only what still does not fit, into continuation lines that carry the
    // name and nothing else — the figures stay on the first line, where they
    // are read.
    const body: PRow[] = [];
    for (const r of base) {
      if (widthOf(pdf, r.label, size, bold(r)) + 12 <= lay.nameW) {
        body.push(r);
        continue;
      }
      const lines = wrapText(pdf, r.label, Math.max(40, lay.nameW - 12), size, bold(r));
      lines.forEach((line, i) => body.push({ ...r, label: line, cont: i > 0 }));
    }

    const columns: PdfColumn<PRow>[] = [
      { header: noun === "sales" || noun === "customer" ? "Customer" : noun === "vendor" ? "Supplier" : "Party",
        width: Math.max(lay.nameW, 40), value: (r) => r.label },
      ...numeric.map((c, i): PdfColumn<PRow> => ({
        header: c.header, width: lay.widths[i], align: "right", value: c.value,
        color: (r) => (!r.cont && c.value(r) === "FOC" ? BRAND.orange : undefined),
      })),
    ];

    return drawTable<PRow>(pdf, {
      x: MARGIN, y: startY, width,
      rows: body, columns,
      rowH: 13, bodySize: size, headerSize: HEADER_SIZE,
      maxY: floor(), onNewPage: continuePage,
      rowKind: (r) => (r.kind === "total" ? "total" : r.kind === "remaining" ? "muted" : "normal"),
    }) + 14;
  };

  /* ============================================================ What sold */
  y = openPage("portrait");
  pageOf.set("sold", page);
  y = pageTitle(
    y, "What sold",
    bankOnly
      ? "Not reported for a banking location."
      : `Sold ${fmtMoney(totals.soldLacs)}, less returns and credit notes ${fmtMoney(Math.abs(totals.returnsLacs))}, is ${fmtMoney(totals.netLacs)}: the sales figure on page one. Each list below is what SOLD in its product line, before returns. Net of GST, ₹ lakhs.`,
  );

  if (bankOnly || (groups.length === 0 && approvals.length === 0)) {
    y = paragraph(y, emptyReason("sales"));
  } else {
    for (const t of SALE_TYPE_ORDER) {
      const g = groups.find((x) => x.saleType === t);
      if (!g) continue;
      const rows = salePivots.get(t) ?? [];
      const qty = t === "ink" ? `${Math.round(g.qty).toLocaleString("en-IN")} kg` : `${g.qty} units`;
      y = ensureRoom(y, 70);
      y = sectionHeading(
        pdf, MARGIN, y,
        `${rows.length} ${listNoun("sales", rows.length)} · ${qty} · sold ${fmtMoney(g.revenueLacs)}`,
        SALE_TYPE_LABEL[t],
      ) + 4;
      if (t === "other") {
        y = paragraph(y, "These lines carry a voucher type no product-line rule covers yet. They are listed rather than dropped; add a rule on ConnectWave and they move into their product line.");
      }
      y = drawPivot(y, rows, saleCompanies, t === "ink" ? "kg" : "qty", "sales");
    }

    if (approvals.length > 0) {
      y = ensureRoom(y, 70);
      y = sectionHeading(pdf, MARGIN, y, `${fmtMoney(totals.approvalLacs)} · not counted as a sale`, "Out on approval") + 4;
      y = drawLines(y, approvals, [
        { header: "Customer", width: 3.2, text: (l) => l.party, wrap: true },
        { header: "Item", width: 3.0, text: (l) => l.item, wrap: true },
        { header: "Qty", width: 0.8, align: "right", text: (l) => String(l.qty) },
        { header: "₹ L", width: 0.9, align: "right", text: (l) => fmtLacs(l.revenueLacs) },
      ]);
    }

    // Heads and machines as they physically left — a different question from who
    // bought, and the sheet this replaces prints both.
    const outward = d.sales.filter(
      (l) => (l.saleType === "head" || l.saleType === "machine") && saleKind(l) !== "negative",
    );
    if (outward.length > 0) {
      y = ensureRoom(y, 70);
      const qty = outward.reduce((s, l) => s + l.qty, 0);
      y = sectionHeading(pdf, MARGIN, y, `${qty} units`, "Heads and machines outward") + 4;
      y = drawLines(y, outward, [
        { header: "Particular", width: 5.2, text: (l) => `${l.party}_${l.item}`, wrap: true },
        { header: "Line", width: 1.2, text: (l) => SALE_TYPE_LABEL[l.saleType] },
        // SALE or DC — whether the goods left on an invoice or on a challan.
        { header: "Type", width: 0.7, text: (l) => l.paper },
        { header: "Qty", width: 0.7, align: "right", text: (l) => String(l.qty) },
      ]);
    }
  }

  /* ====================================================== Money in / out */
  /**
   * One money page, band by band.
   *
   * ⚠ FOLDED PER BAND, NOT OVER THE WHOLE LIST — a bank transfer must never share
   *   a Remaining line with a customer receipt. The bands outside the headline
   *   sit below their own divider, as on the screen and on page one.
   */
  const moneyPage = (
    key: PageKey, title: string, bands: MoneyBand[], tradeLacs: number, allLacs: number,
    companies: PivotCompany[], what: string,
  ) => {
    y = openPage("portrait");
    pageOf.set(key, page);
    y = pageTitle(
      y, title,
      bankOnly
        ? "Not reported for a banking location."
        : `${fmtMoney(tradeLacs)} with customers and suppliers: the figure on page one. ${fmtMoney(allLacs)} with every counterparty Tally recorded. One line per party, ₹ lakhs.`,
    );
    if (bankOnly || bands.length === 0) {
      y = paragraph(y, emptyReason(what));
      return;
    }
    const drawBand = (b: MoneyBand) => {
      const rows = pivotMoney(b.rows);
      y = ensureRoom(y, 64);
      y = sectionHeading(
        pdf, MARGIN, y,
        `${rows.length} ${listNoun(b.kind, rows.length)} · band total ${fmtMoney(b.totalLacs)}`,
        PARTY_KIND_LABEL[b.kind],
      ) + 4;
      y = drawPivot(y, rows, companies, null, b.kind);
    };
    const trade = bands.filter((b) => TRADE_BANDS.includes(b.kind));
    const other = bands.filter((b) => !TRADE_BANDS.includes(b.kind));
    trade.forEach(drawBand);
    if (other.length > 0) {
      y = ensureRoom(y + 4, 80);
      y = sectionHeading(pdf, MARGIN, y, "Not counted in the figure above") + 8;
      other.forEach(drawBand);
    }
    y = ensureRoom(y, 20);
    y = drawTable(pdf, {
      x: MARGIN, y, width: CONTENT_W, showHeader: false,
      rows: [{ label: "Everything Tally recorded", amount: allLacs }],
      rowH: 14, bodySize: 7.6, maxY: floor(), onNewPage: continuePage,
      rowKind: () => "grand",
      columns: [
        { header: "", width: 5, value: (r) => r.label },
        { header: "", width: 1, align: "right", value: (r) => fmtLacs(r.amount) },
      ],
    }) + 16;
  };

  moneyPage("in", "Money in", received, receivedLacs, receivedAllLacs, receivedCompanies, "receipts");
  moneyPage("out", "Money out", paid, paidLacs, paidAllLacs, paidCompanies, "payments");

  // Purchases on the Money out page, under a heading of their own. A purchase is
  // a bill, not a payment, and it is never added into the figure above.
  if (!bankOnly && d.purchases.length > 0) {
    y = ensureRoom(y, 70);
    y = sectionHeading(pdf, MARGIN, y, `${fmtMoney(purchasedLacs)} · net of GST · not a payment`, "Purchases") + 4;
    y = drawLines(y, d.purchases, [
      { header: "Supplier", width: 2.6, text: (p) => p.party, wrap: true },
      { header: "Item", width: 3.0, text: (p) => p.item, wrap: true },
      { header: "Qty", width: 1.0, align: "right", text: (p) => `${p.qty}${p.unit ? ` ${p.unit}` : ""}` },
      { header: "₹ L", width: 0.9, align: "right", text: (p) => fmtLacs(p.amountLacs) },
    ]);
  }

  /* ================================================================= Bank */
  //
  // LAST, AND IN LANDSCAPE: eleven accounts plus three entity totals will not
  // read at 7pt across a portrait page. Nothing portrait follows it.
  y = openPage("landscape");
  pageOf.set("bank", page);
  y = pageTitle(y, "Bank", `As on ${dmy(d.date)}, ₹ lakhs. ${BLANK_NOTE}`);

  y = sectionHeading(pdf, MARGIN, y, "per company · whatever the location", "Credit facility") + 4;
  if (facility.length === 0) {
    y = paragraph(y, `No credit facility was recorded for ${dmy(d.date)}. It is entered under each company on Bank balances.`);
  } else {
    // The client's sheet column order. The headings are the short forms because
    // drawTable ellipsizes rather than wraps.
    y = drawTable(pdf, {
      x: MARGIN, y, width: contentW(pdf),
      rows: facility,
      rowH: 14, bodySize: 7.6, maxY: floor(), onNewPage: continuePage,
      columns: [
        { header: "Company", width: 2.5, value: (f) => entityLabel(f.entityAlias) },
        { header: "Bank", width: 0.6, value: (f) => f.bank },
        { header: "CC limit", width: 0.9, align: "right", value: (f) => money(f.ccLimit) },
        { header: "Available balance", width: 1.1, align: "right", value: (f) => money(f.availableBalance) },
        { header: "LC/BC limit", width: 0.95, align: "right", value: (f) => money(f.lcBcLimit) },
        { header: "Utilised", width: 0.9, align: "right", value: (f) => money(f.lcBcUtilised) },
        { header: "Free limit", width: 0.9, align: "right", value: (f) => money(f.lcBcFree) },
        { header: "Held by bank", width: 0.95, align: "right", value: (f) => money(f.heldByBank) },
        { header: "Available CC limit", width: 1.1, align: "right", value: (f) => money(f.availableCc) },
      ],
    }) + 18;
  }

  interface MRow { iso: string }
  const mrows: MRow[] = [...d.dates].reverse().map((iso) => ({ iso }));

  if (entities.length === 0) {
    y = paragraph(y, "No bank accounts for this location.");
  }
  // ⚠ ONE TABLE PER ENTITY, STACKED — NOT one wide grid.
  //   Eleven accounts plus three entity totals is fifteen columns. Even in
  //   landscape that is ~51pt each, and `drawTable` ELLIPSIZES rather than
  //   wrapping: the first cut printed "AXIS CC 0…", "Orange O Te…" and clipped
  //   the last account's heading to a single letter. Two to six columns per
  //   entity leaves every heading room to print whole.
  for (const [alias, rows] of entities) {
    y = ensureRoom(y, 30 + (mrows.length + 1) * 14);
    y = sectionHeading(pdf, MARGIN, y, `${d.dates.length} days to ${dmy(d.date)} · ₹ lakhs`, entityLabel(alias)) + 4;
    y = drawTable<MRow>(pdf, {
      x: MARGIN, y,
      // Half the sheet at most: a three-column table stretched across a
      // landscape page puts its figures a hand's width from their own date.
      width: Math.min(contentW(pdf), 150 + rows.length * 78),
      rows: mrows,
      rowH: 14, bodySize: 7.6, headerSize: 7, maxY: floor(), onNewPage: continuePage,
      // A Sunday is muted rather than marked, because its blanks mean "closed",
      // not "nobody recorded this".
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

  if (!notesDrawn) {
    const nh = noteBlockHeight(pdf, contentW(pdf), notes);
    y = ensureRoom(y, nh);
    noteBlock(pdf, { x: MARGIN, y, width: contentW(pdf), title: "How to read this", lines: notes });
  }

  footer(ctx, page, generatedAt, note);

  /* ---- navigation furniture ------------------------------------------- */
  applyDeferredLinks(pdf, links, pageOf);
  try {
    pdf.outline.add(null, "Home", { pageNumber: 1 });
    const outline: [PageKey, string][] = [["sold", "What sold"], ["in", "Money in"], ["out", "Money out"], ["bank", "Bank"]];
    for (const [key, label] of outline) {
      const p = pageOf.get(key);
      if (p !== undefined) pdf.outline.add(null, label, { pageNumber: p });
    }
  } catch {
    // Bookmarks are a convenience; the in-page links are the requirement.
  }

  pdf.putTotalPages(ctx.totalPagesToken);
  return pdf;
}

export async function downloadDailyReportPdf(d: DailyPdfInput): Promise<void> {
  const pdf = await buildDailyReportPdf(d);
  pdf.save(`Daily_Report_${dmy(d.date)}.pdf`);
}

/**
 * The same document as a Blob — the upload-and-attach path the daily email
 * (DR-3) will use. Nothing calls it yet, and that is deliberate.
 */
export async function dailyReportPdfBlob(d: DailyPdfInput): Promise<Blob> {
  const pdf = await buildDailyReportPdf(d);
  return pdf.output("blob");
}
