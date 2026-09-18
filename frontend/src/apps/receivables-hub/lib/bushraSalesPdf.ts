/**
 * The Sales dashboard as a PDF that stands on its own.
 *
 * ─── IT NAVIGATES INSIDE ITSELF, NEVER OUT ──────────────────────────────────────────────────────
 * Page 2 is a CONTENTS page whose rows are link annotations pointing at pages of this same file, and
 * every section header carries a "← Contents" link back. There are PDF bookmarks too, so a reader
 * in Acrobat, Chrome or a phone viewer gets the same navigation from the sidebar. Nothing links to
 * the portal: the mail goes to people who may not be signed in, and a link they cannot open is
 * worse than no link.
 *
 * ─── AND IT CARRIES THE WHOLE REPORT ────────────────────────────────────────────────────────────
 * Not "a couple of charts". Every figure the dashboard shows is here as a table, at full depth: the
 * KPI summary, free issues, company and location, the month and year-to-date comparison for every
 * product AND every category inside it, and the quarter × product pivot with last year, this year
 * and the change — for revenue and for quantity.
 *
 * Pure apart from jsPDF: the scheduled mail builds the same file on a runner, so there is no
 * `window`, `document` or React here.
 */
import { jsPDF } from "jspdf";
import { FONT, loadBrandAssets, registerBrandFonts, safeText, type BrandAssets } from "@/shared/lib/pdfBrand";
import { fmtSales } from "./salesReport";
import { changeText, type CmpRow, type SalesSummary } from "./bushraSalesSummary";
import { fmtInt } from "./bushraSalesFigures";

const INK = "#0b0b0b";
const MUTED = "#52514e";
const LINE = "#d8d7d2";
const BRAND = "#e77e23";
const GOOD = "#0b7a0b";
const BAD = "#c0392b";

const PAGE_W = 297;   // A4 landscape, mm — the pivot is wide
const PAGE_H = 210;
const M = 12;         // margin

interface Section { title: string; page: number }

/** A cell in a drawn table: text plus how it should read. */
interface Cell { text: string; align?: "left" | "right"; bold?: boolean; color?: string }

export interface SalesPdfOptions {
  /** Which blocks to draw, in this order. Everything by default. */
  blocks?: SalesPdfBlock[];
}
export type SalesPdfBlock = "summary" | "company" | "performance" | "pivot";

const ALL_BLOCKS: SalesPdfBlock[] = ["summary", "company", "performance", "pivot"];

/**
 * ⚠ THE FONT IS LOAD-BEARING, NOT DECORATION.
 *
 * jsPDF's built-in Helvetica is WinAnsi: it has no ₹ (U+20B9) and no arrows, so every money cell
 * printed as "¹ 82.56 Cr" with the digits spaced out — which is exactly what the first draft did.
 * Poppins is embedded with Identity-H (shared/lib/pdfBrand.ts, the same pair the other PDFs use) and
 * `safeText` maps the few glyphs Poppins lacks. Fetching the .ttf needs a base URL, so the caller
 * passes the assets in; `buildSalesPdf` loads them itself in the browser.
 */
export async function buildSalesPdf(s: SalesSummary, opts: SalesPdfOptions = {}): Promise<Blob> {
  return buildSalesPdfWith(await loadBrandAssets(), s, opts);
}

export function buildSalesPdfWith(assets: BrandAssets, s: SalesSummary, opts: SalesPdfOptions = {}): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  registerBrandFonts(doc, assets);
  const blocks = opts.blocks?.length ? opts.blocks : ALL_BLOCKS;
  const sections: Section[] = [];
  let y = 0;

  const text = (t: string, x: number, yy: number, size = 9, bold = false, color = INK, align: "left" | "right" | "center" = "left") => {
    doc.setFont(FONT, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color);
    doc.text(safeText(t), x, yy, { align });
  };
  const rule = (yy: number, from = M, to = PAGE_W - M) => {
    doc.setDrawColor(LINE);
    doc.setLineWidth(0.2);
    doc.line(from, yy, to, yy);
  };

  /** Every page but the cover carries the report's name and a link back to the contents. */
  const chrome = () => {
    const p = doc.getCurrentPageInfo().pageNumber;
    if (p <= 1) return;
    text(`${s.title} · ${s.periodLabel}`, M, 8, 7.5, false, MUTED);
    text("< Summary", PAGE_W - M, 8, 7.5, false, BRAND, "right");
    // The link sits over those words and points at the slide — page 1 of this same file.
    doc.link(PAGE_W - M - 22, 4.5, 22, 5, { pageNumber: 1 });
    text(`Page ${p}`, PAGE_W - M, PAGE_H - 6, 7.5, false, MUTED, "right");
    rule(10.5);
  };

  const newPage = () => {
    doc.addPage();
    chrome();
    y = 18;
  };
  const room = (need: number) => { if (y + need > PAGE_H - 12) newPage(); };

  /** Start a section: remember its page for the contents, and add a bookmark. */
  const section = (title: string, sub?: string) => {
    if (y > PAGE_H - 40) newPage();
    sections.push({ title, page: doc.getCurrentPageInfo().pageNumber });
    text(title, M, y, 13, true);
    if (sub) text(sub, M + doc.getTextWidth(title) + 4, y, 8, false, MUTED);
    y += 3;
    rule(y);
    y += 6;
  };

  /** One table. Column widths are given; a row that does not fit starts a new page with its header. */
  const table = (cols: { header: string; w: number; align?: "left" | "right" }[], rows: Cell[][], opt: { headRow?: boolean } = {}) => {
    const drawHead = () => {
      let x = M;
      doc.setFillColor("#f3f2ef");
      doc.rect(M, y - 4.2, cols.reduce((a, c) => a + c.w, 0), 6, "F");
      for (const c of cols) {
        text(c.header, c.align === "right" ? x + c.w - 1.5 : x + 1.5, y, 7.5, true, MUTED, c.align === "right" ? "right" : "left");
        x += c.w;
      }
      y += 4.5;
      rule(y - 1.5, M, M + cols.reduce((a, c) => a + c.w, 0));
    };
    if (opt.headRow !== false) drawHead();
    for (const r of rows) {
      if (y > PAGE_H - 14) { newPage(); drawHead(); }
      let x = M;
      r.forEach((cell, i) => {
        const c = cols[i];
        const align = cell.align ?? c.align ?? "left";
        text(cell.text, align === "right" ? x + c.w - 1.5 : x + 1.5, y, 8, cell.bold, cell.color ?? INK, align === "right" ? "right" : "left");
        x += c.w;
      });
      y += 5;
      rule(y - 3.4, M, M + cols.reduce((a, c) => a + c.w, 0));
    }
    y += 3;
  };

  /* ── page 1: THE SLIDE ─────────────────────────────────────────────────────
     One page that answers the question on its own — the totals, what went free, who booked it and
     how each product is doing — and every block on it is a link into the detail pages behind. The
     hit areas are collected here and turned into links at the end, once the pages are known. */
  const money = (n: number): Cell => ({ text: fmtSales(n), align: "right", color: n < 0 ? BAD : INK });
  const change = (cur: number, pre: number): Cell => {
    const t = changeText(cur, pre);
    return { text: t, align: "right", color: t === "—" || t === "new" ? MUTED : t.startsWith("+") ? GOOD : BAD };
  };
  const hits: { x: number; y: number; w: number; h: number; section: string }[] = [];
  const hit = (x: number, yy: number, w: number, h: number, section: string) => hits.push({ x, y: yy, w, h, section });

  doc.setFillColor(BRAND);
  doc.rect(0, 0, PAGE_W, 26, "F");
  text(s.title, M, 13, 17, true, "#ffffff");
  text(s.periodLabel, M, 21, 9, false, "#ffffff");
  text(`Built ${s.generatedAt}`, PAGE_W - M, 13, 8, false, "#ffffff", "right");
  text(`${fmtInt(s.lines)} voucher lines${s.filters.length ? ` · ${s.filters.join(" · ")}` : " · no filters"}`,
       PAGE_W - M, 20, 7.5, false, "#ffffff", "right");

  /** A tile on the slide: a label, a big figure, a note — and a link to its section. */
  const tile = (x: number, yy: number, w: number, h: number, label: string, value: string, note: string, section: string, accent = BRAND) => {
    doc.setDrawColor(LINE);
    doc.setFillColor("#ffffff");
    doc.roundedRect(x, yy, w, h, 1.5, 1.5, "FD");
    doc.setFillColor(accent);
    doc.rect(x, yy, 1.6, h, "F");
    text(label.toUpperCase(), x + 5, yy + 6, 7, true, MUTED);
    text(value, x + 5, yy + 15, 15, true, INK);
    if (note) text(note, x + 5, yy + 21, 7.5, false, MUTED);
    hit(x, yy, w, h, section);
  };

  const k = s.kpis;
  const colW = (PAGE_W - 2 * M - 3 * 4) / 4;
  y = 34;
  tile(M, y, colW, 26, "Sales value", fmtSales(k.sales), "before discount & returns", "Summary", GOOD);
  tile(M + colW + 4, y, colW, 26, "Discount", fmtSales(k.discount), k.sales ? `${((-k.discount / k.sales) * 100).toFixed(1)}% of sales` : "", "Summary", "#eda100");
  tile(M + 2 * (colW + 4), y, colW, 26, "Net value", fmtSales(k.net), "sales - discount - returns", "Summary", BRAND);
  tile(M + 3 * (colW + 4), y, colW, 26, "Credit notes & returns", fmtSales(k.less), `${fmtInt(k.vouchers)} vouchers · ${fmtInt(k.parties)} customers`, "Summary", BAD);

  y += 30;
  // Free issues sit beside the totals, never inside them — on the Sales dashboard, the only one
  // that passes them in. Elsewhere the strip carries the quantity alone.
  doc.setDrawColor(LINE);
  doc.setFillColor("#faf9f6");
  doc.roundedRect(M, y, PAGE_W - 2 * M, 12, 1.5, 1.5, "FD");
  if (s.foc.lines) {
    text("GIVEN FREE (FOC) - not counted above", M + 5, y + 5, 7, true, MUTED);
    text(`${s.fmtQ(s.foc.qty)}   ${fmtSales(s.foc.value)}   ${fmtInt(s.foc.vouchers)} vouchers`, M + 5, y + 10, 9.5, true, INK);
  }
  text(`${s.foc.lines ? "Quantity sold" : "Quantity"} ${s.fmtQ(k.qty)}`, PAGE_W - M - 5, y + 8, 9, false, MUTED, "right");
  hit(M, y, PAGE_W - 2 * M, 12, "Summary");

  /* the three blocks across the slide, each a link into its own section */
  y += 18;
  const bw = (PAGE_W - 2 * M - 2 * 5) / 3;
  const miniTable = (x: number, yy: number, w: number, heading: string, section: string,
                     lines: { left: string; mid: string; right: string; bold?: boolean }[]) => {
    doc.setDrawColor(LINE);
    doc.setFillColor("#ffffff");
    const h = 12 + lines.length * 5.6;
    doc.roundedRect(x, yy, w, h, 1.5, 1.5, "FD");
    text(heading.toUpperCase(), x + 4, yy + 6, 7, true, MUTED);
    text("open >", x + w - 4, yy + 6, 7, true, BRAND, "right");
    let ly = yy + 12;
    for (const l of lines) {
      text(l.left, x + 4, ly, 8, l.bold);
      text(l.mid, x + w - 34, ly, 8, false, MUTED, "right");
      text(l.right, x + w - 4, ly, 8, l.bold, l.right.startsWith("-") ? BAD : INK, "right");
      ly += 5.6;
    }
    hit(x, yy, w, h, section);
    return h;
  };

  const top = <T,>(arr: T[], n: number) => arr.slice(0, n);
  const companyTotal = s.company.reduce((a, p) => a + p.value, 0);
  const h1 = miniTable(M, y, bw, "By company", "Company & location",
    top(s.company, 5).map((p) => ({
      left: p.name, mid: s.fmtQ(p.qty),
      right: `${fmtSales(p.value)}${companyTotal ? `  ${((p.value / companyTotal) * 100).toFixed(0)}%` : ""}`,
    })));
  const h2 = miniTable(M + bw + 5, y, bw, "By location", "Company & location",
    top(s.location, 5).map((p) => ({ left: p.name, mid: s.fmtQ(p.qty), right: fmtSales(p.value) })));
  const h3 = miniTable(M + 2 * (bw + 5), y, bw, `Products · ${s.ytdLabel}`, "Performance",
    top(s.performance, 6).map((r) => ({
      left: r.name, mid: s.fmtRowQ(r.name)(r.ytd.curQty),
      right: `${fmtSales(r.ytd.curVal)}  ${changeText(r.ytd.curVal, r.ytd.preVal)}`,
    })));

  y += Math.max(h1, h2, h3) + 6;
  text("Tap any block above to open its full figures. Every page has a link back to this slide.",
       M, Math.min(y, PAGE_H - 8), 7.5, false, MUTED);

  const slidePage = doc.getCurrentPageInfo().pageNumber;

  /* ── the detail pages ──────────────────────────────────────────────────── */
  newPage();

  for (const block of blocks) {
    if (block === "summary") {
      section("Summary", s.periodLabel);
      const k = s.kpis;
      table(
        [{ header: "", w: 60 }, { header: "Value", w: 40, align: "right" }, { header: "", w: 80 }],
        [
          [{ text: "Sales value", bold: true }, money(k.sales), { text: "billed, before discount & returns", color: MUTED }],
          [{ text: "Discount" }, money(k.discount), { text: k.sales ? `${((-k.discount / k.sales) * 100).toFixed(1)}% of sales` : "", color: MUTED }],
          [{ text: "Credit notes & returns" }, money(k.less), { text: k.sales ? `${((-k.less / k.sales) * 100).toFixed(1)}% of sales` : "", color: MUTED }],
          [{ text: "Net value", bold: true }, { ...money(k.net), bold: true }, { text: "sales − discount − returns", color: MUTED }],
          [{ text: "Quantity" }, { text: s.fmtQ(k.qty), align: "right" }, { text: "as booked", color: MUTED }],
          [{ text: "Vouchers" }, { text: fmtInt(k.vouchers), align: "right" }, { text: `${fmtInt(k.parties)} customers`, color: MUTED }],
        ],
      );
      if (s.foc.lines) {
        room(20);
        text("Given free (FOC) — not counted above", M, y, 9.5, true);
        y += 5;
        table(
          [{ header: "", w: 60 }, { header: "Value", w: 40, align: "right" }, { header: "", w: 80 }],
          [[{ text: "Free issues" }, money(s.foc.value), { text: `${s.fmtQ(s.foc.qty)} · ${fmtInt(s.foc.vouchers)} vouchers`, color: MUTED }]],
        );
      }
    }

    if (block === "company") {
      section("Company & location");
      for (const [name, rows] of [["By company", s.company], ["By location", s.location]] as const) {
        room(30);
        text(name, M, y, 9.5, true);
        y += 5;
        const total = rows.reduce((a, p) => a + p.value, 0);
        table(
          [{ header: "", w: 70 }, { header: "Quantity", w: 40, align: "right" }, { header: "Revenue", w: 40, align: "right" }, { header: "Share", w: 25, align: "right" }],
          rows.map((p) => [
            { text: p.name },
            { text: s.fmtQ(p.qty), align: "right" },
            money(p.value),
            { text: total ? `${((p.value / total) * 100).toFixed(1)}%` : "—", align: "right", color: MUTED },
          ]),
        );
      }
    }

    if (block === "performance") {
      section("Performance", `${s.monthLabel} · ${s.ytdLabel}`);
      const cols = [
        { header: "", w: 62 },
        { header: "This yr", w: 34, align: "right" as const },
        { header: "Last yr", w: 34, align: "right" as const },
        { header: "Chg", w: 22, align: "right" as const },
        { header: "This yr", w: 34, align: "right" as const },
        { header: "Last yr", w: 34, align: "right" as const },
        { header: "Chg", w: 22, align: "right" as const },
      ];
      const line = (r: CmpRow, indent: boolean, measure: "qty" | "value"): Cell[] => {
        const fmt = measure === "value" ? (n: number) => fmtSales(n) : s.fmtRowQ(r.name);
        const cur = (c: { curVal: number; curQty: number }) => (measure === "value" ? c.curVal : c.curQty);
        const pre = (c: { preVal: number; preQty: number }) => (measure === "value" ? c.preVal : c.preQty);
        return [
          { text: (indent ? "   " : "") + r.name, bold: !indent },
          { text: fmt(cur(r.month)), align: "right" },
          { text: fmt(pre(r.month)), align: "right", color: MUTED },
          change(cur(r.month), pre(r.month)),
          { text: fmt(cur(r.ytd)), align: "right" },
          { text: fmt(pre(r.ytd)), align: "right", color: MUTED },
          change(cur(r.ytd), pre(r.ytd)),
        ];
      };
      for (const measure of ["value", "qty"] as const) {
        room(40);
        text(measure === "value" ? "Revenue" : "Quantity", M, y, 9.5, true);
        text(`${s.monthLabel}          ${s.ytdLabel}`, M + 30, y, 7.5, false, MUTED);
        y += 5;
        const rows: Cell[][] = [];
        for (const r of s.performance) {
          rows.push(line(r, false, measure));
          for (const c of r.children) rows.push(line(c, true, measure));
        }
        table(cols, rows);
      }
    }

    if (block === "pivot") {
      for (const measure of ["value", "qty"] as const) {
        section(measure === "value" ? "Revenue by quarter & month" : "Quantity by quarter & month",
                "last year · this year · change");
        // Quarters first, then each quarter's months, so the page reads the way the screen does.
        // Each period is last year, this year, change — the order its headers below say, and the
        // order the screen's table uses.
        const cellsFor = (name: string | null): Cell[] => {
          const out: Cell[] = [{ text: name ?? "Total", bold: !name }];
          for (const p of s.periods) {
            const c = name ? s.pivot[measure][name]?.[p.key] : s.totals[measure][p.key];
            const cur = c?.cur ?? 0, pre = c?.pre ?? 0;
            const fmt = measure === "value" ? (n: number) => fmtSales(n) : s.fmtRowQ(name ?? "");
            out.push({ text: pre ? fmt(pre) : "—", align: "right", color: MUTED });
            out.push({ text: cur ? fmt(cur) : "—", align: "right", bold: !name });
            out.push(change(cur, pre));
          }
          return out;
        };
        // A wide pivot is split into chunks so nothing runs off the page: 46 + 3 × 70 = 256 mm of
        // the 273 between the margins. Four periods (326 mm) cut the last one off.
        const CHUNK = 3;
        for (let i = 0; i < s.periods.length; i += CHUNK) {
          const slice = s.periods.slice(i, i + CHUNK);
          const sliceCols = [{ header: "", w: 46 },
                             ...slice.flatMap((p) => ([
                               { header: `${p.label} LY`, w: 26, align: "right" as const },
                               { header: "TY", w: 26, align: "right" as const },
                               { header: "Chg", w: 18, align: "right" as const },
                             ]))];
          const pickCols = (cells: Cell[]) => [cells[0], ...cells.slice(1 + i * 3, 1 + (i + slice.length) * 3)];
          room(30);
          table(sliceCols, [...s.rowNames.map((n) => pickCols(cellsFor(n))), pickCols(cellsFor(null))]);
        }
      }
    }
  }

  /* ── back to the slide: turn every block into a link to its section ────── */
  doc.setPage(slidePage);
  const pageOf = (title: string) => sections.find((x) => x.title === title)?.page;
  for (const h of hits) {
    const page = pageOf(h.section);
    if (page) doc.link(h.x, h.y, h.w, h.h, { pageNumber: page });
  }

  // Bookmarks, so the viewer's own sidebar navigates too.
  const outline = (doc as unknown as { outline?: { add: (parent: null, title: string, options: { pageNumber: number }) => void } }).outline;
  if (outline) {
    outline.add(null, "Summary slide", { pageNumber: slidePage });
    for (const sec of sections) outline.add(null, sec.title, { pageNumber: sec.page });
  }

  return doc.output("blob");
}
