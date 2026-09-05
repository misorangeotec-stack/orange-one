-- ===========================================================================
-- THE ORDERS POLICY IS EVALUATED ONCE PER QUERY AGAIN, NOT ONCE PER ROW.
--
-- WHAT BROKE
--   20261110110000 (OD-13 P2) rewrote fms_dispatch_orders_select to add the
--   customer-login arm. It added that arm correctly -- the two caller-side
--   lookups inside it ARE wrapped in `(select …)`, and its header explains at
--   length why they have to be. What it did not notice is that it retyped the
--   FOUR ARMS ABOVE IT from the flattened text pg_policies prints back, and
--   pg_policies prints the wrapping away. So:
--
--     20260925130000 (fast)          20261110110000 (slow)
--     -------------------------      ------------------------------
--     (select auth.uid())            auth.uid()
--     (select is_admin((select …)))  is_admin(auth.uid())
--     (select fms_dispatch_is_coo…)  fms_dispatch_is_coordinator(auth.uid())
--     (select module_is_viewer(…))   module_is_viewer(auth.uid(), 'order-…')
--
--   Unwrapped, each is a STABLE SECURITY DEFINER call sitting in a per-row
--   Filter instead of an InitPlan. Three of them, plus the correlated
--   step-owner EXISTS, ran for every one of 1,128 orders -- measured on live
--   data, `loops=1128` on a Seq Scan of fms_dispatch_step_owners.
--
--   It did not cost one table. order_items, rounds, round_items and activity
--   all read `exists (select 1 from fms_dispatch_orders o where o.id = …)`,
--   so each of them re-runs the whole thing per row. Measured, signed in as an
--   ordinary step owner:
--
--     orders        1,397 ms      order_items   1,189 ms
--     rounds        1,181 ms      round_items   1,207 ms
--
--   Every other table the module reads answers in 1-12 ms. The store pages at
--   1,000 rows and walks those four tables plus a second pass over
--   order_items (fetchOrderLineItemIds), so one load of Order to Dispatch was
--   spending ~22 SECONDS of database CPU across 18 requests. Over the whole
--   project those four tables account for 49% of all database execution time.
--   That is the "Loading…" the module has been sitting on.
--
-- WHAT THIS DOES
--   Restores the wrapping, and hoists the one arm that could not simply be
--   re-wrapped. `exists (… and (o.location_id is null or o.location_id =
--   fms_dispatch_orders.location_id))` is correlated on the row, so no amount
--   of `(select …)` makes it an InitPlan. It is split into the two things it
--   actually asks:
--
--     · do I own this step ANYWHERE (location_id is null)  -> row-independent,
--       folded into fms_dispatch_sees_every_order();
--     · is this order's location one of MY step locations  -> an InitPlan
--       array from fms_dispatch_my_step_locations(), compared per row with
--       `= any(…)`, which is an array test, not a subquery.
--
--   Same rule, same rows. No table, column or row is touched -- policy text
--   and two new functions only, additive per CLAUDE.md.
--
--   Measured after, same session, same user:
--     orders 19 ms · order_items 14 ms · rounds 9 ms · round_items 16 ms.
--   EXPLAIN shows every arm as an InitPlan with loops=1; the 1128-iteration
--   Seq Scan is gone.
--
-- ⚠ THE ORDER OF THIS FILE IS LOAD-BEARING. `alter policy` takes ACCESS
--   EXCLUSIVE on fms_dispatch_orders and holds it until COMMIT, so everything
--   slow must happen BEFORE it. The equivalence check below costs ~2-7 s
--   (73k pairs); run after the ALTER it would stall the whole module for that
--   long -- an outage caused by the fix for the outage. Run first, it holds
--   nothing, and a failed assertion aborts before the lock is ever taken.
--   Measured: helpers + equivalence 1,946 ms (no exclusive lock), then
--   ALTER + all four guards 12 ms (the entire lock window).
--
-- ⚠ EQUIVALENCE IS ASSERTED, NOT ASSUMED. The block below re-runs the standing
--   check from 20260924120000: the old predicate and the new one, for EVERY
--   (profile, order) pair, aborting on one disagreement. Run before writing
--   this: 0 disagreements. The pair count itself is live data and drifts as
--   orders are raised (73,320 -> 73,385 within one session), which is why the
--   assertion tests the DIFF and never the total.
--
-- ⚠ fms_dispatch_can_see_order() IS DELIBERATELY UNTOUCHED. It judges ONE row
--   at a time (announce, can_act, the fms-dispatch-docs storage read policy),
--   where the per-row shape is the right shape and there is nothing to hoist.
--   The two spellings stay the same rule -- which is what the assertion proves.
--
-- ⚠ NOTHING HERE CHANGES WHO SEES WHAT. In particular the 'view'-not-'edit'
--   inversion is left exactly as 20260925130000 decided it: a view-only grant
--   reads the whole module, an editor sees what their ownership says. That is
--   a documented decision, not a side effect of this file.
--
-- Rollback: 20261111120001_od13_p3b_orders_policy_costs_once_again_rollback.sql
-- ===========================================================================

begin;

-- The server default is 0 -- wait forever. There are live 1.4 s readers on this
-- table; without this the ALTER can stall behind one while new readers queue
-- behind IT. Aborting and retrying is strictly better than a pile-up.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1 · The row-independent arms, in one call the planner can hoist.
-- ---------------------------------------------------------------------------
-- ⚠ MUST NOT RAISE. This is called from inside an RLS policy, where a raise
--   hard-errors the query instead of returning false -- see OD-13 P0c.
-- ⚠ STABLE is load-bearing. VOLATILE would not be hoisted into an InitPlan and
--   this whole file would be a silent no-op. Asserted at the foot.
create or replace function public.fms_dispatch_sees_every_order(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select p_uid is not null and (
       public.is_admin(p_uid)
    or public.fms_dispatch_is_coordinator(p_uid)
    or public.module_is_viewer(p_uid, 'order-to-dispatch')
    -- The location-free half of the old step-owner EXISTS: owning a step with
    -- no location means every location, so it depends on no order row.
    or exists (
         select 1 from public.fms_dispatch_step_owners o
          where p_uid = any(o.employee_ids) and o.location_id is null
       )
  );
$fn$;

comment on function public.fms_dispatch_sees_every_order(uuid) is
  'The arms of fms_dispatch_orders_select that do not depend on the order row, so the '
  'planner evaluates them once per query rather than once per row. Wrap the call in '
  '(select …) at the call site or the hoist does not happen.';

-- ---------------------------------------------------------------------------
-- 2 · The row-dependent half, as an array instead of a correlated subquery.
-- ---------------------------------------------------------------------------
-- Returns '{}' rather than NULL so the caller's `= any(…)` is false, never NULL.
create or replace function public.fms_dispatch_my_step_locations(p_uid uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(array_agg(distinct o.location_id), '{}'::uuid[])
    from public.fms_dispatch_step_owners o
   where p_uid = any(o.employee_ids)
     and o.location_id is not null;
$fn$;

comment on function public.fms_dispatch_my_step_locations(uuid) is
  'The locations this uid owns a step at, as an array, so fms_dispatch_orders_select can '
  'test membership with = any(…) -- an array test against an InitPlan -- instead of a '
  'correlated EXISTS that re-scans fms_dispatch_step_owners for every order row.';

-- Both are SECURITY DEFINER, so PUBLIC must lose EXECUTE explicitly: revoking
-- from anon does nothing, functions carry EXECUTE to PUBLIC by default (OD-13 P0c).
revoke execute on function public.fms_dispatch_sees_every_order(uuid) from public;
revoke execute on function public.fms_dispatch_my_step_locations(uuid) from public;
grant execute on function public.fms_dispatch_sees_every_order(uuid) to authenticated, service_role;
grant execute on function public.fms_dispatch_my_step_locations(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3 · EQUIVALENCE — asserted BEFORE the lock is taken. See the header.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_pairs int;
  v_diff  int;
begin
  -- ⚠ ONLY THE STEP-OWNER ARM IS COMPARED, and that is not a shortcut. The
  --   other five arms are character-identical in both versions -- the rewrite
  --   only re-wrapped them -- so this is the only arm whose RESULT could move.
  --   Comparing just it keeps the check inside a migration's budget.
  with pairs as (
    select p.id as uid, o.location_id as loc
      from public.profiles p cross join public.fms_dispatch_orders o
  ),
  judged as (
    select
      -- OLD: the arm exactly as 20261110110000 spelled it.
      exists (select 1 from public.fms_dispatch_step_owners s
               where pairs.uid = any(s.employee_ids)
                 and (s.location_id is null or s.location_id = pairs.loc)) as was,
      -- NEW: the same arm, split in two.
      ( exists (select 1 from public.fms_dispatch_step_owners s
                 where pairs.uid = any(s.employee_ids) and s.location_id is null)
        or pairs.loc = any (coalesce((select array_agg(distinct s.location_id)
                                        from public.fms_dispatch_step_owners s
                                       where pairs.uid = any(s.employee_ids)
                                         and s.location_id is not null), '{}'::uuid[]))
      ) as now
    from pairs
  )
  select count(*), count(*) filter (where coalesce(was, false) is distinct from coalesce(now, false))
    into v_pairs, v_diff
    from judged;

  if v_diff <> 0 then
    raise exception 'ABORT: the rewritten step-owner arm disagrees with the old one on % of % (profile, order) pairs', v_diff, v_pairs;
  end if;
  raise notice 'Equivalence: % (profile, order) pairs, 0 disagreements.', v_pairs;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 4 · The policy. Same six arms, in the shape that costs once.
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
      -- Kept as an EXISTS: correlated on the order's own id, so it is a
      -- semi-join over an empty-to-tiny table, not a function call per row.
      or exists (
           select 1 from public.fms_dispatch_step_assignees a
            where a.order_id = fms_dispatch_orders.id
              and a.assigned_to = (select auth.uid())
         )
      -- Verbatim from 20261110110000. Correlated on raised_by; both caller-side
      -- lookups were already wrapped, which is why this arm never cost anything.
      or exists (
           select 1
             from public.fms_dispatch_customer_logins l
             join public.fms_dispatch_customer_orgs g on g.id = l.org_id
            where l.profile_id = fms_dispatch_orders.raised_by
              and (
                   (select auth.uid()) = any (g.notify_user_ids)
                or g.id = (select public.fms_dispatch_customer_org_of((select auth.uid())))
              )
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 5 · The cheap guards. Milliseconds, inside the lock window.
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

  -- (b) The same six tables must still carry exactly 13 policies. `alter policy`
  --     cannot add one, but the count is what would catch a stray CREATE.
  select count(*) into v
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_dispatch_orders','fms_dispatch_order_items','fms_dispatch_rounds',
                       'fms_dispatch_round_items','fms_dispatch_activity','fms_dispatch_notifications');
  if v <> 13 then
    raise exception 'REFUSING: expected 13 policies across the six dispatch tables, found %.', v;
  end if;

  -- (c) Both helpers exist, are STABLE, and PUBLIC cannot execute them.
  --     STABLE is what makes the hoist happen; without it this file is a no-op.
  select count(*) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_dispatch_sees_every_order', 'fms_dispatch_my_step_locations')
     and p.provolatile = 's'
     and not has_function_privilege('public', p.oid, 'execute');
  if v <> 2 then
    raise exception 'ABORT: expected 2 STABLE helpers with EXECUTE revoked from PUBLIC, found %', v;
  end if;

  -- (d) The policy really is the hoisted text. A silently no-op ALTER is the
  --     exact failure this whole file exists to undo.
  perform 1 from pg_policies
   where schemaname = 'public' and tablename = 'fms_dispatch_orders'
     and policyname = 'fms_dispatch_orders_select'
     and qual like '%fms_dispatch_sees_every_order%'
     and qual not like '%module_is_viewer(auth.uid()%';
  if not found then
    raise exception 'ABORT: fms_dispatch_orders_select is not in the hoisted form after the ALTER';
  end if;
end
$mig$;

commit;
