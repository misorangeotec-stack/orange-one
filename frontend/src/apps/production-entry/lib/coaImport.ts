import * as XLSX from "xlsx-js-style";

/**
 * THE QC DAY SHEET, READ BACK INTO A COA — "Daily Quality Monitoring Sheet OOT
 * QC FMT 002", tabs "Daily QA" and "Daily QC".
 *
 * WHY THIS EXISTS: the readings are already typed once, by the analyst, into the
 * workbook the lab has always kept. Re-typing all nine into the certificate form
 * is the step that put blank and mistyped values onto issued certificates. So the
 * certificate is FILLED FROM the day sheet and the analyst checks it, rather than
 * entered twice and hoped to agree.
 *
 * ⚠ NOT shared/lib/importXlsx.ts, and it is not an oversight. That reader takes
 *   the first sheet and one header row, which is the shape of a file this portal
 *   itself exported. This workbook is the factory's own: six tabs, a TWO-ROW
 *   header (the parameter spans a merged pair, "STD."/"Actual" sits underneath),
 *   and data from the third row down. Nothing about it round-trips.
 *
 * ⚠ COLUMNS ARE FOUND BY THEIR HEADING, never by letter. The lab adds a column
 *   to this sheet from time to time; on fixed letters that silently shifts pH
 *   into Conductivity and the certificate still looks perfectly filled in. Read
 *   the heading and a moved column is followed, an absent one is reported.
 *
 * ⚠ IT FILLS THE FORM, IT DOES NOT SAVE. Import lands in the same editable boxes
 *   as typing, and the analyst still presses Issue. The sheet is a convenience,
 *   not an authority — the certificate remains something a person signed off.
 */

/** The nine measurements a certificate carries, as one key per row of the form. */
export type CoaKey =
  | "ph"
  | "conductivity"
  | "surfaceTension"
  | "viscosity"
  | "concentration"
  | "density"
  | "foamVolume"
  | "settleFoam"
  | "spreadTime";

const norm = (v: unknown): string =>
  String(v ?? "")
    // The sheet carries zero-width and non-breaking characters pasted in from
    // Word; left in, they defeat every heading match below.
    .replace(/[ ​-‍﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * A lot number with its punctuation removed — the whole point of the exercise.
 *
 * Production writes `2608-1344`; the lab types `26081344`. They are the same lot
 * and neither side is going to change, so both collapse to one key here. Stripping
 * every non-alphanumeric also rescues a lot Excel decided was a number and
 * formatted with separators ("2,60,81,344").
 */
export const lotKey = (v: unknown): string =>
  String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Which measurement a piece of text names — run over BOTH the workbook's column
 * headings and the COA parameter names, so the two sides meet on one key instead
 * of on a table of exact strings that drifts the first time either is reworded.
 *
 * ⚠ ORDER IS LOAD-BEARING. "Time Required to Settle Foam" contains "foam", so
 *   /settle/ and /spread/ have to be tried before it or the settle-time reading
 *   lands in the foam-volume row.
 */
const KEY_PATTERNS: [CoaKey, RegExp][] = [
  ["ph", /^ph\b/],
  ["conductivity", /conductivit/],
  ["surfaceTension", /surface\s*ten[sc]ion/],
  ["viscosity", /viscosit/],
  ["concentration", /concentration/],
  ["density", /densit/],
  ["settleFoam", /settle/],
  ["spreadTime", /spread/],
  ["foamVolume", /foam/],
];

export const coaKeyFor = (text: string): CoaKey | null => {
  const t = norm(text);
  if (!t) return null;
  for (const [key, re] of KEY_PATTERNS) if (re.test(t)) return key;
  return null;
};

/**
 * Where a measurement's two figures sit under its heading.
 *
 * The five customer parameters are a merged pair — "STD." over one column,
 * "Actual" over the next. The four internal-only ones are a single unheaded
 * column, so `std` is absent and `obs` matches the empty sub-heading.
 *
 * ⚠ % Concentration is the exception that forces this to be per-key rather than
 *   one rule. Its heading spans TEN columns of intermediate weighings, two of
 *   which are literally both labelled "Final Dilution Wt. STD." in the source. A
 *   generic /^std/ would take a weighing; only the two named columns are figures.
 */
const SUBS: Record<CoaKey, { std?: RegExp; obs: RegExp }> = {
  ph: { std: /^std/, obs: /^actual/ },
  conductivity: { std: /^std/, obs: /^actual/ },
  surfaceTension: { std: /^std/, obs: /^actual/ },
  viscosity: { std: /^std/, obs: /^actual/ },
  concentration: { std: /^std\.?\s*concentration/, obs: /^actual\s*concentration/ },
  density: { obs: /^$/ },
  foamVolume: { obs: /^$/ },
  settleFoam: { obs: /^$/ },
  spreadTime: { obs: /^$/ },
};

/** One measurement as the sheet recorded it. Both sides are free text — the form
 *  they fill is free text, and the lab writes ranges and words as well as numbers. */
export interface QcReading {
  standard: string;
  observed: string;
}

/** One lot's row off the day sheet. */
export interface QcRow {
  lot: string;
  productName: string;
  date: string;
  analyst: string;
  shift: string;
  /** Which tab it came from, and which line — quoted back so the analyst can
   *  check the import against the sheet without guessing where it looked. */
  sheetName: string;
  excelRow: number;
  readings: Partial<Record<CoaKey, QcReading>>;
}

export interface QcParseResult {
  rows: QcRow[];
  /** Tabs that were read, in the order they were tried. */
  sheetsRead: string[];
  /** Measurements whose heading was not found on any tab read — the honest half
   *  of the result, and the reason a partial fill is explained rather than silent. */
  missingColumns: CoaKey[];
}

/**
 * The tabs that hold readings, best first: only "Daily QA" carries density, foam
 * and the two timings, so it alone can fill an internal certificate.
 *
 * ⚠ A PREFERENCE, NOT A REQUIREMENT. Every other tab is tried after these two,
 *   because the file that reaches the browser is often not the lab's master
 *   workbook: a tab mailed on its own, or re-saved, arrives with one sheet called
 *   "Sheet1". Refusing that is refusing the right data over its label. What makes
 *   a sheet readable is the heading row (see `findHeader`), never its name.
 */
const SHEET_ORDER = ["daily qa", "daily qc"];

type Grid = string[][];

/** Read a tab as a plain grid of trimmed strings. `raw: false` hands back what the
 *  cell DISPLAYS, so a formatted date or a 2-decimal reading arrives as the lab
 *  sees it rather than as a float or a serial number. */
const gridOf = (ws: XLSX.WorkSheet): Grid =>
  (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][]).map((r) =>
    (r ?? []).map((c) => String(c ?? "").trim()),
  );

/**
 * What the lot column may be called.
 *
 * The lab's own sheet says "Batch / Lot Number", but a tab re-saved or re-typed
 * elsewhere shortens it, and either half of the name may be the one that
 * survives. All three spellings are safe to accept because a heading row still
 * has to clear CORROBORATING below before anything is read from it.
 */
const LOT_HEADING = /batch\s*[/\-]?\s*lot|^lot\s*(no\.?|number)?\s*:?$|^batch\s*(no\.?|number)?\s*:?$/;

/**
 * The other headings that confirm a row really is the day sheet's header.
 *
 * ⚠ THE LOT HEADING ALONE IS NOT ENOUGH, and the COA (Both) tab in the lab's own
 *   workbook is the proof: it carries the label "Lot No :" down the left of a
 *   CERTIFICATE, not a table. Anchoring on that one cell would read the labels
 *   under it — "Issue Date :", "Conclusion :" — as lot numbers and invent a row
 *   per line of the form. Two corroborating headings cost nothing on the real
 *   sheet, which has eight of them, and rule that tab out completely.
 */
const CORROBORATING = [
  /product\s*name/,
  /^date$/,
  /analyst/,
  /^shift$/,
  /viscosit/,
  /^ph\b/,
  /conductivit/,
  /surface\s*ten[sc]ion/,
];

/**
 * Find the heading rows — and so decide whether this sheet is readable at all.
 *
 * The row beneath the heading is the sub-heading only if it actually reads like
 * one; a lab that flattens the header to a single row is still read correctly.
 */
const findHeader = (grid: Grid): { head: number; sub: number | null; first: number } | null => {
  const limit = Math.min(grid.length, 40);
  for (let r = 0; r < limit; r++) {
    const row = grid[r];
    if (!row?.some((c) => LOT_HEADING.test(norm(c)))) continue;
    const hits = CORROBORATING.filter((re) => row.some((c) => re.test(norm(c)))).length;
    if (hits < 2) continue;
    const next = grid[r + 1] ?? [];
    const looksSub = next.some((c) => /^(std|actual)/.test(norm(c)));
    return looksSub ? { head: r, sub: r + 1, first: r + 2 } : { head: r, sub: null, first: r + 1 };
  }
  return null;
};

/** The heading of every column, with a merged parameter name carried across the
 *  columns it spans (a merge leaves the continuation cells blank). */
const groupsOf = (row: string[], width: number): string[] => {
  const out: string[] = [];
  let last = "";
  for (let c = 0; c < width; c++) {
    const g = norm(row[c]);
    if (g) last = g;
    out.push(last);
  }
  return out;
};

/** Which column holds each identity field, by heading. */
const findField = (groups: string[], re: RegExp): number => groups.findIndex((g) => re.test(g));

/**
 * Locate each measurement's standard and observed columns.
 *
 * ⚠ FIRST MATCH WINS PER KEY, so a repeated heading later in the sheet cannot
 *   quietly replace a column already resolved.
 */
const findReadingCols = (
  groups: string[],
  subs: string[],
): Partial<Record<CoaKey, { std: number | null; obs: number | null }>> => {
  const out: Partial<Record<CoaKey, { std: number | null; obs: number | null }>> = {};
  for (let c = 0; c < groups.length; c++) {
    const key = coaKeyFor(groups[c] ?? "");
    if (!key) continue;
    const want = SUBS[key];
    const sub = norm(subs[c] ?? "");
    const slot = (out[key] ??= { std: null, obs: null });
    if (want.std && slot.std === null && want.std.test(sub)) slot.std = c;
    if (slot.obs === null && want.obs.test(sub)) slot.obs = c;
  }
  return out;
};

const ALL_KEYS = Object.keys(SUBS) as CoaKey[];

/**
 * What a sheet actually begins with, for the "I could not read this" message.
 *
 * ⚠ THE MESSAGE HAS TO CARRY THE EVIDENCE. A refusal that only says what was
 *   expected leaves the person holding the file and the developer guessing at it
 *   from a screenshot. Quoting the first few filled rows back turns that into one
 *   glance: either the headings are there under a different name, or this is
 *   plainly a different file.
 */
const describeSheet = (name: string, grid: Grid): string => {
  const filled = grid.filter((r) => r.some((c) => c !== "")).slice(0, 3);
  if (filled.length === 0) return `"${name}" is empty`;
  const lines = filled.map((r) => r.filter((c) => c !== "").slice(0, 10).join(" | ").slice(0, 160));
  return `"${name}" starts: ${lines.join("  ⏎  ")}`;
};

/**
 * Read the workbook.
 *
 * Both tabs are read and their rows concatenated, "Daily QA" first, because a lot
 * may be written up on either and the caller wants whichever one has it. A tab
 * missing from the file is skipped rather than refused — the lab's older copies
 * do not all carry both.
 */
/**
 * A Windows internet shortcut, picked by mistake instead of the workbook.
 *
 * ⚠ THIS IS THE LIKELIEST WRONG FILE, not an exotic one, and it is Explorer's
 *   doing. "Add shortcut to My files" on a single OneDrive file writes a ~190
 *   byte text stub named `<the workbook>.xlsx.url`; with known extensions hidden
 *   — the Windows default — it is shown as `....xlsx` and is indistinguishable
 *   from the real thing in the file picker.
 *
 * SheetJS does not reject it. It reads the two lines as a CSV and hands back a
 * perfectly valid workbook with one sheet called "Sheet1", so every later check
 * fails somewhere deep and reports the wrong thing. Catching it here is the
 * difference between "this is a shortcut, open it and download the file" and a
 * paragraph about missing heading rows.
 */
const SHORTCUT = /^\s*(\[InternetShortcut\]|\[{000214A0-0000-0000-C000-000000000046}\])|^\s*URL=\s*https?:/im;

export async function parseQcWorkbook(file: File): Promise<QcParseResult> {
  const buf = await file.arrayBuffer();

  // latin1 never throws on binary, so a real .xlsx (a ZIP) simply yields noise
  // that cannot match the patterns above.
  const head = new TextDecoder("latin1").decode(new Uint8Array(buf.slice(0, 512)));
  if (SHORTCUT.test(head)) {
    const url = /^\s*URL=\s*(\S+)/im.exec(head)?.[1] ?? "";
    const name = decodeURIComponent(url.split("/").pop() ?? "").replace(/\?.*$/, "");
    throw new Error(
      `That is a SHORTCUT to the file, not the file itself — a small web link, with no readings in it. ` +
        `Windows hides the ".url" ending, so it looks exactly like an Excel file in the picker. ` +
        `Open the shortcut in your browser, press Download${name ? ` (${name})` : ""}, ` +
        `and then choose the DOWNLOADED file here.`,
    );
  }

  const wb = XLSX.read(buf, { type: "array" });

  // The two named tabs first, then everything else — so a lab workbook keeps its
  // QA-over-QC preference while a lone exported sheet is still read.
  const preferred = SHEET_ORDER.map((want) => wb.SheetNames.find((n) => norm(n) === want)).filter(
    (n): n is string => !!n,
  );
  const names = [...preferred, ...wb.SheetNames.filter((n) => !preferred.includes(n))];

  const rows: QcRow[] = [];
  const sheetsRead: string[] = [];
  const found = new Set<CoaKey>();
  /** Kept only to quote back in the refusal below. */
  const looked: string[] = [];

  for (const name of names) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const grid = gridOf(ws);
    const hdr = findHeader(grid);
    if (!hdr) {
      if (looked.length < 3) looked.push(describeSheet(name, grid));
      continue;
    }
    sheetsRead.push(name);

    const width = Math.max(...grid.map((r) => r.length), 0);
    const groups = groupsOf(grid[hdr.head] ?? [], width);
    const subs = hdr.sub === null ? [] : (grid[hdr.sub] ?? []);

    const cLot = findField(groups, /batch\s*\/?\s*lot|lot\s*(no|number)/);
    if (cLot < 0) continue;
    const cProduct = findField(groups, /product\s*name/);
    const cDate = findField(groups, /^date$/);
    const cAnalyst = findField(groups, /analyst/);
    const cShift = findField(groups, /^shift$/);

    const cols = findReadingCols(groups, subs);
    for (const k of ALL_KEYS) if (cols[k]?.obs != null) found.add(k);

    const at = (row: string[], c: number): string => (c >= 0 ? (row[c] ?? "").trim() : "");

    for (let r = hdr.first; r < grid.length; r++) {
      const row = grid[r] ?? [];
      const lot = at(row, cLot);
      // A blank lot is a blank form line or the "Month Summery" block below the
      // data — both are skipped by the same test, so no end-of-data marker is
      // needed and a lab that adds rows under the summary is still read.
      if (!lotKey(lot)) continue;

      const readings: Partial<Record<CoaKey, QcReading>> = {};
      for (const k of ALL_KEYS) {
        const col = cols[k];
        if (!col) continue;
        const standard = col.std == null ? "" : at(row, col.std);
        const observed = col.obs == null ? "" : at(row, col.obs);
        // A measurement with neither figure was not taken on this lot; recording
        // it as an empty reading would let the import blank a box the analyst
        // had already filled by hand.
        if (!standard && !observed) continue;
        readings[k] = { standard, observed };
      }

      rows.push({
        lot,
        productName: at(row, cProduct),
        date: at(row, cDate),
        analyst: at(row, cAnalyst),
        shift: at(row, cShift),
        sheetName: name,
        // 1-based, as Excel's own row numbers read — this is quoted to a person
        // who is about to go and look at the sheet.
        excelRow: r + 1,
        readings,
      });
    }
  }

  if (sheetsRead.length === 0) {
    throw new Error(
      `No sheet in that file has the day sheet's heading row — a "Batch / Lot Number" column ` +
        `alongside at least two of Product Name, Date, Analyst, Shift, Viscosity, pH, Conductivity, ` +
        `Surface Tension. Tabs looked at: ${names.join(", ") || "none"}. ` +
        `This is what they contain — ${looked.join("   ·   ") || "nothing"}`,
    );
  }

  return { rows, sheetsRead, missingColumns: ALL_KEYS.filter((k) => !found.has(k)) };
}

/**
 * The rows written up for one lot, oldest first.
 *
 * ⚠ RETURNS EVERY MATCH, and does not pick. A re-tested lot is written up twice
 *   on the day sheet and the two rows differ precisely in the readings, so
 *   choosing here — "the last one", say — would quietly put Test 2's figures on
 *   Test 1's certificate. The caller shows the analyst what it found.
 */
export const rowsForLot = (rows: QcRow[], lot: string): QcRow[] => {
  const want = lotKey(lot);
  return want ? rows.filter((r) => lotKey(r.lot) === want) : [];
};
