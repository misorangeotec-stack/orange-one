/**
 * Daily Report — the bank account master.
 *
 * Reads go straight at the table under RLS (the account list is readable by any
 * signed-in user; it is the BALANCES that are gated). Writes go at the table
 * too, under the `daily_report_bank_accounts_write` policy, which admits an
 * admin or a user holding 'daily-report' at edit level — the same test the
 * screen uses to decide whether to show the Add button, so the UI mirrors the
 * policy rather than inventing a second rule.
 *
 * ⚠ THE ENTITY IS JOINED IN THE BROWSER, NOT BY POSTGREST.
 *   `mst_companies` is one of the central-master tables that never made it into
 *   the generated `database.types.ts`, so an embedded `mst_companies(alias)`
 *   select does not typecheck and `.from("mst_companies")` is not callable.
 *   Rather than widen the escape hatch, this reuses the existing
 *   `fetchMasterCompanies()` — five rows, already the portal's one reader for
 *   that table — and joins on companyId here.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { fetchMasterCompanies } from "@/core/platform/liveMasters";
import type { BankAccount, BankAccountType, ReportLocation } from "../types";

// ⚠ ONE STRING LITERAL, ON ONE LINE, AND THAT IS NOT A STYLE CHOICE.
//   supabase-js parses this string at the TYPE level to derive the row shape.
//   Split it as "a," + "b" and TypeScript infers plain `string` rather than the
//   literal, the parser has nothing to read, and EVERY column comes back as
//   GenericStringError — while the request itself still works at runtime, so the
//   only symptom is that the result is untyped.
const SELECT = "id,company_id,location,bank_name,branch,account_no,ifsc,account_type,short_label,tally_ledger_guid,tally_ledger_name,cc_limit_lacs,lc_bc_limit_lacs,hold_by_bank_lacs,sort_order,active,notes";

/** Supabase hands numerics back as strings on some paths; normalise once here. */
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function fetchBankAccounts(): Promise<BankAccount[]> {
  const [{ data, error }, companies] = await Promise.all([
    supabase
      .from("daily_report_bank_accounts")
      .select(SELECT)
      .order("sort_order")
      .order("short_label"),
    fetchMasterCompanies(),
  ]);
  if (error) throw new Error(error.message);

  const aliasOf = new Map(companies.map((c) => [c.id, c.alias ?? c.name]));

  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.short_label,
    companyId: r.company_id,
    entityAlias: aliasOf.get(r.company_id) ?? "",
    location: r.location as ReportLocation,
    bank: r.bank_name,
    branch: r.branch,
    accountNo: r.account_no,
    ifsc: r.ifsc,
    accountType: r.account_type as BankAccountType,
    tallyLedgerGuid: r.tally_ledger_guid,
    tallyLedgerName: r.tally_ledger_name,
    ccLimitLacs: num(r.cc_limit_lacs),
    lcBcLimitLacs: num(r.lc_bc_limit_lacs),
    holdByBankLacs: num(r.hold_by_bank_lacs),
    sortOrder: r.sort_order,
    active: r.active,
    notes: r.notes,
  }));
}

export function useBankAccounts() {
  return useQuery({ queryKey: ["daily-report", "bank-accounts"], queryFn: fetchBankAccounts });
}

/** The companies a bank account may belong to, for the master's entity picker. */
export async function fetchCompanyOptions(): Promise<{ id: string; alias: string; location: string | null }[]> {
  const rows = await fetchMasterCompanies();
  return rows
    .filter((c) => c.active)
    .map((c) => ({ id: c.id, alias: c.alias ?? c.name, location: c.location }));
}

export function useCompanyOptions() {
  return useQuery({ queryKey: ["daily-report", "companies"], queryFn: fetchCompanyOptions });
}

/**
 * The form hands everything back as strings (MasterCrud's value bag is
 * Record<string,string>), so this is where "" becomes NULL.
 *
 * ⚠ "" IS UNSET, AND UNSET IS NOT ZERO. An account with no CC limit must store
 *   NULL, not 0 — the facility block reads a 0 limit as a facility the bank has
 *   WITHDRAWN, which is a different and alarming statement. Same for every
 *   optional text field.
 */
const text = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** A typed money field: blank stays blank, and a non-number is rejected loudly. */
const money = (v: string | undefined, label: string): number | null => {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number, or left blank.`);
  return n;
};

export async function upsertBankAccount(
  id: string | null,
  v: Record<string, string>,
  active: boolean,
): Promise<void> {
  const label = text(v.name);
  if (!label) throw new Error("Column head is required.");
  if (!v.companyId) throw new Error("Entity is required.");
  if (!text(v.bank)) throw new Error("Bank is required.");
  if (!["Surat", "Noida", "Delhi"].includes(v.location)) {
    throw new Error("Location must be Surat, Noida or Delhi.");
  }

  const fields = {
    company_id: v.companyId,
    location: v.location,
    bank_name: (v.bank ?? "").trim(),
    branch: text(v.branch),
    account_no: text(v.accountNo),
    ifsc: text(v.ifsc),
    account_type: v.accountType || "current",
    short_label: label,
    tally_ledger_guid: text(v.tallyLedgerGuid),
    tally_ledger_name: text(v.tallyLedgerName),
    cc_limit_lacs: money(v.ccLimitLacs, "CC limit"),
    lc_bc_limit_lacs: money(v.lcBcLimitLacs, "LC / BC limit"),
    hold_by_bank_lacs: money(v.holdByBankLacs, "Held by bank"),
    sort_order: Number(v.sortOrder) || 0,
    notes: text(v.notes),
    active,
  };

  if (id) {
    const { error } = await supabase.from("daily_report_bank_accounts").update(fields).eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("daily_report_bank_accounts").insert(fields);
    if (error) throw new Error(error.message);
  }
}

/**
 * Deactivate, never delete — the balances already typed against this account
 * reference it, and the database refuses the delete anyway (ON DELETE RESTRICT).
 * A deactivated account drops off the evening form and out of the grid's columns
 * from today onward, but keeps its column on any past date it holds a figure for.
 */
export async function setBankAccountActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("daily_report_bank_accounts").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}
