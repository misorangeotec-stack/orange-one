/**
 * The server stand-in for `@/shared/lib/pdfBrand`.
 *
 * It re-exports the real module untouched and overrides ONE function: `loadBrandAssets`.
 *
 * WHY
 *   The browser fetches its fonts and logo from `/assets/…` — page-relative URLs, which off a
 *   page mean nothing. Here the very same files are read off the repository that is already
 *   checked out, so the mailed PDF is drawn with the same faces and the same wordmark as the one
 *   an admin downloads by hand. No network call, no base URL, and nothing to go wrong at 08:00
 *   with nobody watching.
 *
 *   The fonts are not decoration. Without them U+20B9 is unrenderable and every rupee figure in
 *   the report comes out as a blank box.
 *
 * ⚠ `export *` FIRST, OVERRIDE SECOND. An explicit local export beats a star re-export in ESM, so
 *   `loadBrandAssets` below is the one callers get and everything else — drawTable, headerBand,
 *   BRAND, registerBrandFonts — comes straight from the real module. The build resolves the
 *   specifier below back to the real file (it skips the substitution when the importer is this
 *   file), so this is not an infinite loop.
 */
export * from "@/shared/lib/pdfBrand";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrandAssets } from "@/shared/lib/pdfBrand";

/**
 * Where the app keeps them. Set by the build so this file does not have to guess how deep it is
 * inside whatever directory the bundle ends up in.
 */
const PUBLIC_DIR = process.env.COLLECTIONS_REPORT_PUBLIC_DIR ?? resolve("frontend/public");

const read = (rel: string): string => readFileSync(resolve(PUBLIC_DIR, rel)).toString("base64");

let assets: BrandAssets | null = null;

export function loadBrandAssets(): Promise<BrandAssets> {
  if (!assets) {
    // At first use, and it throws rather than degrading: the one thing worse than a report that
    // fails is sixty pages of blank boxes where the money should be.
    const regular = read("assets/fonts/Poppins-Regular.ttf");
    const semibold = read("assets/fonts/Poppins-SemiBold.ttf");
    if (!regular || !semibold) {
      throw new Error(
        `collections-report: the Poppins faces are missing under ${PUBLIC_DIR}. ` +
          "Set COLLECTIONS_REPORT_PUBLIC_DIR to the app's public folder.",
      );
    }
    // The logo is the one asset the real loader already treats as optional — `headerBand` draws
    // its wordmark instead when it is absent, which is a documented fallback rather than a
    // degradation nobody chose. Kept optional here for the same reason.
    let logo = "";
    try {
      logo = `data:image/png;base64,${read("assets/orange-one-logo-dark.png")}`;
    } catch {
      logo = "";
    }
    assets = { regular, semibold, logo };
  }
  return Promise.resolve(assets);
}
