-- OD-13 · P0e — the four holes P0a stepped over, found by actually sitting in the seat.
--
-- Applied to the live database on 04-09-2026 as od13_p0e_close_holes_found_by_the_sweep.
--
-- HOW THESE WERE FOUND, AND WHY THAT MATTERS MORE THAN THE FIX
-- ------------------------------------------------------------
-- P0a swept `pg_policies where cmd = 'SELECT' and qual = 'true'` and then VERIFIED ITSELF
-- WITH THE SAME PREDICATE -- "0 policies still read USING (true)". That is not a proof that
-- the database is closed. It is a proof that the sweep swept what the sweep looked for.
--
-- P0-7 asked a different question: put a customer-shaped login in the chair and count what
-- it can actually read. Measured on 04-09-2026, inside a transaction that was then rolled
-- back, with a real `profiles` row temporarily shaped like a customer would be
-- (is_external = true, role employee, no department, no HOD, no app grant):
--
--     295 tables `authenticated` holds SELECT on
--      10 still returned a row
--
-- Six of the ten are correct and stay: `profiles`, `user_roles`, `module_visits` and
-- `notifications` are own-row policies, and the four task-management tables key on
-- assigned_to / created_by / a mention -- they returned rows only because the test borrowed
-- a REAL employee's row, which owns real tasks. A login created for a customer owns none.
--
-- ⚠ The borrowed row is also what nearly hid the answer. The first run of this sweep used
--   `order by created_at limit 1`, which is the founding ADMIN account, and reported 219 of
--   295 tables open -- every `*_write` policy is `FOR ALL`, which covers SELECT, and is
--   permissive, so `is_admin` ORs straight past `is_staff`. That number was the test being
--   wrong, not the lock. `is_external` says "not staff"; it does not take a role away.
--   Anyone re-running this must model the account, not just flip the flag.
--
-- The four below are the ones that were genuinely open, and none of them would ever have
-- been caught by re-running P0a's own verification.
--
-- 1 · app_lead_masters_global_select  -- SELECT, role {public}, qual `auth.uid() IS NOT NULL`
-- 2 · fms_travel_step_assignees_select -- SELECT, role {public}, qual `auth.uid() IS NOT NULL`
--
--   Not `true`, so the sweep's WHERE clause did not match them; granted to `public` rather
--   than `authenticated`, so P0a's "no swept policy is still public" check did not see them
--   either. Both mean "anybody at all who is signed in".
--
--   🔴 The travel one is the sharper lesson. P0a hand-narrowed `fms_dispatch_step_assignees`
--      away from exactly this predicate, in a section of the migration written specifically
--      about it -- and left its twin in the travel module untouched, because the twin was
--      never in the generated set and nobody looked for siblings. One narrowing by hand is
--      a narrowing of one table.
--
-- 3 · task_remark_mentions "Authenticated can write mentions" -- INSERT, WITH CHECK `true`
--
--   P0a only ever considered `cmd = 'SELECT'`. It read the database as a disclosure problem
--   and never asked what a non-staff login could WRITE. This one takes any row at all.
--
-- 4 · seven `*_master_requests_insert` policies (dispatch, exit, hr, import, production,
--   purchase, supplies) -- INSERT, WITH CHECK `requested_by = auth.uid() AND status =
--   'pending'`. Self-consistent, and satisfied by anybody signed in: a customer login could
--   drop a pending master-data request into seven modules' approval queues. A nuisance
--   rather than a disclosure, but it is a write we never meant to hand out, and it lands in
--   a queue a human then has to clear.
--
-- WHAT IS NOT A HOLE, having been checked
-- ---------------------------------------
-- `fms_ocpi_last_contact_for(uuid)` and `fms_hr_module_user_ids()` are SQL-language, so the
-- P0c sweep (plpgsql only) never touched their bodies, and a first pass here flagged both as
-- unguarded. They are not: each carries `and public.is_staff(auth.uid())` inside its WHERE,
-- added by P0c1, and both return empty to an external caller. A guard in a WHERE clause is
-- invisible to a regex that looks for one after BEGIN -- the same trap noted in P0c's header.
-- Read the body before believing the classifier.
--
-- POSITIVE CONTROL, run alongside the above so the numbers mean something
-- ----------------------------------------------------------------------
--   ordinary staff employee -> 195 of 295 tables readable, 235 storage objects visible
--   same row, is_external    ->  10 of 295 (all own-row), 0 storage objects
-- and the five formerly-bare buckets still read for staff: fms-import-docs 29,
-- fms-production-docs 107, fms-purchase-docs 89, fms-sampling-docs 10.
--
-- SAFETY
-- ------
-- Policies only. No table, column or row is touched. Every change is a CONJUNCT added to an
-- existing predicate, so no account that passes today can start failing unless it is
-- external -- and there are no external accounts yet. Pre-state is in
-- `public._rls_baseline_20260904`; the set altered is recorded in `public._od13_p0_touched`
-- under phase 'p0e', so the P0a rollback shape works for these too.

begin;

-- ---------------------------------------------------------------------------
-- 1 + 2 · "anybody signed in" is not a permission.
-- ---------------------------------------------------------------------------
alter policy app_lead_masters_global_select on public.app_lead_masters_global
  to authenticated
  using ((select public.is_staff((select auth.uid()))));

alter policy fms_travel_step_assignees_select on public.fms_travel_step_assignees
  to authenticated
  using ((select public.is_staff((select auth.uid()))));

insert into public._od13_p0_touched (schemaname, tablename, policyname, phase)
values ('public', 'app_lead_masters_global',  'app_lead_masters_global_select',  'p0e'),
       ('public', 'fms_travel_step_assignees','fms_travel_step_assignees_select','p0e');

-- ---------------------------------------------------------------------------
-- 3 · The write P0a never looked for.
-- ---------------------------------------------------------------------------
alter policy "Authenticated can write mentions" on public.task_remark_mentions
  to authenticated
  with check ((select public.is_staff((select auth.uid()))));

insert into public._od13_p0_touched (schemaname, tablename, policyname, phase)
values ('public', 'task_remark_mentions', 'Authenticated can write mentions', 'p0e');

-- ---------------------------------------------------------------------------
-- 4 · The seven master-request queues.
-- ---------------------------------------------------------------------------
-- Generated from the catalogue, not a hand-written list of seven -- a hand-written list is
-- how the travel twin above survived P0a. The existing WITH CHECK is preserved verbatim and
-- only conjoined with, so `requested_by = auth.uid() AND status = 'pending'` still applies.
do $mr$
declare
  r record;
  n integer := 0;
  v_guard constant text := '(select public.is_staff((select auth.uid())))';
begin
  for r in
    select tablename, policyname, with_check
      from pg_policies
     where schemaname = 'public'
       and cmd = 'INSERT'
       and tablename like '%\_master\_requests'
       and with_check is not null
       and with_check not like '%is_staff%'
     order by tablename
  loop
    execute format('alter policy %I on public.%I to authenticated with check ((%s) and %s)',
                   r.policyname, r.tablename, r.with_check, v_guard);

    insert into public._od13_p0_touched (schemaname, tablename, policyname, phase)
    values ('public', r.tablename, r.policyname, 'p0e');

    n := n + 1;
  end loop;

  raise notice 'OD-13 P0e: % master-request insert policies narrowed to staff.', n;
end $mr$;

-- ---------------------------------------------------------------------------
-- Prove it, inside the transaction.
-- ---------------------------------------------------------------------------
do $verify$
declare
  n_weak   integer;
  n_narrow integer;
begin
  -- (a) No permissive policy in `public` or `storage` still means "anybody signed in",
  --     on ANY command -- which is the check P0a should have been making all along.
  select count(*) into n_weak
    from pg_policies
   where schemaname in ('public','storage')
     and permissive = 'PERMISSIVE'
     and (   regexp_replace(coalesce(qual,''),       '\s+',' ','g') ~* '^\(?\s*auth\.uid\(\) IS NOT NULL\s*\)?$'
          or regexp_replace(coalesce(with_check,''), '\s+',' ','g') ~* '^\(?\s*auth\.uid\(\) IS NOT NULL\s*\)?$'
          or coalesce(qual,'')       = 'true'
          or coalesce(with_check,'') = 'true' );
  if n_weak <> 0 then
    raise exception 'OD-13 P0e: % policies still admit anybody who is merely signed in', n_weak;
  end if;

  -- (b) And staff still pass all of them.
  select count(*) into n_narrow
    from public.profiles p
   where not public.is_staff(p.id);
  if n_narrow <> 0 then
    raise exception 'OD-13 P0e: is_staff() is false for % existing profiles', n_narrow;
  end if;

  raise notice 'OD-13 P0e verified: 0 policies admit a bare signed-in account, 0 profiles narrowed.';
end $verify$;

commit;
