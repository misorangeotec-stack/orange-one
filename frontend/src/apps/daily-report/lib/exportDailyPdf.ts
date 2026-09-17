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
 *   (What sold · Bank · Money in · Money out) and the credit facility when one
 *   was recorded. Every card on it is a link to the page behind it.
 *   Then ONE PAGE PER BLOCK, each starting on a fresh sheet, each with a
 *   "Back to Home" link: What sold · Money in · Money out · Bank. A short block
 *   leaves white space — that is the point, not a layout fault. The notes on how
 *   to read the figures close the document.
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
  applyDeferredLinks, contentW, divider, drawTable, ellipsize, footer, headerBand, homeIcon,
  loadBrandAssets, noteBlock, noteBlockHeight, pageH, pageWash, registerBrandFonts, setDraw, setFill,
  statCard, text, widthOf, wrapText,
  type Ctx, type DeferredLink, type PdfColumn,
} from "@/shared/lib/pdfBrand";
import { formatDateTime } from "@/shared/lib/time";

import { PARTY_KIND_LABEL, type PartyKind } from "../data/dailyReport";
import {
  bandMoney, cellFoc, cellFor, companyColumnLabel, entityTotal, FACILITY_BALANCE_NOTE,
  facilityRows, foldList, FOLD_MIN, FOLD_SHARE, groupSales, isBankOnlyLocation, pivotCompanies,
  pivotMoney, pivotSales, saleKind, salesTotals, tradeTotal, TRADE_BANDS,
  type MoneyBand, type PivotCell, type PivotRow,
} from "./aggregate";
import { SALE_TYPE_LABEL, SALE_TYPE_ORDER } from "./saleType";
import { BASIS_NOTE, BLANK_NOTE, entityLabel, entityRank, listNoun } from "./labels";
import { dmy, fmtLacs, fmtMoney, fmtQty, isSunday, longDate, shortDay, todayIso } from "./format";
import type { DailyXlsxInput } from "./exportDailyXlsx";

/** The same input the workbook takes — one shape, one set of figures. */
export type DailyPdfInput = DailyXlsxInput;

const money = (n: number | null | undefined) => (n == null ? "—" : fmtLacs(n));

/** A product line's quantity, in its own unit, with the noun agreeing. */
const qtyLabel = (saleType: string, qty: number) =>
  saleType === "ink" ? `${Math.round(qty).toLocaleString("en-IN")} kg` : `${fmtQty(qty)} ${qty === 1 ? "unit" : "units"}`;

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
  /** Right edge of the content on the CURRENT page. */
  const rightEdge = () => MARGIN + contentW(pdf);

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
    return homeLink(top) + 18;
  };
  const continuePage = (): number => openPage(orientation);
  const ensureRoom = (y: number, needed: number): number => (y + needed <= floor() ? y : continuePage());

  /** A page's own title, its headline figure on the right, and the sentence under it. */
  const pageTitle = (y: number, title: string, sub: string, figure?: string): number => {
    text(pdf, title, MARGIN, y, { size: 16, bold: true });
    if (figure) text(pdf, figure, rightEdge(), y, { size: 14, bold: true, align: "right" });
    let ty = y + 15;
    for (const line of wrapText(pdf, sub, contentW(pdf), 8)) {
      text(pdf, line, MARGIN, ty, { size: 8, color: BRAND.grey });
      ty += 11;
    }
    return ty + 12;
  };

  /**
   * One list's heading: its name on the left, its figure on the right, and one
   * quiet line of counts beneath. Replaces the orange capitals that used to sit
   * over every table — on a page of five tables they read as shouting.
   */
  const listHeading = (y: number, title: string, figure: string, caption: string): number => {
    text(pdf, title, MARGIN, y + 11, { size: 11, bold: true });
    if (figure) text(pdf, figure, rightEdge(), y + 11, { size: 11, bold: true, align: "right" });
    if (caption) text(pdf, caption, MARGIN, y + 22, { size: 7, color: BRAND.grey2 });
    return y + (caption ? 29 : 18);
  };

  /** A small grey caption with a hairline running to the right edge — a divider that names itself. */
  const captionRule = (y: number, label: string, left = MARGIN, right = rightEdge()): number => {
    const s = label.toUpperCase();
    text(pdf, s, left, y + 6, { size: 6.2, bold: true, color: BRAND.grey2 });
    const w = widthOf(pdf, s, 6.2, true);
    setDraw(pdf, BRAND.line);
    pdf.setLineWidth(0.6);
    pdf.line(left + w + 6, y + 4, right, y + 4);
    return y + 14;
  };

  /** A small grey note under a heading, wrapped — room is left above it for the caption. */
  const noteLine = (y: number, s: string): number => {
    let ny = y + 6;
    for (const line of wrapText(pdf, s, contentW(pdf), 7.4)) {
      text(pdf, line, MARGIN, ny, { size: 7.4, color: BRAND.grey });
      ny += 10;
    }
    return ny + 2;
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

  /** The same reason in a few words, for a summary line on page one. */
  const shortEmpty = (what: string): string =>
    bankOnly ? "Not reported for a banking location"
      : isSunday(d.date) ? "Sunday: the books are closed"
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
  const unmapped = [...new Set(
    pivotCompanies(...salePivots.values(), ...[...received, ...paid].map((b) => pivotMoney(b.rows)))
      .filter((c) => c.unmapped).map(companyColumnLabel),
  )];

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
    "A company appears as a column in a list only when that list has a customer for it.",
    ...(facility.length > 0
      ? [`The credit facility is per company, whatever the location. ${FACILITY_BALANCE_NOTE} Free limit is LC/BC limit less utilised; available CC limit is CC limit less held by bank.`]
      : []),
    ...(unmapped.length > 0
      ? [`${unmapped.join(", ")}: a Tally book missing from the company map, so its rows sit in a column of their own. Tag it in Settings → Masters → Companies & Locations.`]
      : []),
    ...(d.rulesLoaded ? [] : ["The product-line rules could not be read, so sales are filed under Not yet classified. The amounts are still correct."]),
  ];

  /* ================================================================ page 1 */
  //
  // ⚠ REDRAWN 17-09-2026, AFTER THE USER READ THE FIRST CUT: "cluttered … a data
  //   dump … not even properly aligned". Each choice below answers one fault:
  //   · a title and ONE line of terms, instead of a boxed strip of four cells;
  //   · five cards without five "SEE LIST" markers — each card is still a link,
  //     and one sentence under the grid says so once;
  //   · the four blocks are CARDS OF EQUAL HEIGHT on ONE column grid: the count
  //     and the figure sit at the same offset in every card, so figures read
  //     straight down. The first cut sized those columns per block from its own
  //     text, and no two blocks lined up;
  //   · lines outside the headline are grey type, not grey-filled bands;
  //   · a product line that went only free of charge says "free", not 0.00;
  //   · the credit facility is a table only when one was recorded;
  //   · the notes moved to the end of the document.
  pageWash(pdf);
  let y = headerBand(ctx, { tag: "Daily Report", note }) + 32;

  text(pdf, "Daily Report", MARGIN, y, { size: 19, bold: true });
  y += 16;
  const terms = [
    longDate(d.date),
    d.loc === "all" ? "All locations" : bankOnly ? "Delhi (banking only, no Tally book)" : d.loc,
    "Sales and purchases net of GST",
    "Amounts in ₹ lakhs",
  ].join("   ·   ");
  text(pdf, terms, MARGIN, y, { size: 8.4, color: BRAND.grey });
  y = divider(pdf, MARGIN, y + 10, CONTENT_W) + 14;

  /* ---- the five headline cards --------------------------------------- */
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
      label: "Bank balance",
      // A partial sum is a wrong number that looks right. The dash is the honest
      // answer whenever an account in scope has no figure for the day.
      value: bankIncomplete ? "—" : fmtMoney(bankSum),
      sub: `${entered} of ${d.accounts.length} entered`,
      alarm: entered < d.accounts.length,
    },
  ];
  const CARD_H = 50;
  const cardGap = 8;
  const cw = (CONTENT_W - cardGap * (cards.length - 1)) / cards.length;
  cards.forEach((c, i) => {
    const cx = MARGIN + i * (cw + cardGap);
    statCard(pdf, cx, y, cw, CARD_H, { label: c.label, value: c.value, sub: c.sub, alarm: c.alarm });
    links.push({ key: c.key, page: 1, x: cx, y, w: cw, h: CARD_H });
  });
  y += CARD_H + 14;

  /* ---- the four block summaries, two by two -------------------------- */

  /** One line of a summary card. */
  interface Line {
    label: string;
    count?: string;
    value?: string;
    /** quiet: outside the headline, grey · total: closes the card · rule: a named divider */
    tone?: "quiet" | "total" | "rule";
    /** "free" reads orange. */
    valueColor?: string;
  }
  interface Block { title: string; headline: string; caption: string; lines: Line[]; key: PageKey }

  // ONE geometry for all four cards — this is the alignment.
  const PAD = 12;
  const HEAD_H = 40;
  const ROW_H = 15;
  const VALUE_W = 52;
  const COUNT_W = 64;
  const SIZE = 7.8;
  const blockHeight = (b: Block) => HEAD_H + 6 + b.lines.length * ROW_H + 8;

  const drawBlock = (x: number, top: number, w: number, h: number, b: Block) => {
    setFill(pdf, BRAND.white);
    setDraw(pdf, BRAND.line);
    pdf.setLineWidth(0.7);
    pdf.roundedRect(x, top, w, h, 6, 6, "FD");

    const left = x + PAD;
    const right = x + w - PAD;
    text(pdf, b.title, left, top + 18, { size: 10.5, bold: true });
    text(pdf, b.headline, right, top + 18, { size: 10.5, bold: true, align: "right" });
    text(pdf, ellipsize(pdf, b.caption, w - PAD * 2, 6.8), left, top + 30, { size: 6.8, color: BRAND.grey2 });
    setDraw(pdf, BRAND.line);
    pdf.setLineWidth(0.6);
    pdf.line(left, top + HEAD_H, right, top + HEAD_H);

    const hasCount = b.lines.some((l) => l.count);
    const countRight = right - VALUE_W;
    const labelMax = (hasCount ? countRight - COUNT_W : countRight) - left - 4;
    let ry = top + HEAD_H + 6;
    for (const l of b.lines) {
      const base = ry + ROW_H - 4.5;
      if (l.tone === "rule") {
        captionRule(ry + 5, l.label, left, right);
      } else {
        if (l.tone === "total") {
          setDraw(pdf, BRAND.lineStrong);
          pdf.setLineWidth(0.6);
          pdf.line(left, ry + 1.5, right, ry + 1.5);
        }
        const color = l.tone === "quiet" ? BRAND.grey2 : BRAND.navy;
        const bold = l.tone === "total";
        // A line with no figures (an empty day) takes the whole width.
        const room = !l.value && !l.count ? right - left : labelMax;
        text(pdf, ellipsize(pdf, l.label, room, SIZE, bold), left, base, { size: SIZE, bold, color });
        if (l.count) text(pdf, l.count, countRight - 6, base, { size: SIZE, color: BRAND.grey, align: "right" });
        if (l.value) text(pdf, l.value, right, base, { size: SIZE, bold, color: l.valueColor ?? color, align: "right" });
      }
      ry += ROW_H;
    }
    // The whole card opens its page.
    links.push({ key: b.key, page: 1, x, y: top, w, h });
  };

  const soldBlock: Block = {
    key: "sold",
    title: "What sold",
    headline: bankOnly ? "—" : fmtMoney(totals.netLacs),
    caption: "net of returns · goods on approval not counted",
    lines: bankOnly || (groups.length === 0 && totals.returnsLacs === 0 && totals.approvalLacs === 0)
      ? [{ label: shortEmpty("sales"), tone: "quiet" }]
      : [
          ...groups.map((g): Line => {
            // Free of charge carries quantity and no money; "0.00" would read as a fault.
            const free = g.revenueLacs === 0 && g.qty > 0 && g.focQty >= g.qty;
            return {
              label: SALE_TYPE_LABEL[g.saleType],
              count: qtyLabel(g.saleType, g.qty),
              value: free ? "free" : fmtLacs(g.revenueLacs),
              valueColor: free ? BRAND.orange : undefined,
            };
          }),
          ...(totals.returnsLacs !== 0 ? [{ label: "Returns and credit notes", value: fmtLacs(totals.returnsLacs), tone: "quiet" as const }] : []),
          ...(totals.approvalLacs !== 0 ? [{ label: "On approval (not a sale)", value: fmtLacs(totals.approvalLacs), tone: "quiet" as const }] : []),
          { label: "Total", value: fmtLacs(totals.netLacs), tone: "total" },
        ],
  };

  const moneyBlock = (key: PageKey, title: string, bands: MoneyBand[], tradeLacs: number, allLacs: number, what: string): Block => {
    const line = (b: MoneyBand, quiet: boolean): Line => {
      const n = new Set(b.rows.map((r) => r.party)).size;
      return { label: PARTY_KIND_LABEL[b.kind], count: `${n} ${listNoun(b.kind, n)}`, value: fmtLacs(b.totalLacs), tone: quiet ? "quiet" : undefined };
    };
    const trade = bands.filter((b) => TRADE_BANDS.includes(b.kind));
    const other = bands.filter((b) => !TRADE_BANDS.includes(b.kind));
    return {
      key,
      title,
      headline: bankOnly ? "—" : fmtMoney(tradeLacs),
      caption: "customers and suppliers only",
      lines: bankOnly || bands.length === 0
        ? [{ label: shortEmpty(what), tone: "quiet" }]
        : [
            ...trade.map((b) => line(b, false)),
            ...(other.length > 0
              ? [
                  { label: "Not counted in the figure above", tone: "rule" as const },
                  ...other.map((b) => line(b, true)),
                  { label: "Everything Tally recorded", value: fmtLacs(allLacs), tone: "quiet" as const },
                ]
              : []),
          ],
    };
  };

  const bankBlock: Block = {
    key: "bank",
    title: "Bank, as on this date",
    headline: entities.length === 0 ? "—" : bankIncomplete ? "—" : fmtMoney(bankSum),
    caption: entities.length === 0
      ? "no bank accounts for this location"
      : entered < d.accounts.length ? `${entered} of ${d.accounts.length} ${d.accounts.length === 1 ? "account" : "accounts"} entered` : "every account entered",
    lines: [
      ...(entities.length === 0
        ? [{ label: "No bank accounts for this location", tone: "quiet" as const }]
        : [
            ...entities.map(([alias, rows]): Line => ({
              label: entityLabel(alias),
              value: money(entityTotal(rows, d.balances, d.date).totalLacs),
            })),
            { label: "Total", value: bankIncomplete ? "—" : fmtLacs(bankSum), tone: "total" as const },
          ]),
      ...(facility.length === 0 ? [{ label: "Credit facility not recorded for this date", tone: "quiet" as const }] : []),
    ],
  };

  const colGap = 14;
  const colW = (CONTENT_W - colGap) / 2;
  const rightX = MARGIN + colW + colGap;
  const pair = (a: Block, b: Block) => {
    const h = Math.max(blockHeight(a), blockHeight(b));
    drawBlock(MARGIN, y, colW, h, a);
    drawBlock(rightX, y, colW, h, b);
    y += h + 12;
  };
  pair(soldBlock, bankBlock);
  pair(
    moneyBlock("in", "Money in", received, receivedLacs, receivedAllLacs, "receipts"),
    moneyBlock("out", "Money out", paid, paidLacs, paidAllLacs, "payments"),
  );

  /* ---- the credit facility, only when one was recorded ---------------- */
  if (facility.length > 0) {
    const cols: { header: string; x: number; align: "left" | "right"; value: (f: (typeof facility)[number]) => string }[] = [];
    const left = MARGIN + PAD;
    const right = MARGIN + CONTENT_W - PAD;
    cols.push({ header: "Company", x: left, align: "left", value: (f) => entityLabel(f.entityAlias) });
    cols.push({ header: "Bank", x: left + 178, align: "left", value: (f) => f.bank });
    cols.push({ header: "Available balance", x: right - 200, align: "right", value: (f) => money(f.availableBalance) });
    cols.push({ header: "LC/BC free limit", x: right - 100, align: "right", value: (f) => money(f.lcBcFree) });
    cols.push({ header: "Available CC limit", x: right, align: "right", value: (f) => money(f.availableCc) });
    const h = HEAD_H + 6 + ROW_H + facility.length * ROW_H + 8;
    const top = y;
    setFill(pdf, BRAND.white);
    setDraw(pdf, BRAND.line);
    pdf.setLineWidth(0.7);
    pdf.roundedRect(MARGIN, top, CONTENT_W, h, 6, 6, "FD");
    text(pdf, "Credit facility", left, top + 18, { size: 10.5, bold: true });
    text(pdf, "per company, whatever the location", left, top + 30, { size: 6.8, color: BRAND.grey2 });
    setDraw(pdf, BRAND.line);
    pdf.setLineWidth(0.6);
    pdf.line(left, top + HEAD_H, right, top + HEAD_H);
    let ry = top + HEAD_H + 6;
    for (const c of cols) {
      text(pdf, c.header.toUpperCase(), c.x, ry + ROW_H - 5, { size: 6, bold: true, color: BRAND.grey2, align: c.align });
    }
    ry += ROW_H;
    for (const f of facility) {
      for (const c of cols) {
        text(pdf, c.value(f), c.x, ry + ROW_H - 4.5, { size: SIZE, align: c.align, bold: c.header === "Company" });
      }
      ry += ROW_H;
    }
    links.push({ key: "bank", page: 1, x: MARGIN, y: top, w: CONTENT_W, h });
    y += h + 12;
  }

  text(
    pdf,
    "Each card opens the page behind it. How to read these figures is on the last page.",
    MARGIN, y + 6, { size: 7, color: BRAND.grey2 },
  );

  /* ================================================================= lines */

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
    const LINE_SIZE = 7.2;
    const width = contentW(pdf);
    const total = cols.reduce((s, c) => s + c.width, 0);
    const pts = cols.map((c) => (c.width / total) * width);
    const lines: string[][] = [];
    for (const r of rows) {
      const cells = cols.map((c, i) => (c.wrap ? wrapText(pdf, c.text(r), pts[i] - 12, LINE_SIZE) : [c.text(r)]));
      const n = Math.max(1, ...cells.map((x) => x.length));
      for (let k = 0; k < n; k++) lines.push(cells.map((x) => x[k] ?? ""));
    }
    return drawTable<string[]>(pdf, {
      x: MARGIN, y: startY, width, rows: lines,
      rowH: 13, bodySize: LINE_SIZE, maxY: floor(), onNewPage: continuePage,
      columns: cols.map((c, i) => ({ header: c.header, width: c.width, align: c.align, value: (l: string[]) => l[i] })),
    }) + 16;
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
   * The company columns are THIS list's own (`pivotCompanies(rows)`): a company
   * with no customer here gets no column — the user's call, 17-09-2026.
   *
   * On a goods list each company is named ONCE, in a thin row above the navy
   * header, over its "kg | ₹ L" pair — the same arrangement as the screen. The
   * first cut printed "Enterprise kg" and "Enterprise ₹ L" as two headers.
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
    unit: "kg" | "qty" | null,
    noun: PartyKind | "sales",
  ): number => {
    const companies = pivotCompanies(rows);
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
      { kind: "total", label: `TOTAL (${fold.all.length} ${listNoun(noun, fold.all.length)})`, cell: (a) => fold.total.cells[a], all: whole(fold.total) },
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
    // On a goods list the company name lives in the group row above, so the
    // column headers are just the unit. On a money list there is one column per
    // company, and the header carries the name.
    const numeric: { header: string; value: (r: PRow) => string }[] = [
      ...companies.flatMap((co) => {
        const amount = {
          header: unit === null ? `${companyColumnLabel(co)} ₹ L` : "₹ L",
          value: (r: PRow) => (r.cont ? "" : amtStr(r.cell(co.alias))),
        };
        return unit === null
          ? [amount]
          : [{ header: unitWord, value: (r: PRow) => (r.cont ? "" : qtyStr(r.cell(co.alias))) }, amount];
      }),
      ...(showTotals
        ? [
            ...(unit === null ? [] : [{ header: unitWord, value: (r: PRow) => (r.cont ? "" : qtyStr(r.all)) }]),
            { header: unit === null ? "Total ₹ L" : "₹ L", value: (r: PRow) => (r.cont ? "" : amtStr(r.all)) },
          ]
        : []),
    ];

    const HEADER_SIZE = 6.8;
    const width = contentW(pdf);
    const bold = (r: PRow) => r.kind === "total";
    const layout = (size: number) => {
      const widths = numeric.map((c) =>
        Math.max(
          46,
          widthOf(pdf, c.header, HEADER_SIZE, true) + 14,
          ...base.map((r) => widthOf(pdf, c.value(r), size, bold(r)) + 14),
        ),
      );
      const nameW = width - widths.reduce((s, w) => s + w, 0);
      const longest = Math.max(...base.map((r) => widthOf(pdf, r.label, size, bold(r)) + 12));
      return { widths, nameW, longest };
    };
    let size = 7.4;
    let lay = layout(size);
    if (lay.longest > lay.nameW) {
      size = 6.8;
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

    /** The company names over their pairs. Redrawn on a continuation page, above the repeated header. */
    const GROUP_H = 14;
    const groupRow = (gy: number): number => {
      const spans = [
        ...companies.map((co) => companyColumnLabel(co)),
        ...(showTotals ? ["Total"] : []),
      ];
      let gx = MARGIN + lay.nameW;
      spans.forEach((label, i) => {
        const w = lay.widths[i * 2] + lay.widths[i * 2 + 1];
        text(pdf, ellipsize(pdf, label, w - 8, 7, true), gx + w / 2, gy + 9, { size: 7, bold: true, color: BRAND.navy, align: "center" });
        setDraw(pdf, BRAND.lineStrong);
        pdf.setLineWidth(0.6);
        pdf.line(gx + 5, gy + 12, gx + w - 5, gy + 12);
        gx += w;
      });
      return gy + GROUP_H;
    };

    const columns: PdfColumn<PRow>[] = [
      { header: noun === "sales" || noun === "customer" ? "Customer" : noun === "vendor" ? "Supplier" : "Party",
        width: Math.max(lay.nameW, 40), value: (r) => r.label },
      ...numeric.map((c, i): PdfColumn<PRow> => ({
        header: c.header, width: lay.widths[i], align: "right", value: c.value,
        color: (r) => (!r.cont && c.value(r) === "FOC" ? BRAND.orange : undefined),
      })),
    ];

    const tableTop = unit !== null ? groupRow(startY) : startY;
    return drawTable<PRow>(pdf, {
      x: MARGIN, y: tableTop, width,
      rows: body, columns,
      rowH: 14, bodySize: size, headerSize: HEADER_SIZE,
      maxY: floor(),
      onNewPage: () => {
        const ny = continuePage();
        return unit !== null ? groupRow(ny) : ny;
      },
      rowKind: (r) => (r.kind === "total" ? "total" : r.kind === "remaining" ? "muted" : "normal"),
    }) + 18;
  };

  /**
   * How much room a list needs — its heading, the company row, the header and
   * every printed line — so it can start on a fresh page rather than leave its
   * TOTAL stranded at the top of the next one. Capped at a page: a list longer
   * than that has to break somewhere, and breaking at once is no better.
   */
  const listRoom = (rows: PivotRow[], goods: boolean): number => {
    const f = foldList(rows);
    const lines = f.named.length + (f.remaining ? 1 : 0) + f.focOnly.length + 1;
    const need = 29 + (goods ? 14 : 0) + 15 + lines * 14 + 18;
    return Math.min(need, floor() - 110);
  };

  /* ============================================================ What sold */
  y = openPage("portrait");
  pageOf.set("sold", page);
  y = pageTitle(
    y, "What sold",
    bankOnly
      ? "Not reported for a banking location."
      : `Sold ${fmtMoney(totals.soldLacs)}, less returns and credit notes ${fmtMoney(Math.abs(totals.returnsLacs))}, is ${fmtMoney(totals.netLacs)}: the sales figure on page one. Each list is what sold in its product line, before returns.`,
    bankOnly ? undefined : fmtMoney(totals.netLacs),
  );

  if (bankOnly || (groups.length === 0 && approvals.length === 0)) {
    y = paragraph(y, emptyReason("sales"));
  } else {
    for (const t of SALE_TYPE_ORDER) {
      const g = groups.find((x) => x.saleType === t);
      if (!g) continue;
      const rows = salePivots.get(t) ?? [];
      y = ensureRoom(y, listRoom(rows, true));
      y = listHeading(
        // A line that went entirely free says so, as on page one — not "₹0.00 L".
        y, SALE_TYPE_LABEL[t], g.revenueLacs === 0 && g.qty > 0 && g.focQty >= g.qty ? "free" : fmtMoney(g.revenueLacs),
        `${rows.length} ${listNoun("sales", rows.length)} · ${qtyLabel(t, g.qty)} · sold, before returns`,
      );
      if (t === "other") {
        y = noteLine(y, "These lines carry a voucher type no product-line rule covers yet. They are listed rather than dropped; add a rule on ConnectWave and they move into their product line.");
      }
      y = drawPivot(y, rows, t === "ink" ? "kg" : "qty", "sales");
    }

    if (approvals.length > 0) {
      y = ensureRoom(y, 80);
      y = listHeading(y, "Out on approval", fmtMoney(totals.approvalLacs), "not counted as a sale");
      y = drawLines(y, approvals, [
        { header: "Customer", width: 3.2, text: (l) => l.party, wrap: true },
        { header: "Item", width: 3.0, text: (l) => l.item, wrap: true },
        { header: "Qty", width: 0.8, align: "right", text: (l) => fmtQty(l.qty) },
        { header: "₹ L", width: 0.9, align: "right", text: (l) => fmtLacs(l.revenueLacs) },
      ]);
    }

    // Heads and machines as they physically left — a different question from who
    // bought, and the sheet this replaces prints both.
    const outward = d.sales.filter(
      (l) => (l.saleType === "head" || l.saleType === "machine") && saleKind(l) !== "negative",
    );
    if (outward.length > 0) {
      y = ensureRoom(y, 80);
      const qty = outward.reduce((s, l) => s + l.qty, 0);
      y = listHeading(y, "Heads and machines outward", `${fmtQty(qty)} ${qty === 1 ? "unit" : "units"}`, "what physically left, on an invoice (SALE) or a delivery challan (DC)");
      y = drawLines(y, outward, [
        { header: "Particular", width: 5.2, text: (l) => `${l.party}_${l.item}`, wrap: true },
        { header: "Line", width: 1.2, text: (l) => SALE_TYPE_LABEL[l.saleType] },
        { header: "Type", width: 0.7, text: (l) => l.paper },
        { header: "Qty", width: 0.7, align: "right", text: (l) => fmtQty(l.qty) },
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
  const moneyPage = (key: PageKey, title: string, bands: MoneyBand[], tradeLacs: number, allLacs: number, what: string) => {
    y = openPage("portrait");
    pageOf.set(key, page);
    y = pageTitle(
      y, title,
      bankOnly
        ? "Not reported for a banking location."
        : `${fmtMoney(tradeLacs)} with customers and suppliers is the figure on page one. Every counterparty Tally recorded comes to ${fmtMoney(allLacs)}. One line per party.`,
      bankOnly ? undefined : fmtMoney(tradeLacs),
    );
    if (bankOnly || bands.length === 0) {
      y = paragraph(y, emptyReason(what));
      return;
    }
    const drawBand = (b: MoneyBand) => {
      const rows = pivotMoney(b.rows);
      y = ensureRoom(y, listRoom(rows, false));
      y = listHeading(
        y, PARTY_KIND_LABEL[b.kind], fmtMoney(b.totalLacs),
        `${rows.length} ${listNoun(b.kind, rows.length)} · ${b.rows.length} ${b.rows.length === 1 ? "entry" : "entries"}`,
      );
      y = drawPivot(y, rows, null, b.kind);
    };
    const trade = bands.filter((b) => TRADE_BANDS.includes(b.kind));
    const other = bands.filter((b) => !TRADE_BANDS.includes(b.kind));
    trade.forEach(drawBand);
    if (other.length > 0) {
      y = ensureRoom(y, 110);
      y = captionRule(y, "Not counted in the figure above") + 4;
      other.forEach(drawBand);
    }
    // The all-counterparties figure, as a closing line rather than a navy bar.
    y = ensureRoom(y, 24);
    setDraw(pdf, BRAND.lineStrong);
    pdf.setLineWidth(0.7);
    pdf.line(MARGIN, y, rightEdge(), y);
    text(pdf, "Everything Tally recorded", MARGIN, y + 13, { size: 8.4, bold: true });
    text(pdf, fmtMoney(allLacs), rightEdge(), y + 13, { size: 8.4, bold: true, align: "right" });
    y += 30;
  };

  moneyPage("in", "Money in", received, receivedLacs, receivedAllLacs, "receipts");
  moneyPage("out", "Money out", paid, paidLacs, paidAllLacs, "payments");

  // Purchases on the Money out page, under a heading of their own. A purchase is
  // a bill, not a payment, and it is never added into the figure above.
  if (!bankOnly && d.purchases.length > 0) {
    y = ensureRoom(y, 80);
    y = listHeading(y, "Purchases", fmtMoney(purchasedLacs), "net of GST · a bill, not a payment — not in the figure above");
    y = drawLines(y, d.purchases, [
      { header: "Supplier", width: 2.6, text: (p) => p.party, wrap: true },
      { header: "Item", width: 3.0, text: (p) => p.item, wrap: true },
      { header: "Qty", width: 1.0, align: "right", text: (p) => `${fmtQty(p.qty)}${p.unit ? ` ${p.unit}` : ""}` },
      { header: "₹ L", width: 0.9, align: "right", text: (p) => fmtLacs(p.amountLacs) },
    ]);
  }

  /* ================================================================= Bank */
  //
  // LAST, AND IN LANDSCAPE: eleven accounts plus three entity totals will not
  // read at 7pt across a portrait page. Nothing portrait follows it.
  y = openPage("landscape");
  pageOf.set("bank", page);
  y = pageTitle(y, "Bank", `As on ${dmy(d.date)}. ${BLANK_NOTE}`, bankIncomplete ? undefined : fmtMoney(bankSum));

  y = listHeading(y, "Credit facility", "", "per company, whatever the location");
  if (facility.length === 0) {
    y = paragraph(y, `No credit facility was recorded for ${dmy(d.date)}. It is entered under each company on Bank balances.`);
  } else {
    // The client's sheet column order.
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
    }) + 20;
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
    y = ensureRoom(y, 44 + (mrows.length + 1) * 14);
    const t = entityTotal(rows, d.balances, d.date);
    y = listHeading(y, entityLabel(alias), t.totalLacs == null ? "" : fmtMoney(t.totalLacs), `${d.dates.length} days to ${dmy(d.date)}`);
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
            const tt = entityTotal(rows, d.balances, r.iso);
            return tt.totalLacs == null ? "—" : fmtLacs(tt.totalLacs);
          },
        },
      ],
    }) + 20;
  }

  // How to read the figures closes the document — off page one, which is only a summary.
  y = ensureRoom(y, noteBlockHeight(pdf, contentW(pdf), notes));
  noteBlock(pdf, { x: MARGIN, y, width: contentW(pdf), title: "How to read this", lines: notes });

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
