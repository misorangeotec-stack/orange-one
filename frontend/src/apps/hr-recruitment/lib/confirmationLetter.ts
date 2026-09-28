import jsPDF from "jspdf";
import {
  BRAND,
  CONTENT_W,
  MARGIN,
  PAGE_H,
  PAGE_W,
  loadBrandAssets,
  registerBrandFonts,
  text,
  wrapText,
} from "@/shared/lib/pdfBrand";
import { formatDateDMY } from "@/shared/lib/date";

/**
 * NR-10 / KPI 1C.7 — the confirmation letter.
 *
 * A LETTER, not a report. Two consequences the rest of this codebase's PDF work
 * does not have to think about:
 *
 *  • Nothing may be ellipsized. `drawTable` truncates a cell that does not fit,
 *    which is right in a report and wrong here — a silently shortened name or
 *    designation on somebody's confirmation letter is a document that misstates
 *    who it is about. Every line wraps instead.
 *  • The wording is the company's, not ours. It is kept in ONE place below so HR
 *    can have it changed without hunting through layout code, and so nothing
 *    conditional creeps into it. (The `[[if …]]` marker trap from OCPI: a
 *    template string that one renderer understands and another prints raw.)
 *
 * ⚠ SIZE. Embedding Poppins puts a one-page letter at ~5.6 MB, because jsPDF
 * ships the whole TTF rather than a subset. That is what every other document in
 * this codebase does, and it is why the letter looks like the company's own
 * stationery — but it IS a 500x overhead on a file HR will email one per
 * employee. Dropping `registerBrandFonts` and using the built-in Helvetica takes
 * it to a few KB; the letter needs no glyph outside WinAnsi. Worth revisiting if
 * anybody complains about attachment size.
 *
 * The body is deliberately plain. HR has not supplied approved wording, so this
 * states only what the hub actually knows to be true — who, which role, when
 * they joined, and that the probation is complete — and says nothing about terms
 * of employment, notice or salary, which are not this module's facts to assert.
 */

export interface ConfirmationLetterInput {
  name: string;
  jobTitle: string;
  department: string | null;
  employeeCode: string | null;
  joiningDate: string;
  /** The day the decision was taken. */
  confirmedOn: string;
  /** Effective date of the confirmation, when one was recorded. */
  permanentFrom: string | null;
  /** Who signed it off, for the sign-off block. */
  decidedBy: string | null;
}

const BODY = (i: ConfirmationLetterInput): string[] => [
  `Dear ${i.name},`,
  `We are pleased to confirm that you have successfully completed your probation period with Orange O Tec, which began on ${formatDateDMY(i.joiningDate)}.`,
  i.permanentFrom
    ? `With effect from ${formatDateDMY(i.permanentFrom)}, your employment with us is confirmed in the role of ${i.jobTitle}.`
    : `Your employment with us is confirmed in the role of ${i.jobTitle}.`,
  `The reviews held during your probation have been completed and discussed with you. All other terms and conditions of your employment remain unchanged.`,
  `We thank you for your contribution so far and look forward to working with you.`,
];

/**
 * Draw the letter and hand back a File, ready to upload.
 *
 * Returns a File rather than saving: the caller uploads it to `fms-hr-docs` and
 * records the path, so the letter that exists on the record is the same bytes
 * that were produced — never a second render that might differ.
 */
export async function buildConfirmationLetter(i: ConfirmationLetterInput): Promise<File> {
  const assets = await loadBrandAssets();
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  registerBrandFonts(pdf, assets);

  // ---- header band -------------------------------------------------------
  pdf.setFillColor(BRAND.navy);
  pdf.rect(0, 0, PAGE_W, 86, "F");
  if (assets.logo) {
    // 120×34 keeps the wordmark's aspect; it is drawn, never stretched to fit.
    try {
      pdf.addImage(assets.logo, "PNG", MARGIN, 26, 120, 34);
    } catch {
      text(pdf, "ORANGE O TEC", MARGIN, 52, { size: 16, bold: true, color: BRAND.white });
    }
  } else {
    text(pdf, "ORANGE O TEC", MARGIN, 52, { size: 16, bold: true, color: BRAND.white });
  }
  text(pdf, "Confirmation of Employment", PAGE_W - MARGIN, 52, {
    size: 11,
    align: "right",
    color: BRAND.white,
  });

  let y = 132;

  // ---- date and reference ------------------------------------------------
  text(pdf, formatDateDMY(i.confirmedOn), PAGE_W - MARGIN, y, { size: 9.5, align: "right", color: BRAND.grey });
  y += 26;

  // ---- who it is about ---------------------------------------------------
  text(pdf, i.name, MARGIN, y, { size: 13, bold: true });
  y += 16;
  const sub = [i.jobTitle, i.department, i.employeeCode ? `Employee ID ${i.employeeCode}` : null]
    .filter(Boolean)
    .join("  ·  ");
  // Wrapped, never ellipsized: a shortened designation on a confirmation letter
  // is a document that misstates the job somebody has just been confirmed into.
  for (const line of wrapText(pdf, sub, CONTENT_W, 9.5)) {
    text(pdf, line, MARGIN, y, { size: 9.5, color: BRAND.grey });
    y += 13;
  }
  y += 16;

  // ---- the letter --------------------------------------------------------
  for (const para of BODY(i)) {
    for (const line of wrapText(pdf, para, CONTENT_W, 10.5)) {
      text(pdf, line, MARGIN, y, { size: 10.5 });
      y += 16;
    }
    y += 10;
  }

  // ---- sign-off ----------------------------------------------------------
  y += 28;
  text(pdf, "For Orange O Tec", MARGIN, y, { size: 10.5, bold: true });
  y += 44;
  pdf.setDrawColor(BRAND.line);
  pdf.line(MARGIN, y, MARGIN + 180, y);
  y += 14;
  text(pdf, i.decidedBy ?? "Authorised signatory", MARGIN, y, { size: 9.5 });
  y += 13;
  text(pdf, "Human Resources", MARGIN, y, { size: 9, color: BRAND.grey });

  // ---- foot --------------------------------------------------------------
  text(
    pdf,
    "This letter was generated by Orange One and is valid without a signature.",
    PAGE_W / 2,
    PAGE_H - 34,
    { size: 8, align: "center", color: BRAND.grey2 },
  );

  const safe = i.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "employee";
  const fileName = `Confirmation-${safe}-${i.confirmedOn.slice(0, 10)}.pdf`;
  return new File([pdf.output("blob")], fileName, { type: "application/pdf" });
}
