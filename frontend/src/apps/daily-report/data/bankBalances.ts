/**
 * Daily Report — the hand-typed bank balances.
 *
 * ⚠ THE READS RETURN A SPARSE MAP, ON PURPOSE.
 *   A day nobody typed has no key. Nothing in this file, and nothing that
 *   consumes it, may substitute 0 for a missing day: "not recorded" and
 *   "recorded as zero" are different answers, and defaulting one to the other
 *   makes the report understate cash without anybody being able to see it.
 *   `balanceKey` + `Map.get` returning `undefined` IS the "not recorded" signal.
 *
 * Writes go through the SECURITY DEFINER routines, never at the table. The
 * table has no write policy at all, so the future-date guard and the edit-level
 * check cannot be bypassed by a client that talks to PostgREST directly.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import type { BalanceStatus, BankBalance } from "../types";

/** The key a sparse balance map is read by. */
export const balanceKey = (accountId: string, iso: string): string => `${accountId}|${iso}`;

export type BalanceMap = Map<string, BankBalance>;

export async function fetchBankBalances(fromIso: string, toIso: string): Promise<BalanceMap> {
  const { data, error } = await supabase
    .from("daily_report_bank_balances")
    .select("bank_account_id, balance_date, closing_balance_lacs, lc_bc_utilised_lacs, updated_at")
    .gte("balance_date", fromIso)
    .lte("balance_date", toIso);
  if (error) throw new Error(error.message);

  const map: BalanceMap = new Map();
  for (const r of data ?? []) {
    const row: BankBalance = {
      bankAccountId: r.bank_account_id,
      date: r.balance_date,
      closingLacs: Number(r.closing_balance_lacs),
      lcBcUtilisedLacs: r.lc_bc_utilised_lacs == null ? null : Number(r.lc_bc_utilised_lacs),
      updatedAt: r.updated_at,
    };
    map.set(balanceKey(row.bankAccountId, row.date), row);
  }
  return map;
}

export function useBankBalances(fromIso: string, toIso: string) {
  return useQuery({
    queryKey: ["daily-report", "bank-balances", fromIso, toIso],
    queryFn: () => fetchBankBalances(fromIso, toIso),
    enabled: Boolean(fromIso && toIso),
  });
}

/**
 * The most recent EARLIER day that actually holds a figure, per account.
 *
 * ⚠ NOT "yesterday". With Sundays deliberately blank, a literal previous day
 *   reads empty every Monday — exactly when the clerk most wants something to
 *   check this evening's number against. So the form shows the last real entry
 *   and LABELS IT WITH ITS DATE, because "Prev 3.22" without a date is a
 *   comparison against an unknown day.
 */
export async function fetchPreviousBalances(beforeIso: string): Promise<Map<string, BankBalance>> {
  // 60 days back is generous cover for a long gap without pulling the whole
  // history every time the form opens. An account quiet for longer simply shows
  // no previous figure, which is honest.
  const from = new Date(beforeIso);
  from.setDate(from.getDate() - 60);
  const fromIso = from.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("daily_report_bank_balances")
    .select("bank_account_id, balance_date, closing_balance_lacs, lc_bc_utilised_lacs, updated_at")
    .gte("balance_date", fromIso)
    .lt("balance_date", beforeIso)
    .order("balance_date", { ascending: false });
  if (error) throw new Error(error.message);

  const latest = new Map<string, BankBalance>();
  for (const r of data ?? []) {
    // Rows arrive newest first, so the first sighting of an account is its most
    // recent entry and later ones are skipped.
    if (latest.has(r.bank_account_id)) continue;
    latest.set(r.bank_account_id, {
      bankAccountId: r.bank_account_id,
      date: r.balance_date,
      closingLacs: Number(r.closing_balance_lacs),
      lcBcUtilisedLacs: r.lc_bc_utilised_lacs == null ? null : Number(r.lc_bc_utilised_lacs),
      updatedAt: r.updated_at,
    });
  }
  return latest;
}

export function usePreviousBalances(beforeIso: string) {
  return useQuery({
    queryKey: ["daily-report", "bank-balances-prev", beforeIso],
    queryFn: () => fetchPreviousBalances(beforeIso),
    enabled: Boolean(beforeIso),
  });
}

/**
 * How complete a day is. The nav badge, the report's Bank tile and the entry
 * screen all read THIS — three consumers, one routine, so they cannot drift.
 */
export async function fetchBalanceStatus(iso: string): Promise<BalanceStatus> {
  const { data, error } = await supabase.rpc("daily_report_balance_status", { p_date: iso });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as {
    date?: string; expected?: number; entered?: number;
    missing?: { id: string; short_label: string; location: string; company: string }[];
  };
  return {
    date: d.date ?? iso,
    expected: d.expected ?? 0,
    entered: d.entered ?? 0,
    missing: (d.missing ?? []).map((m) => ({
      id: m.id, shortLabel: m.short_label, location: m.location, company: m.company,
    })),
  };
}

export function useBalanceStatus(iso: string) {
  return useQuery({
    queryKey: ["daily-report", "balance-status", iso],
    queryFn: () => fetchBalanceStatus(iso),
    enabled: Boolean(iso),
  });
}

/** One row of a save: a null closing CLEARS the day rather than storing a zero. */
export interface BalanceWrite {
  bankAccountId: string;
  date: string;
  closingLacs: number | null;
  lcBcUtilisedLacs: number | null;
}

/**
 * Save an evening in ONE transaction — the whole evening lands or none of it
 * does. A half-saved evening is worse than an unsaved one: the completeness
 * chip would read "9 of 11" and nobody could tell which two failed.
 */
export async function saveBalances(rows: BalanceWrite[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase.rpc("set_bank_daily_balances", {
    p_rows: rows.map((r) => ({
      bank_account_id: r.bankAccountId,
      balance_date: r.date,
      closing_balance_lacs: r.closingLacs,
      lc_bc_utilised_lacs: r.lcBcUtilisedLacs,
    })),
  });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}
