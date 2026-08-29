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
import { STILL_BUYING_NOTE, hasStillBuyingCard } from "./collectionCards";
import { SALE_TYPE_ORDER, saleTypeLabel, saleTypeRank } from "./salesReport";
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
  /**
   * The customer GROUP's name, undecorated.
   *
   * ⚠ Never pre-decorated with the ledger count — `buildPdf`'s tripwire matches this against the
   *   set of group names in the rep's book, so a "(3)" baked in here would make it throw on the
   *   very rows it guards. The suffix is applied at draw time from `ledgers` below.
   */
  name: string;
  /**
   * How many ledgers the group holds. Printed as an "ABC GROUP (3)" suffix and ONLY when > 1.
   *
   * The screen and the workbook both carry this as a Customers column; the PDF has no room for one
   * (the name column is the tightest thing on the page and a truncated ledger name is the one thing
   * a reader cannot reconstruct), so it rides along with the name instead. Optional so a caller
   * that has no count still renders — the suffix is simply omitted.
   */
  ledgers?: number;
  outstanding: number;
  overdue: number;
  lastReceipt: string;
  lastReceiptAmount: string;
  /** No receipt anywhere in the data horizon. Feeds the read-out and the Never Paid appendix. */
  neverPaid?: boolean;
  /** Money on bills more than 180 days past due. Feeds the Over 180 Days appendix. */
  over180?: number;
  /** Billed at least ₹0.5 inside the period while paying nothing. Feeds the Still Buying appendix. */
  stillBuying?: boolean;
  /** ₹ billed to this customer inside the period — the figure Still Buying is about. */
  salesInWindow?: number;
  /**
   * The open past-due bills behind this customer's Overdue, including the On Account credit.
   *
   * Present ⇒ the customer's name becomes a link to a page of their own. Absent or empty ⇒ the
   * name is plain text, which is the honest rendering: a link that opens a page saying nothing
   * is worse than no link.
   */
  bills?: PdfBillRow[];
}

/** One line on a customer's bill page. `overdueDays` is null on the On Account credit line. */
export interface PdfBillRow {
  /**
   * The ledger this bill sits in — set ONLY when its group holds more than one.
   *
   * A group's bill page can span several ledgers, and without this they merge into a single list
   * with nothing to distinguish them, which is the reader's very next question. Left undefined on
   * a single-ledger group (the large majority), where it would repeat the page heading on every
   * line; the column is dropped entirely when no row carries it.
   */
  ledger?: string;
  number: string;
  date: string;
  /**
   * The same bill date as a raw ISO `yyyy-mm-dd`, for ORDERING only, never printed.
   *
   * `date` arrives pre-formatted as dd-mm-yyyy because that is what the page shows, and a
   * formatted date cannot be sorted: string order would put every 01- before every 02- regardless
   * of year. Optional so a caller that has no ISO form still renders; the page then falls back to
   * reading the printed date, which works for our own formatter's output and simply keeps the
   * bill's arrival order for anything it cannot parse.
   */
  sortDate?: string;
  dueDate: string;
  overdueDays: number | null;
  /** The printed label, e.g. "Spare Parts". */
  saleType: string;
  /**
   * The raw `sale_type` code behind that label, for GROUPING only, never printed.
   *
   * Same arrangement as `sortDate` above and for the same reason: the page groups its bills in the
   * business's own order (`SALE_TYPE_ORDER`), which is a property of the code, and a label cannot
   * be ranked — "Spare Parts" and "Machine" carry no sequence between them. Empty on the On
   * Account line, which belongs to no sale type.
   */
  saleTypeCode?: string;
  amount: number;
  received: number;
  pending: number;
  isOnAccount: boolean;
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

/**
 * Which document to draw.
 *
 * "book"        — the whole report. Contents page, then one page per salesperson.
 * "salesperson" — ONE rep's extract. There is no league table (a "By salesperson" table with a
 *                 single row is scaffolding, not information) and no separate rep page, so their
 *                 customers move up onto page 1 and the top of the page is compressed to fit
 *                 them. The header band already names the report, so page 1 does not repeat it.
 */
export type PdfLayout = "book" | "salesperson";

export interface CollectionsPdfInput {
  layout?: PdfLayout;
  title: string;
  subtitle: string;
  /** The salesperson this document covers, on a "salesperson" layout. */
  scopeName?: string;
  /** ISO date the report is stated as on. */
  asOfDate: string;
  /**
   * ISO date the books are described as COMPLETE to (`asOfDate` − DATA_LAG_DAYS), or "" when
   * unknown. Printed under "As on" on page 1 and in the footer of every page. A label only —
   * nothing on this document is computed against it.
   */
  dataUpdatedTill: string;
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

/**
 * Below this, an appendix row is not worth its own line.
 *
 * The Over 180 Days and Never Paid lists run to hundreds of customers, and their tails are ledgers
 * carrying one or four thousand rupees: nobody is going to make that call, and printing them
 * pushes the accounts that DO matter onto page four. They are folded into a single line that keeps
 * the count and the money, so the page still totals to the figure on the card that linked to it.
 *
 * The fold is on the figure each list is RANKED by, not always on overdue, or the folded rows
 * would not be the bottom of the list and the cut would appear at random points down the page.
 */
const SMALL_BALANCE = 10000;

/**
 * The threshold as the fold line states it: exact rupees, grouped Indian-style.
 *
 * NOT `money()`, which is the lakh/crore scale used for every figure in this document and renders
 * ten thousand rupees as "₹0.10 L". That is correct as a magnitude and useless as a rule: a reader
 * asked to accept that some customers were folded away needs to see the test that was applied, and
 * "each under ₹0.10 L" is a test nobody can check at a glance.
 */
const SMALL_BALANCE_TEXT = `₹${SMALL_BALANCE.toLocaleString("en-IN")}`;

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
 * A bill's date as something sortable: the caller's ISO form, or the printed dd-mm-yyyy read back.
 *
 * Empty for anything neither shape covers, which sinks the line to the bottom of the block rather
 * than floating it to the top on a blank string.
 */
function billDateKey(b: PdfBillRow): string {
  if (b.sortDate) return b.sortDate;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(b.date);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/**
 * Bill date, oldest first — the sequence a ledger is worked in.
 *
 * NOT days-past-due, which looks like the same order and is not: due days count from the DUE date,
 * so a March bill on 90-day terms lands below a June bill on 7-day terms and the list reads as
 * shuffled. Ties fall to the older debt, then to the bill number, so two exports of the same data
 * come out identical.
 */
function byBillDate(a: PdfBillRow, b: PdfBillRow): number {
  const ka = billDateKey(a);
  const kb = billDateKey(b);
  if (ka !== kb) {
    if (!ka) return 1;
    if (!kb) return -1;
    return ka < kb ? -1 : 1;
  }
  return (b.overdueDays ?? 0) - (a.overdueDays ?? 0) || a.number.localeCompare(b.number);
}

/** One sale type's bills on a customer's page, already in reading order. */
interface SaleTypeGroup {
  label: string;
  bills: PdfBillRow[];
}

/**
 * A customer's open bills, bucketed by sale type — Ink together, Spare Parts together.
 *
 * SALE TYPE IS THE OUTER KEY AND BILL DATE THE INNER ONE. Interleaved, a page gives no way to see
 * how much of a customer's overdue is ink and how much is hardware without adding it up by hand,
 * which is what was reported. Grouping changes the SEQUENCE and nothing else: the same bills print
 * and the page still totals to the Overdue figure that linked here.
 *
 * Groups follow `SALE_TYPE_ORDER`, the business's own sequence, so every customer's page reads the
 * same way. Anything Tally sends that we do not recognise ranks last and sorts among its own kind
 * on the code, so a new voucher type appears in a group of its own rather than vanishing into
 * another one.
 *
 * ⚠ PASS OPEN BILLS ONLY. The On Account credit is stamped `voucherType: "other"` upstream, so a
 *   caller that hands the whole list in files the deduction inside the Other group instead of
 *   leaving it at the foot of the page, where it reconciles the total.
 */
function groupBySaleType(open: readonly PdfBillRow[]): SaleTypeGroup[] {
  const byCode = new Map<string, PdfBillRow[]>();
  for (const b of open) {
    const code = b.saleTypeCode ?? "";
    const list = byCode.get(code);
    if (list) list.push(b); else byCode.set(code, [b]);
  }
  return [...byCode.keys()]
    .sort((a, b) => {
      const ra = saleTypeRank(a);
      const rb = saleTypeRank(b);
      if (ra !== rb) return ra - rb;
      // Both unranked: order on the code so two exports of the same data come out identical.
      return ra === SALE_TYPE_ORDER.length ? a.localeCompare(b) : 0;
    })
    .map((code) => ({
      // A bill whose type never arrived would otherwise head a nameless band.
      label: code ? saleTypeLabel(code) : "Unspecified",
      bills: [...(byCode.get(code) ?? [])].sort(byBillDate),
    }));
}

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
  /** On a rep extract the read-out shares page 1 with the whole customer table, so it is cut to
   *  the two lines that are actually about THEM plus the action line. */
  brief = false,
): string[] {
  if (rep.overdue <= 0.5) {
    return [`${rep.name} has no overdue in this period. The outstanding above is not yet due.`];
  }

  const out: string[] = [];

  // Only when there is a field to be ranked against. On a rep extract this document holds exactly
  // one salesperson, so the line came out as "Ranked 1 of 1 by overdue, holding 100.0% of the
  // company's overdue" — a placing against nobody, and a share of a total that is the rep's own,
  // not the company's. Two sentences of scaffolding stated as fact.
  if (repCount > 1) {
    out.push(
      `Ranked ${rank} of ${repCount} by overdue, holding ${pctText(rep.overdue, bookOverdue)} of the company's ` +
      `overdue across ${rep.customers} customers.`,
    );
  } else {
    out.push(`${money(rep.overdue)} overdue across ${rep.customers} customers.`);
  }

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
  const capped = out.slice(0, brief ? 2 : 4);
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

/**
 * A group's printed label: its name, plus how many ledgers it holds when that is more than one.
 *
 * The rows are customer GROUPS, and most groups are a single ledger — so "(3)" is shown only where
 * it says something. Without it a four-ledger group is indistinguishable from a lone customer, and
 * the reader has no way to tell that the figure in front of them covers several accounts. The
 * screen and the workbook answer this with a Customers column; the PDF has no width to spare for
 * one, so it rides on the name.
 *
 * Applied HERE and never upstream: `PdfCustomerRow.name` must stay the bare group name for
 * `buildPdf`'s tripwire and for `custKey` anchors to keep matching.
 */
function groupLabel(r: { name: string; ledgers?: number }): string {
  return (r.ledgers ?? 0) > 1 ? `${r.name} (${r.ledgers})` : r.name;
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

/**
 * Link key for one customer's bill page.
 *
 * Scoped by salesperson as well as name: `pageOf` is a single flat map that also holds the
 * salesperson pages, and a customer worked by two reps appears under both. Keying on the name
 * alone would send both reps' readers to whichever page happened to be written last.
 */
const custKey = (rep: string, customer: string): string => `__cust_${rep}|||${customer}__`;

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
      cardKey: "buying",
      title: "Still Buying",
      blurb:
        `${STILL_BUYING_NOTE} Ranked by overdue rather than by what they bought: the buying is ` +
        "what makes the list worth reading, but the money already past its due date is what has " +
        "to be decided on. What they were billed in the period is the column beside it.",
      // ⚠ RANKED BY OVERDUE, NOT BY BILLED-IN-PERIOD, and that is load-bearing rather than taste.
      //   `metric` is not just the sort: it also drives the percentage column AND the
      //   SMALL_BALANCE fold below. Rank by billed-in-period and a customer owing ₹40 L who
      //   happened to buy ₹5,000 this period drops into "N more customers, each under ₹10,000" —
      //   a large debtor folded away on a collections report. Ranking by overdue folds only
      //   customers who owe under ₹10,000, which is what Never Paid already does.
      rows: rows.filter((r) => r.stillBuying).sort((a, b) => b.overdue - a.overdue),
      metric: (r) => r.overdue,
      // ⚠ HEADERS ARE SIZED TO THEIR COLUMNS, not chosen for prose. With `showLastReceipt` on,
      //   the percentage column is 10 wide — the floor documented on that column, where
      //   "% of > 180" only just fits — so "% of Overdue" ellipsized to "% of Over…", and
      //   "Billed in Period" to "Billed in Peri…". A truncated header is worse than a terse one.
      //   The blurb above the table says what both mean, and Overdue is the column immediately
      //   to their left.
      pctHeader: "% Overdue",
      extra: { header: "Billed", value: (r) => r.salesInWindow ?? 0 },
      // Worth the column here: "still buying, last paid in February" is the whole story.
      showLastReceipt: true,
      // The card's value is already the customer count; appending it would print it twice.
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

  /**
   * How current the figures are, said in three places on purpose.
   *
   * The header band carries it on EVERY page (a reader who lands on a salesperson page from the
   * bookmark pane never sees page 1's meta strip), the meta strip states it beside "As on", and
   * the footer repeats it beside the generated timestamp — which answers a different question and
   * was, on its own, being read as the age of the data.
   *
   * Blank when the as-on date is unknown: nothing is printed rather than a date derived from
   * nothing. Computed here, before page 1 is drawn, because the band needs it too.
   */
  const dataNote = input.dataUpdatedTill
    ? `data updated till ${formatDateDMY(input.dataUpdatedTill)}`
    : undefined;
  const bandOpts = { tag: input.title, note: dataNote };

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
    const top = headerBand(ctx, { ...bandOpts, compact: true }) + 18;
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

  const isRep = (input.layout ?? "book") === "salesperson";

  // ── Page 1 ────────────────────────────────────────────────────────────────────────
  pageWash(pdf);
  let y = headerBand(ctx, bandOpts) + (isRep ? 18 : 22);

  // THE HEADLINE BLOCK.
  //
  // On the book it is the report's title and what the report means. On a rep extract the header
  // band above already carries the report name, so repeating it costs a line and says nothing;
  // the headline is the SALESPERSON, which is the one thing that identifies this file among a
  // dozen otherwise identical ones. Everything here is tightened on a rep extract because their
  // whole customer table has to fit underneath it.
  text(pdf, isRep ? (input.scopeName ?? input.title) : input.title, MARGIN, y, {
    size: isRep ? 17 : 19, bold: true,
  });
  y += isRep ? 15 : 20;

  for (const line of wrapText(pdf, input.subtitle, CONTENT_W, isRep ? 8.4 : 9.5)) {
    text(pdf, line, MARGIN, y, { size: isRep ? 8.4 : 9.5, color: BRAND.grey });
    y += isRep ? 11 : 12;
  }
  y += isRep ? 4 : 6;

  y = metaStrip(pdf, MARGIN, y, CONTENT_W, [
    {
      label: "As on", value: formatDateDMY(input.asOfDate),
      // Blank when the as-on date is unknown: the strip then keeps its original height and prints
      // nothing, rather than a date derived from nothing.
      note: input.dataUpdatedTill ? `Data updated till ${formatDateDMY(input.dataUpdatedTill)}` : undefined,
    },
    { label: "Period", value: input.periodLabel },
    // ⚠ This gap is CLEARANCE, not padding — do not shave it to buy page-1 room.
    //   The note makes the strip 9pt taller, and an earlier attempt to stay budget-neutral by
    //   dropping the rep gap from 11 to 2 put the Filters line's glyphs (which sit ABOVE their
    //   baseline) back inside the strip's rounded border. The table below simply flows to the
    //   next page when page 1 runs short, so the 9pt costs nothing worth this risk.
  ]) + (isRep ? 11 : 13);

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

  y = divider(pdf, MARGIN, y + 5, CONTENT_W) + (isRep ? 11 : 14);

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
    const gap = isRep ? 8 : 10;
    const cardW = (CONTENT_W - gap * (perRow - 1)) / perRow;
    // Shorter cards on a rep extract: the customer table moved onto this page, and six full-size
    // cards plus a table does not fit. statCard re-lays itself out below ~50pt.
    const cardH = isRep ? 44 : 54;
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

    // "Still Buying" is the one card whose label does not explain itself, and a PDF has no
    // tooltip to fall back on. The sentence goes here rather than inside the card because a stat
    // card's `sub` slot is already carrying a figure and there is no room for a fourth line.
    //
    // Gated on the card BEING PRESENT, not on the report mode: the dormant report's rows are the
    // exact complement of Still Buying, so it carries no such card and must not define one.
    if (hasStillBuyingCard(input.kpis.map((k) => k.key))) {
      y += isRep ? 7 : 9;
      text(pdf, STILL_BUYING_NOTE, MARGIN, y, { size: isRep ? 6.6 : 7, color: BRAND.grey2 });
      // Leave `y` on the line just drawn rather than above it, so whatever follows starts clear
      // of it on its own terms instead of relying on the next section's leading gap.
      y += 2;
    }
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

  y = divider(pdf, MARGIN, y + (isRep ? 11 : 15), CONTENT_W) + (isRep ? 11 : 15);

  const pageOf = new Map<string, number>();

  /**
   * One salesperson's figures, customer table and read-out.
   *
   * Shared by both layouts: on the book it fills a rep's own page, on a rep extract it fills the
   * bottom of page 1. One renderer, so the two can never drift into showing different columns for
   * the same thing.
   *
   * BOTH LAYOUTS PRINT THE TOP SLICE, not the whole book. A rep extract briefly printed every one
   * of their customers, on the reasoning that it is THEIR list to work; in practice that is a
   * hundred-odd lines in which the twenty that hold the money are indistinguishable from the tail.
   * The cut is the point of the page, and the folded "Remaining N" line keeps it honest.
   */
  const drawRepBody = (
    rep: PdfSalespersonBlock,
    startY: number,
    opts: { rank: number; compact: boolean },
  ): number => {
    let ry = startY;

    const sorted = [...rep.rows].sort((a, b) => b.overdue - a.overdue);
    const take = topCount(sorted.length);
    const shown = sorted.slice(0, take);
    const rest = sorted.slice(take);

    // Suppressed on a rep extract: the document IS their book, so every share reads "100.0% of
    // book", and the three figures are already on the cards directly above. On the book layout it
    // is the line that places this rep against the company.
    if (!opts.compact) {
      text(
        pdf,
        `${rep.customers} customers · Outstanding ${money(rep.outstanding)} (${pctText(rep.outstanding, input.total.outstanding)} of book) · Overdue ${money(rep.overdue)} (${pctText(rep.overdue, input.total.overdue)} of book)`,
        MARGIN, ry, { size: 8, color: BRAND.grey, maxWidth: CONTENT_W },
      );
      ry += 24;
    }

    ry = sectionHeading(
      pdf, MARGIN, ry,
      take >= sorted.length
        ? `All ${sorted.length} customers, ranked by overdue`
        : `Top ${take} of ${sorted.length} customers by overdue`,
    ) + 7;

    interface CustRow {
      label: string;
      /** Set only on customer rows that have a bill page to jump to. */
      linkKey?: string;
      outstanding: number; overdue: number;
      lastReceipt: string; lastReceiptAmount: string;
      kind: "normal" | "muted" | "total";
    }
    const custRows: CustRow[] = shown.map((r) => ({
      label: groupLabel(r),
      // Only NAMED groups get a link, and only when there are bills behind the name. The
      // "Remaining N" bucket deliberately gets none: it is not a group, and a link that lands
      // on a page about nobody is worse than plain text.
      // ⚠ Keyed on the BARE `r.name`, not the decorated label — the anchor is registered under the
      //   same bare name on the bill page, and a "(3)" on one side only would break every link.
      linkKey: r.bills?.length ? custKey(rep.name, r.name) : undefined,
      outstanding: r.outstanding, overdue: r.overdue,
      lastReceipt: r.lastReceipt, lastReceiptAmount: r.lastReceiptAmount,
      kind: "normal" as const,
    }));
    if (rest.length) {
      custRows.push({
        label: `Remaining ${rest.length} customer${rest.length === 1 ? "" : "s"}`,
        outstanding: rest.reduce((s, r) => s + r.outstanding, 0),
        overdue: rest.reduce((s, r) => s + r.overdue, 0),
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
      { header: "Customer Group", width: 38, value: (r) => r.label, linkKey: (r) => r.linkKey },
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
      linkSink: links,
      onNewPage: newPage,
    });

    // ── The rep's read-out ──────────────────────────────────────────────────────────
    //
    // This replaced a twenty-bar "Overdue distribution" strip. The bars restated the "% of
    // Overdue" column immediately above them and nothing else, so they spent a third of the page
    // saying what the table had already said. The read-out uses that space to say what the
    // figures MEAN, which the table cannot.
    const lines = repInsights(
      rep, sorted, shown, opts.rank, reps.length, input.total.overdue, opts.compact,
    );
    if (lines.length) {
      ry += opts.compact ? 16 : 20;
      ry = ensureRoom(ry, noteBlockHeight(pdf, CONTENT_W, lines));
      ry = noteBlock(pdf, { x: MARGIN, y: ry, width: CONTENT_W, title: "Analysis", lines });
    }
    return ry;
  };

  if (isRep) {
    // No league table: with one salesperson it would be a header, one row and a grand total
    // repeating it. Their customers take the space instead.
    drawRepBody(reps[0] ?? {
      name: input.scopeName ?? "", customers: 0, outstanding: 0, overdue: 0, rows: [],
    }, y, { rank: 1, compact: true });
  } else {

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
  reps.forEach((rep, idx) => {
    pdf.addPage();
    pageWash(pdf);
    pageOf.set(rep.name, pdf.getNumberOfPages());

    let ry = headerBand(ctx, { ...bandOpts, compact: true }) + 20;
    ry = homeLink(pdf, ry) + 26;

    text(pdf, ellipsize(pdf, rep.name, CONTENT_W, 16, true), MARGIN, ry, { size: 16, bold: true });
    ry += 20;

    drawRepBody(rep, ry, { rank: idx + 1, compact: false });
  });

  } // end of the book layout

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

    let ay = headerBand(ctx, { ...bandOpts, compact: true }) + 20;
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

    /**
     * NAMED ROWS FOR THE MONEY THAT MATTERS, ONE FOLDED LINE FOR THE REST.
     *
     * Every customer at or above `SMALL_BALANCE` on the list's own ranking figure gets a line,
     * however many pages that takes: a customer who has never paid does not stop being a credit
     * decision because they rank 90th, and a list that quietly ended at a cut-off would be read as
     * the complete list. Below that, the tail is folded into one line that keeps its count and its
     * money, so the page still totals to the card that linked here.
     *
     * The fold is skipped when it would buy nothing (a single small row folds to a line naming
     * nobody) or cost everything (a list where NOTHING clears the threshold is still that list,
     * and a page consisting only of a folded line and a total tells the reader nothing at all).
     */
    const bigRows = app.rows.filter((r) => app.metric(r) >= SMALL_BALANCE);
    const smallRows = app.rows.filter((r) => app.metric(r) < SMALL_BALANCE);
    const folding = bigRows.length > 0 && smallRows.length > 1;
    const listed = folding ? bigRows : app.rows;
    const folded = folding ? smallRows : [];

    /** A table line, with its figures already resolved: a customer, the folded tail, or the total. */
    interface AppRow {
      label: string;
      salesperson: string;
      lastReceipt: string;
      outstanding: number;
      overdue: number;
      extra: number;
      metric: number;
      kind: "normal" | "muted" | "total";
    }
    const tableRows: AppRow[] = listed.map((r) => ({
      label: groupLabel(r),
      salesperson: r.salesperson,
      lastReceipt: r.lastReceipt,
      outstanding: r.outstanding,
      overdue: r.overdue,
      extra: app.extra ? app.extra.value(r) : 0,
      metric: app.metric(r),
      kind: "normal" as const,
    }));
    if (folded.length) {
      tableRows.push({
        // Says what was folded AND on what test, so the line reads as an editorial decision rather
        // than as a missing chunk of the report.
        label: `${folded.length} more customers, each under ${SMALL_BALANCE_TEXT}`,
        salesperson: "", lastReceipt: NIL,
        outstanding: sum(folded, (r) => r.outstanding),
        overdue: sum(folded, (r) => r.overdue),
        extra: app.extra ? sum(folded, app.extra.value) : 0,
        metric: sum(folded, app.metric),
        kind: "muted",
      });
    }
    tableRows.push({
      label: "TOTAL", salesperson: "", lastReceipt: NIL,
      outstanding, overdue, extra: extraTotal, metric: metricTotal, kind: "total",
    });

    const cols: PdfColumn<AppRow>[] = [
      // Customer takes the most: a truncated ledger name is the one thing on this page a reader
      // cannot reconstruct, and unlike the salesperson-page tables this one also has to fit a
      // salesperson column.
      { header: "Customer Group", width: app.showLastReceipt ? 33 : 36, value: (r) => r.label },
      { header: "Salesperson", width: app.showLastReceipt ? 11 : 18, value: (r) => r.salesperson },
      { header: "Outstanding", width: 12, align: "right", value: (r) => money(r.outstanding) },
      {
        header: "Overdue", width: 12, align: "right", value: (r) => money(r.overdue),
        color: (r) => (r.kind === "normal" && r.overdue > 0.5 ? BRAND.red : undefined),
      },
      ...(app.extra
        ? [{
            header: app.extra.header, width: 12, align: "right" as const,
            value: (r: AppRow) => money(r.extra),
            color: (r: AppRow) => (r.kind === "normal" ? BRAND.red : undefined),
          }]
        : []),
      {
        // Narrowed to 10 to fund Last Receipt below. 10 is the floor: the header "% of > 180" is
        // wider than any value under it, and below this it ellipsizes into "% of > 1…".
        header: app.pctHeader, width: app.showLastReceipt ? 10 : 12, align: "right",
        value: (r) => (r.kind === "total" ? "100.0%" : pctText(r.metric, metricTotal)),
      },
      ...(app.showLastReceipt
        ? [{
            // A DATE MUST NEVER ELLIPSIZE. "20-05-20…" is not a shorter date, it is an unreadable
            // one, and at the old width it happened only to SOME rows: Poppins gives "1" a
            // narrower advance than "2", so 15-07-2026 fitted where 20-05-2026 did not, which
            // reads as data corruption rather than a column that is too tight. Sized off the
            // widest possible dd-mm-yyyy with room to spare, funded from the two columns left.
            header: "Last Receipt", width: 14, align: "right" as const,
            value: (r: AppRow) => r.lastReceipt,
          }]
        : []),
    ];

    drawTable<AppRow>(pdf, {
      x: MARGIN, y: ay, width: CONTENT_W,
      columns: cols,
      rows: tableRows,
      rowKind: (r) => r.kind,
      rowH: 14,
      maxY: FLOOR,
      onNewPage: newPage,
    });
  }

  // ── One page per named customer: the bills behind their Overdue ───────────────────
  //
  // Only for customers actually LISTED above — the "Remaining N" bucket gets nothing, because it
  // is a subtotal rather than someone you can ring. The figures are the same `buildDrillRows`
  // output the on-screen popup and the workbook's bill tab use, so all three agree, including the
  // On Account credit that reconciles a gross bill list to a net Overdue figure.
  interface CustPage { rep: PdfSalespersonBlock; cust: PdfCustomerRow }
  const custPages: CustPage[] = reps.flatMap((rep) => {
    const sorted = [...rep.rows].sort((a, b) => b.overdue - a.overdue);
    // The same slice `drawRepBody` printed, on either layout — a bill page nobody can reach from
    // the table is weight in the file and nothing else.
    const listed = sorted.slice(0, topCount(sorted.length));
    return listed.filter((c) => c.bills?.length).map((cust) => ({ rep, cust }));
  });

  for (const { rep, cust } of custPages) {
    pdf.addPage();
    pageWash(pdf);
    pageOf.set(custKey(rep.name, cust.name), pdf.getNumberOfPages());

    let cy = headerBand(ctx, { ...bandOpts, compact: true }) + 20;
    cy = homeLink(pdf, cy) + 24;

    text(pdf, ellipsize(pdf, cust.name, CONTENT_W, 15, true), MARGIN, cy, { size: 15, bold: true });
    cy += 15;
    text(
      pdf,
      `${rep.name} · Outstanding ${money(cust.outstanding)} · Overdue ${money(cust.overdue)} · Last receipt ${cust.lastReceipt}`,
      MARGIN, cy, { size: 7.8, color: BRAND.grey, maxWidth: CONTENT_W },
    );
    cy += 20;

    const bills = cust.bills ?? [];
    const open = bills.filter((b) => !b.isOnAccount);
    const onAccount = bills.filter((b) => b.isOnAccount);
    // GROUPED BY SALE TYPE, and BILL DATE OLDEST FIRST inside each group — see `groupBySaleType`.
    // The On Account credit stays out of the grouping and lands last, because it is the deduction
    // that reconciles the page rather than another bill. Same order as the workbook's block.
    const groups = groupBySaleType(open);

    /**
     * LEDGER FIRST, SALE TYPE INSIDE IT — on a group that holds more than one ledger.
     *
     * The rows that link here are customer GROUPS, so a page can span several ledgers. Banding by
     * sale type alone interleaved them: forty-six INK bills belonging to three different accounts,
     * one after another, with only a repeated Ledger column to tell them apart. You cannot work
     * that page — chasing is done one ACCOUNT at a time, and the question is always "what does
     * THIS ledger owe, and for what". So the ledger opens the section and its sale types sit
     * inside it, which also lets the ledger's own totals ride on its band and removes the column.
     *
     * Ledgers heaviest first, on pending — the same rule the rest of the document is ordered by.
     * Ties break on name so two exports of the same data come out identical.
     *
     * A single-ledger page (the large majority) takes the `else` and is BYTE-IDENTICAL to before:
     * no ledger band, no extra column, sale-type bands exactly where they were.
     */
    const pendingOf = (bs: readonly PdfBillRow[]) => bs.reduce((s, b) => s + b.pending, 0);
    const ledgerNames = [...new Set(open.map((b) => b.ledger).filter(Boolean))] as string[];
    const byLedger = ledgerNames.length > 1
      ? ledgerNames
          .map((name) => ({ name, bills: open.filter((b) => b.ledger === name) }))
          .sort((a, b) => pendingOf(b.bills) - pendingOf(a.bills) || a.name.localeCompare(b.name))
      : [{ name: "", bills: open }];
    const multiLedger = byLedger.length > 1;

    /**
     * The biggest fifth of the bills, flagged where they sit.
     *
     * The list is ordered by DATE — oldest first, inside each sale type — which is the order you
     * chase a ledger in, and it is deliberately kept. But it says nothing about size: on a
     * forty-six-bill page the four that carry half the money are scattered through it and a
     * reader has to add up the column to find them. Flagging them in place gives both readings of
     * the same table without a second copy sorted by value.
     *
     * Ranked on PENDING, not Amount: pending is what is still to be collected, which is the
     * question the page exists to answer — a ₹5 L bill that is already paid down to ₹2,000 is not
     * a big bill to chase. On Account is excluded; it is a credit, not a bill.
     *
     * Under five bills nothing is flagged: "the top 20%" of four rows is one row, and singling it
     * out on a page a reader takes in at a glance adds noise, not sight.
     */
    const bigBills = new Set<PdfBillRow>();
    if (open.length >= 5) {
      const k = Math.ceil(open.length * 0.2);
      for (const b of [...open].sort((a, b) => b.pending - a.pending).slice(0, k)) bigBills.add(b);
    }

    cy = sectionHeading(
      pdf, MARGIN, cy,
      `${open.length} open past-due bill${open.length === 1 ? "" : "s"}` +
      // The ledger count leads when there is more than one: it is the page's OUTER grouping now,
      // and a reader who sees "46 bills across 3 sale types" on a three-ledger page will read the
      // first band as a sale type and lose their place.
      `${multiLedger ? ` across ${byLedger.length} ledgers` : ""}` +
      `${groups.length > 1 ? `${multiLedger ? " and" : " across"} ${groups.length} sale types` : ""}` +
      `${onAccount.length ? " · plus On Account credit" : ""}`,
    ) + 7;

    // Say what the shading means, or it reads as a defect in the file.
    if (bigBills.size) {
      text(
        pdf,
        `Marked rows are the ${bigBills.size} biggest bill${bigBills.size === 1 ? "" : "s"} here — the top 20% by pending amount.`,
        MARGIN, cy, { size: 7, color: BRAND.grey2 },
      );
      cy += 11;
    }

    interface BillSubtotal { count: number; amount: number; received: number; pending: number }
    interface BillLine {
      bill?: PdfBillRow;
      /** A sale-type heading. Carries a label and no figures. */
      band?: string;
      /**
       * A LEDGER heading, on a group holding more than one. Carries that ledger's own figures, so
       * the section states its total without a third tier of subtotal rows under it.
       */
      ledger?: { name: string; count: number; amount: number; received: number; pending: number };
      /** That sale type's own total, drawn under its bills. */
      subtotal?: BillSubtotal;
      /**
       * A blank line, drawn between a closed section and the next heading.
       *
       * A subtotal is a filled row and so is the band beneath it, so back to back they abutted
       * into one slab and "INK subtotal" ran straight into "SPARE PARTS" with nothing between
       * them. The gap is what makes the sections read as separate.
       */
      spacer?: boolean;
      /** The customer's bottom line — the existing row, unchanged. */
      total?: boolean;
    }

    // One `drawTable` call for the whole page, bands and subtotals included, rather than one per
    // group: the table's repeating header and its page-break handling belong to a single call, and
    // a per-group call would reprint the column headers between every sale type.
    //
    // A lone group gets its band but NO subtotal — with nothing to compare it against it would
    // simply restate the TOTAL two rows below it.
    const billRows: BillLine[] = [];
    const sums = (bs: readonly PdfBillRow[]) => ({
      count: bs.length,
      amount: bs.reduce((s, b) => s + b.amount, 0),
      received: bs.reduce((s, b) => s + b.received, 0),
      pending: bs.reduce((s, b) => s + b.pending, 0),
    });
    let firstSection = true;
    for (const led of byLedger) {
      const gs = groupBySaleType(led.bills);
      if (multiLedger) {
        if (!firstSection) billRows.push({ spacer: true });
        billRows.push({ ledger: { name: led.name, ...sums(led.bills) } });
        firstSection = false;
      }
      let firstGroup = true;
      for (const g of gs) {
        // Never between a ledger band and its own first sale type — those belong together.
        if (!firstGroup) billRows.push({ spacer: true });
        billRows.push({ band: g.label });
        firstGroup = false;
        for (const bill of g.bills) billRows.push({ bill });
        if (gs.length > 1) billRows.push({ subtotal: sums(g.bills) });
      }
      if (!multiLedger) firstSection = false;
    }
    for (const bill of onAccount) billRows.push({ bill });
    billRows.push({ total: true });

    // Over ALL bills, On Account included — see the Pending column's note. The subtotals above
    // cover the open bills only, so they will not add up to this row whenever a credit exists;
    // that gap is the credit, and the paragraph under the table says so.
    const sum = (of: (b: PdfBillRow) => number) => bills.reduce((s, b) => s + of(b), 0);

    // The band and the subtotal both speak in the Bill No column: it is the widest one and the
    // only one whose content is a name rather than a figure.
    const billCols: PdfColumn<BillLine>[] = [
      {
        header: "Bill No", width: 28,
        // A heading row's Bill Date / Due Date / Due Days cells are empty, so the label may use
        // them: a ledger band was ellipsizing "DASS EMBROIDERY PRIVATE LIMIT…" against three
        // columns of blank space. It stops at Amount, which every heading row DOES carry.
        // A bill row spans nothing — its dates are the point.
        span: (r) => (r.bill ? 1 : 4),
        value: (r) =>
          r.spacer ? ""
          : r.total ? "TOTAL"
          : r.ledger ? r.ledger.name
          : r.band ? r.band.toUpperCase()
          // "Subtotal", NOT "<sale type> subtotal": the band two rows up already names the type in
          // full, and the longer captions did not fit this column — "Non-product income subtotal"
          // ellipsized to nonsense at 22/113 of the content width.
          : r.subtotal ? `Subtotal · ${r.subtotal.count} bill${r.subtotal.count === 1 ? "" : "s"}`
          : r.bill!.number,
        color: (r) => (r.bill?.isOnAccount ? BRAND.green : undefined),
      },
      // ── THE SALE TYPE COLUMN IS GONE, AND ITS WIDTH PAID FOR THE DATES ────────────────
      //
      // It repeated its own band on every single row: under "INK" every cell said "Ink", under
      // "SPARE PARTS" every cell said "Spare Par…" — ellipsized, because the column it needed was
      // being spent restating the heading eight rows above it. Its width went to the dates AND to
      // Bill No, which now also has to hold a LEDGER NAME on a band row - the longest text on the
      // page and the one an ellipsis hurts most. The band names the type once, which
      // is the only place it means anything.
      //
      // What it funded: dd-mm-yyyy was clipping to "03-07-2…" — a truncated date is not a shorter
      // date, it is an unreadable one, and both date columns had it. 13 → 14 on a smaller total
      // ratio is ~20% more room each, which fixes it on WIDTH rather than by shrinking the type.
      { header: "Bill Date", width: 14, align: "right", value: (r) => (r.bill ? r.bill.date || NIL : "") },
      { header: "Due Date", width: 14, align: "right", value: (r) => (r.bill ? r.bill.dueDate || NIL : "") },
      {
        header: "Due Days", width: 10, align: "right",
        // NIL is for a BILL whose due days we do not have. A band, a subtotal or the TOTAL has no
        // due days to be missing, so those read blank rather than as a gap in the data.
        value: (r) => (r.bill ? (r.bill.overdueDays !== null ? String(r.bill.overdueDays) : NIL) : ""),
        color: (r) => (r.bill && (r.bill.overdueDays ?? 0) > 180 ? BRAND.red : undefined),
      },
      {
        header: "Amount", width: 12, align: "right",
        value: (r) =>
          r.spacer || r.band ? ""
          : money(r.total ? sum((b) => b.amount)
                : r.ledger ? r.ledger.amount
                : r.subtotal ? r.subtotal.amount
                : r.bill!.amount),
      },
      {
        header: "Received", width: 12, align: "right",
        value: (r) =>
          r.spacer || r.band ? ""
          : money(r.total ? sum((b) => b.received)
                : r.ledger ? r.ledger.received
                : r.subtotal ? r.subtotal.received
                : r.bill!.received),
      },
      {
        // The TOTAL of this column IS the customer's Overdue on the table that linked here, which
        // is the whole point of putting the On Account line in the list rather than in a footnote.
        header: "Pending", width: 12, align: "right",
        value: (r) =>
          r.spacer || r.band ? ""
          : money(r.total ? sum((b) => b.pending)
                : r.ledger ? r.ledger.pending
                : r.subtotal ? r.subtotal.pending
                : r.bill!.pending),
        color: (r) => (r.bill ? (r.bill.isOnAccount ? BRAND.green : BRAND.red) : undefined),
      },
    ];

    cy = drawTable<BillLine>(pdf, {
      x: MARGIN, y: cy, width: CONTENT_W,
      columns: billCols,
      rows: billRows,
      rowKind: (r) =>
        r.total ? "total"
        // A spacer is an ordinary empty row, so it paints nothing — that blank ground IS the gap
        // between one section's subtotal and the next section's band.
        : r.spacer ? "normal"
        // Ledger, band, subtotal and total are four different weights on purpose — see
        // `drawTable`. The On Account credit KEEPS "muted": it is an aside rather than a sum, and
        // its green figure needs the quiet ground to read.
        : r.ledger ? "ledger"
        : r.band ? "band"
        : r.subtotal ? "subtotal"
        : r.bill?.isOnAccount ? "muted"
        : r.bill && bigBills.has(r.bill) ? "big"
        : "normal",
      rowH: 14,
      maxY: FLOOR,
      onNewPage: newPage,
    });

    // The one thing a reader WILL query: why the bills do not add up to the figure that sent them
    // here. Stated under the table rather than left as a mystery negative line.
    if (onAccount.length) {
      cy = ensureRoom(cy + 12, 20);
      for (const line of wrapText(
        pdf,
        "On Account is money this customer has already paid that settles no specific bill (advances, " +
        "credit notes, untagged receipts). It is deducted above, which is why Pending totals to the " +
        "Overdue figure rather than to the sum of the bills.",
        CONTENT_W, 7.2,
      )) {
        text(pdf, line, MARGIN, cy, { size: 7.2, color: BRAND.grey2 });
        cy += 9.5;
      }
    }
  }

  // ── Navigation furniture ──────────────────────────────────────────────────────────
  applyDeferredLinks(pdf, links, pageOf);

  // Bookmarks, so a reader can jump from the viewer's sidebar as well as from the table.
  try {
    // Named to match the on-page link, so the sidebar and the page agree on what page 1 is called.
    pdf.outline.add(null, "Home", { pageNumber: 1 });
    // Customer pages hang UNDER their salesperson on the book layout: a flat sidebar listing
    // three hundred ledger names is not navigation, it is a second copy of the report.
    const repNode = new Map<string, unknown>();
    for (const rep of reps) {
      const p = pageOf.get(rep.name);
      if (p !== undefined) repNode.set(rep.name, pdf.outline.add(null, rep.name, { pageNumber: p }));
    }
    for (const { rep, cust } of custPages) {
      const p = pageOf.get(custKey(rep.name, cust.name));
      if (p !== undefined) {
        pdf.outline.add((repNode.get(rep.name) ?? null) as never, cust.name, { pageNumber: p });
      }
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
  //
  // `dataNote` (defined at the top, beside the header band that also carries it) rides along here
  // so the two facts a reader needs about a printed figure — when the file was made and how
  // current the data behind it is — sit side by side on every page.
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    footer(ctx, p, generatedAt, dataNote);
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
