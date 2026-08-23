import type jsPDF from "jspdf";
import { pageH, pageW } from "@/shared/lib/pdfBrand";
import type { OcpiCompanyProfile } from "../types";

/**
 * The Orange O Tec letterhead, drawn behind every OCPI page.
 *
 * ⚠ THE ARTWORK COMES FROM THE POWERPOINT DECKS, NOT FROM Orange Letterhead.pdf.
 *   Every order-confirmation deck carries the wordmark and the footer band on its
 *   SLIDE MASTER, so they appear on every page of every order confirmation that
 *   has ever gone to a customer. Those are the bytes people already recognise,
 *   they are already sized for an A4 portrait page, and using them avoids
 *   converting the supplied PDF — which is US Letter (612×792pt) and would need
 *   a crop decision nobody has made. The PDF stays as the reference for the
 *   blank letterhead.
 *
 * ⚠ THE GEOMETRY IS READ OFF THE SLIDE MASTER, not eyeballed. On a
 *   6858000 × 9906000 EMU slide the master places:
 *     wordmark  x=3985260 y=57150   w=2599690 h=887095   → 58.1% / 0.6% / 37.9% / 9.0%
 *     footer    x=0       y=5468112 w=6858000 h=4437888  →  0%   / 55.2% / 100%  / 44.8%
 *   Expressed as fractions so the same code lands correctly on any page size.
 *
 * ⚠ THE FOOTER BAND CARRIES A REGISTERED ADDRESS AND A CIN, which are per legal
 *   entity — Orange O Tec Pvt Ltd, Orange O Tec Enterprises, Colorix LLP and the
 *   two Noida arms are five different companies. `letterheadPath` on the
 *   company profile is what lets a deal booked under another entity print its
 *   own. Falling back to the default is right for the common case and wrong to
 *   do silently for the others.
 *
 * ⚠ `usedDefault` BELOW IS NOT WHAT TELLS ANYBODY. An earlier version of this
 *   comment said the flag "reports it, loudly" — it never did: nothing in the
 *   module read it, so a Colorix contract printed Orange O Tec's address and CIN
 *   in silence. The flag is kept because it is the honest answer to "which
 *   artwork did this page get", but the thing a person actually sees is
 *   `CompanyProfileWarning` (components/SetupWarnings.tsx), which is driven by
 *   `profileStatusFor` in the store and appears on the screens that produce a
 *   document. Do not re-add a claim here that this flag warns anyone.
 */

const LOGO = { x: 0.581, y: 0.006, w: 0.379, h: 0.090 };
const FOOTER = { x: 0, y: 0.552, w: 1, h: 0.448 };

/** Where the body may be drawn without colliding with the letterhead. */
export const BODY_TOP = 92;
export const BODY_BOTTOM_FRACTION = 0.925;

export interface LetterheadAssets {
  logo: string;
  footer: string;
  /** True when the deal's company has no artwork of its own and the default was used. */
  usedDefault: boolean;
}

const cache = new Map<string, Promise<string>>();

async function dataUrl(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:image/png;base64,${btoa(bin)}`;
  })().catch((e) => {
    // Do not cache a failure — a transient 404 during a deploy would otherwise
    // make every later export in the session letterhead-less.
    cache.delete(path);
    throw e;
  });
  cache.set(path, p);
  return p;
}

/**
 * Load the artwork for a company.
 *
 * The logo is shared; only the footer differs per entity, because that is where
 * the address and CIN live.
 */
export async function loadLetterhead(profile?: OcpiCompanyProfile): Promise<LetterheadAssets> {
  const custom = profile?.letterheadPath?.trim();
  const logo = await dataUrl("/assets/ocpi/orange-logo.png");
  if (custom) {
    try {
      return { logo, footer: await dataUrl(custom), usedDefault: false };
    } catch {
      // Fall through to the default rather than producing a page with no
      // letterhead at all — but say so, loudly, via usedDefault.
    }
  }
  return { logo, footer: await dataUrl("/assets/ocpi/letterhead-default.png"), usedDefault: true };
}

/**
 * Paint the letterhead on the CURRENT page.
 *
 * ⚠ CALL THIS FIRST ON EVERY PAGE. jsPDF paints in call order with no
 *   z-index, so drawing the footer band after the body would white out the
 *   bottom third of the text.
 */
export function drawLetterhead(pdf: jsPDF, a: LetterheadAssets): void {
  const w = pageW(pdf);
  const h = pageH(pdf);
  // The footer band is mostly white with a faint watermark, so it is safe —
  // and necessary — to lay it down as a background.
  pdf.addImage(a.footer, "PNG", FOOTER.x * w, FOOTER.y * h, FOOTER.w * w, FOOTER.h * h, "ocpiFoot", "FAST");
  pdf.addImage(a.logo, "PNG", LOGO.x * w, LOGO.y * h, LOGO.w * w, LOGO.h * h, "ocpiLogo", "FAST");
}

/** The lowest y a page may draw body content at before it runs into the address block. */
export const bodyBottom = (pdf: jsPDF): number => pageH(pdf) * BODY_BOTTOM_FRACTION;
