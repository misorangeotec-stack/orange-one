import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ExportColumn } from "@/shared/lib/exportXlsx";
import { readBool } from "@/shared/lib/importXlsx";

/**
 * Generic per-master Excel export/import, shared by every FMS Masters tab.
 *
 * Every FMS master (Purchase, Import, Sampling, Production, Office Supplies, HR Exit,
 * HR Recruitment) renders through one component — `MasterCrud` — which already carries
 * everything a round-trip needs: the value-bag schema (`emptyValues` / `toValues`), the
 * field descriptors (labels + select options), and `onSubmit(id, values, active)` where
 * a null id inserts and a present id updates. So export/import is built ONCE here off
 * those props, with no per-app code.
 *
 * THE SCHEMA IS `Object.keys(emptyValues)`, NOT `fields`. A master may carry a value-bag
 * key with no visible form field (Production's `sortOrder`), and driving the columns off
 * `fields` would silently drop it — re-importing would then reset it. `fields` is used
 * only to (a) label a column nicely and (b) know a key is a `select`, so its stored id
 * can be shown as a human name on the way out and resolved back on the way in.
 */

type Values = Record<string, string>;

/** camelCase / snake_case key → "Title Case" header, when there's no field label. */
function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/** The .xlsx header a value-bag key is written under (kept identical on export + import). */
function headerForKey(key: string, fieldByKey: Map<string, MasterFieldDef>): string {
  return fieldByKey.get(key)?.label ?? humanize(key);
}

/**
 * Columns for one master's export: `ID` (the round-trip match key) + one per value-bag
 * key + `Active`. A `select` key shows its option label (a name, not an id); a value not
 * in the option list (e.g. an inactive parent no longer offered) falls through as its raw
 * stored value so it stays recoverable on re-import.
 */
export function buildExportColumns<T extends { id: string; active: boolean }>(
  emptyValues: Values,
  fields: MasterFieldDef[],
  toValues: (row: T) => Values,
): ExportColumn<T>[] {
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const dataCols: ExportColumn<T>[] = Object.keys(emptyValues).map((key) => {
    const field = fieldByKey.get(key);
    return {
      header: headerForKey(key, fieldByKey),
      value: (row: T) => {
        const raw = toValues(row)[key] ?? "";
        if (field?.type === "select" && field.options) {
          const opt = field.options.find((o) => o.value === raw);
          return opt ? opt.label : raw;
        }
        return raw;
      },
    };
  });
  return [
    { header: "ID", width: 24, value: (row: T) => row.id },
    ...dataCols,
    { header: "Active", width: 10, value: (row: T) => (row.active ? "Yes" : "No") },
  ];
}

export interface ImportChange {
  /** The row's identity for the preview (its name, else its id). */
  label: string;
  /** Human summary of what an update touches ("Name, Active"); empty for an add. */
  changed: string;
  save: () => Promise<void>;
}

export interface ImportInvalid {
  label: string;
  reason: string;
}

export interface ImportPlan {
  toAdd: ImportChange[];
  toUpdate: ImportChange[];
  /** Rows whose every cell already matched — no write. */
  unchanged: number;
  /** IDs present in the file but not in the master (skipped, never inserted). */
  unmatched: string[];
  invalid: ImportInvalid[];
}

export interface ImportResult {
  ok: number;
  failed: ImportInvalid[];
}

/**
 * Diff a parsed spreadsheet against the live rows into an apply-able plan. Blank ID →
 * an add (only when `canCreate`); a matching ID → an update of just the changed rows; an
 * unknown ID → skipped. Every write goes through the master's own `onSubmit`, so its
 * validation and RLS are reused verbatim and there is no insert path this can reach that
 * the Add form couldn't.
 */
export function buildImportPlan<T extends { id: string; name: string; active: boolean }>({
  records,
  existingRows,
  emptyValues,
  fields,
  toValues,
  onSubmit,
  canCreate,
}: {
  records: Record<string, unknown>[];
  existingRows: T[];
  emptyValues: Values;
  fields: MasterFieldDef[];
  toValues: (row: T) => Values;
  onSubmit: (id: string | null, values: Values, active: boolean) => Promise<void>;
  canCreate: boolean;
}): ImportPlan {
  const keys = Object.keys(emptyValues);
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const byId = new Map(existingRows.map((r) => [r.id, r]));

  const plan: ImportPlan = { toAdd: [], toUpdate: [], unchanged: 0, unmatched: [], invalid: [] };
  const has = (rec: Record<string, unknown>, header: string) => Object.prototype.hasOwnProperty.call(rec, header);
  const cellOf = (rec: Record<string, unknown>, header: string) => String(rec[header] ?? "").trim();

  for (const rec of records) {
    const idRaw = cellOf(rec, "ID");
    const existing = idRaw ? byId.get(idRaw) : undefined;
    const isAdd = !idRaw;

    if (isAdd && !canCreate) {
      // A blank-ID row in a master that mirrors another system can never be matched.
      plan.unmatched.push("(blank ID — new rows not allowed here)");
      continue;
    }
    if (idRaw && !existing) {
      plan.unmatched.push(idRaw);
      continue;
    }

    const base: Values = existing ? toValues(existing) : { ...emptyValues };
    const values: Values = { ...base };
    let invalidReason: string | null = null;

    for (const key of keys) {
      const header = headerForKey(key, fieldByKey);
      if (!has(rec, header)) continue; // column absent → keep base value, never clear
      const cell = cellOf(rec, header);
      const field = fieldByKey.get(key);

      if (field?.type === "select" && field.options && cell !== "") {
        const byLabel = field.options.find((o) => o.label.toLowerCase() === cell.toLowerCase());
        const byValue = field.options.find((o) => o.value === cell);
        if (byLabel) values[key] = byLabel.value;
        else if (byValue) values[key] = byValue.value;
        else if (existing && cell === base[key]) values[key] = cell; // e.g. inactive parent, unchanged
        else {
          invalidReason = `${field.label}: "${cell}" is not a valid option`;
          break;
        }
      } else {
        values[key] = cell;
      }
    }

    if (invalidReason) {
      plan.invalid.push({ label: values.name || existing?.name || idRaw || "(new)", reason: invalidReason });
      continue;
    }

    for (const f of fields) {
      if (f.required && !(values[f.key] ?? "").trim()) {
        invalidReason = `${f.label} is required`;
        break;
      }
    }
    if (invalidReason) {
      plan.invalid.push({ label: values.name || existing?.name || idRaw || "(new)", reason: invalidReason });
      continue;
    }

    const active = has(rec, "Active") ? readBool(rec["Active"]) : existing ? existing.active : true;
    const label = values.name || existing?.name || idRaw || "(new)";

    if (existing) {
      const changedKeys = keys.filter((k) => (values[k] ?? "") !== (base[k] ?? ""));
      const activeChanged = active !== existing.active;
      if (changedKeys.length === 0 && !activeChanged) {
        plan.unchanged++;
        continue;
      }
      const changed = [
        ...changedKeys.map((k) => headerForKey(k, fieldByKey)),
        ...(activeChanged ? ["Active"] : []),
      ].join(", ");
      plan.toUpdate.push({ label, changed, save: () => onSubmit(existing.id, values, active) });
    } else {
      plan.toAdd.push({ label, changed: "", save: () => onSubmit(null, values, active) });
    }
  }

  return plan;
}

/**
 * Apply the plan's changes one at a time. A single failure never aborts the batch — a bad
 * row is collected and the rest still land — mirroring the receivables importer's contract.
 */
export async function runMasterImport(
  changes: ImportChange[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const failed: ImportInvalid[] = [];
  let ok = 0;
  for (let i = 0; i < changes.length; i++) {
    try {
      await changes[i].save();
      ok++;
    } catch (e) {
      failed.push({ label: changes[i].label, reason: (e as Error).message });
    }
    onProgress?.(i + 1, changes.length);
  }
  return { ok, failed };
}
