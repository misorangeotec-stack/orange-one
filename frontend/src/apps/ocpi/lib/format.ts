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
 * A quotation number from its sequence value: 24 → `QT-M0024`.
 *
 * ⚠ THE FORMAT LIVES IN TWO PLACES AND THAT IS A KNOWN DUPLICATE. The number a
 *   deal actually carries is minted in SQL — `'QT-M' || lpad(next_seq, 4, '0')`
 *   in fms_ocpi_generate_quotation — because minting must be atomic with the
 *   counter. This copy exists ONLY to show a person what the next one will look
 *   like before it is minted (Settings → Quotation numbering). Nothing stores
 *   what this returns; change the SQL and change this to match.
 */
export function quotationNoFor(seq: number): string {
  return `QT-M${String(Math.max(0, Math.trunc(seq))).padStart(4, "0")}`;
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
 * An order-confirmation number from its sequence value: 9 → `OTPL/OC/9/26-27`.
 *
 * ⚠ THE SAME KNOWN DUPLICATE AS `quotationNoFor`, and the more expensive one to
 *   get wrong. The authority is `fms_ocpi_oc_no` in the database, called by both
 *   `fms_ocpi_generate_quotation` (which mints) and `fms_ocpi_decide_quotation`
 *   (which still mints for any deal generated before OCPI-36). Change that and
 *   change this to match.
 *
 * ⚠ THE SERIAL IS FIRST AND UNPADDED, THE YEAR IS LAST AND HYPHENATED (OCPI-36).
 *   It used to read `OTPL/OC/2627/0009` — year first, serial padded to four —
 *   and every one of the 27 folders in Bushra's `2026.27 OC&PI` is headed
 *   `OTPL/OC/<n>/26-27`. So every order confirmation the module had issued
 *   carried a number her register does not recognise.
 *
 * ⚠ `fy` IS STILL THE FOUR-DIGIT COUNTER SCOPE — `2627`, not `26-27`. It names
 *   the `oc:2627` counter row and `fms_ocpi_set_oc_series` validates it as four
 *   digits. The hyphen belongs to the printed number and is added here.
 *
 * ⚠ THE OC SERIES RESTARTS EACH APRIL and the quotation series does not, which
 *   is why this takes a year and `quotationNoFor` does not.
 *
 * ⚠ DEALS ISSUED BEFORE OCPI-36 KEEP THE NUMBER THEY PRINTED. Nothing rewrites
 *   `oc_no`, so `OTPL/OC/2627/0001…0008` still exist on record and this function
 *   will never reproduce them. That is correct: a frozen paper keeps its number.
 */
export function ocNoFor(seq: number, fy: string = fyCode()): string {
  return `OTPL/OC/${Math.max(0, Math.trunc(seq))}/${fy.slice(0, 2)}-${fy.slice(2)}`;
}

/**
 * The same number with the serial left as a placeholder — `OTPL/OC/nnn/26-27`.
 *
 * ⚠ THIS EXISTS BECAUSE THE CALLER USED TO BUILD IT WITH A REGEX, AND OCPI-36
 *   BROKE THAT REGEX SILENTLY. `SetupWarnings` rendered
 *   `ocNoFor(1, fy).replace(/\d+$/, "nnnn")`, which worked only while the number
 *   ENDED in the serial. Against `OTPL/OC/1/26-27` the trailing digits are the
 *   YEAR, so it produced `OTPL/OC/1/26-nnnn` — a made-up number, in a warning
 *   whose entire job is to show the reader what is about to be minted.
 */
export function ocNoPreview(fy: string = fyCode()): string {
  return `OTPL/OC/nnn/${fy.slice(0, 2)}-${fy.slice(2)}`;
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
