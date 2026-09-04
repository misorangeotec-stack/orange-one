/**
 * pdfText.mjs — read a real order confirmation as LINES, not as a text blob.
 *
 * 🔴 pdf.js HANDS BACK ITEMS IN CONTENT-STREAM ORDER, WHICH IS POWERPOINT'S
 *    TEXT-BOX ORDER, NOT READING ORDER. Every real OC in the folder was authored
 *    as a PowerPoint deck, so a two-column specification table arrives as all the
 *    labels and then all the values, or worse, interleaved from three different
 *    boxes. Proven on the real papers before this file was written:
 *
 *      · OCs 108 / 110 / 111 yield NO OC number at all in stream order — the
 *        heading and the number sit in different boxes and land pages apart.
 *      · OC 122 gives `Model: Two` and OC 123 gives `Model: 3`, because the next
 *        item in the stream is a value from the column beside it.
 *      · OC 88's intro paragraph arrives BEFORE the date and the address.
 *
 *    Reading a contract in that order and diffing it against ours would report
 *    dozens of gaps that are only the deck's box ordering. So lines are rebuilt
 *    from geometry: cluster by baseline, sort by x within the line.
 *
 * ⚠ THE TOLERANCE IS DERIVED FROM THE TEXT, NOT GUESSED. Two items belong to one
 *   line when their baselines differ by less than half the smaller item's height.
 *   A fixed pt tolerance breaks on the decks that mix 8pt table text with 20pt
 *   headings — either the heading swallows the row beneath it, or a wrapped 8pt
 *   cell splits into two lines mid-word.
 *
 * ⚠ THE COLUMN GAP IS PRESERVED AS A TAB, NOT A SPACE. `Model:` and `Homer K32`
 *   are separate boxes with an inch between them; joined by a single space the
 *   label/value split is unrecoverable, and the spec-row parser needs it. A gap
 *   wider than ~1.6 spaces becomes `\t`, which the parser reads as a cell break
 *   and every other consumer treats as whitespace.
 */

import { readFileSync } from "node:fs";

const PDFJS = new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.mjs", import.meta.url);

let pdfjsPromise = null;
const pdfjs = () => (pdfjsPromise ??= import(PDFJS.href));


/**
 * Every page of a PDF, as geometric lines.
 *
 * Returns `{ pages: [{ lines: [{ text, y, x, height }] }], hasTextLayer }`.
 * `hasTextLayer` false means an image-only scan — two of the real OCs are exactly
 * that, and they must be REPORTED rather than silently read as an empty document.
 */
export async function readPdfLines(path) {
  const { getDocument } = await pdfjs();
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(path)),
    useSystemFonts: true,
    // The decks embed subset fonts; without this pdf.js warns per glyph and the
    // console output buries everything else.
    verbosity: 0,
  }).promise;

  const pages = [];
  let items = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    items += content.items.length;
    pages.push({ number: p, lines: linesFrom(content.items) });
  }
  await doc.destroy();
  const kept = dropDoubledPrint(pages);
  return {
    pages: kept,
    numPages: doc.numPages,
    hasTextLayer: items > 0,
    doubled: kept.length !== pages.length,
  };
}

/**
 * A PDF whose second half repeats its first half is ONE contract printed twice.
 *
 * 🔴 REAL OC 122 (Vijay Laxmi, 2026.27) IS 12 PAGES OF A 6-PAGE CONTRACT. Both
 *    halves are line-for-line identical — 146 lines each, zero differences —
 *    so the paper is a duplicate binding, not two versions. Read whole, it parsed
 *    to 18 clauses instead of 9 and reported the same clause twice, which then
 *    looked like the machine having twice as many problems as it has.
 *
 * ⚠ IDENTICAL IS THE WHOLE TEST. If the two halves differ ANYWHERE the document
 *   is left exactly as it is, because then it genuinely holds two versions and
 *   which one governs is a question for a person, not something to silently trim.
 */
function dropDoubledPrint(pages) {
  if (pages.length < 4 || pages.length % 2 !== 0) return pages;
  const half = pages.length / 2;
  const flat = (ps) => ps.flatMap((p) => p.lines.map((l) => l.text.replace(/\s+/g, " ").trim()));
  const a = flat(pages.slice(0, half));
  const b = flat(pages.slice(half));
  if (a.length === 0 || a.length !== b.length) return pages;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return pages;
  return pages.slice(0, half);
}

/** Group items into lines by baseline, then order each line left to right. */
function linesFrom(items) {
  const glyphs = items
    .filter((it) => typeof it.str === "string" && it.str.length > 0)
    .map((it) => ({
      text: it.str,
      // transform = [a, b, c, d, e, f]; e is x, f is the baseline y.
      x: it.transform[4],
      y: it.transform[5],
      w: it.width ?? 0,
      // `height` is 0 on some items; fall back to the vertical scale.
      h: it.height || Math.abs(it.transform[3]) || 8,
    }));

  const rows = [];
  for (const g of glyphs) {
    // ⚠ MATCHED AGAINST THE ROW'S OWN BASELINE, not against the last glyph seen.
    //   Superscripts and the odd raised bullet would otherwise walk the row's
    //   baseline downwards one glyph at a time and merge two real lines.
    const row = rows.find((r) => Math.abs(r.y - g.y) < Math.min(r.h, g.h) * 0.5);
    if (row) {
      row.glyphs.push(g);
      row.h = Math.min(row.h, g.h);
    } else {
      rows.push({ y: g.y, h: g.h, glyphs: [g] });
    }
  }

  // Top of the page downwards. PDF y grows upwards, so this is descending.
  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    row.glyphs.sort((a, b) => a.x - b.x);
    let text = "";
    let prev = null;
    for (const g of row.glyphs) {
      if (prev) {
        const gap = g.x - (prev.x + prev.w);
        // A space is roughly a quarter of the font height in these decks.
        const space = prev.h * 0.25;
        if (gap > space * 1.6) text += "\t";
        else if (gap > space * 0.35 && !/\s$/.test(text) && !/^\s/.test(g.text)) text += " ";
      }
      text += g.text;
      prev = g;
    }
    return {
      text: text.replace(/[ \t]+$/, ""),
      y: row.y,
      x: row.glyphs[0].x,
      height: row.h,
    };
  }).filter((l) => l.text.trim().length > 0);
}

/** The whole document as one string, lines separated by newlines, cells by tabs. */
export function asText({ pages }) {
  return pages.map((p) => p.lines.map((l) => l.text).join("\n")).join("\n\f\n");
}

/** Flat list of lines across every page, each carrying its page number. */
export function allLines({ pages }) {
  return pages.flatMap((p) => p.lines.map((l) => ({ ...l, page: p.number })));
}
