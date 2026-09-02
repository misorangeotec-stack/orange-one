import { exportSheetsToXlsx, GROUP_ROW_STYLE, type ExportColumn, type ExportSheet } from "@/shared/lib/exportXlsx";
import {
  BAND_LABEL, buildAllTabDiffs, type BandKey, type CellMark, type DiffRow, type TabDiff,
} from "./templateDiff";
import type { OcpiMachine, OcpiMachineSection, OcpiNamedMaster } from "../types";

/**
 * The template comparison workbook — one tab per machine category.
 *
 * ⚠ THIS SHEET IS THE INPUT TO A CLEAN-UP, NOT A ONE-OFF READ. Ritesh Bhai will
 *   settle a single agreed wording for each line that differs and have the
 *   templates updated to match, so every row carries a blank **Agreed wording**
 *   cell for him to write into. Without it he would be marking up a spreadsheet
 *   with nowhere to put the answer, and the whole exercise would need
 *   regenerating.
 *
 * ⚠ APPLYING those answers is a SEPARATE, LATER TASK. It rewrites the words that
 *   print on signed contracts across twenty-one machines. Nothing here writes.
 *
 * The classification itself lives in `templateDiff.ts` and is pure — this file
 * only turns it into cells, fills and column widths.
 */

/* -------------------------------------------------------------------------- */
/*  Fills                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 🔴 THE FILLS ARE NOT THE ONLY CARRIER OF ANY FINDING, and they must never
 *    become it. Printed in black and white, or read by somebody colour-blind,
 *    three pale tints are three pale greys. So every row also states its verdict
 *    in WORDS in the Status column, and within a row the marked cells are then
 *    self-evident: on a `Differs` row every cell has text and only the odd ones
 *    are amber; on `Missing` the marked cells are the empty ones; on `Only 1–2`
 *    they are the non-empty ones. The legend on each tab says exactly this.
 *
 * `same` deliberately has no entry. Settled boilerplate stays quiet so the
 * variable content can shout — a sheet where every cell is filled says nothing.
 */
const MARK_FILL: Partial<Record<CellMark, object>> = {
  differs: { fill: { fgColor: { rgb: "FCE3A8" } } },
  missing: { fill: { fgColor: { rgb: "F3BFBD" } } },
  unique: { fill: { fgColor: { rgb: "C2DAF0" } } },
};

/** Wrapped and top-aligned: a section body is a paragraph, not a value. */
const WRAP = { alignment: { wrapText: true, vertical: "top" } };

/** The line name and the answer box, which the reader is writing prose into. */
const POINTER_STYLE = { ...WRAP, font: { sz: 10 } };

/** The footer lines under the grid — present, but not competing with the data. */
const NOTE_STYLE = { font: { italic: true, color: { rgb: "5A6B82" }, sz: 10 }, alignment: { wrapText: true, vertical: "top" } };

/* -------------------------------------------------------------------------- */
/*  Row model                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One printed row. Three kinds, because a band banner and a footnote are not
 * data rows and must not be styled or measured as though they were.
 */
type SheetRow =
  | { kind: "band"; text: string }
  | { kind: "pointer"; row: DiffRow }
  | { kind: "note"; text: string };

/** How many columns sit left of the first machine — A..D. See COLUMNS below. */
const FIXED_COLS = 4;

const POINTER_WIDTH = 54;
const ANSWER_WIDTH = 54;
const MACHINE_WIDTH = 46;

/**
 * Roughly how many wrapped lines a string takes in a column this wide.
 *
 * Excel stores a row's height; it does not compute one for wrapped text on
 * opening a generated file, so a row left at the default height shows one line
 * and clips the rest. An estimate is therefore the honest option — the
 * alternative is a grid where every paragraph is a single clipped line.
 */
function wrappedLines(text: string, wch: number): number {
  if (!text) return 1;
  return text
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / Math.max(8, wch - 2))), 0);
}

/**
 * The row's height in points.
 *
 * 🔴 CAPPED, AND THE SHEET SAYS SO. The longest section body in the database is
 *    over six thousand characters — about ninety wrapped lines — and Excel's
 *    maximum row height is 409pt, roughly twenty-seven. No setting shows every
 *    clause in full, so the cap is chosen for the grid to stay readable and the
 *    legend tells the reader that a clipped clause is complete in the cell.
 */
const LINE_PT = 12.6;
const MAX_LINES = 8;

function rowHeight(r: SheetRow): number | undefined {
  if (r.kind === "band") return 20;
  if (r.kind === "note") return undefined;
  const lines = Math.max(
    wrappedLines(r.row.label, POINTER_WIDTH),
    ...r.row.cells.map((c) => wrappedLines(c.text, MACHINE_WIDTH)),
  );
  return Math.round(Math.min(lines, MAX_LINES) * LINE_PT + 3);
}

/* -------------------------------------------------------------------------- */
/*  The comparable tabs                                                       */
/* -------------------------------------------------------------------------- */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summaryLine(t: TabDiff): string {
  const x = t.totals;
  return (
    `${t.category} — ${plural(t.machines.length, "machine")} compared · ` +
    `${plural(x.total, "line")} in the union · ` +
    `${x.same} identical · ${x.differs} differ · ${x.missing} missing on some · ` +
    `${x.unique} on only one or two`
  );
}

const LEGEND_LINE =
  "No fill = every machine says it identically · AMBER = differs from the commonest wording · " +
  "RED = this machine does not carry the line · BLUE = only one or two carry it. " +
  "The Status column says the same in words, so this reads correctly in black and white.";

/** The rows below the grid: who was left out, and where the differences sit. */
function footerRows(t: TabDiff): SheetRow[] {
  const out: SheetRow[] = [{ kind: "note", text: "" }];

  // ⚠ NAMED, NOT COUNTED. "Two machines were excluded" invites the reader to
  //   assume the sheet covers everything else; naming them lets somebody notice
  //   that the machine they came here about is the one that is missing.
  if (t.excludedNoTemplate.length) {
    out.push({
      kind: "note",
      text: `Not compared — no template imported: ${t.excludedNoTemplate.join(", ")}. An untemplated machine is not one that disagrees; carried as an all-blank column it would drown every real finding in false red.`,
    });
  }
  if (t.excludedInactive.length) {
    out.push({
      kind: "note",
      text: `Not compared — inactive, so not quotable: ${t.excludedInactive.join(", ")}.`,
    });
  }

  out.push({ kind: "note", text: "" }, { kind: "note", text: "Where the differences sit" });
  for (const c of t.counts) {
    if (!c.total) continue;
    out.push({
      kind: "note",
      text: `${BAND_LABEL[c.band]} — ${c.total} lines: ${c.same} identical, ${c.differs} differ, ${c.missing} missing on some, ${c.unique} on only one or two.`,
    });
  }

  out.push(
    { kind: "note", text: "" },
    {
      kind: "note",
      text: "Two wordings count as the same after ignoring case, leading and trailing spaces, repeated spaces, blank lines, trailing full stops and commas, and curly quotes and dashes. The cell always shows the ORIGINAL text.",
    },
    {
      kind: "note",
      text: "{{tokens}} are compared as written, never as the value a deal would print. Two machines both saying {{head_count}} are identical.",
    },
    {
      kind: "note",
      text: `Rows are capped at about ${MAX_LINES} lines tall. A longer clause is complete in the cell — click it and read it in the formula bar, or widen the row.`,
    },
  );
  return out;
}

function comparableSheet(t: TabDiff): ExportSheet<SheetRow> {
  const rows: SheetRow[] = [];
  let band: BandKey | null = null;
  for (const r of t.rows) {
    if (r.band !== band) {
      band = r.band;
      rows.push({ kind: "band", text: BAND_LABEL[band].toUpperCase() });
    }
    rows.push({ kind: "pointer", row: r });
  }
  rows.push(...footerRows(t));

  const columns: ExportColumn<SheetRow>[] = [
    {
      header: "Template line",
      width: POINTER_WIDTH,
      value: (r) =>
        r.kind === "pointer"
          ? r.row.key
            ? `${r.row.label}  ·  ${r.row.key}`
            : r.row.label
          : r.text,
    },
    { header: "Band", width: 15, value: (r) => (r.kind === "pointer" ? BAND_LABEL[r.row.band] : "") },
    { header: "Status", width: 19, value: (r) => (r.kind === "pointer" ? r.row.status : "") },
    // Blank on every row, by design — this is the column the answers go in.
    { header: "Agreed wording (write here)", width: ANSWER_WIDTH, value: () => "" },
    // ⚠ INDEXED, NOT LOOKED UP. `buildTabDiff` builds every row's cells from
    //   this same machine list in this same order, so column i + FIXED_COLS is
    //   machine i on every row. Searching for the machine per cell would be a
    //   second ordering that could silently disagree with the first.
    ...t.machines.map(
      (m, i): ExportColumn<SheetRow> => ({
        header: m.name,
        width: MACHINE_WIDTH,
        value: (r) => (r.kind === "pointer" ? r.row.cells[i]?.text ?? "" : ""),
      }),
    ),
  ];

  return {
    sheetName: t.category,
    columns,
    rows,
    // ⚠ FOUR, not one. Column A alone would leave the answer box off screen the
    //   moment the reader scrolls to the machine they are comparing — and the
    //   Band column with it, which is the only thing that still says where a row
    //   belongs once the sheet is filtered and the band banners are hidden.
    freezeCols: FIXED_COLS,
    preamble: [[summaryLine(t)], [LEGEND_LINE], []],
    headerStyle: { alignment: { wrapText: true, vertical: "center" } },
    rowStyle: (r) =>
      r.kind === "band" ? GROUP_ROW_STYLE : r.kind === "note" ? NOTE_STYLE : POINTER_STYLE,
    cellStyle: (r, col) => {
      if (r.kind !== "pointer" || col < FIXED_COLS) return undefined;
      const cell = r.row.cells[col - FIXED_COLS];
      return cell ? MARK_FILL[cell.mark] : undefined;
    },
    rowHeights: rowHeight,
  };
}

/* -------------------------------------------------------------------------- */
/*  The tabs with nothing to compare                                          */
/* -------------------------------------------------------------------------- */

/**
 * 🔴 A CATEGORY THAT CANNOT BE DIFFED STILL GETS ITS TAB, AND THE TAB EXPLAINS
 *    ITSELF. An empty grid reads as a bug: somebody re-runs the export, gets the
 *    same blank sheet, and concludes the feature is broken. A sentence saying
 *    "a comparison needs two templated machines and this category has one"
 *    answers the question the blank sheet raised.
 */
function explanationSheet(t: TabDiff): ExportSheet<{ text: string }> {
  const lines: string[] = [];
  const n = t.machines.length;

  if (n === 0) {
    lines.push(
      `No machine in ${t.category} carries a template yet, so there is nothing to compare.`,
      "",
      `${t.category} holds ${plural(t.excludedNoTemplate.length, "machine")}: ${t.excludedNoTemplate.join(", ")}.`,
      "None of them has had its order-confirmation template imported.",
    );
  } else {
    lines.push(
      `A comparison needs at least two templates to hold side by side. ${t.category} has one.`,
      "",
      `The only templated machine in ${t.category} is ${t.machines[0].name}. Every line it carries is trivially unique, because there is nothing to compare it against — so a grid here would report a hundred differences that do not exist.`,
    );
    if (t.excludedNoTemplate.length) {
      lines.push(
        "",
        `Not compared — no template imported: ${t.excludedNoTemplate.join(", ")}.`,
        `Once one of those is templated, ${t.category} becomes comparable and this tab will carry a grid like Direct and Sublimation.`,
      );
    }
  }
  if (t.excludedInactive.length) {
    lines.push("", `Not compared — inactive, so not quotable: ${t.excludedInactive.join(", ")}.`);
  }

  return {
    sheetName: t.category,
    columns: [{ header: `${t.category} — nothing to compare`, width: 116, value: (r) => r.text }],
    rows: lines.map((text) => ({ text })),
    headerStyle: { alignment: { wrapText: true, vertical: "center" } },
    rowStyle: () => WRAP,
  };
}

/* -------------------------------------------------------------------------- */
/*  Entry point                                                               */
/* -------------------------------------------------------------------------- */

export interface ComparisonInput {
  categories: OcpiNamedMaster[];
  machines: OcpiMachine[];
  sections: OcpiMachineSection[];
}

/** The sheets and the About-sheet notes, without touching the browser. */
export function buildComparisonSheets({ categories, machines, sections }: ComparisonInput): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: ExportSheet<any>[];
  notes: string[];
} {
  const tabs = buildAllTabDiffs(categories, machines, sections);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheets: ExportSheet<any>[] = tabs.map((t) =>
    t.machines.length >= 2 ? comparableSheet(t) : explanationSheet(t),
  );

  const comparable = tabs.filter((t) => t.machines.length >= 2);
  const notes: string[] = [
    "One tab per machine category. Down the side is every line any machine in that category carries; across the top is one column per machine, in the master's own order. A line only one machine has still gets a row, blank across the rest — that blank is the finding.",
    ...comparable.map((t) => summaryLine(t)),
    ...tabs
      .filter((t) => t.machines.length < 2)
      .map(
        (t) =>
          `${t.category} — ${t.machines.length === 0 ? "no machine carries a template" : "only one machine carries a template"}, so the tab explains itself instead of showing a grid. A comparison needs two columns.`,
      ),
    "Machines with no template imported are excluded and named under each grid. An untemplated machine is not a machine that disagrees — as an all-blank column it would drown every real finding in false red. Inactive machines are excluded too, and named separately.",
    "Two wordings count as the same after ignoring case, leading and trailing spaces, repeated spaces, blank lines, trailing full stops and commas, and curly quotes and dashes. Only the comparison is normalised — every cell shows the ORIGINAL text.",
    "{{tokens}} are compared as written, never resolved to what a deal would print. Two machines both saying {{head_count}} are identical, even though every deal prints a different number there. Resolving first would make every machine differ from every other and the whole sheet would be amber.",
    "Sections are matched on their stored key, not on their heading — two machines may title the same clause differently. Where they do, an extra '↳ its heading' row shows each machine's wording, because that difference is itself a finding rather than a reason to split one clause into two rows.",
    "Specification rows are matched on the row label; a label only one machine uses becomes a line of its own.",
    "The Agreed wording column is deliberately empty. It is where the single settled wording for each differing line gets written. Applying those answers back into the templates is a separate job.",
    `Rows are capped at about ${MAX_LINES} lines tall — the longest clause in the database runs past what Excel can show in one row. A clipped clause is still complete in its cell.`,
    "Column A, the Band, the Status and the Agreed wording column stay on screen when the sheet is scrolled sideways.",
  ];

  return { sheets, notes };
}

/** Build and download the comparison workbook. */
export function exportTemplateComparison(input: ComparisonInput): Promise<void> {
  const { sheets, notes } = buildComparisonSheets(input);
  return exportSheetsToXlsx({
    fileName: "OCPI_Template_Comparison",
    title: "OCPI — Machine template comparison",
    sheets,
    filters: [
      "Every machine category, and every machine in it that carries a template.",
      "Machines with no template, and inactive machines, are excluded and named on their tab.",
    ],
    notes,
  });
}

