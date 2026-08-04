-- Receivables Collection Plan — ConnectWave (TallyCopilot) store for the monthly payment plan.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--    NOT the Orange One identity project. The repo's `supabase/migrations/` + `supabase db push`
--    target the identity project — run this one in the ConnectWave project's SQL editor (or via a
--    psql/service connection to ConnectWave). Deploy this BEFORE the frontend that reads it goes live.
--
-- WHAT IT IS:
--   The Salesperson Collection Report answers "what did we collect?" but nothing recorded "what did
--   we INTEND to collect?". Planning lived in a monthly Excel that never came back into the app, so
--   plan-vs-actual could never sit next to the figure it is measured against. This stores one
--   editable plan per (month, customer): a planned amount, an optional expected date and a note.
--
-- WHY IT LIVES HERE:
--   Same reasoning as receivables_followups.sql — all receivables user-content shares one store.
--   ConnectWave is anon/sessionless from the browser, so `auth.uid()` is null here and an RLS
--   ownership model cannot work. Instead:
--     - READS come from the ConnectWave ANON client directly (team-wide, like every ext_* table).
--     - WRITES go only through the `collection-plan-write` Edge Function on the IDENTITY project,
--       which verifies the caller's login there and then writes here with the ConnectWave SERVICE
--       key (bypassing RLS). Authorization is enforced in that function.
--
-- HOW IT DIFFERS FROM receivables_followups (read this before copying either file again):
--   - A follow-up is a PERSONAL utterance ("here is what I discussed"), so nobody else may rewrite
--     it and edits are own-or-admin. A plan is a SHARED CELL: the unique constraint below means
--     there is only ever one row per (month, customer), so "your row" is decided by whoever typed
--     first. A manager revising a number they are accountable for is the intended workflow, so
--     UPSERT is open to any signed-in user and only DELETE stays author-or-admin. `revision` +
--     updated_by make a silent overwrite detectable rather than prevented.
--   - `created_by` here is NULLABLE. receivables_followups declares
--     `not null default auth.uid() references auth.users on delete set null`, which cannot both
--     hold — the FK action would violate the NOT NULL. Not copied. A de-provisioned author must
--     not take the team's shared plan row with them.
--
-- Purely ADDITIVE. Reversal:
--   drop table if exists public.receivables_collection_plan cascade;
--   drop function if exists public.receivables_collection_plan_stamp();

create table if not exists public.receivables_collection_plan (
  id                  uuid primary key default gen_random_uuid(),

  -- Trend month LABEL, 'MMM-YY' (e.g. 'Aug-26') — the vocabulary the Month dropdown,
  -- dashboard.trend and lib/months.ts already speak. Month + 2-digit year is globally unique
  -- across financial years, so no fiscal_year column is needed.
  --
  -- ⚠️ NEVER `order by month`: it is a LABEL, so it sorts alphabetically — 'Apr-26' before
  -- 'Aug-26' only by accident, and 'Feb-27' before 'Mar-26' outright. Order by entity_name (see
  -- the API's paging loop, which needs a unique key anyway) and sequence months in TypeScript
  -- via monthLabelToOrdinal(). The check constraint pins the vocabulary so a stray 'August 2026'
  -- or '2026-08' can never enter and then render silently as "unplanned" forever.
  month               text not null
                        check (month ~ '^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-[0-9]{2}$'),

  -- Entity: the consolidated customer name (Tally ledger name), or a customer group name.
  -- Keyed by NAME, never the dashboard's Customer.id — that is a pipeline surrogate ("C0001")
  -- which renumbers on every reprocess and becomes a Tally GUID under the Live source, so
  -- anything keyed off it would silently detach. Same rule as receivables_followups.
  --
  -- entity_type allows a future group-level plan, but v1's UI writes ONLY 'customer': a plan at
  -- one level alone is what keeps every roll-up subtotal in the report unambiguous. If a group
  -- level is ever added, the rule must be that a group plan SUPERSEDES its members' plans rather
  -- than adding to them — the two would be the same money planned twice.
  entity_type         text not null default 'customer' check (entity_type in ('customer','group')),
  entity_name         text not null,

  -- The plan itself. Rupees, non-negative — planning to collect a negative sum is not a thing.
  -- Clearing a plan is a DELETE, not a zero: the app never writes 0, so "no row" is the single
  -- unambiguous representation of "unplanned".
  planned_amount      numeric not null default 0 check (planned_amount >= 0),
  expected_date       date,                        -- null = "sometime this month"
  note                text,

  -- Context frozen when the plan was last saved, so it still reads true months later after the
  -- pipeline has moved the numbers (same intent as the follow-up log's *_at_entry columns).
  salesperson         text,
  due_at_plan         numeric,
  outstanding_at_plan numeric,

  -- Authorship. Plain uuid + email: there is no auth.users on this project, so no FK and no
  -- default auth.uid() — the Edge Function stamps both from the caller's identity JWT, and the
  -- email is the display/audit fallback that needs no cross-project lookup.
  created_by          uuid,
  created_by_email    text,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_by_email    text,
  updated_at          timestamptz not null default now(),
  -- Bumped on every revision. A shared cell is last-write-wins, so this is what makes "someone
  -- changed my number" detectable in the UI without an append-only history table.
  revision            integer not null default 1,

  -- THE UPSERT KEY. Lets the client save a cell without knowing whether a row exists, and makes
  -- two people editing the same cell converge on one row instead of racing to create two.
  --   .upsert(row, { onConflict: "month,entity_type,entity_name" })
  constraint receivables_collection_plan_uniq unique (month, entity_type, entity_name)
);

comment on table public.receivables_collection_plan is
  'Salesperson Collection Report planning layer: one shared, revisable row per (month, customer name) carrying the planned collection amount, an optional expected date and a note. Month is the hub''s ''MMM-YY'' trend label (never ordered in SQL). Keyed by NAME, not the pipeline''s Customer.id. Any signed-in user may create or revise; delete is author-or-admin.';

create index if not exists receivables_collection_plan_month_idx
  on public.receivables_collection_plan (month);
create index if not exists receivables_collection_plan_entity_idx
  on public.receivables_collection_plan (entity_type, entity_name);

-- Revision stamp. Cannot read auth.uid() — ConnectWave is sessionless; the Edge Function supplies
-- created_by / updated_by in the payload. What this guarantees is that a revision can never
-- rewrite the row's origin, and that `revision` always moves forward even if a caller omits it.
create or replace function public.receivables_collection_plan_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    -- Immutable across revisions: who created the row, and when.
    new.created_by       := old.created_by;
    new.created_by_email := old.created_by_email;
    new.created_at       := old.created_at;
    new.revision         := old.revision + 1;
  else
    new.created_at := now();
    new.revision   := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_receivables_collection_plan_stamp on public.receivables_collection_plan;
create trigger trg_receivables_collection_plan_stamp
  before insert or update on public.receivables_collection_plan
  for each row execute function public.receivables_collection_plan_stamp();

alter table public.receivables_collection_plan enable row level security;

-- READ: any anon/authenticated caller sees every row (team-wide — a manager must see the whole
-- month's plan, and a colleague on leave must not hide theirs). The per-salesperson narrowing
-- happens in the UI at the useCollectionPlan scope chokepoint, consistent with the rest of the
-- Hub; that is UI-level scoping only, see frontend .../lib/scope.tsx.
grant select on public.receivables_collection_plan to anon, authenticated;

drop policy if exists receivables_collection_plan_select on public.receivables_collection_plan;
create policy receivables_collection_plan_select
  on public.receivables_collection_plan for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policy on purpose: every write goes through the service-key Edge
-- Function, which bypasses RLS. With RLS enabled and no write policy, anon/authenticated cannot
-- write directly.
