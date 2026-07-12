import { supabase } from "@/core/platform/supabase";
import type { Followup, FollowupEntityType, FollowupInput, FollowupOutcome, FollowupPatch } from "./followupTypes";

/**
 * Read/write layer for the customer follow-up log.
 *
 * IMPORTANT — which Supabase client this uses, and why:
 * the Hub's own two clients (receivablesSupabase / connectwaveSupabase) are anon clients
 * created with `persistSession: false`, so they carry NO user JWT — `auth.uid()` is null
 * through them and an RLS-protected write is impossible. Follow-ups therefore live on the
 * IDENTITY project (which owns the session) and go through the core `supabase` client, the
 * same one `musterApi.ts` already imports. RLS does the rest: insert-as-yourself,
 * update/delete your own rows (or any row if you're an admin).
 */

interface FollowupRow {
  id: string;
  entity_type: string;
  entity_name: string;
  remarks: string;
  outcome: string;
  next_followup_date: string | null;
  promised_amount: number | null;
  promised_date: string | null;
  outstanding_at_entry: number | null;
  overdue_at_entry: number | null;
  salesperson: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function toFollowup(r: FollowupRow): Followup {
  return {
    id: r.id,
    entityType: r.entity_type as FollowupEntityType,
    entityName: r.entity_name,
    remarks: r.remarks,
    outcome: r.outcome as FollowupOutcome,
    nextFollowupDate: r.next_followup_date,
    promisedAmount: r.promised_amount,
    promisedDate: r.promised_date,
    outstandingAtEntry: r.outstanding_at_entry,
    overdueAtEntry: r.overdue_at_entry,
    salesperson: r.salesperson,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Every follow-up, newest first. The whole table is fetched in one go: this is a
 * human-typed log (a few hundred rows a year), so paging it would cost more than it saves,
 * and having it all client-side is what lets the worklist/history views derive everything
 * without a round-trip per customer.
 */
export async function fetchFollowups(): Promise<Followup[]> {
  const { data, error } = await supabase
    .from("receivables_followups")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as FollowupRow[]).map(toFollowup);
}

/** Log a new follow-up. RLS requires created_by = auth.uid(), so the caller passes their id. */
export async function insertFollowup(input: FollowupInput & { createdBy: string }): Promise<string> {
  const { data, error } = await supabase
    .from("receivables_followups")
    .insert({
      entity_type: input.entityType,
      entity_name: input.entityName,
      remarks: input.remarks,
      outcome: input.outcome,
      next_followup_date: input.nextFollowupDate,
      promised_amount: input.promisedAmount,
      promised_date: input.promisedDate,
      outstanding_at_entry: input.outstandingAtEntry,
      overdue_at_entry: input.overdueAtEntry,
      salesperson: input.salesperson,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/**
 * Correct an existing entry. Only the conversation fields are editable — the entity and the
 * frozen at-entry context are history and must not be rewritten. RLS allows own rows + admin.
 */
export async function updateFollowup(id: string, patch: FollowupPatch): Promise<void> {
  const { error } = await supabase
    .from("receivables_followups")
    .update({
      remarks: patch.remarks,
      outcome: patch.outcome,
      next_followup_date: patch.nextFollowupDate,
      promised_amount: patch.promisedAmount,
      promised_date: patch.promisedDate,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteFollowup(id: string): Promise<void> {
  const { error } = await supabase.from("receivables_followups").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
