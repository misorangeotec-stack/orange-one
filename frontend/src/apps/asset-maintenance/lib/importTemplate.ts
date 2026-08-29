/**
 * The four-tab import template the portal hands out.
 *
 * WHY IT IS NOT JUST A HEADER ROW. The importer resolves every master column by
 * NAME, so the commonest failure by far is a name that does not match — and the old
 * one-sheet template made that likely rather than unlikely. It shipped a worked
 * example whose Location was "Head Office", which is not, and never has been, one of
 * the masters: anyone who downloaded it and followed the example got a row the
 * importer rejected. A template that teaches a rejected value is worse than none.
 *
 * So the tabs are:
 *   Data Entry       — headers only. FIRST, because parseXlsxRows reads the first
 *                      sheet that is not "About this export" (importXlsx.ts).
 *   Read Me          — the rules, including the two that fail silently.
 *   Sample (filled)  — worked rows, built from LIVE masters (see pick()).
 *   Picklists        — the live vocabulary, so nothing has to be guessed.
 *
 * The standalone workbook we email out (frontend/scripts/build-asset-template.mjs)
 * is the same design with real in-cell dropdowns. It needs exceljs to do that, which
 * is a build-time dependency only — xlsx-js-style writes no <dataValidation> at all —
 * so the browser-side version leans on the Picklists tab instead. Keep the two in
 * step: the script asserts its columns against IMPORT_COLUMNS, and so does this.
 */
import type { ExportColumn, ExportSheet } from "@/shared/lib/exportXlsx";
import type { Company, NamedMaster, ScheduleType, Vendor } from "../types";
import { IMPORT_COLUMNS } from "./importAssets";

type Row = Record<string, string | number>;

export interface TemplateCtx {
  categories: NamedMaster[];
  makes: NamedMaster[];
  companies: Company[];
  locations: NamedMaster[];
  vendors: Vendor[];
  conditions: NamedMaster[];
  usageUnits: NamedMaster[];
  scheduleTypes: ScheduleType[];
  departments: { id: string; name: string }[];
  activeOf: <T extends NamedMaster>(rows: T[]) => T[];
}

/**
 * The value to put in a worked example.
 *
 * Prefers the name the example was written around, but falls back to whatever the
 * masters actually hold. That fallback is the whole point: an example is only
 * instructive if it would survive its own import, and this file cannot know what a
 * given deployment has set up.
 */
function pick(names: string[], preferred: string): string {
  const hit = names.find((n) => n.trim().toLowerCase() === preferred.toLowerCase());
  return hit ?? names[0] ?? "";
}

const names = (rows: { name: string }[]): string[] => rows.map((r) => r.name);

/** Column widths, by header. Anything unlisted takes the 18-char default. */
const WIDTHS: Record<string, number> = {
  "Asset name": 30, "Serial / registration no.": 26, "Company": 38, "Model": 22,
  "Department": 22, "Custodian email": 28, "Bought from": 26, "Remarks": 42,
  "Track": 20, "Track provider": 24, "Track remind days ahead": 20,
  "Purchase date": 14, "Reading as on": 14, "Track next due": 14,
  "Usage unit": 12, "Condition": 15, "Warranty months": 15,
};

const columns = (): ExportColumn<Row>[] =>
  IMPORT_COLUMNS.map((c) => ({
    header: c,
    width: WIDTHS[c] ?? 18,
    value: (r: Row) => r[c] ?? "",
  }));

/** The rules a filler has to know. The two marked ⚠ fail without a useful error. */
export const TEMPLATE_NOTES = [
  "One row = one asset. To give an asset a second track, repeat the row with the SAME serial number and change only the Track columns — the second row adds the track and nothing else. Rows 2-4 of the Sample tab do this.",
  "⚠ A serial number identifies ONE physical unit. If two different assets are given the same number, the second is treated as another track for the first and its details are discarded silently. Leave it blank rather than reusing one.",
  "⚠ If you fill in Warranty months AND a purchase date, the Warranty Expiry track is created automatically. Do NOT also add a Warranty Expiry row — the row will fail to save and the error will not say why.",
  "Master columns (Category, Make, Company, Location, Department, Bought from, Condition, Usage unit, Track) must match a value on the Picklists tab, which is read live from the masters. Anything else is rejected.",
  "Custodian is matched on the portal login email OR the person's full name. Leave it blank rather than guessing.",
  "Dates may be dd-mm-yyyy, yyyy-mm-dd, or a real Excel date. Track repeat unit: days, months, years or one time.",
  "Only Asset name is strictly required. A partly filled row is far more useful than a missing one.",
  "There is no column for chassis or engine number — put them in Remarks as 'Chassis: xxxxx ; Engine: xxxxx'.",
  "Fill in the Data Entry tab. Do not rename the tabs or the column headings, and do not send back the Sample tab as your data.",
];

/** Worked rows: three assets, seven tracks, every value drawn from the live masters. */
function sampleRows(ctx: TemplateCtx): Row[] {
  const cat = names(ctx.activeOf(ctx.categories));
  const make = names(ctx.activeOf(ctx.makes));
  const co = names(ctx.activeOf(ctx.companies));
  const loc = names(ctx.activeOf(ctx.locations));
  const ven = names(ctx.activeOf(ctx.vendors));
  const cond = names(ctx.activeOf(ctx.conditions));
  const unit = names(ctx.activeOf(ctx.usageUnits));
  const track = names(ctx.activeOf(ctx.scheduleTypes));
  const dept = names(ctx.departments);

  const inUse = pick(cond, "In Use");
  const company = pick(co, "Orange O Tec Enterprises Private Limited");
  const location = pick(loc, "NOIDA");
  const admin = pick(dept, "Administration");

  const veh = {
    "Asset name": "SAMPLE - Toyota Innova Crysta",
    "Serial / registration no.": "SAMPLE-MH12KJ0001",
  };
  const laptop = {
    "Asset name": "SAMPLE - Dell Latitude 5440",
    "Serial / registration no.": "SAMPLE-DL5440-0001",
  };
  const ac = {
    "Asset name": "SAMPLE - Voltas Split AC 1.5T",
    "Serial / registration no.": "SAMPLE-VLT-88213",
  };

  return [
    {
      ...veh,
      Category: pick(cat, "Vehicle"), Make: pick(make, "Toyota"), Model: "Innova Crysta 2.4 ZX",
      Company: company, Location: location, Department: admin,
      "Purchase date": "12-06-2024", "Purchase cost": "2140000",
      "Bought from": pick(ven, "Sai Toyota Service"), "Invoice no.": "INV-TOY-4471",
      Condition: inUse, "Usage unit": pick(unit, "KM"),
      "Current reading": "84200", "Reading as on": "20-08-2026",
      Remarks: "Pool car. Chassis: MBJ11JV600123456 ; Engine: 2GD1234567",
      Track: pick(track, "Insurance"), "Track next due": "04-08-2027",
      "Track repeats every": "1", "Track repeat unit": "years", "Track remind days ahead": "45",
      "Track reference no.": "POL-2027-4471", "Track provider": "ICICI Lombard", "Track amount": "31200",
    },
    {
      ...veh,
      Remarks: "Same serial number as the row above, so this row only ADDS a track.",
      Track: pick(track, "Periodic Service"), "Track next due": "20-11-2026",
      "Track repeats every": "6", "Track repeat unit": "months", "Track remind days ahead": "15",
    },
    {
      ...veh,
      Track: pick(track, "PUC"), "Track next due": "14-02-2027",
      "Track repeats every": "1", "Track repeat unit": "years", "Track remind days ahead": "30",
    },
    {
      ...veh,
      Track: pick(track, "RC / Fitness"), "Track next due": "12-06-2029",
      "Track repeats every": "1", "Track repeat unit": "years", "Track remind days ahead": "45",
    },
    {
      ...laptop,
      Category: pick(cat, "Computer & IT"), Make: pick(make, "Dell"), Model: "Latitude 5440",
      Company: company, Location: location, Department: pick(dept, "AI & tech"),
      "Purchase date": "20-02-2026", "Purchase cost": "82400",
      "Bought from": pick(ven, "Dell India Services"), "Invoice no.": "INV-DL-7201",
      "Warranty months": "36", Condition: inUse,
      Remarks: "Warranty months is filled in, so the Warranty Expiry track is created automatically — note there is no Warranty Expiry row for this asset.",
    },
    {
      ...laptop,
      Track: pick(track, "AMC Renewal"), "Track next due": "20-02-2027",
      "Track repeats every": "1", "Track repeat unit": "years", "Track remind days ahead": "45",
      "Track reference no.": "AMC-DL-7201", "Track provider": "Dell India Services", "Track amount": "8500",
    },
    {
      ...ac,
      Category: pick(cat, "Air Conditioner"), Make: pick(make, "Voltas"), Model: "185V ADS",
      Company: company, Location: location, Department: admin,
      "Purchase date": "18-04-2025", "Purchase cost": "42500",
      "Bought from": pick(ven, "Voltas Authorised Service"), "Invoice no.": "INV-VLT-8821",
      "Warranty months": "24", Condition: inUse,
      Remarks: "No meter, so Usage unit and Current reading are left blank.",
      Track: pick(track, "Periodic Service"), "Track next due": "18-10-2026",
      "Track repeats every": "6", "Track repeat unit": "months", "Track remind days ahead": "15",
    },
    {
      ...ac,
      Track: pick(track, "AMC Renewal"), "Track next due": "18-04-2027",
      "Track repeats every": "1", "Track repeat unit": "years", "Track remind days ahead": "45",
      "Track reference no.": "AMC-VLT-8821", "Track provider": "Voltas Authorised Service", "Track amount": "4200",
    },
  ];
}

/** The live vocabulary, one column per master, padded to the longest list. */
function picklistSheet(ctx: TemplateCtx): ExportSheet<Row> {
  const lists: [string, string[]][] = [
    ["Category", names(ctx.activeOf(ctx.categories))],
    ["Make", names(ctx.activeOf(ctx.makes))],
    ["Company", names(ctx.activeOf(ctx.companies))],
    ["Location", names(ctx.activeOf(ctx.locations))],
    ["Department", names(ctx.departments)],
    ["Bought from", names(ctx.activeOf(ctx.vendors))],
    ["Condition", names(ctx.activeOf(ctx.conditions))],
    ["Usage unit", names(ctx.activeOf(ctx.usageUnits))],
    ["Track", names(ctx.activeOf(ctx.scheduleTypes))],
    ["Track repeat unit", ["days", "months", "years", "one time"]],
  ];
  const depth = Math.max(...lists.map(([, v]) => v.length));
  const rows: Row[] = Array.from({ length: depth }, (_, i) => {
    const r: Row = {};
    lists.forEach(([k, v]) => { r[k] = v[i] ?? ""; });
    return r;
  });
  return {
    sheetName: "Picklists",
    columns: lists.map(([k, v]) => ({
      header: k,
      width: Math.min(42, Math.max(k.length, ...v.map((n) => n.length), 8) + 3),
      value: (r: Row) => r[k] ?? "",
    })),
    rows,
  };
}

/** The four data sheets, in tab order. Data Entry MUST stay first — see the header. */
export function buildTemplateSheets(ctx: TemplateCtx): ExportSheet<Row>[] {
  const cols = columns();
  return [
    { sheetName: "Data Entry", columns: cols, rows: [] },
    {
      sheetName: "Read Me",
      columns: [{ header: "How to fill this sheet", width: 110, value: (r: Row) => r.line ?? "" }],
      rows: TEMPLATE_NOTES.map((line) => ({ line })),
    },
    { sheetName: "Sample (filled)", columns: cols, rows: sampleRows(ctx) },
    picklistSheet(ctx),
  ];
}
