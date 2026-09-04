-- OD-13 · P0a — an external (customer) login must not read the whole database.
--
-- WHY
-- ---
-- Every login in this portal has belonged to staff, and the RLS was written on that
-- assumption. Read off pg_policies on 04-09-2026:
--
--     207 SELECT policies in schema `public` whose USING clause is literally `true`
--
-- That is one on almost every table: every purchase order, supplier quotation, vendor
-- price, HR candidate, travel claim, production job card, COA and OCPI deal. OD-13 issues
-- the first logins that do NOT belong to staff, so the assumption stops holding the day
-- those accounts exist.
--
-- Three of the 207 are granted to role `public` rather than `authenticated`, and `anon`
-- holds SELECT on the tables -- so `fms_dispatch_customer_items` (3,179 rows: the entire
-- who-buys-what map for every customer we have) and `fms_dispatch_company_locations` are
-- readable TODAY with no login at all, using the anon key that ships in the frontend
-- bundle. `fms_ocpi_sales_pages` is the third; it is read only from inside the signed-in
-- OCPI app (`apps/ocpi/data/ocpiFetch.ts`), so its `public` grant is incidental and it is
-- swept with the rest.
--
-- WHAT
-- ----
-- One predicate, `public.is_staff(uid)`, built on one new column, `profiles.is_external`.
-- Every SELECT policy that read `true` now reads `is_staff(auth.uid())` instead.
--
--     using (true)  ->  using ((select public.is_staff((select auth.uid()))))
--
-- The `(select …)` wrapping is not decoration: it turns a STABLE call whose arguments are
-- query-constant into an InitPlan, evaluated ONCE per query instead of once per row. This
-- repo already learned that the hard way -- see 20260730130000_speed_up_task_rls.sql, where
-- the inline form cost 472 ms on a 3,691-row table. Applying it inline across 207 tables
-- would have been far worse.
--
-- EQUIVALENCE
-- -----------
-- `is_external` is added with `not null default false`, so EVERY row that exists when this
-- migration runs becomes `false`, and `is_staff()` returns true for every one of them.
-- Nothing any current account can see changes. That is asserted, not assumed: the final
-- block fails the migration if a single existing profile is not staff.
--
-- `is_staff` fails CLOSED -- it requires a profiles row that is explicitly not external,
-- rather than merely the absence of an external one. An auth user with no profile row is
-- an anomaly (the `handle_new_user` trigger writes one on signup) and is treated as
-- non-staff. Edge Functions and the schedulers use the service role, which bypasses RLS
-- entirely and is unaffected.
--
-- Two policies that did not read `true` are narrowed here as well, because both carry
-- order content a customer must not have:
--   * fms_dispatch_activity_select  -- the activity trail quotes our internal credit-hold
--     reason verbatim ("Credit hold on SO-xxxx: …"), and the customer is the raiser, so
--     the existing EXISTS-on-orders arm would let them read it.
--   * fms_dispatch_step_assignees_select -- was `auth.uid() is not null`, i.e. every step
--     assignment in the module. `is_staff` implies not-null, so it replaces it outright.
--
-- SAFETY
-- ------
-- Policies and one new column only. No table is dropped, no column altered, no row
-- touched -- additive per CLAUDE.md. The whole sweep runs in ONE transaction, so no table
-- is ever momentarily unprotected. The pre-state of every policy in `public` and `storage`
-- is captured into `public._rls_baseline_20260904` BEFORE anything changes, and the set
-- actually altered is recorded in `public._od13_p0_touched`; the rollback regenerates from
-- those two, so it restores the stored text rather than a hand-transcription.
-- Rollback: 20261109120001_od13_p0a_close_table_reads_rollback.sql
--
-- The sweep is GENERATED from pg_policies, not from a hand-written table list. A list is
-- exactly how the 204th table gets missed.

begin;

-- ---------------------------------------------------------------------------
-- 1 · The baseline, captured before anything is altered.
-- ---------------------------------------------------------------------------
-- `if not exists` on purpose: re-running this migration must not overwrite the true
-- pre-state with a post-state snapshot.
create table if not exists public._rls_baseline_20260904 as
select schemaname, tablename, policyname, cmd, permissive,
       roles::text as roles, qual, with_check
  from pg_policies
 where schemaname in ('public', 'storage');

alter table public._rls_baseline_20260904 enable row level security;
-- No policies, deliberately: RLS on with none defined denies everyone but the service
-- role. Same handling as _coa_test_backup_20260902 and email_outbox.

create table if not exists public._od13_p0_touched (
  schemaname text not null,
  tablename  text not null,
  policyname text not null,
  phase      text not null,
  touched_at timestamptz not null default now()
);
alter table public._od13_p0_touched enable row level security;

-- ---------------------------------------------------------------------------
-- 2 · Is this login one of ours?
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_external boolean not null default false;

comment on column public.profiles.is_external is
  'True for a login that does NOT belong to staff -- today, a customer placing their own '
  'orders through the Orange Order Desk (OD-13). Drives public.is_staff(), which gates '
  'every table read, every storage bucket and the org-wide people directory. Never set '
  'this by hand: Setup -> Customer Logins owns it.';

-- ⚠ Fails CLOSED. `not exists(... and is_external)` would return true for a uid with no
--   profiles row at all; this form returns false. See the header.
create or replace function public.is_staff(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1
      from public.profiles p
     where p.id = p_uid
       and coalesce(p.is_external, false) = false
  );
$fn$;

comment on function public.is_staff(uuid) is
  'True when this uid is one of our own people. The single predicate behind every RLS '
  'policy that used to read USING (true). Call it wrapped -- (select public.is_staff('
  '(select auth.uid()))) -- so it evaluates once per query, not once per row.';

-- ---------------------------------------------------------------------------
-- 3 · The sweep.
-- ---------------------------------------------------------------------------
do $sweep$
declare
  r record;
  n integer := 0;
begin
  for r in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and cmd = 'SELECT'
       and qual = 'true'
     order by tablename, policyname
  loop
    execute format(
      'alter policy %I on public.%I to authenticated using ((select public.is_staff((select auth.uid()))))',
      r.policyname, r.tablename);

    insert into public._od13_p0_touched (schemaname, tablename, policyname, phase)
    values ('public', r.tablename, r.policyname, 'p0a-sweep');

    n := n + 1;
  end loop;

  raise notice 'OD-13 P0a: % SELECT policies rewritten from USING (true) to is_staff().', n;
end $sweep$;

-- ---------------------------------------------------------------------------
-- 4 · The two that never read `true`, but carry order content.
-- ---------------------------------------------------------------------------
-- The customer IS the raiser on their own orders, so the EXISTS-on-orders arm below is
-- satisfied for them. Without the is_staff() conjunct they could read the order's whole
-- activity trail -- including 'Credit hold on SO-xxxx: <our internal reason>', which is
-- precisely what OD-13's decision Q6 exists to keep from them.
alter policy fms_dispatch_activity_select on public.fms_dispatch_activity
  to authenticated
  using (
    (select public.is_staff((select auth.uid())))
    and (
      entity_type <> 'order'
      or exists (
           select 1 from public.fms_dispatch_orders o
            where o.id = fms_dispatch_activity.entity_id
         )
    )
  );

-- Was `auth.uid() is not null` -- i.e. every step assignment in the module, to anybody
-- signed in. is_staff() implies not-null, so this replaces rather than extends it.
alter policy fms_dispatch_step_assignees_select on public.fms_dispatch_step_assignees
  to authenticated
  using ((select public.is_staff((select auth.uid()))));

insert into public._od13_p0_touched (schemaname, tablename, policyname, phase)
values ('public', 'fms_dispatch_activity',       'fms_dispatch_activity_select',       'p0a-narrow'),
       ('public', 'fms_dispatch_step_assignees', 'fms_dispatch_step_assignees_select', 'p0a-narrow');

-- ---------------------------------------------------------------------------
-- 5 · Prove it, inside the transaction, before anyone can see the result.
-- ---------------------------------------------------------------------------
do $verify$
declare
  n_open   integer;
  n_public integer;
  n_narrow integer;
  n_swept  integer;
begin
  -- (a) Nothing in `public` still reads USING (true) on SELECT.
  select count(*) into n_open
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and qual = 'true';
  if n_open <> 0 then
    raise exception 'OD-13 P0a: % SELECT policies still read USING (true)', n_open;
  end if;

  -- (b) None of the swept policies is still granted to role `public` (i.e. to anon).
  select count(*) into n_public
    from pg_policies p
    join public._od13_p0_touched t
      on t.tablename = p.tablename and t.policyname = p.policyname
   where p.schemaname = 'public' and p.roles::text like '%public%';
  if n_public <> 0 then
    raise exception 'OD-13 P0a: % swept policies are still granted to role public', n_public;
  end if;

  -- (c) THE EQUIVALENCE PROOF. Every profile that exists today must still be staff, or
  --     this migration has narrowed what our own people can see.
  select count(*) into n_narrow
    from public.profiles p
   where not public.is_staff(p.id);
  if n_narrow <> 0 then
    raise exception 'OD-13 P0a: is_staff() is false for % existing profiles -- staff access would narrow', n_narrow;
  end if;

  -- (d) Sanity: the sweep actually did something, and roughly what was measured.
  select count(*) into n_swept
    from public._od13_p0_touched where phase = 'p0a-sweep';
  if n_swept < 150 then
    raise exception 'OD-13 P0a: only % policies swept -- expected ~207; refusing a partial sweep', n_swept;
  end if;

  raise notice 'OD-13 P0a verified: % swept, 0 left open, 0 left public, 0 profiles narrowed.', n_swept;
end $verify$;

commit;
