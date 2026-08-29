#!/usr/bin/env node
/**
 * build-asset-template.mjs — the Excel workbook we send the Orange teams so they
 * can hand back the real asset register.
 *
 * WHY A SCRIPT (not a hand-made spreadsheet):
 *   The register is loaded through the bulk importer at /asset-maintenance/assets/import,
 *   and that importer has a fixed column contract (IMPORT_COLUMNS in
 *   src/apps/asset-maintenance/lib/importAssets.ts). A hand-made sheet drifts from it the
 *   first time anyone renames a heading, and the failure mode is a hundred rejected rows
 *   at the end of a data-collection exercise. So the workbook is generated, and the
 *   generator ASSERTS its columns against the importer's own array (see checkColumns).
 *
 * WHY exceljs AND NOT the app's xlsx-js-style:
 *   The whole point of this sheet is that the master columns cannot be filled in wrongly,
 *   which needs in-cell dropdowns. xlsx-js-style and xlsx are both SheetJS Community:
 *   neither writes <dataValidation>, and neither writes a freeze <pane> either — the
 *   `!freeze` key every export in this repo sets is a documented no-op. exceljs writes
 *   both. It is a devDependency, imported only here, never from src/ — and tsconfig.json
 *   is "include": ["src"], so nothing here can affect `npm run build`.
 *
 * USAGE (from the `frontend/` folder):
 *   npm run asset-template
 *
 * OUTPUT:
 *   ../Asset Data Collection Template.xlsx  (repo root, untracked)
 *
 * ⚠ THE HEADER TEXT IS THE CONTRACT. The importer keys every row off the exact header
 *   string, so a heading may not be decorated — no " *" to mark a mandatory column, no
 *   renaming for readability. Mandatory columns are shown by HEADER COLOUR and a cell
 *   note instead. Changing that is how you silently break the import.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPORTER = path.join(HERE, "../src/apps/asset-maintenance/lib/importAssets.ts");
const OUT = path.join(HERE, "../../Asset Data Collection Template.xlsx");

// ===========================================================================
// PICKLISTS — a snapshot of the live masters.
//
// Deliberately a constant and not a live fetch: it keeps this script
// credential-free and deterministic, and the masters are static. Same pattern as
// seed-fms-demo.mjs, which mirrors purchase-fms/config/stages.ts.
//
// TO REFRESH, re-run this against the identity project and paste the result:
//   select 'category' k, name from fms_asset_categories where active
//   union all select 'make',      name from fms_asset_makes       where active
//   union all select 'company',   name from fms_asset_companies   where active
//   union all select 'location',  name from fms_asset_locations   where active
//   union all select 'vendor',    name from fms_asset_vendors     where active
//   union all select 'condition', name from fms_asset_conditions  where active
//   union all select 'usage_unit',name from fms_asset_usage_units where active
//   union all select 'sched',     name from fms_asset_schedule_types where active
//   union all select 'department',name from departments where coalesce(active,true)
//   order by 1, 2;
//
// NOTE: no people. Custodian is free text on purpose — a dropdown would mean
// committing 60-odd staff email addresses into a tracked file.
// Snapshot taken 29-Aug-2026.
// ===========================================================================
const PICKLISTS = {
  "Category": ["Vehicle", "Air Conditioner", "Machinery", "Computer & IT", "Electrical", "Furniture", "Safety Equipment"],
  "Make": ["Blue Star", "Dell", "ELGi", "Honda", "HP", "Riko", "Safex", "Toyota", "Voltas"],
  "Company": [
    "Orange O Tec Private Limited",
    "Orange O Tec Enterprises Private Limited",
    "Colorix Digital Printing Solutions LLP",
  ],
  "Location": ["NOIDA", "SURAT-SACHIN", "SURAT-HOJIWALA"],
  "Department": [
    "Accounting & Finance", "Administration", "After Sales service", "AI & tech",
    "Human Resources", "Ink Manufacturing", "M/C Manufacturing", "Management",
    "Marketing", "Quality Lab", "Sales", "Supply Chain",
  ],
  "Bought from": [
    "Blue Star Service", "Dell India Services", "ELGi Service Centre", "Honda Prime Motors",
    "HP Care Centre", "Riko Engineering Works", "Safex Fire Services", "Sai Toyota Service",
    "Voltas Authorised Service",
  ],
  "Condition": ["In Use", "Under Service", "Under Repair", "Idle", "Scrapped", "Sold"],
  "Usage unit": ["KM", "Hours", "Cycles"],
  "Track": [
    "Periodic Service", "Insurance", "PUC", "RC / Fitness",
    "Warranty Expiry", "AMC Renewal", "Calibration", "Statutory Inspection",
  ],
  "Track repeat unit": ["days", "months", "years", "one time"],
};

/** Each track type's default reminder lead, shown on Picklists for reference. */
const TRACK_LEADS = [
  ["Periodic Service", 15], ["Insurance", 45], ["PUC", 30], ["RC / Fitness", 45],
  ["Warranty Expiry", 30], ["AMC Renewal", 45], ["Calibration", 30], ["Statutory Inspection", 30],
];

// ===========================================================================
// COLUMNS — header text is the contract (checkColumns proves it). `list` binds a
// column to a PICKLISTS key; `strict: false` means the dropdown warns rather than
// blocks, for the masters that are genuinely still filling up.
// ===========================================================================
const COLUMNS = [
  { h: "Asset name", w: 30, req: true,
    note: "REQUIRED. What the thing is called in everyday use, e.g. Toyota Innova Crysta, or Split AC 1.5T - Reception." },
  { h: "Category", w: 18, list: "Category", strict: true,
    note: "Pick from the list. This also decides which tracks the system offers for the asset." },
  { h: "Make", w: 16, list: "Make", strict: false,
    note: "Pick from the list. If your make is not there, type it, and add it to the Values we do not have yet box on the Picklists tab." },
  { h: "Model", w: 22,
    note: "Model or variant, e.g. Latitude 5440. Worth filling in - it is empty on every asset we hold today." },
  { h: "Serial / registration no.", w: 26, key: true,
    note: "The number stamped on the unit: vehicle registration, machine serial, laptop service tag. MUST be unique - two different assets sharing one number means the second one is silently dropped." },
  { h: "Company", w: 38, list: "Company", strict: true,
    note: "Which of the three group companies owns it." },
  { h: "Location", w: 18, list: "Location", strict: false,
    note: "Pick from the list. If your site is not there, type it, and add it to the Values we do not have yet box." },
  { h: "Department", w: 22, list: "Department", strict: true,
    note: "The department that uses it." },
  { h: "Custodian email", w: 28,
    note: "Who looks after it - they get every reminder. Their Orange O Tec login email, OR their full name exactly as it appears in the portal. Leave blank if unsure; do not guess." },
  { h: "Purchase date", w: 14, date: true,
    note: "dd-mm-yyyy, e.g. 12-06-2024. Leave blank if genuinely unknown." },
  { h: "Purchase cost", w: 14, num: "#,##0",
    note: "Rupees, figures only. No commas or currency symbol needed." },
  { h: "Bought from", w: 26, list: "Bought from", strict: false,
    note: "Supplier or dealer. If not listed, type it, and add it to the Values we do not have yet box." },
  { h: "Invoice no.", w: 18 },
  { h: "Warranty months", w: 15, num: "0",
    note: "Warranty length in months. IMPORTANT: if you fill this in AND a purchase date, the system creates the Warranty Expiry track by itself - do NOT also add a Warranty Expiry row." },
  { h: "Condition", w: 15, list: "Condition", strict: true,
    note: "Current state. Sold and scrapped assets should still be listed, with the condition set - do not leave them out." },
  { h: "Usage unit", w: 12, list: "Usage unit", strict: true,
    note: "Only for things with a meter - KM for vehicles, Hours for machines. Leave blank otherwise." },
  { h: "Current reading", w: 14, num: "#,##0",
    note: "The meter reading. Figures only." },
  { h: "Reading as on", w: 14, date: true,
    note: "The date that reading was taken, dd-mm-yyyy. A reading with no date is a guess." },
  { h: "Remarks", w: 42,
    note: "Anything else worth knowing. There is no column for chassis or engine number - put them here as Chassis: xxxxx ; Engine: xxxxx." },
  { h: "Track", w: 20, list: "Track", strict: true,
    note: "What has to be renewed or serviced on a date. ONE track per row - to add a second, copy the row, keep the same serial number, and change only the Track columns. Leave blank if there is nothing to track yet." },
  { h: "Track next due", w: 14, date: true,
    note: "When it is next due, dd-mm-yyyy. Required if you filled in Track - this is what the reminder counts back from." },
  { h: "Track repeats every", w: 16, num: "0",
    note: "How often it comes round, as a number. Pair it with the unit in the next column - e.g. 6 + months." },
  { h: "Track repeat unit", w: 16, list: "Track repeat unit", strict: true,
    note: "days, months, years, or one time for something that never repeats." },
  { h: "Track remind days ahead", w: 20, num: "0",
    note: "How many days before the due date the reminder should start. Leave blank to use the standard lead shown on the Picklists tab." },
  { h: "Track reference no.", w: 20,
    note: "Policy or contract number, for renewals." },
  { h: "Track provider", w: 24,
    note: "Insurer, agency or service provider, for renewals." },
  { h: "Track amount", w: 14, num: "#,##0",
    note: "Premium or fee in rupees, for renewals." },
];

// ===========================================================================
// SAMPLE — three assets, seven tracks, across the three categories in round one.
// Names and serials are SAMPLE- prefixed so they cannot collide with anything real
// even if this tab is uploaded by mistake.
// ===========================================================================
const OOTE = "Orange O Tec Enterprises Private Limited";
const SAMPLE = [
  {
    "Asset name": "SAMPLE - Toyota Innova Crysta", "Category": "Vehicle", "Make": "Toyota",
    "Model": "Innova Crysta 2.4 ZX", "Serial / registration no.": "SAMPLE-MH12KJ0001",
    "Company": OOTE, "Location": "NOIDA", "Department": "Administration",
    "Purchase date": "12-06-2024", "Purchase cost": 2140000, "Bought from": "Sai Toyota Service",
    "Invoice no.": "INV-TOY-4471", "Condition": "In Use",
    "Usage unit": "KM", "Current reading": 84200, "Reading as on": "20-08-2026",
    "Remarks": "Pool car - management travel. Chassis: MBJ11JV600123456 ; Engine: 2GD1234567",
    "Track": "Insurance", "Track next due": "04-08-2027", "Track repeats every": 1,
    "Track repeat unit": "years", "Track remind days ahead": 45,
    "Track reference no.": "POL-2027-4471", "Track provider": "ICICI Lombard", "Track amount": 31200,
  },
  {
    "Asset name": "SAMPLE - Toyota Innova Crysta", "Serial / registration no.": "SAMPLE-MH12KJ0001",
    "Remarks": "Same serial number as the row above, so this row only ADDS a track.",
    "Track": "Periodic Service", "Track next due": "20-11-2026", "Track repeats every": 6,
    "Track repeat unit": "months", "Track remind days ahead": 15,
  },
  {
    "Asset name": "SAMPLE - Toyota Innova Crysta", "Serial / registration no.": "SAMPLE-MH12KJ0001",
    "Track": "PUC", "Track next due": "14-02-2027", "Track repeats every": 1,
    "Track repeat unit": "years", "Track remind days ahead": 30,
  },
  {
    "Asset name": "SAMPLE - Toyota Innova Crysta", "Serial / registration no.": "SAMPLE-MH12KJ0001",
    "Track": "RC / Fitness", "Track next due": "12-06-2029", "Track repeats every": 1,
    "Track repeat unit": "years", "Track remind days ahead": 45,
  },
  {
    "Asset name": "SAMPLE - Dell Latitude 5440", "Category": "Computer & IT", "Make": "Dell",
    "Model": "Latitude 5440", "Serial / registration no.": "SAMPLE-DL5440-0001",
    "Company": OOTE, "Location": "NOIDA", "Department": "AI & tech",
    "Purchase date": "20-02-2026", "Purchase cost": 82400, "Bought from": "Dell India Services",
    "Invoice no.": "INV-DL-7201", "Warranty months": 36, "Condition": "In Use",
    "Remarks": "Issued to the accounts desk. Warranty months is filled in, so the Warranty Expiry track is created automatically - notice there is no Warranty Expiry row for this asset.",
  },
  {
    "Asset name": "SAMPLE - Dell Latitude 5440", "Serial / registration no.": "SAMPLE-DL5440-0001",
    "Track": "AMC Renewal", "Track next due": "20-02-2027", "Track repeats every": 1,
    "Track repeat unit": "years", "Track remind days ahead": 45,
    "Track reference no.": "AMC-DL-7201", "Track provider": "Dell India Services", "Track amount": 8500,
  },
  {
    "Asset name": "SAMPLE - Voltas Split AC 1.5T", "Category": "Air Conditioner", "Make": "Voltas",
    "Model": "185V ADS", "Serial / registration no.": "SAMPLE-VLT-88213",
    "Company": OOTE, "Location": "NOIDA", "Department": "Administration",
    "Purchase date": "18-04-2025", "Purchase cost": 42500, "Bought from": "Voltas Authorised Service",
    "Invoice no.": "INV-VLT-8821", "Warranty months": 24, "Condition": "In Use",
    "Remarks": "Ground floor reception. No meter, so Usage unit and Current reading are left blank.",
    "Track": "Periodic Service", "Track next due": "18-10-2026", "Track repeats every": 6,
    "Track repeat unit": "months", "Track remind days ahead": 15,
  },
  {
    "Asset name": "SAMPLE - Voltas Split AC 1.5T", "Serial / registration no.": "SAMPLE-VLT-88213",
    "Track": "AMC Renewal", "Track next due": "18-04-2027", "Track repeats every": 1,
    "Track repeat unit": "years", "Track remind days ahead": 45,
    "Track reference no.": "AMC-VLT-8821", "Track provider": "Voltas Authorised Service", "Track amount": 4200,
  },
];

// ===========================================================================
// READ ME — "h" heading, "b" sub-heading band, "p" body line.
// ===========================================================================
const READ_ME = [
  ["h", "Asset register - data collection sheet"],
  ["p", "Please fill in the Data Entry tab. The Sample (filled) tab shows a worked example of exactly the same columns - read that first, then work in Data Entry."],
  ["p", ""],
  ["b", "The one rule that matters: one row = one asset"],
  ["p", "Every physical thing you own gets one row. Fill in as much of it as you know."],
  ["p", ""],
  ["b", "How to record more than one renewal or service on the same asset"],
  ["p", "Each row carries at most ONE track - an insurance, a service, a PUC, an AMC. To add a second one, COPY THE ROW, keep the SAME serial number, clear the other columns, and change only the Track columns. Rows 2, 3 and 4 of the Sample tab do exactly this."],
  ["p", "You cannot list the same kind of track twice for one asset - one Insurance row per vehicle, not two."],
  ["p", ""],
  ["b", "Serial / registration number - please be careful with this one"],
  ["p", "It is how we tell one physical unit from another: vehicle registration, machine serial, laptop service tag. If two DIFFERENT assets are given the same number, the second one is treated as another track for the first, and its details are thrown away without any warning. If a unit genuinely has no number, leave it blank."],
  ["p", ""],
  ["b", "Warranty - do not enter it twice"],
  ["p", "If you fill in Warranty months AND a purchase date, the system works out the warranty expiry and starts tracking it by itself. Do NOT also add a row with Track = Warranty Expiry. Doing both makes the row fail to load, and the error it gives does not explain why."],
  ["p", ""],
  ["b", "Dropdowns and the Picklists tab"],
  ["p", "Most columns have a dropdown. The values come from the Picklists tab, and they have to match what is already set up in the system - a location typed as Head Office when the system only knows NOIDA will be rejected."],
  ["p", "Category, Company, Department, Condition, Usage unit, Track and Track repeat unit are fixed lists - please pick from them."],
  ["p", "Make, Location and Bought from will let you type something that is not on the list, because those lists are still growing. If you do, please also write it in the Values we do not have yet box at the bottom of the Picklists tab, so we can add it before loading your sheet."],
  ["p", ""],
  ["b", "Dates"],
  ["p", "Write dates as dd-mm-yyyy, for example 12-06-2024. The date columns are formatted as text on purpose, so what you type is exactly what we read."],
  ["p", ""],
  ["b", "What we especially want"],
  ["p", "Custodian - the person who looks after the asset. They receive every reminder, and right now not one asset has anybody named against it. Their portal login email is ideal, but their FULL NAME as it appears in the portal works just as well. Leave it blank rather than guessing."],
  ["p", "Model - it is empty on every asset we currently hold."],
  ["p", "Next due dates - an asset with no track never reminds anybody about anything."],
  ["p", ""],
  ["b", "Odds and ends"],
  ["p", "There is no column for chassis or engine number. Put them in Remarks as Chassis: xxxxx ; Engine: xxxxx."],
  ["p", "Assets that are sold or scrapped should still be listed, with Condition set accordingly. Do not leave them out."],
  ["p", "Only Asset name is strictly required. Everything else can be left blank if you do not know it - a partly filled row is far more useful than a missing one."],
  ["p", "Hover over any column heading in Data Entry for a note on what goes in it."],
  ["p", ""],
  ["b", "Please do not"],
  ["p", "Rename the tabs, rename or reorder the column headings, or insert columns. The headings are read by the system exactly as written."],
  ["p", "Send back the Sample tab as your data - it is only an example."],
];

// ===========================================================================
// STYLE — matches the house export header in src/shared/lib/exportXlsx.ts.
// ===========================================================================
const NAVY = "FF0B1F3A";
const ORANGE = "FFE8590C";
const TINT = "FFDCE4EE";
const fillWith = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

function styleHeaderRow(ws, cols) {
  const row = ws.getRow(1);
  cols.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.font = HEADER_FONT;
    cell.fill = fillWith(c.req || c.key ? ORANGE : NAVY);
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    if (c.note) cell.note = c.note;
  });
  row.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

/** Column letter for a 1-based index (A, B, ... Z, AA). */
function colLetter(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

// ===========================================================================
// The drift guard. This script cannot import a .ts file — there is no tsx or
// ts-node in this repo — so it holds its own copy of the header list and proves it
// against the importer's array instead. If someone edits IMPORT_COLUMNS and not
// this file, the build stops here rather than shipping a template whose every row
// would be rejected.
// ===========================================================================
function checkColumns() {
  const src = fs.readFileSync(IMPORTER, "utf8");
  const block = src.match(/IMPORT_COLUMNS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!block) throw new Error(`Could not find IMPORT_COLUMNS in ${IMPORTER}`);
  const actual = [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  const mine = COLUMNS.map((c) => c.h);
  const same = actual.length === mine.length && actual.every((v, i) => v === mine[i]);
  if (!same) {
    console.error("\nTEMPLATE COLUMNS NO LONGER MATCH THE IMPORTER.\n");
    const n = Math.max(actual.length, mine.length);
    for (let i = 0; i < n; i++) {
      if (actual[i] !== mine[i]) {
        console.error(`  index ${i}: importer ${JSON.stringify(actual[i])} vs template ${JSON.stringify(mine[i])}`);
      }
    }
    console.error("\nFix COLUMNS in this script to match importAssets.ts, then run again.\n");
    process.exit(1);
  }
  return actual.length;
}

// ===========================================================================
// BUILD
// ===========================================================================
const columnCount = checkColumns();

const wb = new ExcelJS.Workbook();
wb.creator = "Orange One";

// --- sheet 0: Data Entry -----------------------------------------------------
// MUST be first. parseXlsxRows (src/shared/lib/importXlsx.ts) reads the first sheet
// that is not called "About this export" — put the Read Me here and the importer
// parses the instructions instead of the data.
const de = wb.addWorksheet("Data Entry");
de.addRow(COLUMNS.map((c) => c.h));
de.columns = COLUMNS.map((c) => ({ width: c.w }));
styleHeaderRow(de, COLUMNS);

// Column formats. Dates are TEXT on purpose: a General-formatted "10-01-2026" can be
// silently reinterpreted by Excel's own locale as 1 October.
COLUMNS.forEach((c, i) => {
  if (c.date) de.getColumn(i + 1).numFmt = "@";
  else if (c.num) de.getColumn(i + 1).numFmt = c.num;
});

// --- sheet 1: Read Me --------------------------------------------------------
const rm = wb.addWorksheet("Read Me");
rm.columns = [{ width: 110 }];
READ_ME.forEach(([kind, line]) => {
  const row = rm.addRow([line]);
  const cell = row.getCell(1);
  cell.alignment = { wrapText: true, vertical: "top" };
  if (kind === "h") {
    cell.font = { ...HEADER_FONT, size: 14 };
    cell.fill = fillWith(NAVY);
    row.height = 26;
  } else if (kind === "b") {
    cell.font = { bold: true, color: { argb: NAVY }, size: 11.5 };
    cell.fill = fillWith(TINT);
    row.height = 20;
  } else if (line.length > 95) {
    row.height = 30;
  }
});

// --- sheet 2: Sample (filled) ------------------------------------------------
const sp = wb.addWorksheet("Sample (filled)");
sp.addRow(COLUMNS.map((c) => c.h));
sp.columns = COLUMNS.map((c) => ({ width: c.w }));
styleHeaderRow(sp, COLUMNS);
COLUMNS.forEach((c, i) => {
  if (c.date) sp.getColumn(i + 1).numFmt = "@";
  else if (c.num) sp.getColumn(i + 1).numFmt = c.num;
});
SAMPLE.forEach((r) => sp.addRow(COLUMNS.map((c) => (r[c.h] === undefined ? null : r[c.h]))));

// --- sheet 3: Picklists ------------------------------------------------------
const pl = wb.addWorksheet("Picklists");
const listKeys = Object.keys(PICKLISTS);
pl.addRow(listKeys);
styleHeaderRow(pl, listKeys.map((k) => ({ h: k })));
const maxLen = Math.max(...listKeys.map((k) => PICKLISTS[k].length));
for (let r = 0; r < maxLen; r++) pl.addRow(listKeys.map((k) => PICKLISTS[k][r] ?? null));
pl.columns = listKeys.map((k) => ({
  width: Math.min(42, Math.max(k.length, ...PICKLISTS[k].map((v) => v.length)) + 3),
}));

// The release valve for the thin masters. Locations, makes and vendors run to only a
// handful of rows each, and the importer rejects any name it does not already hold —
// so a field team needs somewhere to put a value we have not set up yet.
const gapRow = maxLen + 4;
pl.getCell(`A${gapRow}`).value = "Values we do not have yet";
pl.getCell(`A${gapRow}`).font = { ...HEADER_FONT, size: 12 };
pl.getCell(`A${gapRow}`).fill = fillWith(ORANGE);
pl.mergeCells(`A${gapRow}:C${gapRow}`);
pl.getCell(`A${gapRow + 1}`).value =
  "If a Make, Location or supplier you need is missing from the lists above, type it into Data Entry anyway, and also write it here. We will add it to the system before loading your sheet.";
pl.getCell(`A${gapRow + 1}`).alignment = { wrapText: true, vertical: "top" };
pl.mergeCells(`A${gapRow + 1}:C${gapRow + 1}`);
pl.getRow(gapRow + 1).height = 32;
["Which column", "The value you need", "Where you saw it"].forEach((h, i) => {
  const c = pl.getCell(`${colLetter(i + 1)}${gapRow + 2}`);
  c.value = h;
  c.font = { bold: true, color: { argb: NAVY } };
  c.fill = fillWith(TINT);
});

// Standard reminder leads, so "Track remind days ahead" can safely be left blank.
const leadRow = gapRow + 9;
pl.getCell(`A${leadRow}`).value =
  "Standard reminder lead, in days before the due date - used when you leave Track remind days ahead blank";
pl.getCell(`A${leadRow}`).font = { bold: true, color: { argb: NAVY } };
pl.getCell(`A${leadRow}`).fill = fillWith(TINT);
pl.mergeCells(`A${leadRow}:C${leadRow}`);
TRACK_LEADS.forEach(([name, days], i) => {
  pl.getCell(`A${leadRow + 1 + i}`).value = name;
  pl.getCell(`B${leadRow + 1 + i}`).value = days;
});

// --- dropdowns ---------------------------------------------------------------
// Applied at RANGE level. Setting .dataValidation on each cell instead would
// materialise ~2000 empty cells per column, and the importer would then read
// thousands of blank rows out of a sheet that looks empty.
const LAST_ROW = 2000;
COLUMNS.forEach((c, i) => {
  if (!c.list) return;
  const src = colLetter(listKeys.indexOf(c.list) + 1);
  const col = colLetter(i + 1);
  de.dataValidations.add(`${col}2:${col}${LAST_ROW}`, {
    type: "list",
    allowBlank: true,
    formulae: [`=Picklists!$${src}$2:$${src}$${PICKLISTS[c.list].length + 1}`],
    showErrorMessage: true,
    errorStyle: c.strict ? "stop" : "warning",
    errorTitle: c.strict ? "Please pick from the list" : "Not on our list yet",
    error: c.strict
      ? `${c.h} has to match one of the values on the Picklists tab, or the row cannot be loaded.`
      : `That value is not on the Picklists tab. You can keep it - choose Yes - but please also add it to the "Values we do not have yet" box on the Picklists tab.`,
  });
});

// Open on the instructions, while Data Entry stays FIRST in sheet order.
wb.views = [{ activeTab: 1 }];

await wb.xlsx.writeFile(OUT);
console.log(`Wrote ${path.resolve(OUT)}`);
console.log(`  ${columnCount} columns · ${SAMPLE.length} sample rows · ${listKeys.length} picklists · dropdowns to row ${LAST_ROW}`);
