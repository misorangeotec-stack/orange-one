-- ===========================================================================
-- A VIEW-ONLY GRANT MEANS READ THE WHOLE MODULE.  (Order to Dispatch first.)
--
-- WHY
--   `app_access.access_level` grew a 'view' tier in 20260906120000, and
--   20260923120000 taught the database to refuse writes on it. What neither did
--   is let a view-only user SEE anything: inside every FMS, which screens exist
--   is decided by ownership config — fms_<mod>_step_owners, the coordinator
--   list, fms_<mod>_master_managers — and a view-only user owns none of them.
--   NOTHING IN ANY READ PATH CONSULTS app_access AT ALL.
--
--   So the grant hands somebody a module whose dashboard loads and whose every
--   other screen is either hidden or empty. This is the read half of the fix;
--   the frontend half opens the nav links and the routes.
--
-- WHAT THIS DOES
--   A. public.module_is_viewer(uuid, text) — the readable yes/no, beside the
--      existing module_level() and module_can_edit().
--   B. One extra arm on Order to Dispatch's visibility rule, in BOTH places it
--      lives: fms_dispatch_can_see_order() and the inlined fms_dispatch_orders
--      SELECT policy. No table, column, row or other policy is touched.
--
--   The four child tables (order_items, rounds, round_items, activity) ask
--   nothing but "is my parent row visible", so they follow for free — that
--   free-ride shape is why 20260924120000 rewrote them, and it pays off here.
--
-- ⚠ 'view', NOT "has any grant". An EDIT grant must not widen row visibility:
--   an editor still sees what their ownership says, exactly as today. Nobody
--   currently working in the module sees one row more than they did yesterday.
--   The consequence is an inversion — a viewer sees MORE than an editor who
--   owns no step — and it is deliberate. Ownership answers "whose work is
--   this"; the grant answers "may this person read the module".
--
-- ⚠ BOTH COPIES OF THE RULE MOVE TOGETHER, and that is the whole reason the
--   function is touched at all. The standing equivalence check at the foot of
--   20260924120000 compares them for every (user, order) pair; widening only
--   the policy would break it. Two things follow for free from doing it
--   properly:
--     · attachments work — the fms-dispatch-docs storage read policy runs
--       fms_dispatch_can_see_doc -> fms_dispatch_can_see_order
--       (20260821120000), so a viewer's PDFs open instead of failing;
--     · notifications DO NOT change. fms_dispatch_announce() only ever NARROWS
--       an explicit p_user_ids list through can_see_order; it never expands
--       one. A viewer is not put on any caller's list, so their bell stays
--       empty — which is right. They are an auditor, not a participant.
--
-- ⚠ THE ARM IS WRAPPED AS `(select …)`, AND THAT IS NOT STYLE. module_is_viewer
--   is SECURITY DEFINER *with SET search_path*, so it is NON-INLINABLE — the
--   exact property that made this policy cost 1,620 ms per read before
--   20260924120000 hoisted it. The arm is row-independent, so wrapped it
--   becomes a single InitPlan and the policy keeps its ~5 ms shape. Re-run that
--   migration's timing query after applying this.
--
-- ⚠ DO NOT REACH FOR fms_dispatch_is_step_owner / _is_master_manager IN A READ
--   PREDICATE. 20260923120000 replaced 35 such functions in place with
--   `module_can_edit(p_uid, '<app>') and <name>__ungated(...)`, so they return
--   FALSE for precisely the view-only users this migration exists to help. Read
--   fms_dispatch_step_owners directly, as the policy below does.
--
-- ⚠ EVERY POLICY IS RECREATED `TO authenticated`. `anon` holds full table grants
--   (the Supabase default); the only thing keeping anonymous callers out is that
--   scope. The assertion at the foot fails the migration if any policy on these
--   tables ends up scoped to {public}.
--
-- ⚠ IDEMPOTENT ON PURPOSE (create or replace / drop if exists + create), so a
--   partial application is simply re-run.
--
-- Additive only: no table, column or row is created, altered or dropped.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A. THE READABLE YES/NO
--    module_level() already knows the rule; this is sugar, exactly as
--    module_can_edit() is, so the gates below read as English.
-- ---------------------------------------------------------------------------
create or replace function public.module_is_viewer(_user_id uuid, _app_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.module_level(_user_id, _app_id) = 'view';
$fn$;

comment on function public.module_is_viewer(uuid, text) is
  'Does this user hold a VIEW-ONLY grant on this app? A read-the-whole-module grant: true only for view, false for edit and for no grant at all. Admins are always false, being edit. See 20260925130000.';

revoke all on function public.module_is_viewer(uuid, text) from public, anon;
grant execute on function public.module_is_viewer(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- B1. THE RULE, IN THE FUNCTION
--     Verbatim from 20260820120000 with one arm added. Used by
--     fms_dispatch_announce() (to narrow recipients) and by
--     fms_dispatch_can_see_doc() (the storage read policy, 20260821120000).
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_can_see_order(
  p_uid uuid, p_location uuid, p_raised_by uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select p_uid is not null and (
       public.is_admin(p_uid)
    or public.fms_dispatch_is_coordinator(p_uid)
    or p_raised_by = p_uid
    or public.module_is_viewer(p_uid, 'order-to-dispatch')
    or exists (
         select 1 from public.fms_dispatch_step_owners o
          where p_uid = any(o.employee_ids)
            and (o.location_id is null or o.location_id = p_location)
       )
  );
$fn$;
grant execute on function public.fms_dispatch_can_see_order(uuid, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- B2. THE RULE, INLINED IN THE POLICY
--     Verbatim from 20260924120000 with the same arm added, wrapped so it costs
--     once per query rather than once per row.
-- ---------------------------------------------------------------------------
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
      or (select public.module_is_viewer((select auth.uid()), 'order-to-dispatch'))
      or exists (
           select 1
             from public.fms_dispatch_step_owners o
            where (select auth.uid()) = any(o.employee_ids)
              and (o.location_id is null or o.location_id = fms_dispatch_orders.location_id)
         )
    )
  );


-- ---------------------------------------------------------------------------
-- ASSERTIONS — fail rather than silently widen access.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_public int;
  v_count  int;
  v_bad    int;
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

  -- Unchanged from 20260924120000: this migration replaces one policy in place
  -- and adds none, so the count must still be 13.
  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_dispatch_orders','fms_dispatch_order_items','fms_dispatch_rounds',
                       'fms_dispatch_round_items','fms_dispatch_activity','fms_dispatch_notifications');
  if v_count <> 13 then
    raise exception 'REFUSING: expected 13 policies across the six dispatch tables, found %.', v_count;
  end if;

  -- The two copies of the rule must agree. A cheap standing-check stand-in: no
  -- view-only grantee may be refused by the function while the policy admits
  -- them. Silent when nobody holds the grant yet, which is the state today.
  select count(*) into v_bad
    from public.app_access a
   where a.app_id = 'order-to-dispatch'
     and a.access_level = 'view'
     and not public.fms_dispatch_can_see_order(
           a.user_id, null::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_bad > 0 then
    raise exception
      'REFUSING: % view-only grantee(s) are still invisible to fms_dispatch_can_see_order — the two copies of the rule have diverged.',
      v_bad;
  end if;
end $mig$;


-- ===========================================================================
-- ROLLBACK — the previous definitions, verbatim. To revert, run everything
-- between the BEGIN and END markers.
--
-- ⚠ Rehearse it on live data before relying on it: apply, roll back, and
--   confirm a view-only account's visible row count returns to 0.
--
-- ⚠ module_is_viewer() is deliberately NOT dropped by the rollback. Dropping a
--   function that another module's policy may reference by then turns a revert
--   of one module into an outage in another. It is inert once nothing calls it.
--
-- --8<-- BEGIN ROLLBACK --8<--
--
-- create or replace function public.fms_dispatch_can_see_order(
--   p_uid uuid, p_location uuid, p_raised_by uuid)
-- returns boolean language sql stable security definer set search_path = public as $fn$
--   select p_uid is not null and (
--        public.is_admin(p_uid)
--     or public.fms_dispatch_is_coordinator(p_uid)
--     or p_raised_by = p_uid
--     or exists (
--          select 1 from public.fms_dispatch_step_owners o
--           where p_uid = any(o.employee_ids)
--             and (o.location_id is null or o.location_id = p_location)
--        )
--   );
-- $fn$;
--
-- drop policy if exists fms_dispatch_orders_select on public.fms_dispatch_orders;
-- create policy fms_dispatch_orders_select
--   on public.fms_dispatch_orders
--   for select
--   to authenticated
--   using (
--     (select auth.uid()) is not null and (
--          (select public.is_admin((select auth.uid())))
--       or (select public.fms_dispatch_is_coordinator((select auth.uid())))
--       or fms_dispatch_orders.raised_by = (select auth.uid())
--       or exists (
--            select 1
--              from public.fms_dispatch_step_owners o
--             where (select auth.uid()) = any(o.employee_ids)
--               and (o.location_id is null or o.location_id = fms_dispatch_orders.location_id)
--          )
--     )
--   );
--
-- --8<-- END ROLLBACK --8<--
-- ===========================================================================


-- ===========================================================================
-- THE STANDING REGRESSION CHECK, updated. The visibility rule lives both in
-- fms_dispatch_can_see_order and inlined in the orders policy. Run this after
-- touching either one; it must report 0.
--
--   select count(*) filter (where old_v is distinct from new_v) as mismatches
--   from (
--     select
--       public.fms_dispatch_can_see_order(p.id, o.location_id, o.raised_by) old_v,
--       ( p.id is not null and (
--            public.is_admin(p.id)
--         or public.fms_dispatch_is_coordinator(p.id)
--         or o.raised_by = p.id
--         or public.module_is_viewer(p.id, 'order-to-dispatch')
--         or exists (select 1 from public.fms_dispatch_step_owners s
--                     where p.id = any(s.employee_ids)
--                       and (s.location_id is null or s.location_id = o.location_id))
--       )) new_v
--     from profiles p cross join fms_dispatch_orders o
--   ) t;
--
-- 21-Aug-2026: 28,680 pairs across 60 users, 0 mismatches, 5,120 visible on both
-- sides — measured BEFORE this migration, i.e. with no view-only grant on the
-- module yet. Re-measure once one exists: the visible count must rise by
-- exactly (view-only grantees x orders), and mismatches must stay 0.
-- ===========================================================================
