/**
 * Section 2 of the Master Report PDF — the user × module access matrix, in A4
 * LANDSCAPE.
 *
 * ⚠ WHY THIS DOES NOT USE `drawTable`.
 *   Sixteen module columns across 774pt of landscape content leaves ~40pt each.
 *   `drawTable` ellipsizes a header to its own column width, and `ellipsize`
 *   degrades to a BARE "…" once the budget drops under ~10pt — silently, so the
 *   output looks like rendered data rather than a layout failure. "New Customer
 *   Onboarding" at 40pt would come out as "New…", and sixteen of those is a
 *   legend the reader has to decode. So the headers are drawn ROTATED 90°, which
 *   buys ~110pt of name length for 40pt of column width, and the body is a
 *   purpose-built grid.
 *
 * ⚠ WHY THE ACCESS MARK IS DRAWN, NOT TYPED.
 *   Poppins — embedded here because jsPDF's Helvetica has no ₹ — carries no tick
 *   glyph (see `safeText` in pdfBrand.ts: it maps ₹ · — – … • ≥ ≤ ± × but NOT
 *   ticks or arrows). A "✓" would silently render as nothing. The mark is a
 *   filled rounded rect instead, which also matches the on-screen chip.
 *
 * Orientation is STICKY in jsPDF: once `addPage("a4","landscape")` is called,
 * every later bare `addPage()` stays landscape. That is what we want for this
 * section's own overflow pages, and it is why nothing portrait may follow.
 */

import type jsPDF from "jspdf";
import {
  BRAND, MARGIN,
  contentW, pageH,
  footer, headerBand, pageWash, sectionHeading, text, widthOf,
  type Ctx,
} from "@/shared/lib/pdfBrand";
import { lastSeenLabel } from "./accessMatrix";
import type { AccessMatrix, AccessRow } from "./accessMatrix";

const ROLE_LABEL: Record<AccessRow["role"], string> = {
  admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee",
};

/** Left block: name + department, sign-in, module count. Tuned so the widest real
 *  values fit — the longest name is 26 chars and the longest department 28. */
const W_NAME = 132;
const W_DEPT = 104;
const W_ROLE = 46;
const W_SEEN = 52;
const W_COUNT = 26;
const LEFT_W = W_NAME + W_DEPT + W_ROLE + W_SEEN + W_COUNT;

const ROW_H = 13;
const HEAD_ROT_H = 112;   // vertical room for the rotated module names
const BODY_SIZE = 7.2;

/** Draw one access mark centred in its column. */
function mark(pdf: jsPDF, cx: number, cy: number, on: boolean): void {
  const s = 6.4;
  if (on) {
    pdf.setFillColor(BRAND.orange);
    pdf.roundedRect(cx - s / 2, cy - s / 2, s, s, 1.6, 1.6, "F");
  } else {
    pdf.setDrawColor(BRAND.line);
    pdf.setLineWidth(0.6);
    pdf.roundedRect(cx - s / 2, cy - s / 2, s, s, 1.6, 1.6, "S");
  }
}

/**
 * Append the access section. Returns nothing; the caller stamps the footer of
 * the final page and resolves the total-pages token.
 */
export function drawAccessSection(ctx: Ctx, matrix: AccessMatrix, generatedAt: string): void {
  const { pdf } = ctx;

  const startPage = (first: boolean): number => {
    if (first) pdf.addPage("a4", "landscape");
    else pdf.addPage();            // orientation is sticky — stays landscape
    pageWash(pdf);
    let y = headerBand(ctx, { tag: "Master Report", compact: true });
    y += 16;
    if (first) {
      y = sectionHeading(pdf, MARGIN, y, "Section 2", "User access by module");
      y += 4;
      text(
        pdf,
        `${matrix.rows.length} users · a filled square means the person can open that module · `
          + `${matrix.neverSignedIn} have never signed in`
          + (matrix.grantedButNeverSignedIn
              ? `, ${matrix.grantedButNeverSignedIn} of them already granted access`
              : ""),
        MARGIN, y, { size: 7.2, color: BRAND.grey },
      );
      y += 12;
    }
    return y;
  };

  const cw = contentW(pdf);
  const colW = Math.max(18, (cw - LEFT_W) / Math.max(1, matrix.modules.length));

  /** Rotated module names + the left-block labels. Returns the body's first y. */
  const drawHeader = (top: number): number => {
    const baseY = top + HEAD_ROT_H;

    // Rotated names. jsPDF rotates about the anchor, so anchoring at the
    // baseline and rotating +90 makes the text read bottom-to-top.
    matrix.modules.forEach((m, i) => {
      const x = MARGIN + LEFT_W + i * colW + colW / 2 + 2.4;
      text(pdf, m.name, x, baseY - 4, { size: 6.4, bold: true, color: BRAND.navy, angle: 90 });
    });

    // Left-block headers sit on the baseline, unrotated.
    const lh = baseY - 4;
    let x = MARGIN;
    const label = (s: string, w: number) => {
      text(pdf, s, x, lh, { size: 6.4, bold: true, color: BRAND.grey2 });
      x += w;
    };
    label("USER", W_NAME);
    label("DEPARTMENT", W_DEPT);
    label("ROLE", W_ROLE);
    label("LAST SIGN-IN", W_SEEN);
    text(pdf, "MODS", MARGIN + LEFT_W - 4, lh, { size: 6.4, bold: true, color: BRAND.grey2, align: "right" });

    // Rule under the whole header.
    pdf.setDrawColor(BRAND.navy);
    pdf.setLineWidth(0.8);
    pdf.line(MARGIN, baseY, MARGIN + cw, baseY);
    return baseY + 4;
  };

  let first = true;
  let y = startPage(true);
  y = drawHeader(y);
  first = false;

  const bottom = () => pageH(pdf) - 40;

  for (const [rowIndex, u] of matrix.rows.entries()) {
    if (y + ROW_H > bottom()) {
      footer(ctx, pdf.getCurrentPageInfo().pageNumber, generatedAt);
      y = startPage(first);
      y = drawHeader(y);
    }

    const cy = y + ROW_H / 2;

    // Zebra banding: at 13pt rows across 774pt, the eye loses the line without it.
    if (rowIndex % 2 === 1) {
      pdf.setFillColor(BRAND.page);
      pdf.rect(MARGIN, y, cw, ROW_H, "F");
    }

    let x = MARGIN;
    const cell = (s: string, w: number, opts: { color?: string; bold?: boolean } = {}) => {
      text(pdf, s, x, cy + 2.2, {
        size: BODY_SIZE, color: opts.color ?? BRAND.navy, bold: opts.bold, maxWidth: w - 4,
      });
      x += w;
    };

    cell(clip(pdf, u.name, W_NAME - 4), W_NAME, { bold: true });
    cell(clip(pdf, u.department || "—", W_DEPT - 4), W_DEPT, { color: BRAND.grey });
    cell(ROLE_LABEL[u.role], W_ROLE, { color: BRAND.grey });
    cell(lastSeenLabel(u.lastActiveAt), W_SEEN, {
      // Never signed in is the one thing on this page worth a colour.
      color: u.lastActiveAt ? BRAND.grey : BRAND.red,
      bold: !u.lastActiveAt,
    });
    // Explicit grants, not the overlaid total: an admin would otherwise read as
    // "16 modules granted" when in fact none were granted to them at all.
    text(pdf, u.isAdmin ? "all" : String(u.explicitCount), MARGIN + LEFT_W - 4, cy + 2.2, {
      size: BODY_SIZE, color: BRAND.grey, align: "right",
    });

    if (u.isAdmin) {
      // One banded span rather than sixteen filled squares: an admin's access
      // does not come from a grant, and drawing it as grants would misreport it.
      const bx = MARGIN + LEFT_W;
      const bw = colW * matrix.modules.length;
      pdf.setFillColor(BRAND.orangeSoft);
      pdf.rect(bx, y + 1.5, bw, ROW_H - 3, "F");
      text(pdf, "Admin — every module", bx + bw / 2, cy + 2.2, {
        size: 6.6, bold: true, color: BRAND.orange, align: "center",
      });
    } else {
      matrix.modules.forEach((m, i) => {
        mark(pdf, MARGIN + LEFT_W + i * colW + colW / 2, cy, u.access[m.id] ?? false);
      });
    }

    y += ROW_H;
  }

  // Totals rule + row.
  if (y + ROW_H + 6 > bottom()) {
    footer(ctx, pdf.getCurrentPageInfo().pageNumber, generatedAt);
    y = startPage(false);
    y = drawHeader(y);
  }
  pdf.setDrawColor(BRAND.navy);
  pdf.setLineWidth(0.8);
  pdf.line(MARGIN, y + 1, MARGIN + cw, y + 1);
  y += 5;
  const cy = y + ROW_H / 2;
  text(pdf, "Granted to", MARGIN, cy + 2.2, { size: 6.6, bold: true, color: BRAND.navy });
  matrix.modules.forEach((m, i) => {
    // The EXPLICIT count. The overlaid total can never drop below the number of
    // admins, so it could never show that a module was rolled out to nobody.
    const n = matrix.explicitTotals[m.id] ?? 0;
    text(pdf, n === 0 ? "none" : String(n), MARGIN + LEFT_W + i * colW + colW / 2, cy + 2.2, {
      size: 6.8, bold: true, align: "center",
      color: n === 0 ? BRAND.red : BRAND.navy,
    });
  });
}

/**
 * Hard clip rather than `ellipsize`: at these widths the shared helper can
 * collapse to a lone "…", which reads as data. Losing the tail of a long
 * department name is the lesser evil, and the column is sized so it rarely bites.
 */
function clip(pdf: jsPDF, s: string, maxW: number): string {
  if (widthOf(pdf, s, BODY_SIZE) <= maxW) return s;
  let out = s;
  while (out.length > 1 && widthOf(pdf, out, BODY_SIZE) > maxW) out = out.slice(0, -1);
  return out;
}

