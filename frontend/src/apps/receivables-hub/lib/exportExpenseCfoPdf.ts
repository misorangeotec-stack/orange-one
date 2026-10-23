import jsPDF from "jspdf";
import {
  BRAND, MARGIN,
  applyDeferredLinks, backTriangle, contentW, drawTable, ellipsize, footer, headerBand, loadBrandAssets,
  metaStrip, noteBlock, noteBlockHeight, pageH, pageWash, registerBrandFonts, sectionHeading, setDraw, setFill,
  statCard, text, widthOf,
  type Ctx, type DeferredLink, type PdfColumn, type RowKind,
} from "@/shared/lib/pdfBrand";
import { formatDateTime } from "@/shared/lib/time";

import {
  COMPANIES, TIE_TOLERANCE, UNIT_LABEL, buildTree, colValue, columnsFor, dmy, filterLabel, fmtAmt, fmtCr, fmtUnit, monthLabel, partMonthNote,
  pivot, quarterColumns, sum,
  type Col, type ExpLine, type TieRow, type TreeNode,
} from "./expenseCfo";
import {
  DEFAULT_MATERIALITY, bridge, cfoNotes, draftRemark, entityName, flagText, monthVariance, paretoSet,
  type VarianceRow,
} from "./expenseCfoRules";
import type { ExportCtx } from "./exportExpenseCfo";

/**
 * Expense Analysis (CFO) — the PDF.
 *
 * Page 1 is the cover and contents: headline cards, the TB status and one line per section, every
 * line a link (stamped once the target pages exist — see `applyDeferredLinks`). Each section opens
 * on a fresh landscape page with a "Back to contents" link, and the side panel carries bookmarks.
 * Graphs are drawn as vectors with the same figures as the tables beside them, so the type stays
 * crisp and a chart can never disagree with its table.
 *
 * A load that does not tie to Tally's TB is printed with a DRAFT watermark on every page and the
 * status in every footer — a forwarded page must not lose the warning the screen shows.
 * RAW DATA is left to the Excel (10k+ lines is not a document).
 */

const C = { navy: BRAND.navy, orange: BRAND.orange, red: BRAND.red, green: BRAND.green, grey: BRAND.grey2 };
const PALETTE = ["#0B1B40", "#FF6A1F", "#2F6FDE", "#27AE60", "#8A99B0"];
const axisFmt = (v: number) => (Math.abs(v) >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(0)}L` : `${Math.round(v / 1000)}k`);

// ── Vector charts ────────────────────────────────────────────────────────────────────────────

interface Frame { x: number; y: number; w: number; h: number; title: string }

function chartFrame(pdf: jsPDF, f: Frame): { x: number; y: number; w: number; h: number } {
  setFill(pdf, BRAND.white);
  setDraw(pdf, BRAND.line);
  pdf.setLineWidth(0.7);
  pdf.roundedRect(f.x, f.y, f.w, f.h, 5, 5, "FD");
  text(pdf, f.title, f.x + 10, f.y + 14, { size: 8, bold: true });
  return { x: f.x + 44, y: f.y + 24, w: f.w - 56, h: f.h - 50 };
}

/** Value axis from lo..hi with 4 gridlines; returns a y-mapper. */
function valueAxis(pdf: jsPDF, a: { x: number; y: number; w: number; h: number }, lo: number, hi: number) {
  lo = Math.min(0, lo); hi = Math.max(0, hi);
  if (hi === lo) hi = lo + 1;
  const ty = (v: number) => a.y + a.h - ((v - lo) / (hi - lo)) * a.h;
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    setDraw(pdf, BRAND.line); pdf.setLineWidth(0.4);
    pdf.line(a.x, ty(v), a.x + a.w, ty(v));
    text(pdf, axisFmt(v), a.x - 4, ty(v) + 2, { size: 5.8, color: C.grey, align: "right" });
  }
  setDraw(pdf, BRAND.grey2); pdf.line(a.x, ty(0), a.x + a.w, ty(0));
  return ty;
}

/** Vertical bars; `stacked` stacks series, otherwise they sit side by side. Floating bars via `base`. */
function vBars(pdf: jsPDF, f: Frame, cats: string[], series: { name: string; color: string; values: number[]; base?: number[] }[], stacked: boolean, colorOf?: (si: number, ci: number) => string) {
  const a = chartFrame(pdf, f);
  const tops = cats.map((_, ci) => (stacked ? series.reduce((s, se) => s + Math.max(0, se.values[ci]), 0) : Math.max(...series.map((se) => (se.base?.[ci] ?? 0) + se.values[ci]))));
  const bots = cats.map((_, ci) => (stacked ? series.reduce((s, se) => s + Math.min(0, se.values[ci]), 0) : Math.min(...series.map((se) => Math.min(se.values[ci], se.base?.[ci] ?? 0)))));
  const ty = valueAxis(pdf, a, Math.min(...bots), Math.max(...tops));
  const slot = a.w / cats.length;
  const bw = Math.min(26, slot * 0.7) / (stacked ? 1 : series.length);
  cats.forEach((cat, ci) => {
    let pos = 0, neg = 0;
    series.forEach((se, si) => {
      const v = se.values[ci];
      const bx = a.x + slot * ci + (slot - bw * (stacked ? 1 : series.length)) / 2 + (stacked ? 0 : bw * si);
      let y0: number, y1: number;
      if (stacked) { if (v >= 0) { y0 = pos; y1 = pos + v; pos = y1; } else { y0 = neg + v; y1 = neg; neg = y0; } }
      else { const b = se.base?.[ci] ?? 0; y0 = Math.min(b, b + v); y1 = Math.max(b, b + v); }
      setFill(pdf, colorOf?.(si, ci) ?? se.color);
      pdf.rect(bx, ty(y1), bw, Math.max(0.5, ty(y0) - ty(y1)), "F");
    });
    text(pdf, ellipsize(pdf, cat, slot - 2, 5.8), a.x + slot * ci + slot / 2, a.y + a.h + 9, { size: 5.8, color: C.grey, align: "center" });
  });
  if (series.length > 1) {
    let lx = f.x + f.w - 10;
    for (const se of [...series].reverse()) {
      const w = widthOf(pdf, se.name, 6.2);
      lx -= w;
      text(pdf, se.name, lx, f.y + 14, { size: 6.2, color: BRAND.grey });
      setFill(pdf, se.color); pdf.rect(lx - 9, f.y + 9, 6, 6, "F");
      lx -= 16;
    }
  }
}

/** Horizontal bars, one per item, labels on the left. */
function hBars(pdf: jsPDF, f: Frame, items: { label: string; value: number; color?: string }[]) {
  const a = chartFrame(pdf, f);
  const labelW = Math.min(150, f.w * 0.36);
  const x0 = f.x + 10 + labelW;
  const w = f.x + f.w - 60 - x0;
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const hasNeg = items.some((i) => i.value < 0);
  const zero = hasNeg ? x0 + w / 2 : x0;
  const scale = hasNeg ? w / 2 / max : w / max;
  const rowH = Math.min(16, a.h / Math.max(1, items.length));
  items.forEach((it, i) => {
    const y = a.y + i * rowH;
    text(pdf, ellipsize(pdf, it.label, labelW - 6, 6.4), f.x + 10, y + rowH * 0.65, { size: 6.4 });
    setFill(pdf, it.color ?? C.navy);
    const bw = Math.abs(it.value) * scale;
    pdf.rect(it.value >= 0 ? zero : zero - bw, y + rowH * 0.18, Math.max(0.5, bw), rowH * 0.64, "F");
    text(pdf, fmtCr(it.value), f.x + f.w - 8, y + rowH * 0.65, { size: 6.2, bold: true, align: "right" });
  });
  if (hasNeg) { setDraw(pdf, BRAND.grey2); pdf.line(zero, a.y, zero, a.y + rowH * items.length); }
}

// ── The document ─────────────────────────────────────────────────────────────────────────────

export async function exportExpenseCfoPdf(ctx: ExportCtx): Promise<void> {
  const { lines, months, flags, tb } = ctx;
  const assets = await loadBrandAssets();
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape", compress: true });
  registerBrandFonts(pdf, assets);
  const doc: Ctx = { pdf, assets, totalPagesToken: "{tp}" };
  const generatedAt = formatDateTime(new Date().toISOString());
  const period = `${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}`;
  const note = tb.tied ? `Tied to Tally TB as at ${dmy(tb.asOf)}` : "DRAFT - NOT TIED TO TB";
  const u = ctx.opts.unit;
  const part = partMonthNote(months, ctx.data.meta.dateTo);
  const footNote = `${period} · ${UNIT_LABEL[u]} · load #${ctx.data.meta.loadId} · ${note}${part ? ` · ${part}` : ""}`;
  const links: DeferredLink[] = [];
  const pageOf = new Map<string, number>();
  const W = () => contentW(pdf);
  const floor = () => pageH(pdf) - 50;
  let page = 1;

  const watermark = () => {
    if (tb.tied) return;
    pdf.saveGraphicsState();
    pdf.setGState(new (pdf as unknown as { GState: new (o: object) => unknown }).GState({ opacity: 0.08 }) as never);
    text(pdf, "DRAFT - NOT TIED TO TB", 150, pageH(pdf) - 120, { size: 60, bold: true, color: C.red, angle: 22 });
    pdf.restoreGraphicsState();
  };

  const backLink = (y: number) => {
    const label = "Back to contents";
    const w = widthOf(pdf, label, 7.6, true);
    backTriangle(pdf, MARGIN, y - 3, 6, C.orange);
    text(pdf, label, MARGIN + 10, y, { size: 7.6, bold: true, color: C.orange });
    pdf.link(MARGIN - 2, y - 10, w + 16, 14, { pageNumber: 1 });
  };

  const newPage = (key?: string): number => {
    footer(doc, page, generatedAt, footNote);
    pdf.addPage("a4", "landscape");
    page += 1;
    pageWash(pdf);
    watermark();
    if (key) pageOf.set(key, page);
    const top = headerBand(doc, { tag: "Expense Analysis (CFO)", compact: true, note }) + 16;
    backLink(top);
    return top + 14;
  };

  /**
   * A grouped table in the download's layout: group rows (bold) with their children indented under
   * them. "Grouped" prints the groups only — every level but the last — "Full detail" prints all.
   */
  type Row = { node: TreeNode; grand?: boolean };
  const cols: Col[] = ctx.opts.columns === "quarters" ? quarterColumns(months, new Set()) : columnsFor(months);
  const treeTable = (y: number, ls: ExpLine[], keys: ((l: ExpLine) => string)[], levelNames: string[],
    extra?: { head: string; value: (n: TreeNode) => string; flagged?: (n: TreeNode) => boolean },
    green?: (n: TreeNode, m: string) => boolean): number => {
    const root = buildTree(ls, keys);
    const maxDepth = ctx.opts.rows === "grouped" && keys.length > 1 ? keys.length - 1 : keys.length;
    const rows: Row[] = [];
    const walk = (n: TreeNode) => { rows.push({ node: n }); if (n.depth < maxDepth) n.children.forEach(walk); };
    root.children.forEach(walk);
    rows.push({ node: root, grand: true });
    const indent = (n: TreeNode) => "   ".repeat(Math.max(0, n.depth - 1));
    const columns: PdfColumn<Row>[] = [
      { header: levelNames.slice(0, maxDepth).join(" › "), width: cols.length > 8 ? 4 : 5.5, value: (r) => (r.grand ? "Grand Total" : `${indent(r.node)}${r.node.label}`) },
      ...cols.map((c): PdfColumn<Row> => ({
        header: c.label, width: c.kind === "month" ? 1 : 1.15, align: "right",
        value: (r) => fmtUnit(colValue(r.node.byMonth, c, months), u),
        color: (r) => (green && c.kind === "month" && !r.grand && green(r.node, c.key) ? C.green : undefined),
      })),
      ...(extra ? [{ header: extra.head, width: 4.5, value: (r: Row) => (r.grand ? "" : extra.value(r.node)) } as PdfColumn<Row>] : []),
    ];
    return drawTable(pdf, {
      x: MARGIN, y, width: W(), columns, rows, bodySize: 6.4, headerSize: 6.2, rowH: 12.5,
      rowKind: (r): RowKind => (r.grand ? "grand" : extra?.flagged?.(r.node) ? "big" : r.node.depth === 1 && maxDepth > 1 ? "subtotal" : "normal"),
      onNewPage: () => newPage(), maxY: floor(),
    });
  };

  // ── Page 1: cover and contents ─────────────────────────────────────────────────────────────
  pageWash(pdf);
  watermark();
  let y = headerBand(doc, { tag: "Expense Analysis (CFO)", note }) + 22;
  text(pdf, "Expense Analysis (CFO)", MARGIN, y, { size: 18, bold: true });
  y += 10;
  y = metaStrip(pdf, MARGIN, y, W(), [
    { label: "Period", value: period, ...(part ? { note: part } : {}) },
    { label: "Covers", value: filterLabel(ctx.filters) },
    { label: "Data", value: `Load #${ctx.data.meta.loadId}`, note: `built ${formatDateTime(ctx.data.meta.finishedAt)}` },
    { label: "Trial Balance", value: tb.tied ? "Tied" : "NOT TIED", note: tb.tied ? `as at ${dmy(tb.asOf)}` : `${tb.gaps.length} gap line(s) - see TB Reconciliation` },
  ]) + 12;
  const total = sum(lines);
  const typeTotal = (t: string) => sum(lines.filter((l) => l.expType === t));
  const pctOf = (v: number) => `${total ? Math.round((v / total) * 100) : 0}% of total`;
  const last = months[months.length - 1], prev = months[months.length - 2];
  const lastT = sum(lines.filter((l) => l.month === last)), prevT = prev ? sum(lines.filter((l) => l.month === prev)) : 0;
  const cards = [
    { label: "Total expense", value: fmtCr(total), sub: period },
    { label: "Direct", value: fmtCr(typeTotal("DIRECT")), sub: pctOf(typeTotal("DIRECT")) },
    { label: "Indirect", value: fmtCr(typeTotal("INDIRECT")), sub: pctOf(typeTotal("INDIRECT")) },
    { label: "Other (valuation + exchange)", value: fmtCr(typeTotal("OTHER")), sub: pctOf(typeTotal("OTHER")) },
    { label: `${monthLabel(last)} vs ${prev ? monthLabel(prev) : "-"}`, value: prevT > 0 ? `${(((lastT - prevT) / prevT) * 100).toFixed(1)}%` : "n/m", sub: `${fmtCr(lastT)} vs ${fmtCr(prevT)}`, alarm: lastT > prevT },
    { label: "TB status", value: tb.tied ? "Tied" : "NOT TIED", sub: tb.tied ? `as at ${dmy(tb.asOf)}` : "figures are DRAFT", alarm: !tb.tied },
  ];
  const cw = (W() - (cards.length - 1) * 10) / cards.length;
  cards.forEach((c, i) => statCard(pdf, MARGIN + i * (cw + 10), y, cw, 54, c));
  y += 70;
  y = sectionHeading(pdf, MARGIN, y, "Contents", "Click a section to open it") + 4;
  const contents = ctx.index.filter((s) => s.id !== "index" && s.id !== "raw");
  drawTable(pdf, {
    x: MARGIN, y, width: W(), rowH: 12.5, bodySize: 7, headerSize: 6.6, linkSink: links,
    columns: [
      { header: "Section", width: 3, value: (s) => s.name, linkKey: (s) => s.id, color: () => BRAND.orange },
      { header: "What it shows", width: 6, value: (s) => s.description },
      { header: "Must review", width: 1.2, value: (s) => s.review, color: (s) => (s.review === "HIGH" ? C.red : undefined) },
    ],
    rows: contents,
    rowKind: (s) => (s.review === "HIGH" ? "big" : "normal"),
    onNewPage: () => { footer(doc, page, generatedAt, footNote); pdf.addPage("a4", "landscape"); page += 1; pageWash(pdf); watermark(); return headerBand(doc, { tag: "Expense Analysis (CFO)", compact: true, note }) + 20; },
    maxY: floor(),
  });

  // ── Sections ────────────────────────────────────────────────────────────────────────────────
  for (const s of contents) {
    y = newPage(s.id);
    y = sectionHeading(pdf, MARGIN, y + 6, s.review === "LOW" ? "Section" : `Must review: ${s.review}`, s.name) + 6;
    switch (s.id) {
      case "analytics": {
        const half = (W() - 12) / 2, h = 150;
        // Group and mover charts leave out Other (inventory valuation, exchange) — user, 23-Oct-2026.
        const operating = lines.filter((l) => l.expType !== "OTHER");
        const groupsOf = (t: string | null, n: number) => pivot(t ? operating.filter((l) => l.expType === t) : operating, [(l) => l.mainGroup])
          .filter((r) => r.kind === "detail").slice(0, n);
        vBars(pdf, { x: MARGIN, y, w: half, h, title: "Monthly trend - Direct, Indirect and Other" }, months.map(monthLabel), [
          { name: "Direct", color: C.navy, values: months.map((m) => sum(lines.filter((l) => l.month === m && l.expType === "DIRECT"))) },
          { name: "Indirect", color: C.orange, values: months.map((m) => sum(lines.filter((l) => l.month === m && l.expType === "INDIRECT"))) },
          { name: "Other", color: C.grey, values: months.map((m) => sum(lines.filter((l) => l.month === m && l.expType === "OTHER"))) },
        ], true);
        hBars(pdf, { x: MARGIN + half + 12, y, w: half, h, title: "By company" },
          COMPANIES.map((c, i) => ({ label: c, value: sum(lines.filter((l) => l.company === c)), color: PALETTE[i] })).filter((x) => x.value));
        y += h + 10;
        hBars(pdf, { x: MARGIN, y, w: half, h: 175, title: "Direct expenses - by main group" },
          groupsOf("DIRECT", 10).map((r) => ({ label: r.path[0], value: r.total, color: C.navy })));
        hBars(pdf, { x: MARGIN + half + 12, y, w: half, h: 175, title: "Indirect expenses - top 10 main groups" },
          groupsOf("INDIRECT", 10).map((r) => ({ label: r.path[0], value: r.total, color: C.orange })));
        y = newPage();
        hBars(pdf, { x: MARGIN, y, w: half, h: 175, title: "Top 10 main groups" },
          groupsOf(null, 10).map((r) => ({ label: r.path[0], value: r.total, color: C.orange })));
        const mv = prev ? monthVariance(operating, months, prev, last, DEFAULT_MATERIALITY) : [];
        hBars(pdf, { x: MARGIN + half + 12, y, w: half, h: 175, title: `Top movers - ${monthLabel(last)} vs ${prev ? monthLabel(prev) : "-"}` },
          [...mv.filter((v) => v.change > 0).slice(0, 5), ...mv.filter((v) => v.change < 0).slice(0, 5)]
            .map((v) => ({ label: v.mainGroup, value: v.change, color: v.change > 0 ? C.red : C.green })));
        y += 185;
        noteBlock(pdf, { x: MARGIN, y, width: W(), title: "CFO notes", lines: cfoNotes(lines, months, tb, flags) });
        break;
      }
      case "summary":
        vBars(pdf, { x: MARGIN, y, w: W(), h: 120, title: "Monthly expense by company" }, months.map(monthLabel),
          COMPANIES.map((c, i) => ({ name: c, color: PALETTE[i], values: months.map((m) => sum(lines.filter((l) => l.company === c && l.month === m))) })), true);
        y += 130;
        y = treeTable(y, lines, [(l) => l.expType, (l) => l.mainGroup, (l) => l.gl], ["EXP TYPE", "MAIN GROUP", "LEDGER"], {
          head: "AUDIT FLAG",
          value: (n) => (n.depth === 2 ? flagText(flags, n.path[0] as "DIRECT", n.path[1]) : ""),
          flagged: (n) => n.depth === 2 && !!flagText(flags, n.path[0] as "DIRECT", n.path[1]),
        });
        break;
      case "company":
        y = treeTable(y, lines, [(l) => entityName(l.entity), (l) => l.expType, (l) => l.mainGroup, (l) => l.gl], ["COMPANY", "EXP TYPE", "MAIN GROUP", "LEDGER"]);
        break;
      case "direct":
        y = treeTable(y, lines.filter((l) => l.expType === "DIRECT"), [(l) => l.mainGroup, (l) => l.gl, (l) => l.party], ["MAIN GROUP", "LEDGER", "PARTY"]);
        break;
      case "component": {
        const d = lines.filter((l) => l.expType === "DIRECT");
        hBars(pdf, { x: MARGIN, y, w: W() / 2, h: 120, title: "Direct expense by component" },
          pivot(d, [(l) => l.component]).filter((r) => r.kind === "detail").map((r) => ({ label: r.path[0], value: r.total, color: C.orange })));
        y += 130;
        y = treeTable(y, d, [(l) => l.component, (l) => l.mainGroup, (l) => l.gl], ["COMPONENT", "MAIN GROUP", "LEDGER"]);
        break;
      }
      case "indirect":
        y = treeTable(y, lines.filter((l) => l.expType === "INDIRECT"), [(l) => l.mainGroup, (l) => l.subGroup, (l) => l.gl], ["MAIN GROUP", "SUB-GROUP", "LEDGER"]);
        break;
      case "other":
        y = treeTable(y, lines.filter((l) => l.expType === "OTHER"), [(l) => l.mainGroup, (l) => l.company, (l) => l.gl], ["MAIN GROUP", "COMPANY", "LEDGER"]);
        break;
      case "variance":
        y = varianceSection(y);
        break;
      case "tb":
        y = tbSection(y);
        break;
      default: {
        const gl = lines.filter((l) => l.expType === "INDIRECT" && l.mainGroup === s.mainGroup);
        const parties = buildTree(gl, [(l) => l.party]).children;
        const half = (W() - 12) / 2;
        vBars(pdf, { x: MARGIN, y, w: half, h: 110, title: "Monthly" }, months.map(monthLabel), [{ name: s.name, color: C.orange, values: months.map((m) => sum(gl.filter((l) => l.month === m))) }], true);
        hBars(pdf, { x: MARGIN + half + 12, y, w: half, h: 110, title: "Top 5 vendors" }, parties.slice(0, 5).map((n) => ({ label: n.label, value: n.total })));
        y += 118;
        if (ctx.opts.columns === "months") text(pdf, "Green figures = top 80% of that month's spend (last two months).", MARGIN, y + 4, { size: 6.4, color: BRAND.grey });
        const pareto = new Map(months.slice(-2).map((m) => [m, paretoSet(new Map(parties.map((n) => [n.label, n.byMonth.get(m) ?? 0])))]));
        y = treeTable(y + 10, gl, [(l) => l.party, (l) => l.gl], ["PARTY", "LEDGER"],
          { head: "REMARKS", value: (n) => (n.depth === 1 ? draftRemark(n.lines.map((l) => l.narration)) : "") },
          (n, m) => n.depth === 1 && !!pareto.get(m)?.has(n.label));
      }
    }
  }

  function varianceSection(y0: number): number {
    if (months.length < 2) { text(pdf, "Pick at least two months to see month-on-month variance.", MARGIN, y0 + 10); return y0 + 20; }
    let yy = y0;
    for (let i = months.length - 1; i >= 1; i--) {
      if (i < months.length - 1) yy = newPage();
      const p = months[i - 1], c = months[i];
      const all = monthVariance(lines, months, p, c, DEFAULT_MATERIALITY);
      const start = sum(lines.filter((l) => l.month === p));
      const movement = sum(lines.filter((l) => l.month === c)) - start;
      const top = all.slice(0, 8);
      let run = start;
      const cats = [monthLabel(p)], base = [0], vals = [start], colors: string[] = [C.navy];
      for (const m of top) { cats.push(m.mainGroup); base.push(m.change >= 0 ? run : run + m.change); vals.push(Math.abs(m.change)); colors.push(m.change >= 0 ? C.red : C.green); run += m.change; }
      const other = movement - top.reduce((s, m) => s + m.change, 0);
      if (Math.abs(other) > 0.5) { cats.push("Others"); base.push(other >= 0 ? run : run + other); vals.push(Math.abs(other)); colors.push(C.grey); run += other; }
      cats.push(monthLabel(c)); base.push(0); vals.push(run); colors.push(C.navy);
      vBars(pdf, { x: MARGIN, y: yy, w: W(), h: 135, title: `${monthLabel(c)} vs ${monthLabel(p)}: bridge of the 8 largest moves (red = increase, green = decrease)` },
        cats, [{ name: "", color: C.navy, values: vals, base }], false, (_si, ci) => colors[ci]);
      yy += 142;
      const control = all.reduce((s, r) => s + r.change, 0);
      text(pdf, `Control: sum of changes ${fmtAmt(control)} = movement in month totals ${fmtAmt(movement)} ${Math.abs(control - movement) < 0.01 ? "(agrees)" : "(MISMATCH)"}` +
        ` · material = ≥ ₹${DEFAULT_MATERIALITY.amount.toLocaleString("en-IN")} or ≥ ${DEFAULT_MATERIALITY.pct}%`, MARGIN, yy, { size: 6.6, color: BRAND.grey });
      yy = drawTable(pdf, {
        x: MARGIN, y: yy + 6, width: W(), bodySize: 6.2, headerSize: 6, rowH: 12, rows: all.filter((r) => r.material),
        columns: [
          { header: "Type", width: 1, value: (r: VarianceRow) => r.expType },
          { header: "Main group", width: 2.6, value: (r) => r.mainGroup },
          { header: `Prev month (${UNIT_LABEL[u]})`, width: 1.3, align: "right", value: (r) => fmtUnit(r.prev, u) },
          { header: "This month", width: 1.3, align: "right", value: (r) => fmtUnit(r.cur, u) },
          { header: "Change", width: 1.3, align: "right", value: (r) => fmtUnit(r.change, u), color: (r) => (r.change > 0 ? C.red : C.green) },
          { header: "%", width: 0.7, align: "right", value: (r) => (r.pct === null ? "n/m" : `${r.pct.toFixed(1)}%`) },
          { header: "Inc / Dec", width: 1, value: (r) => r.direction, color: (r) => (r.change > 0 ? C.red : C.green) },
          { header: "Nature", width: 1.6, value: (r) => r.nature },
          { header: "Main drivers", width: 5, value: (r) => r.drivers.map((d) => `${d.label} ${fmtCr(d.change)}`).join("; ") },
        ],
        onNewPage: () => newPage(), maxY: floor(),
      });
    }
    return yy;
  }

  function tbSection(y0: number): number {
    const chartData = COMPANIES.map((c) => {
      const g = ctx.data.ties.filter((t) => t.company === c && t.level === "group");
      return { c, tb: g.reduce((s, t) => s + t.tb, 0), rep: g.reduce((s, t) => s + t.lines, 0) };
    });
    vBars(pdf, { x: MARGIN, y: y0, w: W() / 2, h: 120, title: "Report vs Tally TB, per company" }, chartData.map((d) => d.c), [
      { name: "Tally TB", color: C.navy, values: chartData.map((d) => d.tb) },
      { name: "This report", color: C.orange, values: chartData.map((d) => d.rep) },
    ], false);
    const br = bridge(lines);
    const bh = noteBlockHeight(pdf, W() / 2 - 12, br.map((b) => `${b.label}: ${fmtAmt(b.amount)}`));
    noteBlock(pdf, { x: MARGIN + W() / 2 + 12, y: y0, width: W() / 2 - 12, title: "Bridge to the old Excel basis (selected period)", lines: br.map((b) => `${b.label}: ${fmtAmt(b.amount)}`) });
    let yy = y0 + Math.max(128, bh + 8);
    text(pdf, `Both sides cover 1-Apr to the TB date (${dmy(tb.asOf)}); tolerance ₹${TIE_TOLERANCE}. Red rows differ from Tally's Trial Balance.`, MARGIN, yy, { size: 6.6, color: BRAND.grey });
    const rows = ctx.data.ties.slice().sort((a, b) => COMPANIES.indexOf(a.company as never) - COMPANIES.indexOf(b.company as never) || a.expType.localeCompare(b.expType) || (a.level === "group" ? -1 : 1));
    yy = drawTable(pdf, {
      x: MARGIN, y: yy + 6, width: W(), bodySize: 6.2, headerSize: 6, rowH: 11.5, rows,
      columns: [
        { header: "Company", width: 1.2, value: (t: TieRow) => t.company },
        { header: "Type", width: 1, value: (t) => t.expType },
        { header: "Group / ledger", width: 4, value: (t) => (t.level === "group" ? `${t.name} (total)` : t.name) },
        { header: "Tally TB", width: 1.5, align: "right", value: (t) => fmtAmt(t.tb) },
        { header: "This report", width: 1.5, align: "right", value: (t) => fmtAmt(t.lines) },
        { header: "Gap", width: 1.3, align: "right", value: (t) => fmtAmt(t.gap), color: (t) => (Math.abs(t.gap) > TIE_TOLERANCE ? C.red : undefined) },
        { header: "Status", width: 0.8, value: (t) => (Math.abs(t.gap) > TIE_TOLERANCE ? "GAP" : "Tied"), color: (t) => (Math.abs(t.gap) > TIE_TOLERANCE ? C.red : C.green) },
      ],
      rowKind: (t) => (Math.abs(t.gap) > TIE_TOLERANCE ? "big" : t.level === "group" ? "subtotal" : "normal"),
      onNewPage: () => newPage(), maxY: floor(),
    });
    return yy;
  }

  footer(doc, page, generatedAt, footNote);
  applyDeferredLinks(pdf, links, pageOf);
  try {
    pdf.outline.add(null, "Contents", { pageNumber: 1 });
    for (const s of contents) {
      const p = pageOf.get(s.id);
      if (p !== undefined) pdf.outline.add(null, s.name, { pageNumber: p });
    }
  } catch {
    // Bookmarks are a convenience; the in-page links are the requirement.
  }
  pdf.putTotalPages(doc.totalPagesToken);
  pdf.save(`${ctx.stem}.pdf`);
}
