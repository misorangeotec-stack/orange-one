import type { OcpiDeal, OcpiStatus } from "../types";

/**
 * How OCPI values are worded on screen.
 *
 * One place, because the same status appears on the dashboard, three lists, five
 * queues and the register export — and "Awaiting approval" in one and "Pending
 * approval" in another reads as two different states to somebody scanning.
 */

export const STATUS_LABEL: Record<OcpiStatus, string> = {
  draft: "Draft",
  awaiting_quotation_approval: "Quotation — awaiting approval",
  // ⚠ RETIRED, AND STILL LABELLED. The chain no longer routes through these two
  //   steps, but historical deals parked at them must still read as something.
  awaiting_order_confirmation: "Order confirmation — to complete (retired step)",
  awaiting_oc_approval: "Order confirmation — awaiting approval (retired step)",
  awaiting_customer_sign: "Awaiting customer signature",
  awaiting_management_sign: "Awaiting management signature",
  awaiting_finance_handover: "To hand over to Finance",
  awaiting_finance_receipt: "Awaiting Finance receipt",
  closed: "Completed",
  rejected: "Rejected",
  rework: "Sent back for rework",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/**
 * Money, with the currency the deal was actually quoted in.
 *
 * ⚠ NEVER ASSUME RUPEES. A real submission recorded a total as "1.8 lakh
 *   dollar"; printing that with a ₹ would be an ~85× misstatement on a contract.
 */
export function fmtDealValue(amount: number | null, currency: string | null): string {
  if (amount === null) return "";
  const n = amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return `${currency === "USD" ? "$" : "₹"} ${n}`;
}

/**
 * What the papers are HEADED, which is a function of the stage and not of the
 * machine.
 *
 * ⚠ IT IS RESOLVED AT RENDER, NEVER STORED. One commercial act produces one
 *   document set: it goes out as an ORDER QUOTATION while it is still an offer,
 *   and the same set becomes the ORDER CONFIRMATION the moment the Directors
 *   approve it. A version frozen before approval keeps the heading it was issued
 *   under, because its stored payload was rendered before the stamp existed.
 *
 * 🔴 THE TEST IS THE APPROVAL STAMP, AND `oc_no` IS NOT A TEST FOR ANYTHING.
 *    This function used to read `return deal.ocNo ? …`, and the comment here
 *    said "`oc_no` is therefore the only test". That was true only while the
 *    number was minted AT the Directors' approval. OCPI-36 moved the mint to
 *    Generate, so one serial can serve the Performa Invoice and the Order
 *    Confirmation the way the paper register has always done — and the moment it
 *    moved, the old test would have headed EVERY QUOTATION as a signed contract,
 *    on both papers, from the second it was generated.
 *
 *    So the test moved FIRST, before the number did. Checked on live data before
 *    either change: of 30 deals, 8 carry `oc_no` and all 8 carry `oc_at`, and
 *    none carries one without the other — so the swap changed no existing
 *    document, and it is the mint moving that makes the two diverge.
 *
 *    ⚠ DO NOT "SIMPLIFY" THIS BACK TO `deal.ocNo`. It will look equivalent on
 *      every deal raised before OCPI-36 and be wrong on every one raised after.
 */
export function docHeading(deal: OcpiDeal): string {
  return deal.ocAt ? "ORDER CONFIRMATION" : "ORDER QUOTATION";
}

/**
 * The number a paper PRINTS — and before the approval it is not the OC number.
 *
 * 🔴 UNTIL THE DIRECTORS APPROVE, THE PAPER CARRIES `QT-M####`.
 *    Ritesh Bhai, 03-09-2026, shown that an unapproved deal downloads a complete
 *    order confirmation: *"it should just show as order quotation, and the number
 *    should also be of the quotation only … it should mention the quotation
 *    number till it is not approved."*
 *
 *    This REVISES one line of OCPI-36, which put the OC number on all three
 *    papers on the reasoning that Bushra's register is filed under it. That
 *    reasoning holds for a CONTRACT, and for the PI — folder 127 is headed
 *    `Performa No. OTPL/OC/127/26-27` months before any contract exists — and it
 *    does not hold for a quotation that may never become either. A customer must
 *    not be able to quote back a contract number no contract was issued under.
 *
 * ⚠ PAIRED WITH `docHeading`, ON THE SAME TEST, DELIBERATELY. The heading and the
 *   number have to move together: ORDER QUOTATION printed over `OTPL/OC/10/26-27`
 *   is the exact half-state this removes. Change one, change both.
 *
 * ⚠ NO APPROVED DOCUMENT CHANGES. `oc_at` is set at the approval and never
 *   cleared, so every paper ever headed ORDER CONFIRMATION keeps the number it
 *   printed — frozen revisions included, which render from their stored payload.
 *
 * ⚠ THE PI DOES NOT COME THROUGH HERE. `piPdf.ts` prints `Performa No.` from
 *   `ocNo` at every stage, which is what all 27 real folders do.
 */
export function paperNo(deal: OcpiDeal): string | null {
  const no = deal.ocAt ? deal.ocNo : deal.quotationNo;
  return no?.trim() || null;
}

/**
 * A date as the SCREEN shows it — "30 Sept 2026".
 *
 * ⚠ THE COMMENT HERE USED TO SAY "dd-mm-yyyy", WHICH IT HAS NEVER PRODUCED.
 *   `month: "short"` is a name, not a number, and `en-IN` renders September as
 *   "Sept" rather than "Sep". Corrected while writing OCPI-18, because that
 *   comment is what a brief was written against: it asked for the new
 *   `{{delivery_date}}` token to be formatted "dd-mm-yyyy like every other date
 *   in this module", and no date in this module has ever looked like that.
 *
 * Screen and register export use this; anything that lands on a DOCUMENT goes
 * through `paperDate` below.
 */
export function dmy(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * A date as the PAPERS print it.
 *
 * ⚠ EVERY DATE ON A DOCUMENT COMES THROUGH HERE, and that is worth one function
 *   even though it currently returns exactly what `dmy` above returns.
 *
 *   ocPdf.ts (the contract's "Date:" header) and quotationPdf.ts (the summary
 *   sheet's) each carried this as a private const, character for character, and
 *   OCPI-18 was about to add a THIRD copy for the `{{delivery_date}}` token —
 *   which prints inside the SALE CONDITIONS clause of 21 machine decks, three
 *   lines under a header the same document draws with the copy in ocPdf.ts. All
 *   three now import this one.
 *
 * ⚠ `en-GB` AND `en-IN` AGREE TODAY, AND THAT IS A COINCIDENCE, NOT A RULE. The
 *   two locales were checked month by month in Chrome while writing OCPI-18 and
 *   produce identical output for all twelve — so the copies had NOT drifted, and
 *   nothing was printing wrongly. They agree because of the CLDR data this
 *   browser ships; a different runtime, or a later ICU, need not. One definition
 *   is what stops that ever becoming a document that spells one month two ways.
 */
export function paperDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * The next quotation number, for the screen only: 1 → `OTPL/QT/2627/SEP/0001`.
 *
 * ⚠ A KNOWN DUPLICATE OF SQL, AND IT MUST STAY IDENTICAL. The number a deal
 *   actually carries is minted by `fms_ocpi_qt_no` in the database, because
 *   minting must be atomic with the counter. This copy exists ONLY to show a
 *   person what the next one will look like before it is minted (Settings →
 *   Quotation numbering). Nothing stores what this returns.
 *
 * ⚠ THE PERIOD IS THE COUNTER SCOPE (R6). `2627/SEP` names the `qt:2627/SEP`
 *   counter row, and a new scope starts at 1 — which is what makes the series
 *   restart every month, with no reset job.
 */
export function quotationNoFor(seq: number, period: string = periodCode()): string {
  return `OTPL/QT/${period}/${String(Math.max(0, Math.trunc(seq))).padStart(4, "0")}`;
}

/**
 * The financial year and month a number belongs to: Sep-2026 → `2627/SEP`.
 *
 * ⚠ A SECOND COPY OF `fms_ocpi_period_code`. The database mints the real number
 *   and derives its own period IN IST; this exists so Settings can name the
 *   period it is about to move before anything is minted.
 *
 * ⚠ THE BROWSER IS ALREADY IN THE USER'S OWN CLOCK, so a local `Date` is the
 *   right thing here — unlike SQL, where `current_date` is UTC and would stamp a
 *   1-October paper SEP. That trap lives in the database, not here.
 */
export function periodCode(d: Date = new Date()): string {
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${fyCode(d)}/${MON[d.getMonth()]}`;
}

/**
 * The Indian financial year as an OC number spells it: Apr-2026 → `2627`.
 *
 * ⚠ A SECOND COPY OF `fms_ocpi_fy_code`, and it must stay identical to it. The
 *   database mints the real number; this exists so Settings can name which
 *   year's counter it is about to move before anything is minted.
 */
export function fyCode(d: Date = new Date()): string {
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const two = (n: number) => String(n % 100).padStart(2, "0");
  return two(startYear) + two(startYear + 1);
}

/**
 * An order-confirmation number from its sequence value:
 * 1 → `OTPL/OC/2627/SEP/0001`.
 *
 * ⚠ A KNOWN DUPLICATE OF `fms_ocpi_oc_no`, and the more expensive one to get
 *   wrong. The database is the authority — it is called by
 *   `fms_ocpi_generate_quotation` (which mints), `fms_ocpi_decide_quotation`
 *   (the fallback for pre-OCPI-36 deals) and `fms_ocpi_submit_oc`. Change that
 *   and change this to match.
 *
 * ⚠ THE COUNTER RESTARTS EVERY MONTH (R6), not every April, because the period
 *   is part of the counter scope and a new scope starts at 1.
 *
 * ⚠ TWO EARLIER SHAPES STILL EXIST ON RECORD AND THIS WILL NEVER REPRODUCE
 *   EITHER. `OTPL/OC/2627/0001…0008` (pre-OCPI-36) and `OTPL/OC/9…22/26-27`
 *   (OCPI-36) are both frozen where they were printed. That is correct: a paper
 *   keeps the number it was issued under. Expect three shapes in the register
 *   for the rest of this financial year.
 */
export function ocNoFor(seq: number, period: string = periodCode()): string {
  return `OTPL/OC/${period}/${String(Math.max(0, Math.trunc(seq))).padStart(4, "0")}`;
}

/**
 * The same number with the serial left as a placeholder — `OTPL/OC/2627/SEP/nnnn`.
 *
 * ⚠ THIS EXISTS BECAUSE THE CALLER USED TO BUILD IT WITH A REGEX, AND OCPI-36
 *   BROKE THAT REGEX SILENTLY. `SetupWarnings` rendered
 *   `ocNoFor(1, fy).replace(/\d+$/, "nnnn")`, which worked only while the number
 *   ENDED in the serial. R6 has made it end in the serial again — which is
 *   exactly why this stays a function rather than being folded back into a
 *   regex that happens to work today.
 */
export function ocNoPreview(period: string = periodCode()): string {
  return `OTPL/OC/${period}/nnnn`;
}

/**
 * Anything a file name may not contain, on Windows or in a storage key.
 *
 * `/` is the one that matters: every number here contains three of them, and a
 * slash in a storage key would open a new path segment — which the RPCs refuse,
 * because the first segment is how the owning deal is identified.
 */
const UNSAFE = /[\\/:*?"<>|]+/g;

/** How much of a customer's name a file name carries before it is unwieldy. */
const NAME_CAP = 44;

/**
 * The shared stem of every paper this module issues.
 *
 * ⚠ NAMED THE WAY THE REAL FILING NAMES THEM (OCPI-36). Bushra's folders read
 *   `127 -SUMATI PRINTS PVT.LTD ALPHA 2 1.9 MTR - PI.pdf` and `… - OC.pdf`: the
 *   serial leads, the customer follows, the paper is named last, and `QT-M####`
 *   appears nowhere. So all three papers are named off the number they PRINT,
 *   and the caller adds ` - Summary` / ` - OC` / ` - PI`.
 *
 * ⚠ THIS REPLACES TWO PRIVATE COPIES — `fileBase` in quotationPdf.ts and
 *   `ocBase` in ocPdf.ts — which differed only in which number they read. They
 *   differed because the OC number did not exist until the approval; it exists
 *   from Generate now, so there is one stem and no reason for two.
 *
 * ⚠ THE SUFFIXES MUST STAY DISTINCT, and that is the whole reason the callers
 *   add one. Every paper of a revision is uploaded to the SAME folder with
 *   `upsert: true`, so the file name is the identity: two papers sharing a name
 *   means the second silently replaces the first and the deal appears to hold
 *   one document where it holds three.
 *
 * ⚠ THE `DRAFT-` FALLBACK IS FOR **UNGENERATED** DRAFTS ONLY, and it is now
 *   nearly unreachable: since OCPI-36 the serial is minted at Generate, and this
 *   function only ever runs on a deal that has papers to name. It stands for the
 *   never-generated case, not for "a draft has no serial", which this note used
 *   to claim and which stopped being true on 02-09-2026.
 *
 * 🔴 THIS STEM IS NOT GATED ON APPROVAL, DELIBERATELY AND FOR NOW. A paper
 *    downloaded before the Directors approve is therefore SAVED AS
 *    `OTPL-OC-13-26-27 - CUSTOMER - Summary.pdf`, and `uploadQuotationPdf`
 *    embeds the same string in the storage key. Raised by the OCPI-40 re-audit
 *    (N-3) and left alone on purpose: the bucket uses `upsert: true` with the
 *    name as identity, so gating the stem would RENAME a deal's papers at
 *    approval and orphan the pre-approval objects rather than overwrite them.
 *    That is a storage decision, not a labelling one — see the plan. Do not
 *    "fix" this in isolation.
 */
export function paperFileBase(deal: OcpiDeal, versionNo?: number): string {
  const number = (deal.ocNo ?? `DRAFT-${deal.customerName ?? "quotation"}`).replace(UNSAFE, "-");
  const rev = versionNo && versionNo > 1 ? ` Rev ${versionNo - 1}` : "";
  const who = (deal.customerName ?? "").replace(UNSAFE, "-").trim().slice(0, NAME_CAP).trim();
  // No customer segment rather than an empty one — " -  - PI.pdf" reads as a bug.
  return who && deal.ocNo ? `${number}${rev} - ${who}` : `${number}${rev}`;
}

/**
 * The company's name as it appears in PROSE — "Orange O Tec Pvt Ltd".
 *
 * 🔴 THE STORED `legal_name` IS "M/s ORANGE O TEC PVT LTD.", WHICH IS AN ADDRESS
 *    FORM. "M/s" is used ABOUT a firm, never BY one, so it is right on the bank
 *    line (the company addressing itself to a payer) and wrong everywhere the
 *    company is a party in a sentence.
 *
 * 🔴 THIS EXISTS BECAUSE THE SAME LEAK APPEARED TWICE. OCPI-36 fixed it in the
 *    Performa Invoice's cover letter ("We are M/s ORANGE O TEC PVT LTD."), and
 *    the OCPI-42 audit then found it again inside the composed trade term, on
 *    folder 101's re-entry:
 *
 *      ours    ( Transportation bear by M/s ORANGE O TEC PVT LTD.)
 *      theirs  ( Transportation Bear by Orange O Tec Pvt Ltd)
 *
 *    Two copies of one rule is how a third site gets written wrong. Both callers
 *    now read this; a new one must too.
 *
 * ⚠ ONLY SHOUTING WORDS ARE CALMED. Counted across all 56 real Performa
 *   Invoices in both years: 48 read "Orange O Tec Pvt Ltd", 2 read "Orange O Tec
 *   PVT LTD", 2 name a different entity. A word already carrying a lower-case
 *   letter is left exactly as stored, so "Colorix InkJet" survives intact and
 *   only genuine ALL-CAPS is brought down. One-letter words (the "O") are safe
 *   either way.
 *
 * ⚠ THE BANK LINE MUST NOT USE THIS. It keeps the stored form, "M/s" and all.
 */
export function proseCompanyName(legalName: string | null | undefined): string {
  const legal = legalName?.trim() || "";
  if (!legal) return "";
  const bare = legal.replace(/^m\/s\.?\s+/i, "").trim() || legal;
  return bare
    .split(/(\s+)/)
    .map((w) => (/[a-z]/.test(w) || !/[A-Z]/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join("");
}
