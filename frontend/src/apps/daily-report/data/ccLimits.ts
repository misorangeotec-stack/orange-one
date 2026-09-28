/**
 * Daily Report — the credit-limit block, typed per company per day.
 *
 * The same two rules as the balances beside it (see `bankBalances.ts`):
 *
 * ⚠ THE READS RETURN A SPARSE MAP, ON PURPOSE.
 *   A company-day nobody typed has no key, and nothing here or downstream may
 *   substitute zeros for it. `ccLimitKey` + `Map.get` returning `undefined` IS
 *   the "not recorded" signal.
 *
 * Writes go through the SECURITY DEFINER routines only — `saveEvening` in
 * `bankBalances.ts` sends the closing balances and these blocks in one
 * transaction. The table has no write policy.
 *
 * ⚠ KEYED ON THE ENTITY ALIAS, NEVER company_id. Two Tally books share an alias.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { addDays } from "../lib/format";
import type { CcLimit } from "../types";

/** The key a sparse credit-limit map is read by. */
export const ccLimitKey = (entityAlias: string, bank: string, iso: string): string =>
  `${entityAlias}|${bank}|${iso}`;

/** A company's facility at one bank, without the day — what carry-forward is keyed on. */
export const facilityKey = (entityAlias: string, bank: string): string => `${entityAlias}|${bank}`;

export type CcLimitMap = Map<string, CcLimit>;

// One string literal on one line — supabase-js parses it at the type level (see
// the note in bankAccounts.ts).
const SELECT = "entity_alias,bank,balance_date,cc_limit_lacs,lc_bc_limit_lacs,lc_bc_utilised_lacs,hold_by_bank_lacs,updated_at";

/** Supabase hands numerics back as strings on some paths; null stays null. */
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function fetchCcLimits(fromIso: string, toIso: string): Promise<CcLimitMap> {
  const { data, error } = await supabase
    .from("daily_report_cc_limits")
    .select(SELECT)
    .gte("balance_date", fromIso)
    .lte("balance_date", toIso);
  if (error) throw new Error(error.message);

  const map: CcLimitMap = new Map();
  for (const r of data ?? []) {
    const row: CcLimit = {
      entityAlias: r.entity_alias,
      bank: r.bank,
      date: r.balance_date,
      ccLimitLacs: num(r.cc_limit_lacs),
      lcBcLimitLacs: num(r.lc_bc_limit_lacs),
      lcBcUtilisedLacs: num(r.lc_bc_utilised_lacs),
      holdByBankLacs: num(r.hold_by_bank_lacs),
      updatedAt: r.updated_at,
    };
    map.set(ccLimitKey(row.entityAlias, row.bank, row.date), row);
  }
  return map;
}

export function useCcLimits(fromIso: string, toIso: string) {
  return useQuery({
    queryKey: ["daily-report", "cc-limits", fromIso, toIso],
    queryFn: () => fetchCcLimits(fromIso, toIso),
    enabled: Boolean(fromIso && toIso),
  });
}

/** A sanctioned limit as last recorded, and the day it was recorded on. */
export interface CarriedFigure {
  lacs: number;
  date: string;
}

export interface CarriedLimits {
  ccLimit: CarriedFigure | null;
  lcBcLimit: CarriedFigure | null;
}

/**
 * The two SANCTIONED limits as last recorded before `beforeIso`, per company and bank.
 *
 * The form pre-fills its boxes from this so an ordinary evening is two numbers,
 * not four. ⚠ IT IS A PRE-FILL, NEVER A COPY. Nothing is written until somebody
 * saves that company's block, so a day nobody typed stays unrecorded — copying
 * rows forward in the database would erase exactly that distinction.
 *
 * Each limit is carried separately, from the latest day that holds IT: a day
 * whose block recorded only utilised and held figures does not blank a limit
 * recorded the day before.
 *
 * Only the limits carry. Utilised and held-by-bank are the day's own figures;
 * carrying them would put yesterday's drawings on today's report as fact.
 */
export async function fetchCarriedLimits(beforeIso: string): Promise<Map<string, CarriedLimits>> {
  // Half a year back. A sanctioned limit changes rarely, but a company whose
  // block has not been typed for six months should be re-checked, not assumed.
  const { data, error } = await supabase
    .from("daily_report_cc_limits")
    .select(SELECT)
    .gte("balance_date", addDays(beforeIso, -180))
    .lt("balance_date", beforeIso)
    .or("cc_limit_lacs.not.is.null,lc_bc_limit_lacs.not.is.null")
    .order("balance_date", { ascending: false });
  if (error) throw new Error(error.message);

  const out = new Map<string, CarriedLimits>();
  for (const r of data ?? []) {
    // Newest first, so the first sighting of each figure is its latest.
    const key = facilityKey(r.entity_alias, r.bank);
    const hit = out.get(key) ?? { ccLimit: null, lcBcLimit: null };
    const cc = num(r.cc_limit_lacs);
    const lcBc = num(r.lc_bc_limit_lacs);
    if (!hit.ccLimit && cc != null) hit.ccLimit = { lacs: cc, date: r.balance_date };
    if (!hit.lcBcLimit && lcBc != null) hit.lcBcLimit = { lacs: lcBc, date: r.balance_date };
    out.set(key, hit);
  }
  return out;
}

export function useCarriedLimits(beforeIso: string) {
  return useQuery({
    queryKey: ["daily-report", "cc-limits-carried", beforeIso],
    queryFn: () => fetchCarriedLimits(beforeIso),
    enabled: Boolean(beforeIso),
  });
}

/** One company block in a save. All four figures null CLEARS the day's row. */
export interface CcLimitWrite {
  entityAlias: string;
  bank: string;
  date: string;
  ccLimitLacs: number | null;
  lcBcLimitLacs: number | null;
  lcBcUtilisedLacs: number | null;
  holdByBankLacs: number | null;
}
