/**
 * exportCollectionsPdf.ts — the branded PDF for the three Collection Performance reports
 * (Zero Collections, Below-N%, Dormant Debtors).
 *
 * THE SHAPE
 *   Page 1 is the contents page: what the report covers, the report's own KPI cards plus a strip
 *   splitting the overdue by sale type, a salesperson league table ranked by overdue, and a short
 *   read-out of what the figures say. Every salesperson name on the table is a link.
 *   Pages 2..N are one salesperson each: their headline figures, the top slice of their customers
 *   BY OVERDUE, their own read-out, and a link back to the contents page.
 *
 * WHY TOP 20% BY OVERDUE, NOT BY OUTSTANDING
 *   Outstanding includes money that is not due yet. A call-list is about what is already late,
 *   so the cut is taken on overdue. The rows still SHOW outstanding.
 *
 * WHY THE PAGE STILL FOOTS
 *   Printing a subset of a rep's customers without saying so turns a summary into a wrong
 *   number. Each rep page carries a "Remaining X customers" line and a TOTAL, so the page adds
 *   up to the figure that rep contributes on page 1.
 *
 * WHY LINKS ARE DEFERRED
 *   The contents page is drawn before the rep pages exist, so it cannot know their page numbers.
 *   Link rectangles are recorded during the draw and stamped afterwards — see `applyDeferredLinks`.
 *
 * TYPOGRAPHIC RULE FOR THIS DOCUMENT: NO EM DASHES IN THE RENDERED COPY.
 *   Every string that reaches the page uses commas, colons or full stops instead, and an empty
 *   cell reads as a plain hyphen. (The rule is about the printed report; these source comments
 *   are not part of it.)
 */

// Statically imported, like every other export module here. A dynamic import would buy nothing:
// `exportCustomer.ts` already pulls jsPDF in statically, so it is in the bundle either way (vite
// says as much at build time). The genuine deferral is the FONT, which is fetched at export time
// from /assets/fonts — see pdfBrand.loadBrandAssets.
import jsPDF from "jspdf";
import { formatDateDMY, fmtINRMoney } from "./utils";
import {
  BRAND, CONTENT_W, MARGIN, MINI_CARD_H, PAGE_H,
  applyDeferredLinks, divider, drawTable, ellipsize, footer, headerBand, homeIcon,
  loadBrandAssets, metaStrip, miniCard, noteBlock, noteBlockHeight, pageWash,
  registerBrandFonts, sectionHeading, statCard, text, widthOf, wrapText,
  type Ctx, type DeferredLink, type PdfColumn,
} from "@/shared/lib/pdfBrand";

/** One KPI card, projected to plain data — the page's own cards carry ReactNode, which cannot
 *  cross into a renderer that knows nothing about React. */
export interface PdfKpi {
  label: string;
  value: string;
  sub?: string;
  alarm?: boolean;
  /**
   * The card's stable identity (the report's `focusKey`), NOT its label.
   *
   * Two cards get their own appendix page, and matching them on the printed label would break the
   * moment somebody rewords "> 180 Days". Only `never` and `over180` mean anything here; every
   * other key is carried and ignored.
   */
  key?: string;
}

/**
 * One customer line under a salesperson.
 *
 * `name` is the customer's name and NOTHING ELSE. It used to carry the trading company and branch
 * appended ("ACME · Enterprise / Colorix · Surat"), which is internal structure: it doubled the
 * width of the widest column, pushed real names into an ellipsis, and told the reader nothing they
 * could act on. Company and branch still exist per bill on the workbook's Overdue Bill Details
 * tab, which is where a reader who needs them is already looking.
 *
 * Money stays numeric so the renderer can rank and compute shares; the two last-receipt fields
 * arrive pre-formatted because they are per-customer facts the caller already renders.
 */
export interface PdfCustomerRow {
  name: string;
  outstanding: number;
  overdue: number;
  lastReceipt: string;
  lastReceiptAmount: string;
  /** No receipt anywhere in the data horizon. Feeds the read-out and the Never Paid appendix. */
  neverPaid?: boolean;
  /** Money on bills more than 180 days past due. Feeds the Over 180 Days appendix. */
  over180?: number;
}

export interface PdfSalespersonBlock {
  name: string;
  customers: number;
  outstanding: number;
  overdue: number;
  /** Worst days-past-due anywhere in their book (0 = unknown). Read-out only. */
  maxOverdueDays?: number;
  /** How many of their customers have never paid. Read-out only. */
  neverPaid?: number;
  /** ALL of this salesperson's customers. The renderer takes the top slice by overdue itself. */
  rows: PdfCustomerRow[];
}

/** Overdue split by the customer's dominant sale type, for the secondary card strip. */
export interface PdfSaleTypeStat {
  label: string;
  customers: number;
  overdue: number;
}

export interface CollectionsPdfInput {
  title: string;
  subtitle: string;
  /** ISO date the report is stated as on. */
  asOfDate: string;
  periodLabel: string;
  /** The active filter chips, verbatim from the screen. */
  filterSummary: string[];
  kpis: PdfKpi[];
  /**
   * Overdue by sale type over the SAME rows this document covers, so the strip sums to the
   * Overdue figure on the cards above it.
   *
   * (The on-screen strip deliberately spans the rows from BEFORE the sale-type filter, so that
   * clicking a type still WIDENS the report. A printed page cannot be clicked, and two totals
   * that disagree on one sheet of paper read as an error, so the document takes the split over
   * its own rows instead.)
   */
  saleTypes?: PdfSaleTypeStat[];
  /**
   * Set ONLY when a KPI lens is active, and then it must be printed.
   *
   * The report's cards are deliberately computed over the UNFOCUSED rows — they are a fixed set
   * of lenses over the same customers, so clicking one must not silently redefine the others.
   * The table below them follows the lens. On screen that gap is explained on hover; in a
   * document there is no hover, and two different "Outstanding" figures on one page read as an
   * error. So the page says which is which.
   */
  kpiScopeNote?: string;
  /**
   * True when the KPI cards describe EXACTLY the rows this document lists.
   *
   * The two appendix pages are built from this document's own rows, so a card may only link to
   * one (and print its customer count) when the two populations are the same. They are not on a
   * per-salesperson extract, where the cards still carry the whole book, nor when a KPI lens is
   * active, where the cards span the report and the tables span the lens. Linking anyway would
   * put "Never Paid 38" one click away from a list of four, which reads as a broken report.
   */
  cardsMatchRows?: boolean;
  salespersons: PdfSalespersonBlock[];
  total: {
    customers: number;
    outstanding: number;
    overdue: number;
    /** Book-level colour for the read-out. Absent simply means that bullet is not printed. */
    over180?: number;
    neverPaid?: number;
    stillBuying?: number;
  };
  /**
   * Printed under the contents title on a per-salesperson export. A customer owned by two reps
   * belongs to both files, so a set of per-rep exports sums to more than the consolidated one —
   * which a reader comparing two files must be told rather than left to discover.
   */
  overlapNote?: string;
}

/**
 * The share of a salesperson's customers printed on their page.
 *
 * The cap is what keeps a rep page to ONE page. At 25 rows the table, its two closing rows and
 * the read-out below it still clear the footer on A4; a rep page that spills is a rep page whose
 * "Top N of M" heading stops matching what is actually on it.
 */
const TOP_SHARE = 0.2;
const MIN_ROWS = 5;
const MAX_ROWS = 25;

/** An empty cell. A plain hyphen, never an em dash — see the file header. */
const NIL = "-";

const pctText = (part: number, whole: number): string =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : NIL;

/** How many customers to print for a salesperson: 20%, but never fewer than 5 (a small book must
 *  still say something) and never more than 25 (one page). */
export function topCount(n: number): number {
  if (n <= MIN_ROWS) return n;
  return Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.ceil(n * TOP_SHARE)));
}

const money = (n: number) => fmtINRMoney(n);

/**
 * How many of these values (largest first) it takes to reach `target`.
 *
 * This is the basis of the read-out: "4 of 13 salespersons hold half the overdue" is a sentence
 * someone can act on, where a list of thirteen percentages is not.
 */
function paretoCount(sortedDesc: readonly number[], target: number): number {
  let acc = 0;
  for (let i = 0; i < sortedDesc.length; i++) {
    acc += sortedDesc[i];
    if (acc >= target) return i + 1;
  }
  return sortedDesc.length;
}

function stamp(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The contents-page read-out.
 *
 * ⚠ THIS IS COMPUTED, NOT WRITTEN BY A LANGUAGE MODEL. Every sentence is a fixed template filled
 *   from figures that are already on the page, so it cannot state anything the tables do not, and
 *   it cannot invent a customer or a number. That is deliberate: this text goes out as an email
 *   attachment that nobody re-reads before sending, to people who will act on it. If a real model
 *   is ever wired in it belongs behind a server proxy (the hub's AI chat was left unported
 *   precisely because the browser build shipped the API key), and its output should sit BESIDE
 *   these lines rather than replace them.
 */
function bookInsights(input: CollectionsPdfInput, reps: readonly PdfSalespersonBlock[]): string[] {
  const out: string[] = [];
  const t = input.total;
  const od = t.overdue;

  // Only worth saying when it names more than one person: at k=1 the bullet below already says
  // who it is, and "1 of 5 salespersons hold ... working those 1 books" is not a sentence.
  if (reps.length > 1 && od > 0.5) {
    const k = paretoCount(reps.map((r) => r.overdue), od * 0.5);
    if (k > 1) {
      const held = reps.slice(0, k).reduce((s, r) => s + r.overdue, 0);
      out.push(
        `${k} of ${reps.length} salespersons hold ${pctText(held, od)} of the overdue ` +
        `(${money(held)} of ${money(od)}). Working those ${k} books moves most of the money.`,
      );
    }
  }

  const top = reps[0];
  if (top && top.overdue > 0.5) {
    out.push(
      `${top.name} is the single largest exposure: ${money(top.overdue)} overdue across ${top.customers} customers, ` +
      `${pctText(top.overdue, od)} of the total.`,
    );
  }

  if (t.neverPaid) {
    out.push(
      `${t.neverPaid} of ${t.customers} customers have never paid at all. ` +
      `Those are credit decisions to review, not collection calls.`,
    );
  }

  if (t.over180 && t.over180 > 0.5) {
    out.push(
      `${money(t.over180)} (${pctText(t.over180, t.outstanding)} of outstanding) is older than 180 days, ` +
      `which is the hardest money in the book to recover.`,
    );
  }

  if (t.stillBuying) {
    out.push(
      `${t.stillBuying} customers were billed again in this period while paying nothing. ` +
      `Supply to those accounts is worth a second look.`,
    );
  }

  const types = [...(input.saleTypes ?? [])].sort((a, b) => b.overdue - a.overdue);
  if (types.length > 1 && od > 0.5 && types[0].overdue / od >= 0.4) {
    out.push(`Overdue is concentrated in ${types[0].label}, which carries ${pctText(types[0].overdue, od)} of it.`);
  }

  return out.slice(0, 5);
}

/** The same treatment for one salesperson's page. Computed, not model-generated: see above. */
function repInsights(
  rep: PdfSalespersonBlock,
  sorted: readonly PdfCustomerRow[],
  shown: readonly PdfCustomerRow[],
  rank: number,
  repCount: number,
  bookOverdue: number,
): string[] {
  if (rep.overdue <= 0.5) {
    return [`${rep.name} has no overdue in this period. The outstanding above is not yet due.`];
  }

  const out: string[] = [
    `Ranked ${rank} of ${repCount} by overdue, holding ${pctText(rep.overdue, bookOverdue)} of the company's ` +
    `overdue across ${rep.customers} customers.`,
  ];

  if (sorted.length > 1) {
    const k = paretoCount(sorted.map((r) => r.overdue), rep.overdue * 0.5);
    out.push(
      `${k} customer${k === 1 ? "" : "s"} account for ${pctText(held(sorted, k), rep.overdue)} of that overdue, ` +
      `so this book is not evenly weighted.`,
    );
  }

  const biggest = sorted[0];
  if (biggest) {
    out.push(
      `${biggest.name} is the largest single account at ${money(biggest.overdue)} overdue, ` +
      `${pctText(biggest.overdue, rep.overdue)} of this book.`,
    );
  }

  // `rep.neverPaid` counts the WHOLE book, not the rows printed above it, so the sentence has to
  // say "of their N customers". Saying "of these" while the page shows a 25-row slice of 140 would
  // read as a claim about the slice, which is exactly the kind of quiet wrongness a report like
  // this cannot afford. The fallback counts the printed rows and says so honestly.
  const never = rep.neverPaid;
  if (never !== undefined && never > 0) {
    out.push(`${never} of their ${rep.customers} customers have no receipt on record at all.`);
  } else if (never === undefined) {
    const shownNever = shown.filter((r) => r.neverPaid).length;
    if (shownNever > 0) out.push(`${shownNever} of the customers listed above have never paid.`);
  }

  if (rep.maxOverdueDays && rep.maxOverdueDays > 0) {
    out.push(`The oldest unpaid bill in this book is ${Math.round(rep.maxOverdueDays)} days past its due date.`);
  }

  // The action line is appended AFTER the cap, never inside it. It is the only bullet that tells
  // the reader what to do next, so it must not be the one squeezed out when a book happens to
  // trip every other observation.
  const capped = out.slice(0, 4);
  const calls = shown.slice(0, 3).map((r) => r.name);
  if (calls.length) capped.push(`Start with: ${calls.join(", ")}.`);
  return capped;
}

/** Overdue held by the first `k` of a descending list. */
function held(rows: readonly PdfCustomerRow[], k: number): number {
  return rows.slice(0, k).reduce((s, r) => s + r.overdue, 0);
}

// ── Appendices ──────────────────────────────────────────────────────────────────────

/**
 * One customer on an appendix page, carrying the salesperson it belongs to.
 *
 * The appendices cut ACROSS salespersons, which is the whole reason they are worth a page: "who
 * has never paid" is a credit question, and the answer is useless without the name of the person
 * who owns the account.
 */
interface AppendixRow extends PdfCustomerRow {
  salesperson: string;
}

/** Every customer in the document, tagged with their salesperson. */
function allRows(reps: readonly PdfSalespersonBlock[]): AppendixRow[] {
  return reps.flatMap((rep) => rep.rows.map((r) => ({ ...r, salesperson: rep.name })));
}

/** The two appendix definitions: which rows, how to rank them, and what the page says. */
interface Appendix {
  /** Matches `PdfKpi.key`, so the card that links here is found by identity, not by label. */
  cardKey: string;
  title: string;
  blurb: string;
  /** The list, sorted descending by `metric`. Printed in full: see the note on the page loop. */
  rows: AppendixRow[];
  /** The figure the list is ranked, cut and percentage-split by. */
  metric: (r: AppendixRow) => number;
  /** Header for the percentage column, e.g. "% of Overdue". */
  pctHeader: string;
  /** The extra money column this list exists to show, if any. */
  extra?: { header: string; value: (r: AppendixRow) => number };
  /**
   * Print the Last Receipt column.
   *
   * Off for Never Paid, where every cell would read "Never" by definition: a column with one
   * repeated value is width spent on nothing.
   */
  showLastReceipt: boolean;
  /**
   * Append "· N customers" to the linking card's sub-line.
   *
   * Only for cards whose VALUE is money. "Never Paid" already prints the count as its value, so
   * repeating it in the sub would just be the same number twice on one card.
   */
  countInSub: boolean;
}

/** Link key for an appendix page. Prefixed so it can never collide with a salesperson's name. */
const appendixKey = (a: Appendix): string => `__appendix_${a.cardKey}__`;

/** The appendix pages this document carries, in page order. Empty lists get no page. */
function appendicesOf(reps: readonly PdfSalespersonBlock[]): Appendix[] {
  const rows = allRows(reps);
  // Annotated, so `extra.value`'s parameter is contextually typed rather than implicitly any.
  const all: Appendix[] = [
    {
      cardKey: "never",
      title: "Never Paid",
      blurb:
        "Customers with no receipt anywhere in the data horizon. Ranked by overdue: with no " +
        "payment history behind them, the money already past its due date is what needs deciding on.",
      rows: rows.filter((r) => r.neverPaid).sort((a, b) => b.overdue - a.overdue),
      metric: (r) => r.overdue,
      pctHeader: "% of Overdue",
      // Every row here is "Never" by definition.
      showLastReceipt: false,
      countInSub: false,
    },
    {
      cardKey: "over180",
      title: "Over 180 Days",
      blurb:
        "Customers carrying money on bills more than 180 days past due. Ranked by that figure, " +
        "which is the oldest and hardest money in the book to recover.",
      rows: rows.filter((r) => (r.over180 ?? 0) > 0.5).sort((a, b) => (b.over180 ?? 0) - (a.over180 ?? 0)),
      metric: (r) => r.over180 ?? 0,
      pctHeader: "% of > 180",
      extra: { header: "> 180 Days", value: (r) => r.over180 ?? 0 },
      showLastReceipt: true,
      countInSub: true,
    },
  ];
  return all.filter((a) => a.rows.length > 0);
}

/** Build the whole document and hand back the bytes. The caller decides whether to save it,
 *  zip it or attach it to an email — which is why this returns a Blob rather than downloading. */
export async function buildCollectionsPdf(input: CollectionsPdfInput): Promise<Blob> {
  const assets = await loadBrandAssets();
  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4", compress: true });
  registerBrandFonts(pdf, assets);
  pdf.setDocumentProperties({
    title: input.title,
    subject: `${input.subtitle} As on ${formatDateDMY(input.asOfDate)}.`,
    author: "Orange O Tec",
    creator: "Orange One",
  });

  const TP = "{tp}"; // placeholder swapped for the real page count by putTotalPages
  const ctx: Ctx = { pdf, assets, totalPagesToken: TP };
  const generatedAt = stamp();
  const links: DeferredLink[] = [];

  /** Bottom of the drawable area, clear of the footer rule. */
  const FLOOR = PAGE_H - 52;

  /**
   * The "Back to Home" affordance, on every page that is not page 1.
   *
   * Called "Home" with a drawn house rather than "Contents" with an arrow: the reader of a mailed
   * PDF is a salesperson, not a technical-manual reader, and a house says "the front page" without
   * having to be learned. The mark is drawn because Poppins carries no icon glyphs at all.
   * Returns the baseline it drew on.
   */
  const homeLink = (p: typeof pdf, baseline: number): number => {
    const label = "Back to Home";
    const w = widthOf(p, label, 7.6, true);
    homeIcon(p, MARGIN + 4, baseline - 3, 8.5, BRAND.orange);
    text(p, label, MARGIN + 13, baseline, { size: 7.6, bold: true, color: BRAND.orange });
    p.link(MARGIN - 2, baseline - 10, w + 18, 14, { pageNumber: 1 });
    return baseline;
  };

  /**
   * Start a fresh page carrying the same chrome, and return the y to draw at.
   *
   * Every continuation page gets the Home link too. A long list spills across pages, and a reader
   * who lands on page 9 of an appendix should not have to scroll back to page 8 to find the way
   * out. Page 1 is the only page in the document without one, because it IS home.
   */
  const newPage = (): number => {
    pdf.addPage();
    pageWash(pdf);
    const top = headerBand(ctx, { tag: input.title, compact: true }) + 18;
    return homeLink(pdf, top) + 14;
  };

  /** Break to a new page if `needed` points will not fit below `y`. */
  const ensureRoom = (y: number, needed: number): number => (y + needed <= FLOOR ? y : newPage());

  // Ranked once, here: the league table, the page order and the bookmark order must agree.
  const reps = [...input.salespersons].sort((a, b) => b.overdue - a.overdue);

  // The appendix pages this document will carry, and the cards permitted to link to them.
  const appendices = appendicesOf(reps);
  const linkableCards = new Map<string, Appendix>(
    input.cardsMatchRows ? appendices.map((a) => [a.cardKey, a] as const) : [],
  );

  // ── Contents page ─────────────────────────────────────────────────────────────────
  pageWash(pdf);
  let y = headerBand(ctx, { tag: input.title }) + 22;

  // THE HEADLINE BLOCK: the title, what the report actually means, then the two facts that make
  // every figure below it legible (as on, period) raised into their own card. Those two used to
  // sit inside a run-on grey line alongside the filter list, where they were skipped.
  text(pdf, input.title, MARGIN, y, { size: 19, bold: true });
  y += 20;

  for (const line of wrapText(pdf, input.subtitle, CONTENT_W, 9.5)) {
    text(pdf, line, MARGIN, y, { size: 9.5, color: BRAND.grey });
    y += 12;
  }
  y += 6;

  y = metaStrip(pdf, MARGIN, y, CONTENT_W, [
    { label: "As on", value: formatDateDMY(input.asOfDate) },
    { label: "Period", value: input.periodLabel },
  ]) + 13;

  // The filters, demoted to one quiet line. They must be RECORDED (the workbook drops them, so
  // without this a mailed copy cannot be traced back to the screen that produced it) but they are
  // not what the reader came for, so they get a single ellipsized line rather than three.
  text(
    pdf,
    ellipsize(
      pdf,
      input.filterSummary.length ? `Filters: ${input.filterSummary.join(" · ")}` : "Filters: none",
      CONTENT_W, 7.2,
    ),
    MARGIN, y, { size: 7.2, color: BRAND.grey2 },
  );
  y += 9;

  if (input.overlapNote) {
    for (const line of wrapText(pdf, input.overlapNote, CONTENT_W, 7.2)) {
      text(pdf, line, MARGIN, y, { size: 7.2, color: BRAND.orange });
      y += 9;
    }
  }

  y = divider(pdf, MARGIN, y + 5, CONTENT_W) + 14;

  // ── At a glance ───────────────────────────────────────────────────────────────────
  if (input.kpis.length) {
    y = sectionHeading(pdf, MARGIN, y, "At a glance") + 5;
    if (input.kpiScopeNote) {
      for (const line of wrapText(pdf, input.kpiScopeNote, CONTENT_W, 7)) {
        text(pdf, line, MARGIN, y, { size: 7, color: BRAND.orange });
        y += 9;
      }
      y += 3;
    }
    const perRow = 3;
    const gap = 10;
    const cardW = (CONTENT_W - gap * (perRow - 1)) / perRow;
    const cardH = 54;
    input.kpis.forEach((k, i) => {
      const cx = MARGIN + (i % perRow) * (cardW + gap);
      const cy = y + Math.floor(i / perRow) * (cardH + gap);
      // A card links to its appendix only when the two describe the same customers. See
      // `cardsMatchRows`; without that guard a card's figure and its list disagree.
      const app = linkableCards.get(k.key ?? "");
      const sub = app?.countInSub
        ? `${k.sub ? `${k.sub} · ` : ""}${app.rows.length} customer${app.rows.length === 1 ? "" : "s"}`
        : k.sub;
      statCard(pdf, cx, cy, cardW, cardH, { ...k, sub, link: app !== undefined });
      if (app) {
        // Whole-card hit area, recorded now and stamped once the appendix pages exist.
        links.push({ key: appendixKey(app), page: 1, x: cx, y: cy, w: cardW, h: cardH });
      }
    });
    y += Math.ceil(input.kpis.length / perRow) * (cardH + gap) - gap;
  }

  // The sale-type split, as a SECOND and quieter row of cards. Full-size cards here would give ten
  // equally loud boxes and no headline; at this size they read as a breakdown of the Overdue card
  // above them, which is what they are.
  const types = [...(input.saleTypes ?? [])]
    .filter((t) => t.customers > 0)
    .sort((a, b) => b.overdue - a.overdue);
  if (types.length) {
    y += 14;
    y = sectionHeading(pdf, MARGIN, y, "Overdue by sale type") + 5;
    const perRow = Math.min(5, types.length);
    const gap = 8;
    const cardW = (CONTENT_W - gap * (perRow - 1)) / perRow;
    types.forEach((t, i) => {
      miniCard(
        pdf,
        MARGIN + (i % perRow) * (cardW + gap),
        y + Math.floor(i / perRow) * (MINI_CARD_H + gap),
        cardW,
        {
          label: t.label,
          value: money(t.overdue),
          sub: `${t.customers} cust · ${pctText(t.overdue, input.total.overdue)}`,
        },
      );
    });
    y += Math.ceil(types.length / perRow) * (MINI_CARD_H + gap) - gap;
  }

  y = divider(pdf, MARGIN, y + 15, CONTENT_W) + 15;

  // ── League table ──────────────────────────────────────────────────────────────────
  y = sectionHeading(pdf, MARGIN, y, "By salesperson", "Ranked by overdue") + 6;

  interface LeagueRow {
    key: string;
    label: string;
    customers: string;
    outstanding: number;
    overdue: number;
    grand?: boolean;
  }
  const leagueRows: LeagueRow[] = [
    ...reps.map((r) => ({
      key: r.name,
      label: r.name,
      customers: String(r.customers),
      outstanding: r.outstanding,
      overdue: r.overdue,
    })),
    {
      key: "__total__",
      label: "GRAND TOTAL",
      customers: String(input.total.customers),
      outstanding: input.total.outstanding,
      overdue: input.total.overdue,
      grand: true,
    },
  ];

  const leagueCols: PdfColumn<LeagueRow>[] = [
    {
      header: "Salesperson", width: 30, value: (r) => r.label,
      linkKey: (r) => (r.grand ? undefined : r.key),
    },
    { header: "Customers", width: 11, align: "right", value: (r) => r.customers },
    { header: "Outstanding", width: 15, align: "right", value: (r) => money(r.outstanding) },
    { header: "% of Outst.", width: 11, align: "right", value: (r) => (r.grand ? "100.0%" : pctText(r.outstanding, input.total.outstanding)) },
    {
      header: "Overdue", width: 15, align: "right", value: (r) => money(r.overdue),
      color: (r) => (r.grand ? undefined : r.overdue > 0.5 ? BRAND.red : undefined),
    },
    { header: "% of Overdue", width: 12, align: "right", value: (r) => (r.grand ? "100.0%" : pctText(r.overdue, input.total.overdue)) },
  ];

  y = drawTable<LeagueRow>(pdf, {
    x: MARGIN, y, width: CONTENT_W,
    columns: leagueCols,
    rows: leagueRows,
    rowKind: (r) => (r.grand ? "grand" : "normal"),
    linkSink: links,
    maxY: FLOOR,
    onNewPage: newPage,
  });

  // ── The contents-page read-out ────────────────────────────────────────────────────
  const bookLines = bookInsights(input, reps);
  if (bookLines.length) {
    y += 18;
    y = ensureRoom(y, noteBlockHeight(pdf, CONTENT_W, bookLines));
    noteBlock(pdf, { x: MARGIN, y, width: CONTENT_W, title: "Analysis", lines: bookLines });
  }

  // ── One page per salesperson ──────────────────────────────────────────────────────
  const pageOf = new Map<string, number>();

  reps.forEach((rep, idx) => {
    pdf.addPage();
    pageWash(pdf);
    pageOf.set(rep.name, pdf.getNumberOfPages());

    let ry = headerBand(ctx, { tag: input.title, compact: true }) + 20;

    ry = homeLink(pdf, ry) + 26;

    text(pdf, ellipsize(pdf, rep.name, CONTENT_W, 16, true), MARGIN, ry, { size: 16, bold: true });
    ry += 20;

    const sorted = [...rep.rows].sort((a, b) => b.overdue - a.overdue);
    const take = topCount(sorted.length);
    const shown = sorted.slice(0, take);
    const rest = sorted.slice(take);
    const restOutstanding = rest.reduce((s, r) => s + r.outstanding, 0);
    const restOverdue = rest.reduce((s, r) => s + r.overdue, 0);

    text(
      pdf,
      `${rep.customers} customers · Outstanding ${money(rep.outstanding)} (${pctText(rep.outstanding, input.total.outstanding)} of book) · Overdue ${money(rep.overdue)} (${pctText(rep.overdue, input.total.overdue)} of book)`,
      MARGIN, ry, { size: 8, color: BRAND.grey, maxWidth: CONTENT_W },
    );
    ry += 24;

    ry = sectionHeading(pdf, MARGIN, ry, `Top ${take} of ${sorted.length} customers by overdue`) + 7;

    interface CustRow {
      label: string;
      outstanding: number; overdue: number;
      lastReceipt: string; lastReceiptAmount: string;
      kind: "normal" | "muted" | "total";
    }
    const custRows: CustRow[] = shown.map((r) => ({
      label: r.name,
      outstanding: r.outstanding, overdue: r.overdue,
      lastReceipt: r.lastReceipt, lastReceiptAmount: r.lastReceiptAmount,
      kind: "normal" as const,
    }));
    if (rest.length) {
      custRows.push({
        label: `Remaining ${rest.length} customer${rest.length === 1 ? "" : "s"}`,
        outstanding: restOutstanding, overdue: restOverdue,
        lastReceipt: NIL, lastReceiptAmount: NIL, kind: "muted",
      });
    }
    custRows.push({
      label: "TOTAL", outstanding: rep.outstanding, overdue: rep.overdue,
      lastReceipt: NIL, lastReceiptAmount: NIL, kind: "total",
    });

    // Widths are ratios. Customer takes the most because ledger names run long, and anything it
    // cannot fit is ellipsized — a truncated customer name is the one thing on this page a reader
    // cannot reconstruct. It got wider once the company/branch suffix came off the name.
    const custCols: PdfColumn<CustRow>[] = [
      { header: "Customer", width: 38, value: (r) => r.label },
      { header: "Outstanding", width: 13, align: "right", value: (r) => money(r.outstanding) },
      {
        header: "Overdue", width: 13, align: "right", value: (r) => money(r.overdue),
        color: (r) => (r.kind === "normal" && r.overdue > 0.5 ? BRAND.red : undefined),
      },
      { header: "% of Overdue", width: 12, align: "right", value: (r) => (r.kind === "total" ? "100.0%" : pctText(r.overdue, rep.overdue)) },
      { header: "Last Receipt", width: 12, align: "right", value: (r) => r.lastReceipt },
      { header: "Last Receipt ₹", width: 12, align: "right", value: (r) => r.lastReceiptAmount },
    ];

    ry = drawTable<CustRow>(pdf, {
      x: MARGIN, y: ry, width: CONTENT_W,
      columns: custCols,
      rows: custRows,
      rowKind: (r) => (r.kind === "total" ? "total" : r.kind),
      rowH: 14,
      maxY: FLOOR,
      onNewPage: newPage,
    });

    // ── The rep's read-out ──────────────────────────────────────────────────────────
    //
    // This replaced a twenty-bar "Overdue distribution" strip. The bars restated the "% of
    // Overdue" column immediately above them and nothing else, so they spent a third of the page
    // saying what the table had already said. The read-out uses that space to say what the
    // figures MEAN, which the table cannot.
    const lines = repInsights(rep, sorted, shown, idx + 1, reps.length, input.total.overdue);
    if (lines.length) {
      ry += 20;
      ry = ensureRoom(ry, noteBlockHeight(pdf, CONTENT_W, lines));
      noteBlock(pdf, { x: MARGIN, y: ry, width: CONTENT_W, title: "Analysis", lines });
    }
  });

  // ── Appendix pages ────────────────────────────────────────────────────────────────
  //
  // Placed at the END rather than after page 1 on purpose: the document's spine is "the book,
  // then one page per salesperson", and these two lists cut across every salesperson. Reached by
  // clicking their card, or from the bookmark pane, so their position costs the reader nothing.
  // They are NOT capped: a list that silently stops at 25 is worse than several pages.
  for (const app of appendices) {
    pdf.addPage();
    pageWash(pdf);
    pageOf.set(appendixKey(app), pdf.getNumberOfPages());

    let ay = headerBand(ctx, { tag: input.title, compact: true }) + 20;
    ay = homeLink(pdf, ay) + 26;

    text(pdf, app.title, MARGIN, ay, { size: 16, bold: true });
    ay += 18;

    for (const line of wrapText(pdf, app.blurb, CONTENT_W, 8)) {
      text(pdf, line, MARGIN, ay, { size: 8, color: BRAND.grey });
      ay += 11;
    }
    ay += 13;

    const sum = (rows: readonly AppendixRow[], of: (r: AppendixRow) => number) =>
      rows.reduce((s, r) => s + of(r), 0);

    const outstanding = sum(app.rows, (r) => r.outstanding);
    const overdue = sum(app.rows, (r) => r.overdue);
    const metricTotal = sum(app.rows, app.metric);
    const extraTotal = app.extra ? sum(app.rows, app.extra.value) : 0;

    ay = sectionHeading(
      pdf, MARGIN, ay,
      `${app.rows.length} customer${app.rows.length === 1 ? "" : "s"} · Outstanding ${money(outstanding)} · Overdue ${money(overdue)}`,
    ) + 11;

    // EVERY row, however many pages that takes. These lists are worked through, not skimmed: a
    // customer who has never paid does not stop being a credit decision because they rank 90th,
    // and an appendix that quietly ended at a cut-off would be read as the complete list.
    interface AppRow { row?: AppendixRow; total?: boolean }
    const tableRows: AppRow[] = [...app.rows.map((row) => ({ row })), { total: true }];

    /** A cell that is one figure on a customer row, and the roll-up on the closing TOTAL. */
    const cell = (of: (r: AppendixRow) => number, grand: number) =>
      (r: AppRow) => money(r.total ? grand : of(r.row!));

    const cols: PdfColumn<AppRow>[] = [
      // Customer takes the most: a truncated ledger name is the one thing on this page a reader
      // cannot reconstruct, and unlike the salesperson-page tables this one also has to fit a
      // salesperson column.
      {
        header: "Customer", width: app.showLastReceipt ? 33 : 36,
        value: (r) => (r.total ? "TOTAL" : r.row!.name),
      },
      { header: "Salesperson", width: app.showLastReceipt ? 11 : 18, value: (r) => (r.row ? r.row.salesperson : "") },
      {
        header: "Outstanding", width: 12, align: "right",
        value: cell((r) => r.outstanding, outstanding),
      },
      {
        header: "Overdue", width: 12, align: "right",
        value: cell((r) => r.overdue, overdue),
        color: (r) => (r.row && r.row.overdue > 0.5 ? BRAND.red : undefined),
      },
      ...(app.extra
        ? [{
            header: app.extra.header, width: 12, align: "right" as const,
            value: cell(app.extra.value, extraTotal),
            color: (r: AppRow) => (r.row ? BRAND.red : undefined),
          }]
        : []),
      {
        // Narrowed to 10 to fund Last Receipt below. 10 is the floor: the header "% of > 180" is
        // wider than any value under it, and below this it ellipsizes into "% of > 1…".
        header: app.pctHeader, width: app.showLastReceipt ? 10 : 12, align: "right",
        value: (r) => (r.total ? "100.0%" : pctText(app.metric(r.row!), metricTotal)),
      },
      ...(app.showLastReceipt
        ? [{
            // A DATE MUST NEVER ELLIPSIZE. "20-05-20…" is not a shorter date, it is an unreadable
            // one, and at the old width it happened only to SOME rows: Poppins gives "1" a
            // narrower advance than "2", so 15-07-2026 fitted where 20-05-2026 did not, which
            // reads as data corruption rather than a column that is too tight. Sized off the
            // widest possible dd-mm-yyyy with room to spare, funded from the two columns left.
            header: "Last Receipt", width: 14, align: "right" as const,
            value: (r: AppRow) => (r.row ? r.row.lastReceipt : NIL),
          }]
        : []),
    ];

    drawTable<AppRow>(pdf, {
      x: MARGIN, y: ay, width: CONTENT_W,
      columns: cols,
      rows: tableRows,
      rowKind: (r) => (r.total ? "total" : "normal"),
      rowH: 14,
      maxY: FLOOR,
      onNewPage: newPage,
    });
  }

  // ── Navigation furniture ──────────────────────────────────────────────────────────
  applyDeferredLinks(pdf, links, pageOf);

  // Bookmarks, so a reader can jump from the viewer's sidebar as well as from the table.
  try {
    // Named to match the on-page link, so the sidebar and the page agree on what page 1 is called.
    pdf.outline.add(null, "Home", { pageNumber: 1 });
    for (const rep of reps) {
      const p = pageOf.get(rep.name);
      if (p !== undefined) pdf.outline.add(null, rep.name, { pageNumber: p });
    }
    for (const app of appendices) {
      const p = pageOf.get(appendixKey(app));
      if (p !== undefined) pdf.outline.add(null, app.title, { pageNumber: p });
    }
    // Open with the bookmark pane showing — the fastest route to a salesperson.
    pdf.setDisplayMode("fullwidth", "continuous", "UseOutlines");
  } catch {
    // Bookmarks are a convenience; the in-page links are the requirement. Never fail the export.
  }

  // Footers last, so every page knows the final count.
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    footer(ctx, p, generatedAt);
  }
  pdf.putTotalPages(TP);

  return pdf.output("blob");
}

/** Safe, readable filename stem for a report + date. */
export function pdfFileName(title: string, asOfDate: string, suffix?: string): string {
  const base = title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const who = suffix ? `_${suffix.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}` : "";
  return `${base}${who}_${formatDateDMY(asOfDate) || "export"}.pdf`;
}
