-- Receivables Follow-ups — ConnectWave (TallyCopilot) copy of the payment-chase log.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--    NOT the Orange One identity project. The repo's `supabase/migrations/` + `supabase db push`
--    target the identity project — run this one in the ConnectWave project's SQL editor (or via a
--    psql/service connection to ConnectWave). Deploy this BEFORE the frontend that reads it goes live.
--
-- WHY IT LIVES HERE (2026-07-20):
--   The follow-up feature is being moved to store on ConnectWave only. ConnectWave is anon/sessionless
--   from the browser, so `auth.uid()` is null here and the identity project's RLS model (created_by =
--   auth.uid()) cannot work. Instead:
--     - READS come from the ConnectWave ANON client directly (team-wide, like every other ext_* table).
--     - WRITES go only through the `followups-write` Edge Function on the IDENTITY project, which
--       verifies the caller's login there and then writes here with the ConnectWave SERVICE key
--       (bypassing RLS). Authorization (insert = any user; edit/delete = own-or-admin) is enforced in
--       that function, exactly like `muster-write` does for the ext_* muster tables.
--
-- DIFFERENCES from the identity table (supabase/migrations/20260711120000_add_receivables_followups.sql):
--   - `created_by` is a plain uuid — NO `default auth.uid()`, NO FK to auth.users (there is no
--     auth.users on this project). The Edge Function stamps it from the caller's identity JWT.
--   - new `created_by_email` text — display/audit fallback that needs no cross-project lookup.
--   - a local `set_updated_at()` is defined here (the identity project's copy is not in this repo).
--   - RLS grants anon/authenticated SELECT only; there is no anon write policy — the service key is
--     the sole write path.
--   - no tenant_id: follow-ups are keyed by customer/group NAME and are org-wide (single tenant today).
--
-- Purely ADDITIVE. Reversal: drop table if exists public.receivables_followups cascade;

-- updated_at maintenance (local copy; identity's public.set_updated_at() is not in this repo).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.receivables_followups (
  id                   uuid primary key default gen_random_uuid(),

  -- Entity: the customer (Tally ledger name) or the customer group this chase is about.
  entity_type          text not null check (entity_type in ('customer','group')),
  entity_name          text not null,

  -- The conversation.
  remarks              text not null,
  outcome              text not null check (outcome in (
                         'connected','no_response','promised_payment',
                         'payment_disputed','partial_received','escalated','other')),
  next_followup_date   date,                      -- null = no further follow-up scheduled

  -- Promise to pay (optional; typically captured when outcome = 'promised_payment').
  promised_amount      numeric,
  promised_date        date,

  -- Context frozen at the time of the call.
  outstanding_at_entry numeric,
  overdue_at_entry     numeric,
  salesperson          text,

  -- Author: the identity-project user id (uuid) the Edge Function read from the caller's JWT.
  -- No FK (auth.users is not on this project); created_by_email is a display/audit fallback.
  created_by           uuid,
  created_by_email     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.receivables_followups is
  'ConnectWave copy of the Outstanding Dashboard payment-chase log. One append-only row per follow-up on a customer or customer group. Written only by the identity-project followups-write Edge Function (service key); read anon. Keyed by NAME; latest row per entity carries the open next_followup_date.';

create index if not exists receivables_followups_entity_idx
  on public.receivables_followups (entity_type, entity_name);
create index if not exists receivables_followups_next_idx
  on public.receivables_followups (next_followup_date);
create index if not exists receivables_followups_created_idx
  on public.receivables_followups (created_at desc);

drop trigger if exists trg_receivables_followups_updated on public.receivables_followups;
create trigger trg_receivables_followups_updated
  before update on public.receivables_followups
  for each row execute function public.set_updated_at();

alter table public.receivables_followups enable row level security;

-- READ: any anon/authenticated caller sees every row (team-wide, same as the identity table's policy).
-- The per-salesperson narrowing happens in the UI, consistent with the rest of the ConnectWave data.
grant select on public.receivables_followups to anon, authenticated;

drop policy if exists receivables_followups_select on public.receivables_followups;
create policy receivables_followups_select
  on public.receivables_followups for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policy on purpose: every write goes through the service-key Edge Function,
-- which bypasses RLS. With RLS enabled and no write policy, anon/authenticated cannot write directly.

-- Reversal:
--   drop table if exists public.receivables_followups cascade;
