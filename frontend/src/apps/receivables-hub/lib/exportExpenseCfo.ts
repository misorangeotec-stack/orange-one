import * as XLSX from "xlsx-js-style";

import {
  UNIT_LABEL, buildTree, colValue, columnsFor, dmy, filterLabel, inUnit, monthLabel, partMonthNote, quarterColumns, quarterOf, sum,
  type Col, type DownloadOptions, type ExpLine, type ExpenseCfoData, type Filters, type TreeNode,
} from "./expenseCfo";
import {
  DEFAULT_MATERIALITY, bridge, cfoNotes, draftRemark, entityName, flagText, monthVariance, paretoSet,
  type SheetEntry, type TbStatus,
} from "./expenseCfoRules";

/**
 * Expense Analysis (CFO) — the Excel workbook.
 *
 * Laid out like the refresh-expenses workbook the CFO already reads: Index with hyperlinks and a
 * Must Review column (HIGH rows amber), "<< Back to Index" on every sheet, Summary with AUDIT FLAG
 * (flagged rows amber FFE6B3), the vendor sheets with green C6EFCE Pareto cells in the last two
 * months and a REMARKS column, RAW DATA with the gold FFC000 header.
 *
 * Rows are a real Excel OUTLINE, grouped the same way as the screen (e.g. Company ▸ Direct/Indirect
 * ▸ main group ▸ ledger): with "Grouped" chosen only the top level shows and every group opens with
 * Excel's own + button; with "Full detail" everything is open. Figures are in the unit chosen at
 * download (Crore / Lakh / rupees); the TB reconciliation and RAW DATA always stay in full rupees.
 * Tables only — the graphs are on the screen and in the PDF (user's choice, 23-Oct-2026).
 */

export interface ExportCtx {
  data: ExpenseCfoData;
  lines: ExpLine[];
  months: string[];
  filters: Filters;
  flags: Map<string, string[]>;
  index: SheetEntry[];
  tb: TbStatus;
  stem: string;
  opts: DownloadOptions;
}

const NUM = "#,##0.00";
const S = {
  title: { font: { bold: true, sz: 13, color: { rgb: "0B1B40" } } },
  draft: { font: { bold: true, sz: 12, color: { rgb: "C00000" } } },
  link: { font: { color: { rgb: "0563C1" }, underline: true } },
  head: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0B1B40" } }, alignment: { vertical: "center", wrapText: true } },
  gold: { font: { bold: true }, fill: { fgColor: { rgb: "FFC000" } } },
  sub: { font: { bold: true }, fill: { fgColor: { rgb: "E9EEF6" } } },
  grand: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "0B1B40" } } },
  amber: { fill: { fgColor: { rgb: "FFE6B3" } } },
  green: { fill: { fgColor: { rgb: "C6EFCE" } } },
  red: { font: { bold: true, color: { rgb: "C00000" } }, fill: { fgColor: { rgb: "FDECEC" } } },
  wrap: { alignment: { wrapText: true, vertical: "top" } },
  italic: { font: { italic: true, color: { rgb: "64748B" } } },
};

type Cell = string | number | null;

/** A sheet built row by row, with styles and outline levels recorded per row / cell. */
class Sheet {
  rows: Cell[][] = [];
  styles = new Map<string, object>();
  links = new Map<string, string>();
  levels = new Map<number, { level: number; hidden: boolean }>();
  widths: number[] = [];

  add(row: Cell[], style?: object, fromCol = 0): number {
    this.rows.push(row);
    const r = this.rows.length - 1;
    if (style) for (let c = fromCol; c < row.length; c++) this.style(r, c, style);
    return r;
  }
  style(r: number, c: number, s: object) {
    const k = `${r},${c}`;
    this.styles.set(k, { ...(this.styles.get(k) ?? {}), ...s });
  }
  link(r: number, c: number, sheet: string) { this.links.set(`${r},${c}`, sheet); this.style(r, c, S.link); }

  build(): XLSX.WorkSheet {
    const ws = XLSX.utils.aoa_to_sheet(this.rows.map((r) => r.map((v) => (v === null ? "" : v))));
    const w = ws as Record<string, XLSX.CellObject>;
    this.rows.forEach((row, r) => row.forEach((v, c) => {
      const a = XLSX.utils.encode_cell({ r, c });
      if (!w[a]) return;
      if (typeof v === "number") w[a].z = NUM;
      const st = this.styles.get(`${r},${c}`);
      if (st) (w[a] as XLSX.CellObject & { s?: object }).s = st;
      const target = this.links.get(`${r},${c}`);
      if (target) w[a].l = { Target: `#'${target.replace(/'/g, "''")}'!A1` };
    }));
    ws["!cols"] = this.widths.map((wch) => ({ wch }));
    if (this.levels.size) {
      ws["!rows"] = this.rows.map((_, r) => {
        const l = this.levels.get(r);
        return l ? { level: l.level, hidden: l.hidden } : {};
      });
      // Group totals sit ABOVE their detail, so Excel's +/- button goes on the total's row.
      (ws as Record<string, unknown>)["!outline"] = { above: true };
    }
    return ws;
  }
}

/** Excel sheet names: ≤31 chars, none of []:*?/\ and unique. */
function sheetNames(index: SheetEntry[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const s of index) {
    const base = s.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim();
    let name = base, n = 2;
    while (used.has(name.toUpperCase())) { name = `${base.slice(0, 28)} ${n++}`; }
    used.add(name.toUpperCase());
    out.set(s.id, name);
  }
  return out;
}

function header(sh: Sheet, ctx: ExportCtx, title: string, index: string | null, unit = true) {
  const r = sh.add([title], S.title);
  if (index) { sh.rows[r][6] = "<< Back to Index"; sh.link(r, 6, index); }
  if (!ctx.tb.tied) sh.add(["DRAFT – NOT TIED TO TB. See TB Reconciliation before relying on these figures."], S.draft);
  const part = partMonthNote(ctx.months, ctx.data.meta.dateTo);
  if (part) sh.add([`${part} - compare it with full months with care.`], S.draft);
  sh.add([`Period ${monthLabel(ctx.months[0])} to ${monthLabel(ctx.months[ctx.months.length - 1])} · ` +
    `${filterLabel(ctx.filters)} · load #${ctx.data.meta.loadId}${unit ? ` · amounts ${UNIT_LABEL[ctx.opts.unit]}` : ""}`], S.italic);
  sh.add([]);
}

const colsFor = (ctx: ExportCtx): Col[] =>
  ctx.opts.columns === "quarters" ? quarterColumns(ctx.months, new Set()) : columnsFor(ctx.months);

/**
 * One grouped table: a total row per group, its children under it as an Excel outline level, the
 * grand total last. "Grouped" hides every level below the first; Excel's + opens them.
 */
function treeSheet(sh: Sheet, ctx: ExportCtx, lines: ExpLine[], keys: ((l: ExpLine) => string)[], levelNames: string[],
  extra?: { head: string; cell: (n: TreeNode) => string; amber?: (n: TreeNode) => boolean },
  green?: (n: TreeNode, month: string) => boolean) {
  const cols = colsFor(ctx);
  const u = ctx.opts.unit;
  const root = buildTree(lines, keys);
  sh.add([levelNames.join(" › "), "Level", ...cols.map((c) => c.label), ...(extra ? [extra.head] : [])], S.head);
  const write = (n: TreeNode) => {
    const r = sh.add([n.label, levelNames[n.depth - 1], ...cols.map((c) => inUnit(colValue(n.byMonth, c, ctx.months), u)), ...(extra ? [extra.cell(n)] : [])],
      n.children.length ? S.sub : undefined);
    sh.style(r, 0, { alignment: { indent: n.depth - 1 } });
    if (n.depth > 1) sh.levels.set(r, { level: n.depth - 1, hidden: ctx.opts.rows === "grouped" });
    if (extra?.amber?.(n)) for (let c = 0; c < 2 + cols.length; c++) sh.style(r, c, S.amber);
    if (extra) sh.style(r, 2 + cols.length, S.wrap);
    if (green) cols.forEach((c, ci) => { if (c.kind === "month" && green(n, c.key)) sh.style(r, 2 + ci, S.green); });
    n.children.forEach(write);
  };
  root.children.forEach(write);
  sh.add(["Grand Total", "", ...cols.map((c) => inUnit(colValue(root.byMonth, c, ctx.months), u)), ...(extra ? [""] : [])], S.grand);
  sh.widths = [44, 12, ...cols.map(() => 13), ...(extra ? [60] : [])];
}

export function exportExpenseCfoXlsx(ctx: ExportCtx): void {
  const wb = XLSX.utils.book_new();
  const names = sheetNames(ctx.index);
  const idx = names.get("index")!;
  const { lines } = ctx;
  const u = ctx.opts.unit;

  for (const s of ctx.index) {
    const sh = new Sheet();
    const name = names.get(s.id)!;
    header(sh, ctx, s.id === "index" ? "Expense Analysis (CFO) — Index" : s.name, s.id === "index" ? null : idx, !["index", "tb", "raw"].includes(s.id));

    switch (s.id) {
      case "analytics": {
        sh.add(["Figures behind the Analytics page (graphs are in the PDF)"], S.italic);
        sh.add(["Month", "Direct", "Indirect", "Other (valuation + exchange)", "Total"], S.head);
        for (const m of ctx.months) {
          const ml = lines.filter((l) => l.month === m);
          const t = (k: string) => inUnit(sum(ml.filter((l) => l.expType === k)), u);
          sh.add([monthLabel(m), t("DIRECT"), t("INDIRECT"), t("OTHER"), inUnit(sum(ml), u)]);
        }
        sh.add([]);
        sh.add(["CFO notes"], S.head);
        cfoNotes(lines, ctx.months, ctx.tb, ctx.flags).forEach((n) => sh.add([n], S.wrap));
        sh.widths = [90, 16, 16, 22, 16];
        break;
      }
      case "index": {
        sh.add(["Sheet", "Description", "Must Review"], S.head);
        for (const e of ctx.index) {
          if (e.id === "index") continue;
          const r = sh.add([names.get(e.id)!, e.description, e.review], e.review === "HIGH" ? S.amber : undefined);
          sh.link(r, 0, names.get(e.id)!);
        }
        sh.add([]);
        sh.add([`Companion PDF: ${ctx.stem}.pdf (same figures, with graphs and a linked contents page).`], S.italic);
        sh.add([`Rows are grouped - use Excel's + / - (or the 1 2 3 buttons at the top left) to open and close them.`], S.italic);
        sh.widths = [32, 70, 14];
        break;
      }
      case "summary":
        treeSheet(sh, ctx, lines, [(l) => l.expType, (l) => l.mainGroup, (l) => l.gl], ["EXP TYPE", "MAIN GROUP", "LEDGER"], {
          head: "AUDIT FLAG",
          cell: (n) => (n.depth === 2 ? flagText(ctx.flags, n.path[0] as "DIRECT", n.path[1]) : ""),
          amber: (n) => n.depth === 2 && !!flagText(ctx.flags, n.path[0] as "DIRECT", n.path[1]),
        });
        break;
      case "company":
        treeSheet(sh, ctx, lines, [(l) => entityName(l.entity), (l) => l.expType, (l) => l.mainGroup, (l) => l.gl], ["COMPANY", "EXP TYPE", "MAIN GROUP", "LEDGER"]);
        break;
      case "direct":
        treeSheet(sh, ctx, lines.filter((l) => l.expType === "DIRECT"), [(l) => l.mainGroup, (l) => l.gl, (l) => l.party], ["MAIN GROUP", "LEDGER", "PARTY"]);
        break;
      case "component":
        treeSheet(sh, ctx, lines.filter((l) => l.expType === "DIRECT"), [(l) => l.component, (l) => l.mainGroup, (l) => l.gl], ["COMPONENT", "MAIN GROUP", "LEDGER"]);
        break;
      case "indirect":
        treeSheet(sh, ctx, lines.filter((l) => l.expType === "INDIRECT"), [(l) => l.mainGroup, (l) => l.subGroup, (l) => l.gl], ["MAIN GROUP", "SUB-GROUP", "LEDGER"]);
        break;
      case "other":
        treeSheet(sh, ctx, lines.filter((l) => l.expType === "OTHER"), [(l) => l.mainGroup, (l) => l.company, (l) => l.gl], ["MAIN GROUP", "COMPANY", "LEDGER"]);
        break;
      case "variance": {
        const ms = ctx.months;
        if (ms.length < 2) { sh.add(["Pick at least two months to see month-on-month variance."]); break; }
        for (let i = ms.length - 1; i >= 1; i--) {
          const rows = monthVariance(lines, ms, ms[i - 1], ms[i], DEFAULT_MATERIALITY).filter((r) => r.material);
          sh.add([`${monthLabel(ms[i])} vs ${monthLabel(ms[i - 1])} — material moves (≥ ₹${DEFAULT_MATERIALITY.amount.toLocaleString("en-IN")} or ≥ ${DEFAULT_MATERIALITY.pct}%)`], S.title);
          sh.add(["Type", "Main group", "Prev month", "This month", "Change", "Change %", "Inc / Dec", "Nature", "Main drivers"], S.head);
          for (const r of rows) {
            const x = sh.add([r.expType, r.mainGroup, inUnit(r.prev, u), inUnit(r.cur, u), inUnit(r.change, u), r.pct === null ? "n/m" : `${r.pct.toFixed(1)}%`, r.direction, r.nature,
              r.drivers.map((d) => `${d.label} ${Math.round(d.change).toLocaleString("en-IN")}${d.narration ? ` (${d.narration.slice(0, 60)})` : ""}`).join("; ")]);
            sh.style(x, 8, S.wrap);
          }
          sh.add([]);
        }
        sh.widths = [10, 30, 15, 15, 15, 10, 11, 22, 80];
        break;
      }
      case "tb": {
        sh.add(["Company", "Type", "Level", "Group / ledger", "Tally TB (₹)", "This report (₹)", "Gap (₹)", "TB as at", "Status"], S.head);
        for (const t of ctx.data.ties) {
          const bad = Math.abs(t.gap) > 0.99;
          sh.add([t.company, t.expType, t.level === "group" ? "Total" : "Group / ledger", t.name, t.tb, t.lines, t.gap, dmy(t.asOf), bad ? "GAP" : "Tied"],
            bad ? S.red : t.level === "group" ? S.sub : undefined);
        }
        sh.add([]);
        sh.add(["Bridge to the old Excel basis (selected period, ₹)"], S.title);
        bridge(lines).forEach((b, i) => sh.add([b.label, null, null, null, b.amount], i === 2 ? S.sub : undefined));
        sh.widths = [12, 10, 14, 44, 16, 16, 14, 12, 8];
        break;
      }
      case "raw": {
        sh.add(["Company", "Company Name", "EXP TYPE", "MAIN GROUP", "SUB-GROUP", "SUB-SUB GROUP", "TYPES", "DATE", "MONTH", "Financial Quarter",
          "LEDGER NAME", "PARTY SOURCE", "VCH. TYPE", "VCH NO.", "NET AMOUNT (₹)", "NARRATION", "COMPONENT CATEGORY", "Sales voucher"], S.gold);
        for (const l of lines) {
          sh.add([l.company, l.entity, l.expType, l.mainGroup, l.subGroup, l.subSubGroup, l.gl, dmy(l.date), monthLabel(l.month), `Q${quarterOf(l.month)}`,
            l.party, l.partySource, l.voucherType, l.voucherNo, l.amount, l.narration, l.component, l.isSalesVch ? "Yes" : ""]);
        }
        sh.widths = [11, 10, 9, 28, 28, 28, 34, 11, 9, 8, 34, 16, 18, 14, 15, 60, 16, 8];
        break;
      }
      default: {
        const gl = lines.filter((l) => l.expType === "INDIRECT" && l.mainGroup === s.mainGroup);
        const parties = buildTree(gl, [(l) => l.party]).children;
        const pareto = new Map(ctx.months.slice(-2).map((m) => [m, paretoSet(new Map(parties.map((n) => [n.label, n.byMonth.get(m) ?? 0])))]));
        sh.add(["Green = top 80% of that month's spend (last two months; choose 'Quarters with months' to see it)"], S.italic);
        treeSheet(sh, ctx, gl, [(l) => l.party, (l) => l.gl], ["PARTY", "LEDGER"],
          { head: "REMARKS", cell: (n) => (n.depth === 1 ? draftRemark(n.lines.map((l) => l.narration)) : "") },
          (n, m) => n.depth === 1 && !!pareto.get(m)?.has(n.label));
      }
    }
    XLSX.utils.book_append_sheet(wb, sh.build(), name);
  }
  XLSX.writeFile(wb, `${ctx.stem}.xlsx`);
}
