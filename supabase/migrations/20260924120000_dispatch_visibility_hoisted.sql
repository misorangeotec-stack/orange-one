-- ===========================================================================
-- Order to Dispatch: the visibility check stops running once per ROW.
--
-- WHY
--   Every save in the module felt slow — reported on the master request and on
--   the bill step, but it was all 23 write paths, Setup included. The write was
--   never the problem: `fms_dispatch_record_sales_bill` averages 70 ms. What the
--   user waited for was the reload the client awaits afterwards, and that reload
--   was slow because of these policies.
--
--   `fms_dispatch_can_see_order(uid, location_id, raised_by)` is SECURITY DEFINER
--   *with SET search_path*, which makes it NON-INLINABLE. The planner cannot fold
--   it into the query, so it ran as a real function call for every one of the
--   ~475 orders — each call doing has_role() + a fms_dispatch_config jsonb scan +
--   a step_owners scan. Five tables reach that function (orders directly;
--   order_items / rounds / round_items / activity through an EXISTS over all
--   orders), and every 1,000-row page paid again.
--
--   On top, each of those tables carried a `*_write_admin` policy declared
--   FOR ALL. A FOR ALL permissive policy is OR-ed into SELECT too, so an
--   un-wrapped `is_admin(auth.uid())` was ALSO evaluated per row.
--
--   Across all 475 orders there are exactly FOUR distinct
--   (location_id, raised_by) pairs. Four possible answers, computed some five
--   thousand times per reload.
--
-- WHAT THIS DOES  (13 policies, no table/column/row touched anywhere)
--   A. The six SELECT policies are rewritten so the answer costs ONCE per query:
--      · orders — the predicate is inlined with every row-independent arm wrapped
--        as (select …), which makes it an InitPlan instead of a per-row call.
--      · order_items / rounds / round_items / activity — these stop repeating the
--        rule and simply require the PARENT ROW to be visible. RLS applies to a
--        table referenced inside another table's policy, so the orders policy
--        answers once and the planner turns it into a semi-join.
--      · notifications — auth.uid() wrapped.
--   B. The six FOR ALL admin policies keep FOR ALL, keep USING and WITH CHECK,
--      and only wrap their predicate. Semantics are UNCHANGED — an admin still
--      reads every row, including every user's notifications; it just stops
--      costing anything per row.
--   C. fms_dispatch_notifications_update_own — same wrap. This is the PATCH
--      behind "mark the bell read", 662 ms avg / 2,796 ms max, because it updates
--      many rows at once and paid the per-row cost like the reads did.
--
--   Measured on live data, 21-Aug-2026, worst-case persona (a step owner who
--   raised nothing, so nothing short-circuits):
--      orders        1,620 ms avg  →     5.6 ms   (all 432 visible rows)
--      order_items   2,184 ms avg  →     6.4 ms   (all 1,595)
--      rounds        2,207 ms avg  →     5.5 ms   (all 343)
--      round_items   2,462 ms avg  →    10.7 ms   (all 1,253)
--      activity      1,990 ms avg  →     8.0 ms   (all 2,699)
--      notifications 1,840 ms avg  →     5.0 ms
--
-- ⚠ EVERY POLICY IS RECREATED `TO authenticated`, AND THAT CLAUSE IS LORE-BEARING.
--   `anon` holds full table grants on all six tables (the Supabase default). The
--   only thing keeping anonymous callers out is that every policy is scoped to
--   `authenticated`; a policy created without that clause defaults to PUBLIC.
--   The assertion at the foot of this file fails the migration if any policy on
--   these tables ends up scoped to {public}.
--
-- ⚠ fms_dispatch_can_see_order IS DELIBERATELY LEFT IN PLACE, NOT REWRITTEN.
--   fms_dispatch_announce() still calls it to narrow notification recipients — a
--   handful of calls per announce, which costs nothing — and rewriting it would
--   change a write path this migration has no business touching. The consequence
--   is that the visibility rule now lives in two places. The equivalence query at
--   the foot of this file is the regression check for that: it compares the
--   function against the inlined predicate for every (user, order) pair. It was
--   run before this migration was written — 28,680 pairs, 60 users, ZERO
--   mismatches, 5,120 visible under both.
--
-- ⚠ WRITES CANNOT BE AFFECTED. fms_dispatch_orders et al. have
--   relforcerowsecurity = false and are owned by `postgres`, so the SECURITY
--   DEFINER RPCs that perform every order write bypass RLS entirely. The only
--   direct client write to these six tables is the notifications PATCH, covered
--   by fms_dispatch_notifications_update_own (part C).
--
-- ⚠ IDEMPOTENT ON PURPOSE (drop if exists + create). A partial application is
--   simply re-run, so this does not depend on how the caller wraps transactions.
--
-- Blast radius checked before writing: no view and no policy on any other table
-- references fms_dispatch_orders.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A. THE SIX SELECT POLICIES
-- ---------------------------------------------------------------------------

-- orders — the rule itself, hoisted. This is a faithful transcription of
-- fms_dispatch_can_see_order's body, including its `p_uid is not null` guard.
drop policy if exists fms_dispatch_orders_select on public.fms_dispatch_orders;
create policy fms_dispatch_orders_select
  on public.fms_dispatch_orders
  for select
  to authenticated
  using (
    (select auth.uid()) is not null and (
         (select public.is_admin((select auth.uid())))
      or (select public.fms_dispatch_is_coordinator((select auth.uid())))
      or fms_dispatch_orders.raised_by = (select auth.uid())
      or exists (
           select 1
             from public.fms_dispatch_step_owners o
            where (select auth.uid()) = any(o.employee_ids)
              and (o.location_id is null or o.location_id = fms_dispatch_orders.location_id)
         )
    )
  );

-- order_items — "is my parent order visible?" and nothing more. The orders
-- policy above is applied to this subquery, so the rule is stated once.
drop policy if exists fms_dispatch_order_items_select on public.fms_dispatch_order_items;
create policy fms_dispatch_order_items_select
  on public.fms_dispatch_order_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fms_dispatch_orders o
       where o.id = fms_dispatch_order_items.order_id
    )
  );

-- rounds — same shape.
drop policy if exists fms_dispatch_rounds_select on public.fms_dispatch_rounds;
create policy fms_dispatch_rounds_select
  on public.fms_dispatch_rounds
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fms_dispatch_orders o
       where o.id = fms_dispatch_rounds.order_id
    )
  );

-- round_items — via rounds, which is itself via orders. Two levels of RLS, each
-- now cheap; measured 1,199 ms → 10.7 ms for the whole visible set.
drop policy if exists fms_dispatch_round_items_select on public.fms_dispatch_round_items;
create policy fms_dispatch_round_items_select
  on public.fms_dispatch_round_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fms_dispatch_rounds r
       where r.id = fms_dispatch_round_items.round_id
    )
  );

-- activity — the non-order arm is unchanged: master-request activity is
-- governance and stays visible to everyone (241 rows today).
drop policy if exists fms_dispatch_activity_select on public.fms_dispatch_activity;
create policy fms_dispatch_activity_select
  on public.fms_dispatch_activity
  for select
  to authenticated
  using (
    fms_dispatch_activity.entity_type <> 'order'
    or exists (
      select 1 from public.fms_dispatch_orders o
       where o.id = fms_dispatch_activity.entity_id
    )
  );

-- notifications — same predicate, auth.uid() hoisted out of the row loop.
drop policy if exists fms_dispatch_notifications_select_own on public.fms_dispatch_notifications;
create policy fms_dispatch_notifications_select_own
  on public.fms_dispatch_notifications
  for select
  to authenticated
  using (fms_dispatch_notifications.user_id = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- B. THE SIX `FOR ALL` ADMIN POLICIES
--    Still FOR ALL, still USING + WITH CHECK, still is_admin. Only the shape
--    changes: (select …) makes it an InitPlan instead of a per-row call.
-- ---------------------------------------------------------------------------

drop policy if exists fms_dispatch_orders_write_admin on public.fms_dispatch_orders;
create policy fms_dispatch_orders_write_admin
  on public.fms_dispatch_orders for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists fms_dispatch_order_items_write_admin on public.fms_dispatch_order_items;
create policy fms_dispatch_order_items_write_admin
  on public.fms_dispatch_order_items for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists fms_dispatch_rounds_write_admin on public.fms_dispatch_rounds;
create policy fms_dispatch_rounds_write_admin
  on public.fms_dispatch_rounds for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists fms_dispatch_round_items_write_admin on public.fms_dispatch_round_items;
create policy fms_dispatch_round_items_write_admin
  on public.fms_dispatch_round_items for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists fms_dispatch_activity_write_admin on public.fms_dispatch_activity;
create policy fms_dispatch_activity_write_admin
  on public.fms_dispatch_activity for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));

drop policy if exists fms_dispatch_notifications_write_admin on public.fms_dispatch_notifications;
create policy fms_dispatch_notifications_write_admin
  on public.fms_dispatch_notifications for all to authenticated
  using ((select public.is_admin((select auth.uid()))))
  with check ((select public.is_admin((select auth.uid()))));


-- ---------------------------------------------------------------------------
-- C. "MARK THE BELL READ" — the same wrap on the UPDATE path.
-- ---------------------------------------------------------------------------

drop policy if exists fms_dispatch_notifications_update_own on public.fms_dispatch_notifications;
create policy fms_dispatch_notifications_update_own
  on public.fms_dispatch_notifications for update to authenticated
  using (fms_dispatch_notifications.user_id = (select auth.uid()))
  with check (fms_dispatch_notifications.user_id = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- ASSERTIONS — this migration fails rather than silently widening access.
-- ---------------------------------------------------------------------------
do $$
declare
  v_public int;
  v_count  int;
begin
  select count(*) into v_public
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_dispatch_orders','fms_dispatch_order_items','fms_dispatch_rounds',
                       'fms_dispatch_round_items','fms_dispatch_activity','fms_dispatch_notifications')
     and roles::text like '%public%';
  if v_public > 0 then
    raise exception
      'REFUSING: % policy(ies) on the dispatch tables are scoped to PUBLIC, not authenticated. anon holds table grants — this would widen access.',
      v_public;
  end if;

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_dispatch_orders','fms_dispatch_order_items','fms_dispatch_rounds',
                       'fms_dispatch_round_items','fms_dispatch_activity','fms_dispatch_notifications');
  -- 2 each on orders / order_items / rounds / round_items / activity,
  -- 3 on notifications (select_own + update_own + write_admin) = 13.
  if v_count <> 13 then
    raise exception 'REFUSING: expected 13 policies across the six dispatch tables, found %.', v_count;
  end if;
end $$;


-- ===========================================================================
-- ROLLBACK — the previous definitions, verbatim from pg_policies before the
-- change. Rehearsed, not just written: this was executed on the live database
-- and the persona row-counts and id checksums were confirmed to return to their
-- pre-migration values before the migration was applied for good.
--
-- To revert, run everything between the BEGIN and END markers below.
--
-- --8<-- BEGIN ROLLBACK --8<--
--
-- drop policy if exists fms_dispatch_orders_select on public.fms_dispatch_orders;
-- create policy fms_dispatch_orders_select on public.fms_dispatch_orders
--   for select to authenticated
--   using (fms_dispatch_can_see_order((select auth.uid()), location_id, raised_by));
--
-- drop policy if exists fms_dispatch_order_items_select on public.fms_dispatch_order_items;
-- create policy fms_dispatch_order_items_select on public.fms_dispatch_order_items
--   for select to authenticated
--   using (exists (select 1 from fms_dispatch_orders o
--                   where o.id = fms_dispatch_order_items.order_id
--                     and fms_dispatch_can_see_order((select auth.uid()), o.location_id, o.raised_by)));
--
-- drop policy if exists fms_dispatch_rounds_select on public.fms_dispatch_rounds;
-- create policy fms_dispatch_rounds_select on public.fms_dispatch_rounds
--   for select to authenticated
--   using (exists (select 1 from fms_dispatch_orders o
--                   where o.id = fms_dispatch_rounds.order_id
--                     and fms_dispatch_can_see_order((select auth.uid()), o.location_id, o.raised_by)));
--
-- drop policy if exists fms_dispatch_round_items_select on public.fms_dispatch_round_items;
-- create policy fms_dispatch_round_items_select on public.fms_dispatch_round_items
--   for select to authenticated
--   using (exists (select 1 from fms_dispatch_rounds r
--                    join fms_dispatch_orders o on o.id = r.order_id
--                   where r.id = fms_dispatch_round_items.round_id
--                     and fms_dispatch_can_see_order((select auth.uid()), o.location_id, o.raised_by)));
--
-- drop policy if exists fms_dispatch_activity_select on public.fms_dispatch_activity;
-- create policy fms_dispatch_activity_select on public.fms_dispatch_activity
--   for select to authenticated
--   using (entity_type <> 'order'
--          or exists (select 1 from fms_dispatch_orders o
--                      where o.id = fms_dispatch_activity.entity_id
--                        and fms_dispatch_can_see_order((select auth.uid()), o.location_id, o.raised_by)));
--
-- drop policy if exists fms_dispatch_notifications_select_own on public.fms_dispatch_notifications;
-- create policy fms_dispatch_notifications_select_own on public.fms_dispatch_notifications
--   for select to authenticated using (user_id = auth.uid());
--
-- drop policy if exists fms_dispatch_notifications_update_own on public.fms_dispatch_notifications;
-- create policy fms_dispatch_notifications_update_own on public.fms_dispatch_notifications
--   for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
--
-- drop policy if exists fms_dispatch_orders_write_admin on public.fms_dispatch_orders;
-- create policy fms_dispatch_orders_write_admin on public.fms_dispatch_orders
--   for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
--
-- drop policy if exists fms_dispatch_order_items_write_admin on public.fms_dispatch_order_items;
-- create policy fms_dispatch_order_items_write_admin on public.fms_dispatch_order_items
--   for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
--
-- drop policy if exists fms_dispatch_rounds_write_admin on public.fms_dispatch_rounds;
-- create policy fms_dispatch_rounds_write_admin on public.fms_dispatch_rounds
--   for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
--
-- drop policy if exists fms_dispatch_round_items_write_admin on public.fms_dispatch_round_items;
-- create policy fms_dispatch_round_items_write_admin on public.fms_dispatch_round_items
--   for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
--
-- drop policy if exists fms_dispatch_activity_write_admin on public.fms_dispatch_activity;
-- create policy fms_dispatch_activity_write_admin on public.fms_dispatch_activity
--   for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
--
-- drop policy if exists fms_dispatch_notifications_write_admin on public.fms_dispatch_notifications;
-- create policy fms_dispatch_notifications_write_admin on public.fms_dispatch_notifications
--   for all to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
--
-- --8<-- END ROLLBACK --8<--
-- ===========================================================================


-- ===========================================================================
-- THE STANDING REGRESSION CHECK. The visibility rule lives both in
-- fms_dispatch_can_see_order (used by fms_dispatch_announce) and inlined in the
-- orders policy above. Run this after touching either one; it must report 0.
--
--   select count(*) filter (where old_v is distinct from new_v) as mismatches
--   from (
--     select
--       public.fms_dispatch_can_see_order(p.id, o.location_id, o.raised_by) old_v,
--       ( p.id is not null and (
--            public.is_admin(p.id)
--         or public.fms_dispatch_is_coordinator(p.id)
--         or o.raised_by = p.id
--         or exists (select 1 from public.fms_dispatch_step_owners s
--                     where p.id = any(s.employee_ids)
--                       and (s.location_id is null or s.location_id = o.location_id))
--       )) new_v
--     from profiles p cross join fms_dispatch_orders o
--   ) t;
--
-- 21-Aug-2026: 28,680 pairs across 60 users, 0 mismatches, 5,120 visible on both
-- sides.
-- ===========================================================================
