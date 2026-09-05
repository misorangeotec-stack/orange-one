-- ===========================================================================
-- THE NAMED RECIPIENT COULD NOT SEE THE ORDER. AGAIN, ONE LEVEL DOWN.
--
-- WHAT BROKE
--   OD-13 Correction 3 said: name a person against a customer and they still
--   see nothing, because fms_dispatch_can_see_order's step-owner arm collapses
--   on a null location. P2 fixed that by adding a recipient arm to BOTH
--   fms_dispatch_can_see_order() and the fms_dispatch_orders_select policy.
--
--   The function arm works. The POLICY arm does not, and for a reason the
--   function arm cannot have: it is the same SQL, but the policy is evaluated
--   as the CALLER, so its inner reads are themselves subject to RLS.
--
--     or exists (
--          select 1 from public.fms_dispatch_customer_logins l      <-- RLS
--          join public.fms_dispatch_customer_orgs g on g.id = l.org_id  <-- RLS
--          where l.profile_id = fms_dispatch_orders.raised_by
--            and ((select auth.uid()) = any (g.notify_user_ids) or …))
--
--   Both of those tables are coordinator-only:
--
--     fms_dispatch_customer_logins_select  USING (fms_dispatch_is_coordinator(…))
--     fms_dispatch_customer_orgs_select    USING (fms_dispatch_is_coordinator(…))
--
--   A named recipient who is not a coordinator therefore reads ZERO rows from
--   them, the EXISTS is false, and the order is invisible -- exactly the
--   symptom Correction 3 exists to prevent, one level further down, and
--   reintroduced by the fix for it.
--
--   Measured live, before this file, on a real customer order with a null
--   location, with Jayshree Patil (credit_check owner, not a coordinator)
--   named as the recipient:
--
--     fms_dispatch_can_see_order(Jayshree, null, <customer>)  = TRUE
--     fms_dispatch_can_act('credit_check', <order>, Jayshree) = TRUE
--     select … from fms_dispatch_orders  (as Jayshree, under RLS)
--                                    -> the order is NOT in the 936 she sees
--     select count(*) from fms_dispatch_customer_logins (as Jayshree) -> 0
--     select count(*) from fms_dispatch_customer_orgs   (as Jayshree) -> 0
--
--   Neither of the two credit-check owners is a coordinator. So on the day the
--   first real customer order was raised, the person we had named would have
--   been told about an order they could not open.
--
--   ⚠ THIS IS WHY THE FUNCTION AND THE POLICY DISAGREED, AND WHY NO TEST
--     THROUGH THE FUNCTION COULD EVER HAVE FOUND IT. can_see_order is
--     SECURITY DEFINER: it reads those two tables as the definer and never
--     meets the policy. Every P7 check that used it passed. The client is
--     already safe for the same reason -- customerOrgs.ts deliberately reads
--     fms_dispatch_customer_order_actors(), a SECURITY DEFINER RPC, and says
--     in its header that the table is coordinator-only. The policy is the one
--     reader that went at the tables directly.
--
-- WHAT THIS DOES
--   Moves the arm behind a SECURITY DEFINER helper, in the shape the four arms
--   above it already use (20261111120000): the caller-side half is computed
--   ONCE per query as an array, and the row test becomes `= any(…)`.
--
--     raised_by = any (coalesce((select fms_dispatch_customer_raisers_for(
--                                 (select auth.uid()))), '{}'::uuid[]))
--
--   Same rule, same rows, evaluated by the definer instead of the caller. It
--   is also strictly cheaper than what it replaces: a correlated EXISTS over
--   two tables per row becomes an InitPlan plus an array membership test.
--
--   No table, column or row is touched -- one new function and policy text
--   only, additive per CLAUDE.md.
--
-- ⚠ ORDER IS LOAD-BEARING, per 20261111120000: `alter policy` holds ACCESS
--   EXCLUSIVE on fms_dispatch_orders until COMMIT, so the equivalence check
--   runs BEFORE it. A failed assertion aborts before the lock is ever taken.
--
-- ⚠ EQUIVALENCE IS ASSERTED AS THE DEFINER, WHICH IS THE WHOLE POINT. Run with
--   RLS bypassed, the old arm and the new one must agree on every
--   (profile, order) pair -- that proves this changes WHO MAY EVALUATE the
--   rule and not the rule itself. The behaviour change is visible only under
--   RLS, and is proved separately, live, as Jayshree.
--
-- ⚠ fms_dispatch_can_see_order() IS DELIBERATELY UNTOUCHED, for the same
--   reason 20261111120000 left it alone: it already works, because it is
--   already SECURITY DEFINER.
--
-- Rollback: 20261112120001_od13_p7b_the_recipient_arm_could_not_read_its_own_tables_rollback.sql
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1 · The caller-side half, as an array the planner hoists into an InitPlan.
-- ---------------------------------------------------------------------------
-- "Which customer logins' orders am I entitled to see?" -- because I am named
-- on that customer in Setup, or because I am another login at that customer.
--
-- ⚠ MUST NOT RAISE. Called from inside an RLS policy, where a raise
--   hard-errors the query instead of returning false (OD-13 P0c).
-- ⚠ STABLE is load-bearing: VOLATILE is not hoisted and this file becomes a
--   silent per-row cost. Asserted at the foot.
-- ⚠ SECURITY DEFINER is the fix itself, not an optimisation. The two tables it
--   reads are coordinator-only; read as the caller they return nothing to the
--   very people this arm exists for.
-- ⚠ NOT gated on is_staff(), unlike fms_dispatch_customer_order_actors(): the
--   second arm below is what lets a SECOND login at the same customer see
--   their colleague's orders, so an external caller must reach it. What it
--   discloses is a list of opaque profile uuids and nothing else -- no name,
--   no ledger, no ticked-book list (Q11).
-- Returns '{}' rather than NULL so the caller's `= any(…)` is false, never NULL.
create or replace function public.fms_dispatch_customer_raisers_for(p_uid uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(array_agg(distinct l.profile_id), '{}'::uuid[])
    from public.fms_dispatch_customer_logins l
    join public.fms_dispatch_customer_orgs g on g.id = l.org_id
   where p_uid is not null
     and (
          -- our staff, named against this customer in Setup (Q8)
          p_uid = any (g.notify_user_ids)
          -- or another login belonging to the same customer (P1's arm (b))
       or g.id = public.fms_dispatch_customer_org_of(p_uid)
     );
$fn$;

comment on function public.fms_dispatch_customer_raisers_for(uuid) is
  'The customer logins whose orders this uid may see: those naming them as a recipient, '
  'plus their own customer''s other logins. SECURITY DEFINER because '
  'fms_dispatch_customer_logins and _orgs are coordinator-only, so the same query '
  'evaluated inside an RLS policy as the caller returns nothing to a named recipient '
  'who is not a coordinator. Wrap the call in (select …) at the call site or the '
  'planner will not hoist it.';

-- SECURITY DEFINER, so PUBLIC must lose EXECUTE explicitly: revoking from anon
-- does nothing, functions carry EXECUTE to PUBLIC by default (OD-13 P0c).
revoke execute on function public.fms_dispatch_customer_raisers_for(uuid) from public;
grant execute on function public.fms_dispatch_customer_raisers_for(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · EQUIVALENCE — asserted BEFORE the lock is taken. See the header.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_pairs int;
  v_diff  int;
begin
  -- ⚠ ONLY THE CUSTOMER ARM IS COMPARED. The five arms above it are
  --   character-identical either side of this file; this is the only arm whose
  --   RESULT could move.
  -- ⚠ This runs as the migration role, so RLS is bypassed on both sides. That
  --   is deliberate: it isolates "is it the same rule?" from "who may evaluate
  --   it?", and only the second is what this file changes.
  with per_person as (
    select p.id as uid,
           public.fms_dispatch_customer_raisers_for(p.id) as raisers
      from public.profiles p
  ),
  judged as (
    select
      -- OLD: the arm exactly as 20261110110000 / 20261111120000 spelled it.
      exists (
        select 1
          from public.fms_dispatch_customer_logins l
          join public.fms_dispatch_customer_orgs g on g.id = l.org_id
         where l.profile_id = o.raised_by
           and (per_person.uid = any (g.notify_user_ids)
                or g.id = public.fms_dispatch_customer_org_of(per_person.uid))
      ) as was,
      -- NEW: the same rule, hoisted.
      (o.raised_by = any (coalesce(per_person.raisers, '{}'::uuid[]))) as now
    from per_person cross join public.fms_dispatch_orders o
  )
  select count(*), count(*) filter (where coalesce(was, false) is distinct from coalesce(now, false))
    into v_pairs, v_diff
    from judged;

  if v_diff <> 0 then
    raise exception 'ABORT: the rewritten customer arm disagrees with the old one on % of % (profile, order) pairs', v_diff, v_pairs;
  end if;
  raise notice 'Equivalence: % (profile, order) pairs, 0 disagreements.', v_pairs;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 3 · The policy. Same six arms; the sixth no longer reads under the caller.
--     Everything from here to COMMIT holds ACCESS EXCLUSIVE — keep it cheap.
-- ---------------------------------------------------------------------------
alter policy fms_dispatch_orders_select on public.fms_dispatch_orders
  to authenticated
  using (
    (select auth.uid()) is not null and (
         (select public.fms_dispatch_sees_every_order((select auth.uid())))
      or fms_dispatch_orders.raised_by = (select auth.uid())
      or fms_dispatch_orders.location_id = any (
           coalesce((select public.fms_dispatch_my_step_locations((select auth.uid()))), '{}'::uuid[])
         )
      or exists (
           select 1 from public.fms_dispatch_step_assignees a
            where a.order_id = fms_dispatch_orders.id
              and a.assigned_to = (select auth.uid())
         )
      -- Was an EXISTS over two coordinator-only tables, evaluated as the
      -- caller. See the header: that is why a named recipient saw nothing.
      or fms_dispatch_orders.raised_by = any (
           coalesce((select public.fms_dispatch_customer_raisers_for((select auth.uid()))), '{}'::uuid[])
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 4 · The cheap guards. Milliseconds, inside the lock window.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v int;
begin
  -- (a) The house guard since 20260924120000: anon holds table grants, so a
  --     dispatch policy scoped to PUBLIC rather than authenticated widens access.
  select count(*) into v
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_dispatch_orders','fms_dispatch_order_items','fms_dispatch_rounds',
                       'fms_dispatch_round_items','fms_dispatch_activity','fms_dispatch_notifications')
     and roles::text like '%public%';
  if v > 0 then
    raise exception 'REFUSING: % policy(ies) on the dispatch tables are scoped to PUBLIC, not authenticated.', v;
  end if;

  -- (b) The same six tables must still carry exactly 13 policies.
  select count(*) into v
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_dispatch_orders','fms_dispatch_order_items','fms_dispatch_rounds',
                       'fms_dispatch_round_items','fms_dispatch_activity','fms_dispatch_notifications');
  if v <> 13 then
    raise exception 'REFUSING: expected 13 policies across the six dispatch tables, found %.', v;
  end if;

  -- (c) All THREE helpers exist, are STABLE, and PUBLIC cannot execute them.
  --     STABLE is what makes the hoist happen; without it this file is a no-op.
  select count(*) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_dispatch_sees_every_order', 'fms_dispatch_my_step_locations',
                       'fms_dispatch_customer_raisers_for')
     and p.provolatile = 's'
     and not has_function_privilege('public', p.oid, 'execute');
  if v <> 3 then
    raise exception 'ABORT: expected 3 STABLE helpers with EXECUTE revoked from PUBLIC, found %', v;
  end if;

  -- (d) The policy really is the new text, AND the inline read of the
  --     coordinator-only tables is gone. Checking only that the helper appears
  --     would pass while the broken EXISTS still sat beside it.
  perform 1 from pg_policies
   where schemaname = 'public' and tablename = 'fms_dispatch_orders'
     and policyname = 'fms_dispatch_orders_select'
     and qual like '%fms_dispatch_customer_raisers_for%'
     and qual like '%fms_dispatch_sees_every_order%'
     and qual not like '%fms_dispatch_customer_logins%'
     and qual not like '%fms_dispatch_customer_orgs%';
  if not found then
    raise exception 'ABORT: fms_dispatch_orders_select still reads the coordinator-only tables inline';
  end if;
end
$mig$;

commit;
