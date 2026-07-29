/**
 * Bulk asset import — the plan builder.
 *
 * MasterCrud's Excel round trip cannot be reused here: it is built for masters
 * (one flat table, id-keyed round trip), and an asset is an entity with dated
 * child tracks. So this module does the equivalent job for the register, on top of
 * the same shared `parseXlsxRows` reader.
 *
 * ONE ROW = ONE ASSET, optionally plus ONE track. To give an asset several tracks,
 * repeat the row with the same serial number and different track columns — the
 * second row matches the asset created by the first and only adds the track. That
 * is how people actually build these sheets, and it avoids inventing a
 * multi-column-group format nobody would fill in correctly.
 *
 * Matching is by SERIAL NUMBER, because that is the only field that identifies a
 * physical unit. Rows without one can only ever create, never match.
 */
import type { AssetSchedule, FrequencyUnit, NamedMaster } from "../types";

export const IMPORT_COLUMNS = [
  "Asset name",
  "Category",
  "Make",
  "Model",
  "Serial / registration no.",
  "Company",
  "Location",
  "Department",
  "Custodian email",
  "Purchase date",
  "Purchase cost",
  "Bought from",
  "Invoice no.",
  "Warranty months",
  "Condition",
  "Usage unit",
  "Current reading",
  "Remarks",
  "Track",
  "Track next due",
  "Track repeats every",
  "Track repeat unit",
  "Track remind days ahead",
  "Track reference no.",
  "Track provider",
  "Track amount",
] as const;

export interface ImportRowPlan {
  rowNo: number;
  /** Present when this row creates a new asset. */
  asset?: Record<string, unknown>;
  /** The serial used to match/dedupe. */
  serial: string | null;
  /** Matched an asset that already exists (in the file or in the register). */
  matchedExisting: boolean;
  matchedAssetId?: string;
  /** Present when this row also carries a track. */
  track?: Record<string, unknown>;
  trackTypeName?: string;
  name: string;
  problems: string[];
}

export interface ImportPlan {
  rows: ImportRowPlan[];
  newAssets: number;
  newTracks: number;
  invalid: number;
}

const text = (v: unknown): string => String(v ?? "").trim();

/** Excel serial → yyyy-mm-dd. Day 1 is 1900-01-01, with the classic 1900 leap bug. */
const fromExcelSerial = (n: number): string | null => {
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

/**
 * Read a date cell. Accepts an Excel serial, yyyy-mm-dd, or dd-mm-yyyy (the format
 * every screen in this portal displays, so it is what people will type).
 */
export function parseDateCell(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return fromExcelSerial(v);
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const str = text(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const dmy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const n = Number(str);
  if (Number.isFinite(n) && n > 0) return fromExcelSerial(n);
  return null;
}

const numCell = (v: unknown): string => {
  const t = text(v).replace(/[,₹\s]/g, "");
  return t && Number.isFinite(Number(t)) ? t : "";
};

const UNIT_ALIASES: Record<string, FrequencyUnit> = {
  day: "days", days: "days",
  month: "months", months: "months",
  year: "years", years: "years", yearly: "years", annual: "years", annually: "years",
  "one time": "one_time", "one time only": "one_time", one_time: "one_time", once: "one_time",
};

export interface ImportCtx {
  categories: NamedMaster[];
  makes: NamedMaster[];
  companies: NamedMaster[];
  locations: NamedMaster[];
  vendors: NamedMaster[];
  conditions: NamedMaster[];
  usageUnits: NamedMaster[];
  scheduleTypes: { id: string; name: string; defaultLeadDays: number }[];
  departments: { id: string; name: string }[];
  people: { id: string; name: string; email?: string | null }[];
  existingAssets: { id: string; serialNo: string | null; schedules: AssetSchedule[] }[];
}

/** Case-insensitive name → id. Returns undefined for a blank cell, null for "not found". */
function lookup(rows: { id: string; name: string }[], raw: unknown): string | null | undefined {
  const t = text(raw);
  if (!t) return undefined;
  const hit = rows.find((r) => r.name.trim().toLowerCase() === t.toLowerCase());
  return hit ? hit.id : null;
}

export function buildImportPlan(records: Record<string, unknown>[], ctx: ImportCtx): ImportPlan {
  const rows: ImportRowPlan[] = [];
  // Serials created earlier in THIS file, so row 7 can add a track to the asset
  // row 3 is about to create.
  const seenSerials = new Set<string>();

  ctx.existingAssets.forEach((a) => {
    if (a.serialNo) seenSerials.add(a.serialNo.trim().toLowerCase());
  });

  records.forEach((rec, i) => {
    const problems: string[] = [];
    const rowNo = i + 2; // header is row 1
    const name = text(rec["Asset name"]);
    const serialRaw = text(rec["Serial / registration no."]);
    const serialKey = serialRaw.toLowerCase();

    const existing = serialRaw
      ? ctx.existingAssets.find((a) => (a.serialNo ?? "").trim().toLowerCase() === serialKey)
      : undefined;
    const alreadyInFile = !!serialRaw && seenSerials.has(serialKey) && !existing;
    const matchedExisting = !!existing || alreadyInFile;

    if (!name && !matchedExisting) problems.push("Asset name is required");

    const resolve = (col: string, list: { id: string; name: string }[], label: string) => {
      const r = lookup(list, rec[col]);
      if (r === null) problems.push(`${label} "${text(rec[col])}" is not in the masters`);
      return r ?? "";
    };

    const categoryId = resolve("Category", ctx.categories, "Category");
    const makeId = resolve("Make", ctx.makes, "Make");
    const companyId = resolve("Company", ctx.companies, "Company");
    const locationId = resolve("Location", ctx.locations, "Location");
    const vendorId = resolve("Bought from", ctx.vendors, "Vendor");
    const conditionId = resolve("Condition", ctx.conditions, "Condition");
    const usageUnitId = resolve("Usage unit", ctx.usageUnits, "Usage unit");
    const departmentId = resolve("Department", ctx.departments, "Department");

    let custodianId = "";
    const custEmail = text(rec["Custodian email"]);
    if (custEmail) {
      const p = ctx.people.find(
        (x) => (x.email ?? "").trim().toLowerCase() === custEmail.toLowerCase()
          || x.name.trim().toLowerCase() === custEmail.toLowerCase(),
      );
      if (!p) problems.push(`Custodian "${custEmail}" is not a portal user`);
      else custodianId = p.id;
    }

    const purchaseDate = parseDateCell(rec["Purchase date"]);
    if (text(rec["Purchase date"]) && !purchaseDate) problems.push("Purchase date is not a date");

    // ---- the optional track on this row ----
    const trackName = text(rec.Track);
    let track: Record<string, unknown> | undefined;
    let trackTypeName: string | undefined;
    if (trackName) {
      const type = ctx.scheduleTypes.find((t) => t.name.trim().toLowerCase() === trackName.toLowerCase());
      if (!type) {
        problems.push(`Track "${trackName}" is not a schedule type`);
      } else {
        trackTypeName = type.name;
        const due = parseDateCell(rec["Track next due"]);
        if (!due) problems.push(`Track "${trackName}" needs a next due date`);
        const unitRaw = text(rec["Track repeat unit"]).toLowerCase();
        const unit: FrequencyUnit = UNIT_ALIASES[unitRaw] ?? "months";
        if (unitRaw && !UNIT_ALIASES[unitRaw]) problems.push(`Repeat unit "${unitRaw}" is not days / months / years / one time`);
        // A track already on the matched asset would violate the (asset, type)
        // unique key — say so here rather than failing halfway through the run.
        if (existing?.schedules.some((sc) => sc.scheduleTypeId === type.id)) {
          problems.push(`${type.name} is already tracked on this asset`);
        }
        if (due) {
          track = {
            schedule_type_id: type.id,
            next_due_date: due,
            frequency_value: numCell(rec["Track repeats every"]),
            frequency_unit: unit,
            lead_days: numCell(rec["Track remind days ahead"]) || String(type.defaultLeadDays),
            ref_no: text(rec["Track reference no."]),
            provider: text(rec["Track provider"]),
            amount: numCell(rec["Track amount"]),
          };
        }
      }
    }

    const plan: ImportRowPlan = {
      rowNo,
      serial: serialRaw || null,
      matchedExisting,
      matchedAssetId: existing?.id,
      track,
      trackTypeName,
      name: name || existing?.id || serialRaw || `Row ${rowNo}`,
      problems,
    };

    if (!matchedExisting) {
      plan.asset = {
        name,
        category_id: categoryId,
        make_id: makeId,
        model: text(rec.Model),
        serial_no: serialRaw,
        company_id: companyId,
        location_id: locationId,
        department_id: departmentId,
        custodian_user_id: custodianId,
        purchase_date: purchaseDate ?? "",
        purchase_cost: numCell(rec["Purchase cost"]),
        vendor_id: vendorId,
        invoice_no: text(rec["Invoice no."]),
        warranty_months: numCell(rec["Warranty months"]),
        condition_id: conditionId,
        usage_unit_id: usageUnitId,
        current_usage: numCell(rec["Current reading"]),
        remarks: text(rec.Remarks),
      };
      if (serialRaw) seenSerials.add(serialKey);
    }

    rows.push(plan);
  });

  return {
    rows,
    newAssets: rows.filter((r) => r.asset && !r.problems.length).length,
    newTracks: rows.filter((r) => r.track && !r.problems.length).length,
    invalid: rows.filter((r) => r.problems.length).length,
  };
}
