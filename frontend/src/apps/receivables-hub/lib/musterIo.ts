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
  saveTag, saveGroup, saveOtherPayment, saveRedMark, clearRedMark, saveDispute, clearDispute, disputeKey,
  type TagRow, type GroupRow, type SnapRow, type OtherPaymentRow, type RedMarkRow, type DisputeRow,
} from "./musterApi";
import { saveCompanyMap } from "./musterApi";
import type { CompanyMapRow } from "./companyMap";
import { formatDateDMY } from "./utils";

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

/**
 * A value that must come from a managed master (RC-15): salesperson, collection team.
 *
 * Returns the reason to report, or null when the cell is fine. Blank is always fine — it means
 * unset, and 37 ledgers genuinely have no salesperson.
 *
 * ⚠ THE SET HOLDS EVERY NAME THE MASTER KNOWS, SWITCHED OFF OR NOT. Inactive means "not offered for
 *   new mappings", not "invalid": re-importing a sheet that still carries a retired salesperson's
 *   own customers must not turn every one of those rows into an error.
 *
 * ⚠ AND THE COMPARISON IS EXACT AND CASE-SENSITIVE, like every other comparison of these values.
 *   Accepting "others" for "OTHERS" here would put a value into the data that the scope filter then
 *   matches against nothing — the precise bug the master exists to prevent.
 */
function offMaster(value: string | null, known: Set<string>, what: string): string | null {
  if (value === null) return null;
  if (known.has(value)) return null;
  return `${what} "${value}" is not in the ${what.toLowerCase()} master. ` +
         `Add it under Settings → Masters first, or correct the spelling — it is matched exactly.`;
}

const MASTER_NOTE = (what: string) =>
  `${what} must already exist in the ${what.toLowerCase()} master (Settings → Masters). ` +
  `An unrecognised name is reported and skipped, never written. Spelling is matched exactly.`;

// ── Salesperson & Category (ext_ledger_tags, key = Ledger ID) ─────────────────
const K_LEDGER = "Ledger ID";
export function tagIo(snapByGuid: Map<string, SnapRow>, knownSalespersons: Set<string>): MasterIo<TagRow> {
  const name = (r: TagRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
  return {
    fileName: "Master_Salesperson_Category",
    sheetName: "Salesperson & Category",
    title: "Salesperson & Category master",
    notes: [DO_NOT_EDIT_KEY, UPDATE_ONLY_NOTE, "Editable columns: Salesperson, Category, Checked.", MASTER_NOTE("Salesperson")],
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
        const bad = offMaster(salesperson, knownSalespersons, "Salesperson");
        if (bad) { plan.invalid.push({ label, reason: bad }); continue; }
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
export function groupIo(snapByGuid: Map<string, SnapRow>, knownTeams: Set<string>): MasterIo<GroupRow> {
  const name = (r: GroupRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
  return {
    fileName: "Master_Customer_Groups",
    sheetName: "Customer Groups",
    title: "Customer Groups master",
    notes: [DO_NOT_EDIT_KEY, UPDATE_ONLY_NOTE, "Editable columns: Group, Collection Team, Checked. Leave Group blank to keep the customer's own name.", MASTER_NOTE("Collection team")],
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
        // Group is a per-customer label, not a vocabulary, so only the team is checked.
        const badTeam = offMaster(team, knownTeams, "Collection team");
        if (badTeam) { plan.invalid.push({ label, reason: badTeam }); continue; }
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
//
// ⚠ THE IMPORT CAN CLEAR A CASE, BUT IT CAN NEVER REOPEN, ADD OR REMOVE ONE (RC-12).
//   Adding and removing were already withheld — a spreadsheet must not be able to flag or unflag
//   customers wholesale — and clearing-by-import is the safe middle ground: it settles cases that
//   are already on the list.
//
//   Reopening is withheld for a reason worth stating. `readBool` reads a blank cell as "No", and
//   an export taken this morning says "No" against every row somebody cleared this afternoon. If
//   "No" meant reopen, importing a stale sheet would silently undo their work — the failure would
//   look exactly like success. So a No against a Cleared row is REPORTED and skipped, and reopening
//   is done on screen, one case at a time, by somebody who can see what they are reopening.
export function redMarkIo(snapByGuid: Map<string, SnapRow>, knownSalespersons: Set<string>): MasterIo<RedMarkRow> {
  const name = (r: RedMarkRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
  const company = (r: RedMarkRow) => snapByGuid.get(r.ledger_id)?.company ?? r.company ?? "";
  const location = (r: RedMarkRow) => snapByGuid.get(r.ledger_id)?.location ?? r.location ?? "";
  return {
    fileName: "Master_Red_Mark",
    sheetName: "Red Mark",
    title: "Red Mark master",
    notes: [
      DO_NOT_EDIT_KEY,
      UPDATE_ONLY_NOTE,
      "Editable columns: Salesperson, Reason, Checked, and Cleared (with Clear note).",
      "Import cannot add or remove a Red Mark, and cannot REOPEN a cleared case — only edit details " +
      "and clear settled ones. Reopen on screen instead: a sheet exported before somebody cleared a " +
      "case still says \"No\" against it, and reopening from that would silently undo their work.",
      "To clear a case: set Cleared to Yes and write a Clear note saying how it was settled. A row " +
      "set to Yes with no note is reported and skipped — a cleared case with money still owed " +
      "against it is unreadable a month later without one.",
      "Cleared on / Cleared by are stamped by the app and ignored on import.",
      MASTER_NOTE("Salesperson"),
    ],
    exportColumns: [
      { header: K_LEDGER, width: 34, value: (r) => r.ledger_id },
      { header: "Customer", width: 30, value: name },
      { header: "Company", width: 16, value: company },
      { header: "Location", width: 12, value: location },
      { header: "Salesperson", width: 22, value: (r) => r.salesperson ?? "" },
      { header: "Reason", width: 30, value: (r) => r.reason ?? "" },
      { header: "Checked", width: 10, value: (r) => yesNo(r.checked) },
      { header: "Cleared", width: 10, value: (r) => yesNo(r.cleared) },
      { header: "Clear note", width: 40, value: (r) => r.clear_note ?? "" },
      { header: "Cleared on", width: 14, value: (r) => (r.cleared_at ? formatDateDMY(r.cleared_at.slice(0, 10)) : "") },
      { header: "Cleared by", width: 24, value: (r) => r.cleared_by ?? "" },
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
        const badSp = offMaster(salesperson, knownSalespersons, "Salesperson");
        if (badSp) { plan.invalid.push({ label, reason: badSp }); continue; }

        // ⚠ "column absent" IS NOT "cell left empty", and the difference decides whether a sheet can
        //   un-clear a case. parseXlsxRows reads with defval:"" so every column in the FILE appears
        //   on every record — so a missing key means the sheet predates this column, and the case
        //   status is simply not part of that import.
        const hasClearedCol = Object.prototype.hasOwnProperty.call(rec, "Cleared");
        const wantCleared = hasClearedCol ? readBool(rec["Cleared"]) : cur.cleared;
        const clearNote = cell(rec["Clear note"]);

        let doClear = false;
        if (wantCleared && !cur.cleared) {
          if (!clearNote) {
            plan.invalid.push({
              label,
              reason: "Set to Cleared with no Clear note — say how the case was settled.",
            });
            continue;
          }
          doClear = true;
        } else if (!wantCleared && cur.cleared) {
          plan.invalid.push({
            label,
            reason: "This case was cleared in the app since this sheet was exported. Import never " +
                    "reopens a case — reopen it on screen if that is what you meant.",
          });
          continue;
        } else if (wantCleared && cur.cleared && clearNote && clearNote !== (cur.clear_note ?? null)) {
          plan.invalid.push({
            label,
            reason: "The Clear note of an already-cleared case can only be changed on screen.",
          });
          continue;
        }

        const dSp = salesperson !== (cur.salesperson ?? null);
        const dRs = reason !== (cur.reason ?? null);
        const dChk = checked !== cur.checked;
        if (!dSp && !dRs && !dChk && !doClear) { plan.unchanged++; continue; }
        plan.changes.push({
          key,
          label: name(cur) || label,
          fields: changedFields([
            ["Salesperson", dSp], ["Reason", dRs], ["Checked", dChk], ["Cleared", doClear],
          ]),
          // Two writes, because they are two different doors: the metadata goes through
          // update_redmark (admin / Settings full access) and the clear through clear_redmark, which
          // has its own rule. Details first, so a refused clear does not silently drop an edit that
          // was allowed.
          save: async () => {
            if (dSp || dRs || dChk) {
              await saveRedMark({ ledger_id: key, salesperson, reason, checked });
            }
            if (doClear) await clearRedMark(key, clearNote as string);
          },
        });
      }
      return plan;
    },
  };
}

// ── Disputed bills (ext_dispute, key = Dispute ID) — RC-13 ───────────────────
// The same contract as Red Mark, decision for decision: import edits the typed details and can CLEAR
// a settled dispute (with a note), but never adds, removes or REOPENS one — a sheet exported before
// somebody cleared a dispute still says "No" against it, and reopening from that would silently undo
// their work. A dispute is put on the list from the screen, where the bill is picked from Tally's
// open bills rather than typed.
const K_DISPUTE = "Dispute ID";

export function disputeIo(snapByGuid: Map<string, SnapRow>, openKeys: Set<string>): MasterIo<DisputeRow> {
  const name = (r: DisputeRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
  const company = (r: DisputeRow) => snapByGuid.get(r.ledger_id)?.company ?? "";
  const location = (r: DisputeRow) => snapByGuid.get(r.ledger_id)?.location ?? "";
  const billState = (r: DisputeRow) => (openKeys.has(disputeKey(r.ledger_id, r.bill_ref)) ? "Open" : "No longer open");
  return {
    fileName: "Master_Disputed_Bills",
    sheetName: "Disputed Bills",
    title: "Disputed bills master",
    notes: [
      DO_NOT_EDIT_KEY,
      UPDATE_ONLY_NOTE,
      "Editable columns: Remark, Item, Checked, and Cleared (with Clear note).",
      "Import cannot add or remove a disputed bill, and cannot REOPEN a cleared one — add bills on " +
      "screen (they are picked from Tally's open bills) and reopen there too: a sheet exported before " +
      "somebody cleared a dispute still says \"No\" against it, and reopening from that would silently " +
      "undo their work.",
      "To clear a dispute: set Cleared to Yes and write a Clear note saying how it was settled. A row " +
      "set to Yes with no note is reported and skipped.",
      "Bill says whether Tally still lists the bill as open. \"No longer open\" usually means it was " +
      "settled — those disputes are waiting to be cleared. Amounts are on the Disputed Bills report, " +
      "where they match every other screen.",
      "Customer, Company, Location, Bill reference, Bill, Cleared on and Cleared by are ignored on import.",
    ],
    exportColumns: [
      { header: K_DISPUTE, width: 11, value: (r) => r.id },
      { header: "Customer", width: 30, value: name },
      { header: "Company", width: 16, value: company },
      { header: "Location", width: 12, value: location },
      { header: "Bill reference", width: 20, value: (r) => r.bill_ref },
      { header: "Bill", width: 15, value: billState },
      { header: "Remark", width: 50, value: (r) => r.remarks ?? "" },
      { header: "Item", width: 30, value: (r) => r.item_description ?? "" },
      { header: "Checked", width: 10, value: (r) => yesNo(r.checked) },
      { header: "Cleared", width: 10, value: (r) => yesNo(r.cleared) },
      { header: "Clear note", width: 40, value: (r) => r.clear_note ?? "" },
      { header: "Cleared on", width: 14, value: (r) => (r.cleared_at ? formatDateDMY(r.cleared_at.slice(0, 10)) : "") },
      { header: "Cleared by", width: 24, value: (r) => r.cleared_by ?? "" },
    ],
    buildPlan(records, existing) {
      const byId = new Map(existing.map((r) => [String(r.id), r]));
      const plan: ImportPlan = { changes: [], unchanged: 0, unmatched: [], invalid: [] };
      for (const rec of records) {
        const key = cell(rec[K_DISPUTE]);
        const label = `${String(rec["Customer"] ?? "")} · ${String(rec["Bill reference"] ?? key ?? "(unknown)")}`;
        if (!key) { plan.unmatched.push(label); continue; }
        const cur = byId.get(key);
        if (!cur) { plan.unmatched.push(label); continue; }

        const remarks = cell(rec["Remark"]);
        const item = cell(rec["Item"]);
        const checked = readBool(rec["Checked"]);

        // "Column absent" is not "cell left empty" — see redMarkIo.
        const hasClearedCol = Object.prototype.hasOwnProperty.call(rec, "Cleared");
        const wantCleared = hasClearedCol ? readBool(rec["Cleared"]) : cur.cleared;
        const clearNote = cell(rec["Clear note"]);

        let doClear = false;
        if (wantCleared && !cur.cleared) {
          if (!clearNote) {
            plan.invalid.push({ label, reason: "Set to Cleared with no Clear note — say how the dispute was settled." });
            continue;
          }
          doClear = true;
        } else if (!wantCleared && cur.cleared) {
          plan.invalid.push({
            label,
            reason: "This dispute was cleared in the app since this sheet was exported. Import never " +
                    "reopens a dispute — reopen it on screen if that is what you meant.",
          });
          continue;
        } else if (wantCleared && cur.cleared && clearNote && clearNote !== (cur.clear_note ?? null)) {
          plan.invalid.push({ label, reason: "The Clear note of an already-cleared dispute can only be changed on screen." });
          continue;
        }

        const dRem = remarks !== (cur.remarks ?? null);
        const dItem = item !== (cur.item_description ?? null);
        const dChk = checked !== cur.checked;
        if (!dRem && !dItem && !dChk && !doClear) { plan.unchanged++; continue; }
        const id = cur.id;
        plan.changes.push({
          key,
          label: `${name(cur) || String(rec["Customer"] ?? "")} · ${cur.bill_ref}`,
          fields: changedFields([["Remark", dRem], ["Item", dItem], ["Checked", dChk], ["Cleared", doClear]]),
          // Details first, through update_dispute (Settings grade), then the clear through its own door —
          // so a refused clear never swallows an edit that was allowed. Only the CHANGED fields are sent.
          save: async () => {
            if (dRem || dItem || dChk) {
              await saveDispute({
                id,
                ...(dRem ? { remarks } : {}),
                ...(dItem ? { item_description: item } : {}),
                ...(dChk ? { checked } : {}),
              });
            }
            if (doClear) await clearDispute(id, clearNote as string);
          },
        });
      }
      return plan;
    },
  };
}
