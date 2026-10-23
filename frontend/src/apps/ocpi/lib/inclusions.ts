import type { OcpiDeal } from "../types";

/**
 * What the deal INCLUDES (section B), worded for the customer's papers.
 *
 * 🔴 ONLY A "YES" BECOMES A LINE (client, 20-Oct-2026). An item answered "No"
 *    produces nothing — on the Summary, the PI and the OC alike — so no paper
 *    ever tells the customer what the deal leaves out. Used by the PI's
 *    Terms & Conditions and the OC's note under the price, so the two cannot
 *    disagree.
 */

/**
 * The ink sentence: "50 Kgs ink included in above value."
 *
 * ⚠ THE FIELD IS FREE TEXT, so the sentence is completed rather than assembled
 *   blindly (see the long note on `includedInkNote` in ocPdf.ts): a value that
 *   already says "included" prints as typed, a bare number gets "Kgs".
 */
export function inkIncludedSentence(d: OcpiDeal): string | null {
  if (d.inclInk !== true) return null;
  const typed = d.inkQtyIncluded?.trim();
  if (!typed) return "Ink included in above value.";
  if (/\bincluded\b/i.test(typed)) return typed;
  // No letters at all ⇒ a bare quantity, so the unit is missing rather than different.
  const withUnit = /[A-Za-z]/.test(typed) ? typed : `${typed} Kgs`;
  const withInk = /\bink\b/i.test(withUnit) ? withUnit : `${withUnit} ink`;
  return `${withInk} included in above value.`;
}

export interface InclusionLine {
  /** Short label for the PI's "Label : text" bullet. */
  label: string;
  /** The sentence itself. */
  text: string;
}

export function inclusionLines(d: OcpiDeal): InclusionLine[] {
  const out: InclusionLine[] = [];
  const ink = inkIncludedSentence(d);
  if (ink) out.push({ label: "Ink", text: ink });

  if (d.inclSpares === true) {
    const det = d.spareDetails?.trim();
    out.push({
      label: "Spare Parts",
      text: det ? `Spare parts included in above value — ${det}.`.replace(/\.\.$/, ".") : "Spare parts included in above value.",
    });
  }

  if (d.inclHead === true) {
    const n = d.headsIncluded;
    out.push({
      label: "Print Head",
      text: n && n > 0
        ? `${n} print head${n === 1 ? "" : "s"} included in above value.`
        : "Print head included in above value.",
    });
  }

  if (d.inclCentering === true) {
    const det = d.centeringDetails?.trim();
    out.push({
      label: "Centering Device",
      text: det ? `External centring device included — ${det}.`.replace(/\.\.$/, ".") : "External centring device included.",
    });
  }
  return out;
}
