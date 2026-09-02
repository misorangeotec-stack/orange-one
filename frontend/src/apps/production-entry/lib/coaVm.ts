import type { Coa, CoaAudience } from "../types";
import { dmy } from "./format";

/**
 * ONE COA, TWO AUDIENCES — the shared piece is the DATA, not the template.
 *
 * The customer copy and the internal copy are the same certificate with a
 * different row set, so the split lives here and all three renderers (print, PDF,
 * Excel) consume the same view model. That is the mirror image of the issue slip,
 * where one layout is fed two different data sets.
 *
 * ⚠ NOTHING HERE READS A MASTER. Every value comes off the saved COA, which
 *   froze its own copy of each parameter name, standard and equipment when it was
 *   issued. A standard corrected in the master next month must not change what a
 *   certificate already in a customer's hands would reprint.
 *
 * ⚠ NOR DOES IT READ THE JOB CARD. The test verdict is taken from the COA's own
 *   `qcResult`, frozen at save for ITS round. `ProductionRequest.qcStatus` mirrors
 *   the LATEST round, so re-deriving from it here would relabel a Test 1
 *   certificate the moment Test 2 came back with a different answer.
 *
 * ⚠ THE LAYOUT IS THE FACTORY'S OWN SHEET, not the portal's report chrome.
 *   Source: "Daily Quality Monitoring Sheet OOT QC FMT 002", tab "COA (Both)" —
 *   logo top-left, company and address to its right, a centred title, three
 *   label/value rows, the four-column analysis grid (whose first header cell is
 *   deliberately BLANK), a conclusion row, then two signature rules. Every
 *   renderer reproduces that, so the three outputs are the same document.
 */

export const COA_COMPANY = "Orange O Tec Enterprises Pvt. Ltd.";
export const COA_ADDRESS_LINES = [
  "Shed No. A2/7111, Road No.71, Gate No.: 01 G.I.D.C Sachin,",
  "Surat – 394230, (Guj.) India.",
];
export const COA_TITLE = "Certification of Analysis";
/** Trailing " :" is the sheet's own convention for every label on the form. */
export const COA_SIGN_OFFS = ["Analyst", "Q.C. Head"];
/** The white-background wordmark, the same one pasted into the sheet. */
export const COA_LOGO_PATH = "/assets/Orang_O_Tec_logo.jpg";

/** The verdict of the one test round this certificate covers. */
export type CoaResult = "approved" | "rejected" | null;

/**
 * WHAT THE PAPER SAYS THE TEST FOUND — one sentence, on both copies, next to the
 * Conclusion.
 *
 * ⚠ IT IS NOT DECORATION FOR THE WATERMARK. The client chose a pale watermark
 *   over a red band knowing it is the weakest of the three markings against a bad
 *   photocopy or a low-toner printer; this line is the plain-text statement
 *   underneath the visual, and it is the only marking the .xlsx and a
 *   black-and-white fax can be relied on to carry.
 */
export const coaResultText = (result: CoaResult, round: number): string =>
  result === "approved"
    ? `Approved (Test ${round})`
    : result === "rejected"
      ? `Rejected — this lot failed the quality test (Test ${round})`
      : `Not yet recorded (Test ${round})`;

/**
 * The word stamped across the page, or null for a clean certificate.
 *
 * ⚠ A CERTIFICATE WITH NO VERDICT IS MARKED TOO. The COA may now be entered
 *   before Approve/Reject is pressed — it is the test-results record, not only
 *   the certificate — so there is a window in which it is printable and the lot
 *   has not been passed. Printing that unmarked would read as a pass.
 */
export const coaWatermark = (result: CoaResult): string | null =>
  result === "approved" ? null : result === "rejected" ? "REJECTED" : "NOT VERIFIED";

export interface CoaDocLine {
  name: string;
  standard: string;
  observed: string;
  equipment: string;
}

export interface CoaDocument {
  audience: CoaAudience;
  company: string;
  addressLines: string[];
  title: string;
  productName: string;
  lotNo: string;
  issueDateDmy: string;
  conclusion: string;
  /**
   * The internal-only remark, or NULL when this copy must not show it.
   *
   * ⚠ NULL IS THE AUDIENCE DECISION, ALREADY MADE. Every renderer omits the row
   *   when this is null and none of them re-checks `audience` — the switch lives
   *   in one place (see REMARKS_AUDIENCE), exactly as it does for the line rows.
   */
  remarks: string | null;
  /** Which test this certificate is for — 1 on a lot that passed first time. */
  round: number;
  result: CoaResult;
  /** The Result row's value, printed on both copies. */
  resultText: string;
  /** "REJECTED" / "NOT VERIFIED" / null. The PDF and the print view draw it
   *  across the page; the .xlsx cannot, and states it in text instead. */
  watermark: string | null;
  lines: CoaDocLine[];
}

/** The dash the paper form uses for an empty cell — never a blank, so a reader
 *  can tell "nothing was recorded" from "the cell failed to render". */
const dash = (v: string | null | undefined): string => {
  const t = (v ?? "").trim();
  return t === "" ? "-" : t;
};

/**
 * Which rows this copy prints.
 *
 * ⚠ "both" IS THE COMMON CASE. In the factory sheet the five customer parameters
 *   appear on the internal copy as well — the two blocks are nested, not
 *   disjoint — so an audience filter that only matched its own name exactly
 *   would print an internal copy of four rows instead of nine.
 */
const showsOn = (lineAudience: string, audience: CoaAudience): boolean =>
  lineAudience === "both" || lineAudience === audience;

/**
 * WHO SEES THE REMARKS — the one place that decides it.
 *
 * ⚠ THE FIRST FIELD WHOSE AUDIENCE IS FIXED IN CODE. Every other difference
 *   between the two copies is data-driven, through the parameter master's
 *   `appears_on`; Remarks has no master row to carry one. So it is declared here
 *   as a value and pushed through the SAME `showsOn` the line rows use, rather
 *   than an `if (audience === "customer")` in each renderer — which is how the
 *   two copies would start diverging in two places at once.
 *
 * Internal only, and the reason is what makes the field usable at all: staff
 * must be able to write plainly about a batch without a customer reading it.
 */
const REMARKS_AUDIENCE: CoaAudience | "both" = "internal";

export function buildCoaDocument(coa: Coa, audience: CoaAudience): CoaDocument {
  return {
    audience,
    company: COA_COMPANY,
    addressLines: COA_ADDRESS_LINES,
    title: COA_TITLE,
    productName: dash(coa.productName),
    lotNo: dash(coa.lotNo),
    issueDateDmy: dmy(coa.issueDate),
    conclusion: dash(coa.conclusion),
    // The audience switch, applied ONCE. A null here is "this copy does not show
    // it" and every renderer simply omits the row.
    remarks: showsOn(REMARKS_AUDIENCE, audience) && (coa.remarks ?? "").trim() !== ""
      ? (coa.remarks as string).trim()
      : null,
    round: coa.round,
    result: coa.qcResult,
    resultText: coaResultText(coa.qcResult, coa.round),
    watermark: coaWatermark(coa.qcResult),
    lines: coa.lines
      .filter((l) => showsOn(l.appearsOn, audience))
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        name: l.name,
        standard: dash(l.standard),
        observed: dash(l.observed),
        equipment: dash(l.equipmentName),
      })),
  };
}

/** Who this copy is for, said once — used for the file name, never printed on the
 *  document itself (the source sheet's two headings label the SHEET, and are not
 *  part of the certificate). */
export const AUDIENCE_WORD: Record<CoaAudience, string> = {
  customer: "Customer",
  internal: "Internal",
};

const safeSlug = (s: string): string =>
  s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "COA";

/**
 * The download name.
 *
 * ⚠ THE PRODUCT IS IN IT ON PURPOSE. "COA-2608-1344-Customer.pdf" is correct but
 *   unrecognisable in a Downloads folder — a lot number is not something anyone
 *   carries in their head. Naming the product first makes the file say what it is
 *   at a glance, which is the whole job of a file name.
 *
 * ⚠ AND SO IS THE TEST NUMBER. A re-tested lot has a certificate per round; two
 *   files landing in one folder under the same name is how the wrong one gets
 *   sent.
 */
export const coaFileName = (coa: Coa, audience: CoaAudience, ext: "pdf" | "xlsx"): string =>
  `COA-${safeSlug(coa.productName ?? "")}-${safeSlug(coa.lotNo ?? "")}-Test${coa.round}-${AUDIENCE_WORD[audience]}.${ext}`;
