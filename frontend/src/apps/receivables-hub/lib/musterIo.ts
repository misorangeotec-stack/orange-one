/**
 * musterIo.ts — the round-trip contract for the Settings → Masters export/import.
 *
 * Export columns and the import plan builder for each master live side-by-side here so their
 * headers can NEVER drift apart: the string that Export writes into the header row is the exact
 * string Import reads back out. Change one and you change both.
 *
 * Import is UPDATE-EXISTING-ONLY (a decision, not a limitation of the schema): every row is matched
 * to an existing master row by its identity key (Tally GUID / company GUID / payment id). A key we
 * don't recognise is reported as `unmatched` and skipped — never inserted. Only rows whose editable
 * cells actually differ from the live value become writes, so a 1,800-row export re-imported after a
 * handful of edits fires a handful of edge-function calls, not 1,800.
 *
 * Values are exported in STORAGE form, not display form, wherever the two differ — otherwise the
 * re-import fails the muster-write validation. See `Other Payments` (raw yyyy-mm-dd date, raw
 * AGST REF / ON ACCOUNT allocation codes).
 */
import type { ExportColumn } from "@/shared/lib/exportXlsx";
import { readBool } from "@/shared/lib/importXlsx";
import {
  saveTag, saveGroup, saveOtherPayment, saveRedMark,
  type TagRow, type GroupRow, type SnapRow, type OtherPaymentRow, type RedMarkRow,
} from "./musterApi";
import { saveCompanyMap } from "./musterApi";
import type { CompanyMapRow } from "./companyMap";

// ── Shared types ─────────────────────────────────────────────────────────────
export interface ImportChange {
  key: string;
  label: string;           // human name for the preview (customer / company)
  fields: string;          // which fields change, e.g. "Salesperson, Checked"
  save: () => Promise<void>;
}

export interface ImportPlan {
  changes: ImportChange[];
  unchanged: number;
  unmatched: string[];                        // labels of rows whose key matched nothing
  invalid: { label: string; reason: string }[];
}

export interface MasterIo<Row> {
  fileName: string;
  sheetName: string;
  title: string;
  notes: string[];
  exportColumns: ExportColumn<Row>[];
  buildPlan: (records: Record<string, unknown>[], existing: Row[]) => ImportPlan;
}

export interface ImportResult {
  ok: number;
  failed: { label: string; error: string }[];
}

/** Write each change in turn; one failure never aborts the batch (it's collected and reported). */
export async function runImport(
  changes: ImportChange[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  let ok = 0;
  const failed: { label: string; error: string }[] = [];
  for (let i = 0; i < changes.length; i++) {
    try {
      await changes[i].save();
      ok++;
    } catch (e) {
      failed.push({ label: changes[i].label, error: (e as Error).message });
    }
    onProgress(i + 1, changes.length);
  }
  return { ok, failed };
}

// ── Cell helpers ─────────────────────────────────────────────────────────────
/** Normalise a text cell to the same shape the save wrappers store: trimmed, or null when empty. */
const cell = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
/** "Yes"/"No" for export. */
const yesNo = (b: boolean): string => (b ? "Yes" : "No");
/** The columns that changed, as a short label list. */
const changedFields = (pairs: [string, boolean][]): string =>
  pairs.filter(([, changed]) => changed).map(([name]) => name).join(", ");

const DO_NOT_EDIT_KEY = "The first column is the identity key used to match rows on import — do not edit or delete it.";
const UPDATE_ONLY_NOTE = "Import updates existing rows only. Rows whose key is blank or unrecognised are skipped, not added.";

// ── Salesperson & Category (ext_ledger_tags, key = Ledger ID) ─────────────────
const K_LEDGER = "Ledger ID";
export function tagIo(snapByGuid: Map<string, SnapRow>): MasterIo<TagRow> {
  const name = (r: TagRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
  return {
    fileName: "Master_Salesperson_Category",
    sheetName: "Salesperson & Category",
    title: "Salesperson & Category master",
    notes: [DO_NOT_EDIT_KEY, UPDATE_ONLY_NOTE, "Editable columns: Salesperson, Category, Checked."],
    exportColumns: [
      { header: K_LEDGER, width: 34, value: (r) => r.ledger_id },
      { header: "Customer", width: 34, value: name },
      { header: "Company", width: 16, value: (r) => snapByGuid.get(r.ledger_id)?.company ?? "" },
      { header: "Location", width: 12, value: (r) => snapByGuid.get(r.ledger_id)?.location ?? "" },
      { header: "Salesperson", width: 22, value: (r) => r.salesperson ?? "" },
      { header: "Category", width: 10, value: (r) => r.category ?? "" },
      { header: "Outstanding", width: 16, value: (r) => Number(snapByGuid.get(r.ledger_id)?.outstanding ?? 0) },
      { header: "Checked", width: 10, value: (r) => yesNo(r.checked) },
    ],
    buildPlan(records, existing) {
      const byKey = new Map(existing.map((r) => [r.ledger_id, r]));
      const plan: ImportPlan = { changes: [], unchanged: 0, unmatched: [], invalid: [] };
      for (const rec of records) {
        const key = cell(rec[K_LEDGER]);
        const label = String(rec["Customer"] ?? key ?? "(unknown)");
        if (!key) { plan.unmatched.push(label); continue; }
        const cur = byKey.get(key);
        if (!cur) { plan.unmatched.push(label); continue; }
        const salesperson = cell(rec["Salesperson"]);
        const category = cell(rec["Category"]);
        const checked = readBool(rec["Checked"]);
        const dSp = salesperson !== (cur.salesperson ?? null);
        const dCat = category !== (cur.category ?? null);
        const dChk = checked !== cur.checked;
        if (!dSp && !dCat && !dChk) { plan.unchanged++; continue; }
        plan.changes.push({
          key, label: name(cur) || label,
          fields: changedFields([["Salesperson", dSp], ["Category", dCat], ["Checked", dChk]]),
          save: () => saveTag({ ledger_id: key, salesperson, category, checked }),
        });
      }
      return plan;
    },
  };
}

// ── Customer Groups (ext_ledger_group, key = Ledger ID) ───────────────────────
export function groupIo(snapByGuid: Map<string, SnapRow>): MasterIo<GroupRow> {
  const name = (r: GroupRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
  return {
    fileName: "Master_Customer_Groups",
    sheetName: "Customer Groups",
    title: "Customer Groups master",
    notes: [DO_NOT_EDIT_KEY, UPDATE_ONLY_NOTE, "Editable columns: Group, Collection Team, Checked. Leave Group blank to keep the customer's own name."],
    exportColumns: [
      { header: K_LEDGER, width: 34, value: (r) => r.ledger_id },
      { header: "Customer", width: 34, value: name },
      { header: "Company", width: 16, value: (r) => snapByGuid.get(r.ledger_id)?.company ?? "" },
      { header: "Location", width: 12, value: (r) => snapByGuid.get(r.ledger_id)?.location ?? "" },
      { header: "Group", width: 26, value: (r) => r.group_name ?? "" },
      { header: "Collection Team", width: 20, value: (r) => r.collection_team ?? "" },
      { header: "Outstanding", width: 16, value: (r) => Number(snapByGuid.get(r.ledger_id)?.outstanding ?? 0) },
      { header: "Checked", width: 10, value: (r) => yesNo(r.checked) },
    ],
    buildPlan(records, existing) {
      const byKey = new Map(existing.map((r) => [r.ledger_id, r]));
      const plan: ImportPlan = { changes: [], unchanged: 0, unmatched: [], invalid: [] };
      for (const rec of records) {
        const key = cell(rec[K_LEDGER]);
        const label = String(rec["Customer"] ?? key ?? "(unknown)");
        if (!key) { plan.unmatched.push(label); continue; }
        const cur = byKey.get(key);
        if (!cur) { plan.unmatched.push(label); continue; }
        // group_name is NOT NULL: a blank cell means "keep the customer's own name" (server falls back
        // when it receives null), so compare the effective stored value against the current one.
        const group = cell(rec["Group"]);
        const team = cell(rec["Collection Team"]);
        const checked = readBool(rec["Checked"]);
        // A blank Group in the file is not a change (the server keeps the existing NOT NULL name).
        const dGrp = group !== null && group !== (cur.group_name ?? null);
        const dTeam = team !== (cur.collection_team ?? null);
        const dChk = checked !== cur.checked;
        if (!dGrp && !dTeam && !dChk) { plan.unchanged++; continue; }
        plan.changes.push({
          key, label: name(cur) || label,
          fields: changedFields([["Group", dGrp], ["Collection Team", dTeam], ["Checked", dChk]]),
          save: () => saveGroup({ ledger_id: key, group_name: group, collection_team: team, checked }),
        });
      }
      return plan;
    },
  };
}

// ── Companies & Locations (ext_company_map, key = Company GUID) ───────────────
const K_COMPANY_GUID = "Company GUID";
export function companyIo(custCounts: Map<string, number>): MasterIo<CompanyMapRow> {
  return {
    fileName: "Master_Companies_Locations",
    sheetName: "Companies & Locations",
    title: "Companies & Locations master",
    notes: [DO_NOT_EDIT_KEY, UPDATE_ONLY_NOTE, "Editable columns: Company (required), Location, Checked."],
    exportColumns: [
      { header: K_COMPANY_GUID, width: 34, value: (r) => r.company_guid },
      { header: "Tally Company", width: 40, value: (r) => r.tally_company ?? "" },
      { header: "Company", width: 16, value: (r) => r.company ?? "" },
      { header: "Location", width: 12, value: (r) => r.location ?? "" },
      { header: "Customers", width: 12, value: (r) => custCounts.get(r.company_guid) ?? 0 },
      { header: "Checked", width: 10, value: (r) => yesNo(r.checked) },
    ],
    buildPlan(records, existing) {
      const byKey = new Map(existing.map((r) => [r.company_guid, r]));
      const plan: ImportPlan = { changes: [], unchanged: 0, unmatched: [], invalid: [] };
      for (const rec of records) {
        const key = cell(rec[K_COMPANY_GUID]);
        const label = String(rec["Company"] ?? rec["Tally Company"] ?? key ?? "(unknown)");
        if (!key) { plan.unmatched.push(label); continue; }
        const cur = byKey.get(key);
        if (!cur) { plan.unmatched.push(label); continue; }
        const company = cell(rec["Company"]);
        const location = cell(rec["Location"]);
        const checked = readBool(rec["Checked"]);
        if (!company) { plan.invalid.push({ label, reason: "Company is required" }); continue; }
        const dCo = company !== (cur.company ?? null);
        const dLoc = location !== (cur.location ?? null);
        const dChk = checked !== cur.checked;
        if (!dCo && !dLoc && !dChk) { plan.unchanged++; continue; }
        plan.changes.push({
          key, label: cur.company || label,
          fields: changedFields([["Company", dCo], ["Location", dLoc], ["Checked", dChk]]),
          save: () => saveCompanyMap({
            company_guid: key, tally_company: cur.tally_company, company, location, checked,
          }),
        });
      }
      return plan;
    },
  };
}

// ── Other Payments (ext_other_payments, key = Payment ID) ─────────────────────
const K_PAYMENT_ID = "Payment ID";
const ALLOC_LABELS: Record<string, string> = { "AGST REF": "AGST REF", "AGAINST INVOICE": "AGST REF", "ON ACCOUNT": "ON ACCOUNT" };

/** yyyy-mm-dd or dd-mm-yyyy text → yyyy-mm-dd; "" → null; anything else → error. */
function normDate(v: unknown): { ok: true; val: string | null } | { ok: false } {
  const s = String(v ?? "").trim();
  if (!s) return { ok: true, val: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: true, val: s };
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return { ok: true, val: `${m[3]}-${m[2]}-${m[1]}` };
  return { ok: false };
}

export function otherPaymentIo(snapByGuid: Map<string, SnapRow>): MasterIo<OtherPaymentRow> {
  const name = (r: OtherPaymentRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
  return {
    fileName: "Master_Other_Payments",
    sheetName: "Other Payments",
    title: "Other Payments master",
    notes: [
      DO_NOT_EDIT_KEY, UPDATE_ONLY_NOTE,
      "Editable columns: Date (yyyy-mm-dd), Amount (> 0), Allocation (AGST REF or ON ACCOUNT), Ref Invoice, Payment Ref, Remarks, Checked.",
      "Ledger ID and Customer are reference only — a payment's customer cannot be reassigned by import.",
    ],
    exportColumns: [
      { header: K_PAYMENT_ID, width: 12, value: (r) => r.id },
      { header: "Ledger ID", width: 34, value: (r) => r.ledger_id },
      { header: "Customer", width: 30, value: name },
      { header: "Company", width: 16, value: (r) => snapByGuid.get(r.ledger_id)?.company ?? "" },
      { header: "Location", width: 12, value: (r) => snapByGuid.get(r.ledger_id)?.location ?? "" },
      { header: "Date", width: 12, value: (r) => r.payment_date ?? "" },
      { header: "Amount", width: 14, value: (r) => Number(r.amount ?? 0) },
      { header: "Allocation", width: 14, value: (r) => r.allocation_type ?? "" },
      { header: "Ref Invoice", width: 20, value: (r) => r.ref_invoice ?? "" },
      { header: "Payment Ref", width: 18, value: (r) => r.payment_ref ?? "" },
      { header: "Remarks", width: 28, value: (r) => r.remarks ?? "" },
      { header: "Checked", width: 10, value: (r) => yesNo(r.checked) },
    ],
    buildPlan(records, existing) {
      const byKey = new Map(existing.map((r) => [String(r.id), r]));
      const plan: ImportPlan = { changes: [], unchanged: 0, unmatched: [], invalid: [] };
      for (const rec of records) {
        const key = cell(rec[K_PAYMENT_ID]);
        const label = String(rec["Customer"] ?? key ?? "(unknown)");
        if (!key) { plan.unmatched.push(label); continue; }
        const cur = byKey.get(key);
        if (!cur) { plan.unmatched.push(label); continue; }
        const amount = Number(rec["Amount"]);
        if (!Number.isFinite(amount) || amount <= 0) { plan.invalid.push({ label, reason: "Amount must be a number greater than 0" }); continue; }
        const alloc = ALLOC_LABELS[String(rec["Allocation"] ?? "").trim().toUpperCase()];
        if (!alloc) { plan.invalid.push({ label, reason: "Allocation must be AGST REF or ON ACCOUNT" }); continue; }
        const d = normDate(rec["Date"]);
        if (!d.ok) { plan.invalid.push({ label, reason: "Date must be yyyy-mm-dd" }); continue; }
        const refInvoice = cell(rec["Ref Invoice"]);
        const paymentRef = cell(rec["Payment Ref"]);
        const remarks = cell(rec["Remarks"]);
        const checked = readBool(rec["Checked"]);
        const dDate = (d.val ?? null) !== (cur.payment_date ?? null);
        const dAmt = amount !== Number(cur.amount ?? 0);
        const dAlloc = alloc !== (cur.allocation_type ?? null);
        const dRef = refInvoice !== (cur.ref_invoice ?? null);
        const dPref = paymentRef !== (cur.payment_ref ?? null);
        const dRem = remarks !== (cur.remarks ?? null);
        const dChk = checked !== cur.checked;
        if (!dDate && !dAmt && !dAlloc && !dRef && !dPref && !dRem && !dChk) { plan.unchanged++; continue; }
        plan.changes.push({
          key, label: name(cur) || label,
          fields: changedFields([
            ["Date", dDate], ["Amount", dAmt], ["Allocation", dAlloc],
            ["Ref Invoice", dRef], ["Payment Ref", dPref], ["Remarks", dRem], ["Checked", dChk],
          ]),
          save: () => saveOtherPayment({
            id: cur.id, ledger_id: cur.ledger_id, tally_name: cur.tally_name,
            payment_date: d.val, amount, allocation_type: alloc,
            ref_invoice: refInvoice, payment_ref: paymentRef, remarks, checked,
          }),
        });
      }
      return plan;
    },
  };
}

// ── Red Mark (ext_redmark, key = Ledger ID) ───────────────────────────────────
export function redMarkIo(snapByGuid: Map<string, SnapRow>): MasterIo<RedMarkRow> {
  const name = (r: RedMarkRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
  const company = (r: RedMarkRow) => snapByGuid.get(r.ledger_id)?.company ?? r.company ?? "";
  const location = (r: RedMarkRow) => snapByGuid.get(r.ledger_id)?.location ?? r.location ?? "";
  return {
    fileName: "Master_Red_Mark",
    sheetName: "Red Mark",
    title: "Red Mark master",
    notes: [DO_NOT_EDIT_KEY, UPDATE_ONLY_NOTE, "Editable columns: Salesperson, Reason, Checked. Import cannot add or remove a Red Mark — only edit its details."],
    exportColumns: [
      { header: K_LEDGER, width: 34, value: (r) => r.ledger_id },
      { header: "Customer", width: 30, value: name },
      { header: "Company", width: 16, value: company },
      { header: "Location", width: 12, value: location },
      { header: "Salesperson", width: 22, value: (r) => r.salesperson ?? "" },
      { header: "Reason", width: 30, value: (r) => r.reason ?? "" },
      { header: "Checked", width: 10, value: (r) => yesNo(r.checked) },
    ],
    buildPlan(records, existing) {
      const byKey = new Map(existing.map((r) => [r.ledger_id, r]));
      const plan: ImportPlan = { changes: [], unchanged: 0, unmatched: [], invalid: [] };
      for (const rec of records) {
        const key = cell(rec[K_LEDGER]);
        const label = String(rec["Customer"] ?? key ?? "(unknown)");
        if (!key) { plan.unmatched.push(label); continue; }
        const cur = byKey.get(key);
        if (!cur) { plan.unmatched.push(label); continue; }
        const salesperson = cell(rec["Salesperson"]);
        const reason = cell(rec["Reason"]);
        const checked = readBool(rec["Checked"]);
        const dSp = salesperson !== (cur.salesperson ?? null);
        const dRs = reason !== (cur.reason ?? null);
        const dChk = checked !== cur.checked;
        if (!dSp && !dRs && !dChk) { plan.unchanged++; continue; }
        plan.changes.push({
          key, label: name(cur) || label,
          fields: changedFields([["Salesperson", dSp], ["Reason", dRs], ["Checked", dChk]]),
          save: () => saveRedMark({ ledger_id: key, salesperson, reason, checked }),
        });
      }
      return plan;
    },
  };
}
