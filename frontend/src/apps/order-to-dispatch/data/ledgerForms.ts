import { supabase } from "@/core/platform/supabase";

// fms_dispatch_* tables and RPCs are not in the generated Database types; route
// through an untyped alias. The standing FMS convention — see dispatchFetch.ts.
const db = supabase as any;

/**
 * The ledger → form-name master (OD-16).
 *
 * One Tally ledger maps to one FORM NAME: what the customer reads on the Order
 * Desk where our company name used to be. The Desk shows the form and never
 * "O-tec - Surat" again.
 *
 * ⚠ WHY THE LEDGER IS THE KEY AND NOT THE COMPANY, because the company looks like
 *   it would do. Within one customer they are 1:1 — `fms_dispatch_save_customer_org`
 *   refuses a second ticked ledger in the same book. ACROSS customers they are
 *   not: one book holds thousands of ledgers, and two customers buying from the
 *   same book can be on different forms. Keyed on the company, every customer of
 *   O-tec Surat would be forced onto one name, which is the thing this replaces.
 *
 * ⚠ AN UNMAPPED LEDGER IS NOT AN ERROR. The server returns a null form and the
 *   Desk falls back to the company label it showed before, so this can be switched
 *   on before a single form is typed. What it must not do is fall back SILENTLY
 *   where an admin would never look — which is why `CustomerOrgFormsSection` flags
 *   the ticked ledgers still missing one, inside the customer dialog itself.
 */
export interface LedgerForm {
  partyId: string;
  partyName: string;
  companyId: string | null;
  /** Our book, for the reader's orientation only — never shown to a customer. */
  companyLabel: string | null;
  formName: string;
  active: boolean;
}

export const LEDGER_FORMS_QK = ["dispatch", "ledger-forms"] as const;

export async function fetchLedgerForms(): Promise<LedgerForm[]> {
  const { data, error } = await db.rpc("fms_dispatch_ledger_forms_admin");
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    party_id: string; party_name: string; company_id: string | null;
    company_label: string | null; form_name: string; active: boolean;
  }[]).map((r) => ({
    partyId: r.party_id,
    partyName: r.party_name,
    companyId: r.company_id,
    companyLabel: r.company_label,
    formName: r.form_name,
    active: r.active,
  }));
}

export async function saveLedgerForm(input: {
  partyId: string;
  formName: string;
  active?: boolean;
}): Promise<string> {
  const { data, error } = await db.rpc("fms_dispatch_save_ledger_form", {
    p: {
      party_id: input.partyId,
      form_name: input.formName.trim(),
      active: input.active ?? true,
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function deleteLedgerForm(partyId: string): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_delete_ledger_form", { p_party: partyId });
  if (error) throw new Error(error.message);
}

/**
 * Ledger id → form name, for the screens that only need to look one up.
 *
 * ⚠ INACTIVE ROWS ARE LEFT OUT, matching `fms_dispatch_customer_org_companies`,
 *   which filters on `f.active`. A parked form must not show in the customer
 *   dialog as though the customer were about to order on it.
 */
export const formNameByParty = (rows: readonly LedgerForm[]): Map<string, string> =>
  new Map(rows.filter((r) => r.active).map((r) => [r.partyId, r.formName]));
