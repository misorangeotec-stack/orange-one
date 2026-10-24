/**
 * fundFlow.ts — Fund Flow reads and writes against the Hub database.
 *
 * Tables: fund_flow_month, fund_flow_line (read through v_fund_flow_line, which adds the rupee
 * figures), fund_flow_log. Migration: supabase/migrations/20270217120000_fund_flow.sql.
 *
 * WRITES ONLY THROUGH THE ff_* RPCs. The tables carry no write policy, so the month window, the
 * CFO-only approval and the stale-write check cannot be bypassed by a client talking to PostgREST
 * directly. The RPCs re-check everything; the page only hides the buttons a user cannot use.
 *
 * Reads the main Hub client, cast loosely as the Expense CFO lib does: these tables are not in the
 * generated database.types.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabase as typed } from "@/core/platform/supabase";
import type { DutyMode, FfBlock, FfCompany, FfHead } from "./fundFlowCalc";

/**
 * DEV ONLY — try Fund Flow on localhost before its migration reaches the Hub database.
 * Start the dev server with VITE_FUND_FLOW_LOCAL_URL=http://localhost:54399 and these reads and
 * RPCs go to a local Postgres running the same migration, carrying the signed-in user's token so
 * the database sees who is calling. Unset (always, in Vercel) this is the ordinary Hub client.
 */
const LOCAL_URL = import.meta.env.VITE_FUND_FLOW_LOCAL_URL;
const supabase: SupabaseClient = LOCAL_URL
  ? createClient(LOCAL_URL, "local", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "ff-local" },
      global: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const { data } = await typed.auth.getSession();
          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${data.session?.access_token ?? ""}`);
          return fetch(input, { ...init, headers });
        },
      },
    })
  : (typed as unknown as SupabaseClient);

/** director: reads everything and gives the final approval after the CFO; edits nothing. */
export type FfRole = "cfo" | "director" | "editor" | "viewer" | "none";

export interface FfMonth {
  month: string;
  std_rate: number;
  opening_override: number | null;
  opening_reason: string | null;
  status: "open" | "closed";
  reopened: boolean;
  /** Set when the CFO approves the month's plan; from then on every change waits for the CFO. */
  plan_approved_at: string | null;
  /** Set once the rate is entered; from then the month's std rate cannot change. Null = provisional. */
  rate_fixed_at: string | null;
  /** A Director's final approval, given after the CFO approved the plan. */
  final_approved_at: string | null;
  final_approved_by: string | null;
  final_note: string | null;
  closed_at: string | null;
  updated_at: string;
}

/** A row of v_fund_flow_line: the stored line plus its rupee figures. */
export interface FfLine {
  id: string;
  month: string;
  head: FfHead;
  block: FfBlock | null;
  company: FfCompany | null;
  location: string | null;
  line_type: string | null;
  party: string | null;
  customer_for: string | null;
  ref_no: string | null;
  description: string | null;
  item: string | null;
  doc_date: string | null;
  currency: "USD" | "INR";
  amt_budget: number | null;
  amt_approved: number | null;
  amt_paid: number | null;
  paid_before: number;
  inv_usd: number | null;
  duty_pct: number | null;
  freight_inr: number | null;
  duty_mode: DutyMode | null;
  duty_typed_inr: number | null;
  extra_inr: number | null;
  not_this_month: boolean;
  paid_in_full: boolean;
  loan_os: number | null;
  terms: string | null;
  status_note: string | null;
  remarks: string | null;
  sales_person: string | null;
  machine: string | null;
  expected_date: string | null;
  follow_up: string | null;
  total_due: number | null;
  tally_company_guid: string | null;
  tally_ledger: string | null;
  tally_ledger_guid: string | null;
  tally_due_inr: number | null;
  tally_due_as_at: string | null;
  tally_paid_inr: number | null;
  tally_paid_as_at: string | null;
  paid_source: "manual" | "tally" | "linked";
  actual_inr: number | null;
  link_target_inr: number | null;
  link_received_inr: number | null;
  link_due_inr: number | null;
  link_as_at: string | null;
  override_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  /** The approved figure when the plan was approved; null = added after the plan. */
  plan_unit: number | null;
  delete_requested_at: string | null;
  /** The CFO did not approve this line: kept, counted 0, listed apart; can be approved later. */
  not_approved_at: string | null;
  carried_from_line_id: string | null;
  carry_frozen: boolean;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
  // from the view
  budget_inr: number;
  approved_inr: number;
  paid_inr: number;
  balance_inr: number;
  achieved: number | null;
  changed_after_approval: boolean;
  /** Plan approved and this line not yet approved: an addition waiting for the CFO. */
  awaiting_approval: boolean;
  added_after_plan: boolean;
  delete_requested: boolean;
  not_approved: boolean;
  plan_locked: boolean;
}

export interface FfLogRow {
  id: number; month: string; line_id: string | null; action: string;
  old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null;
  reason: string | null; by_user: string | null; at: string;
  /** Who made the change, by name, stored with it. */
  by_name: string | null;
}

export interface BankPosition {
  as_of: string;
  total_inr: number;
  accounts: { label: string; location: string | null; date: string | null; balance_inr: number | null; stale: boolean; missing: boolean }[];
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

function toLine(r: Record<string, unknown>): FfLine {
  const out = { ...r } as unknown as FfLine;
  for (const k of ["amt_budget", "amt_approved", "amt_paid", "inv_usd", "duty_pct", "freight_inr", "duty_typed_inr",
    "extra_inr", "loan_os", "total_due", "tally_due_inr", "tally_paid_inr", "actual_inr", "link_target_inr",
    "link_received_inr", "link_due_inr", "achieved", "plan_unit"] as const) {
    (out as unknown as Record<string, number | null>)[k] = num(r[k]);
  }
  out.paid_before = Number(r.paid_before ?? 0);
  out.budget_inr = Number(r.budget_inr ?? 0);
  out.approved_inr = Number(r.approved_inr ?? 0);
  out.paid_inr = Number(r.paid_inr ?? 0);
  out.balance_inr = Number(r.balance_inr ?? 0);
  return out;
}

/* ------------------------------------------------------------------ reads */

export async function fetchRole(uid: string): Promise<FfRole> {
  const { data, error } = await supabase.rpc("ff_role", { p_uid: uid });
  if (error) throw new Error(error.message);
  return (data as FfRole) ?? "none";
}

export async function fetchMonths(): Promise<FfMonth[]> {
  const { data, error } = await supabase.from("fund_flow_month").select("*").order("month", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((m: Record<string, unknown>) => ({ ...(m as unknown as FfMonth), std_rate: Number(m.std_rate), opening_override: num(m.opening_override) }));
}

export async function fetchLines(month: string): Promise<FfLine[]> {
  const { data, error } = await supabase.from("v_fund_flow_line").select("*").eq("month", month)
    .order("head").order("sort_order").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => toLine(r));
}

/**
 * Lines that WERE in the approved plan and have since been removed — for "Changes after plan".
 * Read from the table, not the view: the view shows live lines only.
 */
export async function fetchRemoved(month: string): Promise<FfLine[]> {
  const { data, error } = await supabase.from("fund_flow_line").select("*").eq("month", month).not("deleted_at", "is", null)
    .not("plan_unit", "is", null).order("deleted_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => toLine(r));
}

export async function fetchLog(month: string): Promise<FfLogRow[]> {
  const { data, error } = await supabase.from("fund_flow_log").select("*").eq("month", month).order("at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as FfLogRow[];
}

export async function fetchBankPosition(asOf: string): Promise<BankPosition> {
  const { data, error } = await supabase.rpc("ff_bank_position", { p_as_of: asOf });
  if (error) throw new Error(error.message);
  return data as BankPosition;
}

export async function housekeep(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("ff_housekeep");
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export const FF_KEY = ["fund-flow"] as const;

export function useFfMonths(enabled: boolean) {
  return useQuery({ queryKey: [...FF_KEY, "months"], queryFn: fetchMonths, enabled });
}
export function useFfLines(month: string | null) {
  return useQuery({ queryKey: [...FF_KEY, "lines", month], queryFn: () => fetchLines(month as string), enabled: Boolean(month) });
}
export function useFfRemoved(month: string | null, enabled: boolean) {
  return useQuery({ queryKey: [...FF_KEY, "removed", month], queryFn: () => fetchRemoved(month as string), enabled: Boolean(month) && enabled });
}
export function useFfLog(month: string | null, enabled: boolean) {
  return useQuery({ queryKey: [...FF_KEY, "log", month], queryFn: () => fetchLog(month as string), enabled: Boolean(month) && enabled });
}
export function useBankPosition(asOf: string | null) {
  return useQuery({ queryKey: [...FF_KEY, "bank", asOf], queryFn: () => fetchBankPosition(asOf as string), enabled: Boolean(asOf), staleTime: 5 * 60_000 });
}

/* ----------------------------------------------------------------- writes */

/** The fields a save may carry — the RPC drops anything else. */
export type FfLinePatch = Partial<Omit<FfLine,
  "id" | "month" | "budget_inr" | "approved_inr" | "paid_inr" | "balance_inr" | "achieved" | "changed_after_approval"
  | "approved_by" | "approved_at" | "carried_from_line_id" | "carry_frozen" | "updated_at" | "updated_by" | "paid_before" | "amt_approved">>;

export interface FfSaveItem extends FfLinePatch {
  id?: string | null;
  expected_updated_at?: string;
  delete?: boolean;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const saveLines = (month: string, items: FfSaveItem[]) =>
  rpc<{ saved: number; ids: string[] }>("ff_save_lines", { p_month: month, p_lines: items });

/**
 * CFO decisions, one per line: approve as budgeted ({id}), approve an amount ({id, approved}),
 * turn a change down ({id, reject}), or approve a requested removal ({id, approve_delete}).
 */
/** unapprove: the CFO takes an approval back — the line becomes Not approved (kept, counts 0). */
export interface FfDecision { id: string; approved?: number | null; reject?: boolean; approve_delete?: boolean; unapprove?: boolean }
export const approveLines = (month: string, items: FfDecision[]) =>
  rpc<number>("ff_approve", { p_month: month, p_items: items });

/** CFO: approve the month's plan. After this every addition, edit and delete waits for the CFO. */
export const approvePlan = (month: string) => rpc<number>("ff_approve_plan", { p_month: month });

/** A Director: the final approval of the month's budget, after the CFO. */
export const finalApprove = (month: string, note: string | null) =>
  rpc<void>("ff_final_approve", { p_month: month, p_note: note });

/** stdRate null leaves the rate alone; a rate given fixes it for the month (once only). */
export const setMonth = (month: string, stdRate: number | null, opening: number | null, reason: string | null) =>
  rpc<void>("ff_set_month", { p_month: month, p_std_rate: stdRate, p_opening: opening, p_reason: reason });

export const openMonth = (month: string) => rpc<{ created: boolean }>("ff_open_month", { p_month: month });
export const closeMonth = (month: string, reason: string | null) => rpc<{ closed: boolean }>("ff_close_month", { p_month: month, p_reason: reason });
export const reopenMonth = (month: string, reason: string) => rpc<void>("ff_reopen_month", { p_month: month, p_reason: reason });
