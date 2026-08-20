/**
 * The Deno stand-in for `@/shared/lib/pdfBrand`.
 *
 * It re-exports the real module untouched and overrides ONE function: `loadBrandAssets`.
 *
 * WHY
 *   The browser fetches its fonts from `/assets/fonts/…` — a page-relative URL, which on a server
 *   means nothing. `report-spike` proved the runtime can draw the PDF but had to pull Poppins off
 *   the public Google Fonts repo to do it, and wrote down the conclusion: in production the fonts
 *   must be INLINED into the bundle. That removes a network call, a base URL, and a whole class of
 *   failure from a send path that runs at 08:00 with nobody watching. The browser is unaffected —
 *   it keeps fetching and caching its own copy.
 *
 *   The fonts are not decoration. Without them U+20B9 is unrenderable and every rupee figure in
 *   the report comes out as a blank box.
 *
 * ⚠ THE LOGO IS DELIBERATELY DROPPED. It is a 163 KB PNG, it is the one asset `loadBrandAssets`
 *   already treats as optional, and `headerBand` draws its wordmark instead when it is absent —
 *   which is the documented fallback, not a degradation nobody chose. Inlining it would add a
 *   220 KB base64 string to every deploy of this function to save one wordmark.
 *
 * ⚠ `export *` FIRST, OVERRIDE SECOND. An explicit local export beats a star re-export in ESM, so
 *   `loadBrandAssets` below is the one callers get and everything else — drawTable, headerBand,
 *   BRAND, registerBrandFonts — comes straight from the real module. The build resolves the
 *   specifier below back to the real file (it skips the substitution when the importer is this
 *   file), so this is not an infinite loop.
 */
export * from "@/shared/lib/pdfBrand";

import type { BrandAssets } from "@/shared/lib/pdfBrand";
import { POPPINS_REGULAR_B64, POPPINS_SEMIBOLD_B64 } from "./fonts.generated";

const assets: BrandAssets = {
  regular: POPPINS_REGULAR_B64,
  semibold: POPPINS_SEMIBOLD_B64,
  logo: "",
};

if (!assets.regular || !assets.semibold) {
  // At module load, not mid-render: a missing font is a broken report, and the one thing worse
  // than failing is mailing sixty pages of blank boxes where the money should be.
  throw new Error("collections-report: the Poppins faces are missing from the bundle");
}

export function loadBrandAssets(): Promise<BrandAssets> {
  return Promise.resolve(assets);
}
