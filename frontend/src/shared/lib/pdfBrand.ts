/**
 * pdfBrand.ts — the Orange One look, drawn into a jsPDF document.
 *
 * Lives in `shared/lib` because it is portal-wide infrastructure, not hub-local: it was written
 * for the Outstanding Dashboard's collections report and moved here when the Master Report needed
 * the same chrome. Import it as `@/shared/lib/pdfBrand` from anywhere; do NOT copy it per app,
 * which is how the brand ends up with four slightly different navies.
 *
 * Every branded PDF in the portal draws through these primitives so the chrome (navy band, orange
 * rule, card, table, footer) is defined once. The palette is the same set of hex values the app
 * uses in `vite.config.ts` / `index.css` and that `supabase/functions/send-email/index.ts` already
 * mirrors for the HTML mails — three copies of the brand, one source of truth for the numbers.
 *
 * WHY VECTOR, NOT html2canvas
 *   `exportCustomer.ts` renders a PDF by screenshotting the DOM. That produces an image: no
 *   selectable text, no internal links, no bookmarks, and text that blurs when zoomed. A report
 *   whose whole point is "click a salesperson to jump to their page" has to be drawn natively.
 *
 * WHY THE FONT IS EMBEDDED (this is a correctness fix, not styling)
 *   jsPDF's built-in Helvetica is WinAnsi-encoded and has NO rupee sign (U+20B9), while every
 *   money figure in this app comes from `fmtINRMoney` and starts with one. Left alone, every
 *   amount in the document prints as a missing-glyph box. Embedding Poppins — which does carry
 *   U+20B9, verified against its cmap — fixes that AND happens to be the portal's own typeface.
 *   The font must be registered with Identity-H; WinAnsi cannot address the codepoint at all.
 *
 * WHY THE ASSETS ARE FETCHED, NOT INLINED
 *   The two faces are ~305 KB of TTF. Base64'd into a .ts module they would be ~410 KB of source
 *   in git and in the bundle. Served from `public/assets/fonts/` they are ordinary static files:
 *   downloaded only when someone actually exports, then cached by the browser. `loadBrandAssets`
 *   memoises the promise, so a session pays for them once.
 */

import type jsPDF from "jspdf";

// ── Palette (hex, from vite.config.ts + index.css) ──────────────────────────────────
export const BRAND = {
  navy: "#0B1B40",
  navy2: "#15294F",
  orange: "#FF6A1F",
  orange2: "#FF8A3D",
  orangeSoft: "#FFF1E8",
  /**
   * A wash so faint it reads as "this row is worth a look" rather than as a total.
   * Deliberately LIGHTER than `orangeSoft`, which is the interim-total fill: a flagged
   * ordinary row and a row that concludes a section must not land in the same tone.
   */
  orangeWash: "#FFF7F0",
  page: "#F6F9FD",
  line: "#E9EEF6",
  /**
   * One step deeper than `line`, for the row that CLOSES a section.
   * A band opens a sale type and a subtotal closes it; painted in the same `line` they abutted
   * into one grey slab and a reader could not tell the heading from the sum.
   */
  lineStrong: "#CFDCEE",
  grey: "#64748B",
  grey2: "#8A99B0",
  red: "#E5484D",
  green: "#27AE60",
  white: "#FFFFFF",
} as const;

export const FONT = "Poppins";

/** A4 portrait in points, and the page margin everything is laid out against. */
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 34;
export const CONTENT_W = PAGE_W - MARGIN * 2;

/**
 * The CURRENT page's size, read from the document rather than assumed.
 *
 * ⚠ THE CONSTANTS ABOVE ARE PORTRAIT A4 AND ALWAYS WILL BE. They are baked at
 *   import time, so any primitive that used them directly silently mislaid
 *   itself the moment a landscape page appeared: the footer drew at y=818 on a
 *   595pt-tall page (i.e. off the sheet entirely), the navy band and page wash
 *   stopped two-thirds across, and `drawTable`'s default `maxY` never tripped,
 *   so rows ran off the bottom and the page-break callback never fired.
 *
 *   jsPDF tracks a mediaBox PER PAGE, so these getters are correct after
 *   `addPage()` and after `setPage()`. Everything that touches page geometry
 *   goes through here now; the exported constants stay for callers that want
 *   the portrait figure (and so existing imports keep working).
 */
export const pageW = (pdf: jsPDF): number => pdf.internal.pageSize.getWidth();
export const pageH = (pdf: jsPDF): number => pdf.internal.pageSize.getHeight();
/** Drawable width on the current page, whatever its orientation. */
export const contentW = (pdf: jsPDF): number => pageW(pdf) - MARGIN * 2;

/**
 * Characters Poppins does NOT have, mapped to something it does.
 *
 * Checked against the shipped cmap rather than assumed: the font carries ₹ · — – … • ≥ ≤ ± × −,
 * but NOT the arrows, Greek delta, ticks or numero. An unmapped codepoint does not throw — it
 * silently renders as a blank or a box, which is exactly the kind of defect that reaches a
 * customer-facing report unnoticed. So every string drawn goes through `safeText` first.
 *
 * Note "Δ pp" is a real column label in ZC_COLUMNS, so this is not hypothetical.
 */
const GLYPH_FALLBACK: Record<string, string> = {
  "→": ">", "←": "<", "↑": "^", "↓": "v",  // → ← ↑ ↓
  "Δ": "D",                                                // Δ
  "✓": "y", "✔": "y", "✗": "x",                  // ✓ ✔ ✗
  "№": "No.",                                              // №
  /**
   * FULLWIDTH FORMS, which arrive with anything copied out of a Chinese-authored
   * document — and OCPI's machine templates are transcribed from exactly that.
   *
   * ⚠ THESE ARE SEPARATORS, SO LOSING THEM JOINS WORDS RATHER THAN LEAVING A
   *   GAP. Poppins has neither, so before this an electrical specification read
   *   "AC220V~240V +- 10% single phasePrinter 34A (7.4 kW)" and "DryerAC380V" on
   *   a customer's contract — the missing glyph took the word boundary with it,
   *   which reads as a typo rather than as a rendering fault and so goes
   *   unreported. Caught by rendering an order confirmation, not by the compiler.
   */
  "｜": " | ",                                             // U+FF5C fullwidth vertical line
  "：": ": ",                                              // U+FF1A fullwidth colon
  "，": ", ",                                              // U+FF0C fullwidth comma
  "（": " (", "）": ") ",                                  // U+FF08 / U+FF09
};
const GLYPH_RE = new RegExp(`[${Object.keys(GLYPH_FALLBACK).join("")}]`, "g");

/** Make a string safe to draw in Poppins. Always call this before `pdf.text`. */
export const safeText = (s: string): string =>
  (s ?? "").replace(GLYPH_RE, (c) => GLYPH_FALLBACK[c] ?? "");

// ── Asset loading ───────────────────────────────────────────────────────────────────

export interface BrandAssets {
  regular: string;   // base64 TTF
  semibold: string;  // base64 TTF
  /** Data URL for the white-on-dark logo, or "" when it could not be fetched. */
  logo: string;
}

/** ArrayBuffer → base64, chunked so a 150 KB font cannot blow the argument limit. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return toBase64(await res.arrayBuffer());
}

let assetsPromise: Promise<BrandAssets> | null = null;

/**
 * Fetch (once per session) the embedded font faces and the logo.
 *
 * The fonts are required — without them the rupee sign is unrenderable, so a failure here is a
 * failed export and must be surfaced. The logo is decorative: if it 404s the header band simply
 * draws its wordmark instead, which is a better outcome than refusing to produce the report.
 */
export function loadBrandAssets(): Promise<BrandAssets> {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const [regular, semibold] = await Promise.all([
        fetchBase64("/assets/fonts/Poppins-Regular.ttf"),
        fetchBase64("/assets/fonts/Poppins-SemiBold.ttf"),
      ]);
      let logo = "";
      try {
        logo = `data:image/png;base64,${await fetchBase64("/assets/orange-one-logo-dark.png")}`;
      } catch {
        logo = "";
      }
      return { regular, semibold, logo };
    })().catch((err) => {
      assetsPromise = null; // let a later export retry rather than caching the failure
      throw err;
    });
  }
  return assetsPromise;
}

/**
 * Register Poppins on a fresh document. Identity-H is what makes U+20B9 addressable.
 *
 * ⚠ THE ENCODING GOES IN THE FOURTH ARGUMENT, AND THE WEIGHT MUST NOT.
 *   `addFont(postScriptName, fontName, fontStyle, fontWeight, encoding)` overloads argument 4:
 *   a recognised encoding string is taken as the encoding, but ANY other truthy value is taken as
 *   a font weight and rewrites the style key via `combineFontStyleAndFontWeight`. Passing the
 *   honest weight 600 for SemiBold therefore files the face under "600bold", while `setFont(FONT,
 *   "bold")` looks up "bold" — so every bold string silently falls back and jsPDF logs
 *   "Unable to look up font label". Registering with the encoding in slot 4 keeps the key as
 *   plain "bold". (jspdf 4.2.1, dist/jspdf.es.js:4989 and :1179.)
 */
export function registerBrandFonts(pdf: jsPDF, assets: BrandAssets): void {
  pdf.addFileToVFS("Poppins-Regular.ttf", assets.regular);
  pdf.addFont("Poppins-Regular.ttf", FONT, "normal", "Identity-H");
  pdf.addFileToVFS("Poppins-SemiBold.ttf", assets.semibold);
  pdf.addFont("Poppins-SemiBold.ttf", FONT, "bold", "Identity-H");
  pdf.setFont(FONT, "normal");
}

// ── Drawing helpers ─────────────────────────────────────────────────────────────────

export interface Ctx {
  pdf: jsPDF;
  assets: BrandAssets;
  /** Filled in once the whole document is laid out; used by the footer. */
  totalPagesToken: string;
}

export const setFill = (pdf: jsPDF, hex: string) => pdf.setFillColor(hex);
export const setText = (pdf: jsPDF, hex: string) => pdf.setTextColor(hex);
export const setDraw = (pdf: jsPDF, hex: string) => pdf.setDrawColor(hex);

export function text(
  pdf: jsPDF,
  s: string,
  x: number,
  y: number,
  opts: {
    size?: number; bold?: boolean; color?: string;
    align?: "left" | "center" | "right"; maxWidth?: number;
    /**
     * Degrees, anticlockwise about the anchor. Used for the rotated column
     * headers on the landscape access matrix, where sixteen module names have
     * ~40pt of column width each and would otherwise ellipsize to nothing.
     */
    angle?: number;
  } = {},
): void {
  pdf.setFont(FONT, opts.bold ? "bold" : "normal");
  pdf.setFontSize(opts.size ?? 9);
  setText(pdf, opts.color ?? BRAND.navy);
  pdf.text(safeText(s), x, y, {
    align: opts.align ?? "left",
    maxWidth: opts.maxWidth,
    ...(opts.angle === undefined ? {} : { angle: opts.angle }),
  });
}

/** Width of a string at a given size/weight — for measuring before drawing. */
export function widthOf(pdf: jsPDF, s: string, size: number, bold = false): number {
  pdf.setFont(FONT, bold ? "bold" : "normal");
  pdf.setFontSize(size);
  return pdf.getTextWidth(safeText(s));
}

/**
 * Wrap a string to `maxW` AT A GIVEN SIZE.
 *
 * ⚠ ALWAYS USE THIS INSTEAD OF `pdf.splitTextToSize` DIRECTLY. jsPDF measures against whatever
 *   font and size happen to be set on the document at that moment, which is the size of the LAST
 *   thing drawn, not the size the caller is about to draw at. Wrapping a 9pt subtitle straight
 *   after drawing a 19pt title silently measures it at 19pt and breaks the line a third of the way
 *   across the page — a defect that looks like a deliberate layout choice, so nobody reports it.
 */
export function wrapText(pdf: jsPDF, s: string, maxW: number, size: number, bold = false): string[] {
  pdf.setFont(FONT, bold ? "bold" : "normal");
  pdf.setFontSize(size);
  return pdf.splitTextToSize(safeText(s), maxW) as string[];
}

/** Truncate to fit a column, with an ellipsis. Poppins has U+2026, so the real one is safe. */
export function ellipsize(pdf: jsPDF, s: string, maxW: number, size: number, bold = false): string {
  const clean = safeText(s);
  if (widthOf(pdf, clean, size, bold) <= maxW) return clean;
  let lo = 0, hi = clean.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (widthOf(pdf, `${clean.slice(0, mid)}…`, size, bold) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${clean.slice(0, lo).trimEnd()}…`;
}

/**
 * A left-pointing triangle used as the "back" affordance.
 *
 * Poppins has no arrow glyphs at all (verified — U+2190..U+2193 are absent), so "← Contents"
 * would print with a hole in it. Drawing the mark keeps the affordance without depending on the
 * typeface for iconography.
 */
export function backTriangle(pdf: jsPDF, x: number, y: number, size: number, color: string): void {
  setFill(pdf, color);
  pdf.triangle(x, y, x + size, y - size / 2, x + size, y + size / 2, "F");
}

/**
 * A house mark, drawn, used as the "back to the front page" affordance.
 *
 * Poppins carries no arrows and no dingbats (verified against its cmap), so an icon here cannot
 * come from the typeface — "🏠 Home" or "← Contents" would print with a hole in it. It is built
 * from a triangle and two rectangles instead, which is also the only way to get it in brand orange
 * at an exact size.
 *
 * `(x, y)` is the mark's CENTRE, not its corner, so it can be centred on a text baseline without
 * the caller doing the arithmetic. The doorway is punched in the page colour rather than left
 * solid: at 8pt a filled pentagon reads as a smudge, and the doorway is what makes it a house.
 */
export function homeIcon(
  pdf: jsPDF,
  x: number, y: number, size: number,
  color: string,
  bg: string = BRAND.page,
): void {
  const half = size / 2;
  const left = x - half;
  const right = x + half;
  const top = y - half;
  const bottom = y + half;
  const eave = top + size * 0.42;

  setFill(pdf, color);
  // Roof, deliberately wider than the body so the silhouette still reads as a house when small.
  pdf.triangle(left, eave, x, top, right, eave, "F");
  const bodyW = size * 0.68;
  pdf.rect(x - bodyW / 2, eave, bodyW, bottom - eave, "F");

  setFill(pdf, bg);
  const doorW = size * 0.22;
  const doorH = size * 0.34;
  pdf.rect(x - doorW / 2, bottom - doorH, doorW, doorH, "F");
}

/** #rrggbb → [r,g,b]. */
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * A left-to-right gradient, drawn as N abutting strips.
 *
 * jsPDF has real axial shading patterns, but they are a per-page resource with their own
 * bookkeeping; at this size a 48-step ramp is indistinguishable and costs nothing. Two flat
 * blocks — which is what this replaced — showed a hard seam down the middle of the header.
 */
export function gradientRect(
  pdf: jsPDF,
  x: number, y: number, w: number, h: number,
  from: string, to: string,
  steps = 48,
): void {
  const [r1, g1, b1] = rgb(from);
  const [r2, g2, b2] = rgb(to);
  const sw = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    pdf.setFillColor(Math.round(r1 + (r2 - r1) * t), Math.round(g1 + (g2 - g1) * t), Math.round(b1 + (b2 - b1) * t));
    // +0.6 overlap: abutting fills can leave hairline seams once the viewer rounds to device pixels.
    pdf.rect(x + i * sw, y, sw + 0.6, h, "F");
  }
}

/** The navy header band with the logo. Returns the y coordinate just under the orange rule. */
export function headerBand(
  ctx: Ctx,
  /**
   * `note` is a short fact about the DATA (e.g. how current it is), set on the band itself so it
   * is impossible to miss and impossible to leave behind: the band is on every page, while the
   * meta strip is page 1 only. It rides under the tag on the right, in orange on navy — the one
   * combination in this palette that is loud without being a heading.
   */
  opts: { tag?: string; compact?: boolean; note?: string } = {},
): number {
  const { pdf, assets } = ctx;
  const h = opts.compact ? 40 : 54;
  const pw = pageW(pdf);

  gradientRect(pdf, 0, 0, pw, h, BRAND.navy, BRAND.navy2);

  const logoH = opts.compact ? 16 : 22;
  let drewLogo = false;
  let brandW = 0;
  if (assets.logo) {
    try {
      const p = pdf.getImageProperties(assets.logo);
      brandW = (p.width / p.height) * logoH;
      pdf.addImage(assets.logo, "PNG", MARGIN, (h - logoH) / 2, brandW, logoH, "ooLogo", "FAST");
      drewLogo = true;
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo) {
    text(pdf, "Orange One", MARGIN, h / 2 + 4, { size: 13, bold: true, color: BRAND.white });
    brandW = widthOf(pdf, "Orange One", 13, true);
  }

  /**
   * The tag is the DOCUMENT'S OWN NAME, and it is set brightly on purpose.
   *
   * It used to be a muted "RECEIVABLES" — the app's name, which the reader of a mailed PDF already
   * knows and which is the same on every report the app produces. The report's own name is what
   * identifies the file at a glance on every page, so it gets a legible weight rather than a
   * decorative one. Ellipsized against the room the wordmark left, so a long title can never run
   * under the logo.
   */
  const room = pw - MARGIN * 2 - brandW - 18;
  if (opts.tag) {
    // With a note under it the pair is centred as a block, so the band never looks bottom-heavy.
    text(pdf, ellipsize(pdf, opts.tag.toUpperCase(), room, 8, true), pw - MARGIN, h / 2 + (opts.note ? -3 : 3), {
      size: 8, bold: true, color: "#E8EEF8", align: "right",
    });
  }
  if (opts.note) {
    text(pdf, ellipsize(pdf, opts.note.toUpperCase(), room, 6.6, true), pw - MARGIN, h / 2 + (opts.tag ? 10 : 3), {
      size: 6.6, bold: true, color: BRAND.orange2, align: "right",
    });
  }

  gradientRect(pdf, 0, h, pw, 3, BRAND.orange, BRAND.orange2);

  return h + 3;
}

/**
 * The footer rule + page number. `pageNo` is 1-based; the total uses jsPDF's placeholder.
 *
 * `note` is an optional trailing fact about the DATA, as opposed to `generatedAt`, which is the
 * wall clock when the file was made. The two answer different questions and a reader who only has
 * the timestamp cannot tell how current the figures above it are. Appended here rather than given
 * its own line so it reaches every page — the header strip is page 1 only.
 */
export function footer(ctx: Ctx, pageNo: number, generatedAt: string, note?: string): void {
  const { pdf } = ctx;
  // Both read from the CURRENT page: on a landscape sheet the portrait constants
  // put this 222pt below the bottom edge, and the footer vanished silently.
  const pw = pageW(pdf);
  const y = pageH(pdf) - 24;
  setDraw(pdf, BRAND.line);
  pdf.setLineWidth(0.5);
  pdf.line(MARGIN, y - 10, pw - MARGIN, y - 10);
  text(pdf, `Orange O Tec · Orange One · generated ${generatedAt}${note ? ` · ${note}` : ""}`, MARGIN, y, {
    size: 7, color: BRAND.grey2,
  });
  text(pdf, `Page ${pageNo} of ${ctx.totalPagesToken}`, pw - MARGIN, y, {
    size: 7, color: BRAND.grey2, align: "right",
  });
}

/**
 * A rounded white card with a label, a big value and a sub-line.
 *
 * `card.link` does NOT create the link — the caller owns that, because a forward link's target
 * page usually does not exist yet (see DeferredLink). It draws the AFFORDANCE: an orange border
 * and a "SEE LIST" marker, so a reader can tell which cards do something before clicking around
 * the page to find out. A link with no affordance is a link nobody uses.
 */
export function statCard(
  pdf: jsPDF,
  x: number, y: number, w: number, h: number,
  card: { label: string; value: string; sub?: string; alarm?: boolean; link?: boolean },
): void {
  setFill(pdf, BRAND.white);
  setDraw(pdf, card.link ? BRAND.orange : BRAND.line);
  pdf.setLineWidth(card.link ? 1 : 0.7);
  pdf.roundedRect(x, y, w, h, 6, 6, "FD");
  // Orange left rail, the same device the emails use to mark a card.
  setFill(pdf, BRAND.orange);
  pdf.roundedRect(x, y, 2.5, h, 1.2, 1.2, "F");

  // The card lays itself out from its own height rather than from fixed offsets, so a caller
  // that needs to fit six cards plus a table on one page can just ask for a shorter card. Below
  // ~50pt the three lines no longer clear each other at the full sizes.
  const tight = h < 50;
  const labelY = tight ? 12 : 14;
  const valueY = tight ? 28 : 32;
  const valueSize = tight ? 12.5 : 14;
  const subY = tight ? 38 : 43;
  const subSize = tight ? 6.3 : 6.8;

  const pad = 9;
  let labelRoom = w - pad * 2;

  if (card.link) {
    const hint = "SEE LIST";
    const hintW = widthOf(pdf, hint, 5.6, true);
    const right = x + w - pad;
    // Right-pointing triangle: Poppins has no arrow or chevron glyph, so the mark is drawn.
    setFill(pdf, BRAND.orange);
    pdf.triangle(right - 3.4, y + labelY - 5.8, right, y + labelY - 3, right - 3.4, y + labelY - 0.2, "F");
    text(pdf, hint, right - 5.2, y + labelY - 0.6, { size: 5.6, bold: true, color: BRAND.orange, align: "right" });
    labelRoom -= hintW + 12;
  }

  text(pdf, ellipsize(pdf, card.label.toUpperCase(), labelRoom, 6.4, true), x + pad, y + labelY, {
    size: 6.4, bold: true, color: BRAND.grey2,
  });
  text(pdf, ellipsize(pdf, card.value, w - pad * 2, valueSize, true), x + pad, y + valueY, {
    size: valueSize, bold: true, color: card.alarm ? BRAND.red : BRAND.navy,
  });
  if (card.sub) {
    text(pdf, ellipsize(pdf, card.sub, w - pad * 2, subSize), x + pad, y + subY, {
      size: subSize, color: BRAND.grey,
    });
  }
}

/**
 * A compact card, for a strip of secondary figures under the headline ones.
 *
 * Same anatomy as `statCard` at roughly two-thirds the height, so a second row of cards reads as
 * subordinate to the first rather than competing with it. Use it when a page needs MORE numbers
 * without becoming a wall of equally-loud boxes — a full-size card per sale type turns the
 * at-a-glance block into ten shouting tiles and nothing stands out.
 */
export const MINI_CARD_H = 38;

export function miniCard(
  pdf: jsPDF,
  x: number, y: number, w: number,
  card: { label: string; value: string; sub?: string; alarm?: boolean },
): void {
  setFill(pdf, BRAND.white);
  setDraw(pdf, BRAND.line);
  pdf.setLineWidth(0.7);
  pdf.roundedRect(x, y, w, MINI_CARD_H, 5, 5, "FD");
  setFill(pdf, card.alarm ? BRAND.red : BRAND.orange);
  pdf.roundedRect(x, y, 2, MINI_CARD_H, 1, 1, "F");

  const pad = 7;
  text(pdf, ellipsize(pdf, card.label.toUpperCase(), w - pad * 2, 5.9, true), x + pad, y + 11, {
    size: 5.9, bold: true, color: BRAND.grey2,
  });
  text(pdf, ellipsize(pdf, card.value, w - pad * 2, 10.5, true), x + pad, y + 25, {
    size: 10.5, bold: true, color: card.alarm ? BRAND.red : BRAND.navy,
  });
  if (card.sub) {
    text(pdf, ellipsize(pdf, card.sub, w - pad * 2, 6.1), x + pad, y + 34, {
      size: 6.1, color: BRAND.grey,
    });
  }
}

/**
 * A hairline rule used to separate the bands of a page.
 *
 * Deliberately its own primitive rather than an inline `pdf.line`: the whole point is that every
 * divider in the portal's PDFs is the SAME weight and colour, so they read as structure instead of
 * as decoration someone added by hand at three different thicknesses.
 */
export function divider(pdf: jsPDF, x: number, y: number, width: number): number {
  setDraw(pdf, BRAND.line);
  pdf.setLineWidth(0.7);
  pdf.line(x, y, x + width, y);
  return y + 1;
}

/**
 * The "what this document covers" strip: a small row of label/value pairs in a bordered card.
 *
 * These facts (as on, period) are the ones that make a printed figure mean anything, and buried in
 * a grey run-on line they get skipped. Given their own card with a rule between each pair, they
 * read as the document's terms of reference. Values are ellipsized per cell.
 */
export const META_STRIP_H = 32;
/** Height when any cell carries a `note`. The extra 9pt is the note's own line. */
export const META_STRIP_H_NOTE = 41;

export function metaStrip(
  pdf: jsPDF,
  x: number, y: number, width: number,
  /** `note` is a quiet third line under the value — e.g. how complete the data behind it is. */
  items: readonly { label: string; value: string; note?: string }[],
): number {
  if (!items.length) return y;
  // The card grows only when something needs the room, so every existing caller keeps its layout
  // to the point. Callers must read the RETURN value rather than assuming META_STRIP_H.
  const h = items.some((it) => it.note) ? META_STRIP_H_NOTE : META_STRIP_H;
  setFill(pdf, BRAND.white);
  setDraw(pdf, BRAND.line);
  pdf.setLineWidth(0.7);
  pdf.roundedRect(x, y, width, h, 5, 5, "FD");
  setFill(pdf, BRAND.orange);
  pdf.roundedRect(x, y, 2.5, h, 1.2, 1.2, "F");

  const pad = 12;
  const colW = (width - pad) / items.length;
  items.forEach((it, i) => {
    const cx = x + pad + i * colW;
    if (i > 0) {
      setDraw(pdf, BRAND.line);
      pdf.setLineWidth(0.7);
      pdf.line(cx - 9, y + 7, cx - 9, y + h - 7);
    }
    text(pdf, it.label.toUpperCase(), cx, y + 12, { size: 6.1, bold: true, color: BRAND.grey2 });
    text(pdf, ellipsize(pdf, it.value, colW - 16, 9, true), cx, y + 24, {
      size: 9, bold: true, color: BRAND.navy,
    });
    if (it.note) {
      text(pdf, ellipsize(pdf, it.note, colW - 16, 6.4, false), cx, y + 34, {
        size: 6.4, color: BRAND.grey2,
      });
    }
  });
  return y + h;
}

// ── Tables ──────────────────────────────────────────────────────────────────────────

export interface PdfColumn<T> {
  header: string;
  /** Share of the table width. Normalised across the column set, so these are ratios. */
  width: number;
  align?: "left" | "right";
  value: (row: T) => string;
  /** Per-row colour override (e.g. red for an alarm figure). */
  color?: (row: T) => string | undefined;
  /** Target page for an internal link on this cell, when it is already known. */
  linkTo?: (row: T) => number | undefined;
  /**
   * A symbolic link target, resolved AFTER the whole document is laid out.
   *
   * The contents page links to per-salesperson pages that do not exist while it is being drawn,
   * and a forward link needs a real page number. So the cell records where it sits, and
   * `applyDeferredLinks` stamps the annotations once every page exists. Requires `linkSink`.
   */
  linkKey?: (row: T) => string | undefined;
}

/** A link whose target page is not known until the document is finished. */
export interface DeferredLink {
  key: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Stamp deferred links now that every page exists. Unresolved keys are skipped, not thrown. */
export function applyDeferredLinks(
  pdf: jsPDF,
  links: readonly DeferredLink[],
  pageOf: ReadonlyMap<string, number>,
): void {
  const current = pdf.getCurrentPageInfo().pageNumber;
  for (const l of links) {
    const target = pageOf.get(l.key);
    if (target === undefined) continue;
    pdf.setPage(l.page);
    pdf.link(l.x, l.y, l.w, l.h, { pageNumber: target });
  }
  pdf.setPage(current);
}

/**
 * How a table row is painted.
 *
 *   normal · total (an interim subtotal) · muted (a deduction or an aside) · grand (the bottom line)
 *   band   · a SECTION HEADING inside the table — the row carries a label, not figures, and the
 *            rows under it belong to it. Used where a table is grouped and the group needs naming
 *            without breaking it into separate `drawTable` calls, which would lose the shared
 *            header and the page-break handling.
 *   subtotal · the row that CLOSES a section, under the bills it sums.
 *   big    · an ordinary row FLAGGED as one of the large ones. It is still a data row — it sums
 *            nothing and concludes nothing — so it wears a rail and a wash rather than a
 *            total's fill. Only meaningful where the caller has ranked the rows.
 */
export type RowKind = "normal" | "total" | "muted" | "grand" | "band" | "subtotal" | "big";

export interface TableOpts<T> {
  x: number;
  y: number;
  width: number;
  columns: PdfColumn<T>[];
  rows: T[];
  rowKind?: (row: T) => RowKind;
  headerSize?: number;
  bodySize?: number;
  rowH?: number;
  /** Called when the table needs a new page; must return the y to continue drawing at. */
  onNewPage?: () => number;
  /** Bottom limit before a page break is forced. */
  maxY?: number;
  /** Collector for `linkKey` cells. Pass the same array to `applyDeferredLinks` afterwards. */
  linkSink?: DeferredLink[];
}

/** Draw a table. Returns the y coordinate just below the last row. */
export function drawTable<T>(pdf: jsPDF, opts: TableOpts<T>): number {
  const { x, width, columns, rows } = opts;
  const headerSize = opts.headerSize ?? 7;
  const bodySize = opts.bodySize ?? 7.8;
  const rowH = opts.rowH ?? 15;
  // Off the CURRENT page, not off portrait A4. With the old constant this
  // defaulted to 796 on a 595pt-tall landscape sheet, so the `y + rowH > maxY`
  // check below never fired: rows were painted past the bottom edge and
  // `onNewPage` was never called.
  const maxY = opts.maxY ?? pageH(pdf) - 46;
  const pad = 5;

  const totalRatio = columns.reduce((s, c) => s + c.width, 0);
  const widths = columns.map((c) => (c.width / totalRatio) * width);
  const xs: number[] = [];
  let acc = x;
  for (const w of widths) { xs.push(acc); acc += w; }

  let y = opts.y;

  const drawHeader = () => {
    setFill(pdf, BRAND.navy);
    pdf.rect(x, y, width, rowH + 1, "F");
    columns.forEach((c, i) => {
      const right = (c.align ?? "left") === "right";
      text(pdf, ellipsize(pdf, c.header, widths[i] - pad * 2, headerSize, true),
        right ? xs[i] + widths[i] - pad : xs[i] + pad, y + rowH - 4,
        { size: headerSize, bold: true, color: BRAND.white, align: right ? "right" : "left" });
    });
    y += rowH + 1;
  };

  drawHeader();

  for (const row of rows) {
    if (y + rowH > maxY) {
      if (!opts.onNewPage) break;
      y = opts.onNewPage();
      drawHeader();
    }
    const kind = opts.rowKind?.(row) ?? "normal";

    if (kind === "grand") { setFill(pdf, BRAND.navy); pdf.rect(x, y, width, rowH, "F"); }
    else if (kind === "total") { setFill(pdf, BRAND.orangeSoft); pdf.rect(x, y, width, rowH, "F"); }
    // A band is quieter than a total on purpose: it names the section, it does not conclude it.
    else if (kind === "band") { setFill(pdf, BRAND.line); pdf.rect(x, y, width, rowH, "F"); }
    // The subtotal is a step DEEPER than the band, plus a navy rule drawn across its top edge.
    // It closes what the band opened, and one section's subtotal is usually followed immediately
    // by the next section's band: painted in the same `line` the two abutted into a single grey
    // slab with no telling which was the heading and which the sum. (Both were "muted" before
    // that — grey, unfilled, unbolded, i.e. lighter than the very bills they were summing.)
    else if (kind === "subtotal") {
      setFill(pdf, BRAND.lineStrong);
      pdf.rect(x, y, width, rowH, "F");
      setDraw(pdf, BRAND.navy);
      pdf.setLineWidth(0.7);
      pdf.line(x, y, x + width, y);
    }
    // A flagged row: faint wash plus an orange rail down its left edge. The rail is what does the
    // work — a wash pale enough not to be mistaken for a total is also pale enough to miss when
    // scanning, and the rail is the same mark the cards use for "look here".
    else if (kind === "big") {
      setFill(pdf, BRAND.orangeWash);
      pdf.rect(x, y, width, rowH, "F");
      setFill(pdf, BRAND.orange);
      pdf.rect(x, y + 1, 2, rowH - 2, "F");
    }

    const baseColor =
      kind === "grand" ? BRAND.white : kind === "muted" ? BRAND.grey2 : BRAND.navy;

    columns.forEach((c, i) => {
      const right = (c.align ?? "left") === "right";
      const bold =
        kind === "grand" || kind === "total" || kind === "band" || kind === "subtotal" || kind === "big";
      const color = (kind === "grand" ? undefined : c.color?.(row)) ?? baseColor;
      const raw = c.value(row);
      const shown = ellipsize(pdf, raw, widths[i] - pad * 2, bodySize, bold);
      const tx = right ? xs[i] + widths[i] - pad : xs[i] + pad;
      text(pdf, shown, tx, y + rowH - 4.5, { size: bodySize, bold, color, align: right ? "right" : "left" });

      const target = c.linkTo?.(row);
      const key = c.linkKey?.(row);
      if (target !== undefined || (key !== undefined && opts.linkSink)) {
        const w = widthOf(pdf, shown, bodySize, bold);
        const lx = right ? tx - w : tx;
        if (target !== undefined) pdf.link(lx, y + 2, w, rowH - 3, { pageNumber: target });
        else opts.linkSink!.push({ key: key!, page: pdf.getCurrentPageInfo().pageNumber, x: lx, y: y + 2, w, h: rowH - 3 });
      }
    });

    if (kind !== "grand") {
      setDraw(pdf, BRAND.line);
      pdf.setLineWidth(0.4);
      pdf.line(x, y + rowH, x + width, y + rowH);
    }
    y += rowH;
  }

  return y;
}

/**
 * A horizontal bar comparing one customer against the biggest one shown.
 *
 * ⚠ THE BAR IS SCALED TO THE LARGEST ROW, NOT TO 100% OF THE TOTAL, and that is the whole point.
 *   Scaled against the total, a book where the top twenty customers hold ~1.3% each renders as
 *   twenty invisible slivers — a chart that occupies a third of the page and says nothing. Against
 *   the largest row the bars actually compare customers to each other, which is the question the
 *   strip exists to answer. The true share of the salesperson's overdue is still printed on every
 *   row, and the section caption states what the shown rows add up to, so nothing is lost.
 *
 * `fraction` is 0..1 of the largest row. `valueText` carries the honest figures.
 */
export function shareBar(
  pdf: jsPDF,
  opts: { x: number; y: number; width: number; label: string; fraction: number; valueText: string },
): void {
  const { x, y, width } = opts;
  const labelW = width * 0.34;
  const valueW = width * 0.20;
  const trackX = x + labelW + 4;
  const trackW = width - labelW - valueW - 8;
  const h = 7;

  text(pdf, ellipsize(pdf, opts.label, labelW - 2, 7.2), x, y + h - 0.5, { size: 7.2, color: BRAND.navy });

  setFill(pdf, BRAND.line);
  pdf.roundedRect(trackX, y, trackW, h, 3, 3, "F");

  const fillW = Math.max(2, Math.max(0, Math.min(1, opts.fraction)) * trackW);
  setFill(pdf, BRAND.orange);
  pdf.roundedRect(trackX, y, fillW, h, 3, 3, "F");

  text(pdf, opts.valueText, x + width, y + h - 0.5, { size: 7.2, bold: true, color: BRAND.navy, align: "right" });
}

/** Section heading: small uppercase orange eyebrow over a navy title. */
export function sectionHeading(pdf: jsPDF, x: number, y: number, eyebrow: string, title?: string): number {
  text(pdf, eyebrow.toUpperCase(), x, y, { size: 6.8, bold: true, color: BRAND.orange });
  if (!title) return y + 8;
  text(pdf, title, x, y + 14, { size: 11.5, bold: true, color: BRAND.navy });
  return y + 22;
}

// ── Note block (bulleted commentary) ────────────────────────────────────────────────

const NOTE_SIZE = 7.6;
const NOTE_LEAD = 10.5;
const NOTE_PAD = 10;
const NOTE_BULLET_W = 9;

/** Wrap each source bullet to the block's inner width, keeping the bullets separable. */
function wrapNote(pdf: jsPDF, lines: readonly string[], innerW: number): string[][] {
  pdf.setFont(FONT, "normal");
  pdf.setFontSize(NOTE_SIZE);
  return lines.map((l) => pdf.splitTextToSize(safeText(l), innerW) as string[]);
}

/**
 * How tall `noteBlock` will be for these lines at this width.
 *
 * Exported because the caller has to decide whether the block fits on the current page BEFORE it
 * starts drawing — a commentary box half off the bottom of a page is worse than one on the next
 * page, and jsPDF gives you no way to undo a draw.
 */
export function noteBlockHeight(pdf: jsPDF, width: number, lines: readonly string[]): number {
  const innerW = width - NOTE_PAD * 2 - NOTE_BULLET_W;
  const n = wrapNote(pdf, lines, innerW).reduce((s, w) => s + w.length, 0);
  return 28 + n * NOTE_LEAD;
}

/**
 * A soft-orange panel of bulleted commentary, for the read-out under a table.
 *
 * Set apart from the body deliberately: these lines are an INTERPRETATION of the figures above,
 * not more figures, and a reader must be able to tell the two apart at a glance. Returns the y
 * coordinate just below the block.
 */
export function noteBlock(
  pdf: jsPDF,
  opts: { x: number; y: number; width: number; title: string; lines: readonly string[] },
): number {
  const { x, y, width } = opts;
  const h = noteBlockHeight(pdf, width, opts.lines);

  setFill(pdf, BRAND.orangeSoft);
  pdf.roundedRect(x, y, width, h, 6, 6, "F");
  setFill(pdf, BRAND.orange);
  pdf.roundedRect(x, y, 2.5, h, 1.2, 1.2, "F");

  text(pdf, opts.title.toUpperCase(), x + NOTE_PAD, y + NOTE_PAD + 4, {
    size: 6.4, bold: true, color: BRAND.orange,
  });

  const innerW = width - NOTE_PAD * 2 - NOTE_BULLET_W;
  let ly = y + NOTE_PAD + 16;
  for (const wrapped of wrapNote(pdf, opts.lines, innerW)) {
    setFill(pdf, BRAND.orange);
    pdf.circle(x + NOTE_PAD + 2, ly - 2.4, 1.4, "F");
    for (const line of wrapped) {
      text(pdf, line, x + NOTE_PAD + NOTE_BULLET_W, ly, { size: NOTE_SIZE, color: BRAND.navy });
      ly += NOTE_LEAD;
    }
  }
  return y + h;
}

/** Paint the page background wash. Call before anything else on a page. */
export function pageWash(pdf: jsPDF): void {
  setFill(pdf, BRAND.page);
  pdf.rect(0, 0, pageW(pdf), pageH(pdf), "F");
}
