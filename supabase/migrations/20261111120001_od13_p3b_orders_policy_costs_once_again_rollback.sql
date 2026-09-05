-- ===========================================================================
-- ROLLBACK of 20261111120000_od13_p3b_orders_policy_costs_once_again.sql
--
-- Restores fms_dispatch_orders_select to the text 20261110110000 (OD-13 P2)
-- left it in -- character for character, the slow form -- and drops the two
-- helpers that file introduced.
--
-- ⚠ THIS PUTS THE ~22-SECOND LOAD BACK. It exists so the change can be undone
--   in one statement if the equivalence assertion ever turns out to have missed
--   something, not because the old text is preferable. Nothing else depends on
--   it: the helpers are called from this one policy and nowhere else, which the
--   assertion below checks before dropping them.
--
-- ⚠ THE GUARD READS pg_proc.prosrc, NOT pg_get_functiondef(). That is not a
--   style preference. pg_get_functiondef() raises
--     ERROR: 42809 "array_agg" is an aggregate function
--   the moment the planner reaches a non-plain function, and a `nspname =
--   'public'` qual is NOT a barrier -- Postgres promises no evaluation order
--   between a qual and a function call in the same scan. Reproduced on this
--   database: the two-schema form throws every time, the single-schema form
--   happens to succeed today, which is exactly what makes it dangerous. It
--   would fail HERE, in an emergency, on a plan change nobody caused.
--   `prosrc` is a plain column read and cannot throw.
--
-- ⚠ The functions are dropped AFTER the policy no longer references them.
--   The other order is a dependency error, not a silent one, but the message is
--   confusing enough to be worth avoiding.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

-- 1 · The policy, verbatim from 20261110110000.
alter policy fms_dispatch_orders_select on public.fms_dispatch_orders
  to authenticated
  using (
    (auth.uid() is not null) and (
         is_admin(auth.uid())
      or fms_dispatch_is_coordinator(auth.uid())
      or (raised_by = auth.uid())
      or module_is_viewer(auth.uid(), 'order-to-dispatch')
      or exists (
           select 1 from public.fms_dispatch_step_owners o
            where (auth.uid() = any (o.employee_ids))
              and ((o.location_id is null) or (o.location_id = fms_dispatch_orders.location_id))
         )
      or exists (
           select 1 from public.fms_dispatch_step_assignees a
            where a.order_id = fms_dispatch_orders.id and a.assigned_to = auth.uid()
         )
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

-- 2 · Nothing may still reference the helpers before they go.
do $rb$
declare v_refs int;
begin
  select count(*) into v_refs
    from pg_policies
   where schemaname in ('public', 'storage')
     and (qual like '%fms_dispatch_sees_every_order%'
       or qual like '%fms_dispatch_my_step_locations%'
       or coalesce(with_check, '') like '%fms_dispatch_sees_every_order%'
       or coalesce(with_check, '') like '%fms_dispatch_my_step_locations%');
  if v_refs <> 0 then
    raise exception 'ABORT: % policy/policies still reference the helpers this rollback drops', v_refs;
  end if;

  -- prosrc, not pg_get_functiondef -- see the header.
  select count(*) into v_refs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname not in ('fms_dispatch_sees_every_order', 'fms_dispatch_my_step_locations')
     and coalesce(p.prosrc, '') ~ '(fms_dispatch_sees_every_order|fms_dispatch_my_step_locations)';
  if v_refs <> 0 then
    raise exception 'ABORT: % function(s) still call the helpers this rollback drops', v_refs;
  end if;
end
$rb$;

drop function if exists public.fms_dispatch_sees_every_order(uuid);
drop function if exists public.fms_dispatch_my_step_locations(uuid);

-- 3 · Prove the old text is back, not a half-applied mixture.
do $rb$
begin
  perform 1 from pg_policies
   where schemaname = 'public' and tablename = 'fms_dispatch_orders'
     and policyname = 'fms_dispatch_orders_select'
     and qual like '%module_is_viewer(auth.uid()%'
     and qual not like '%fms_dispatch_sees_every_order%';
  if not found then
    raise exception 'ABORT: fms_dispatch_orders_select was not restored to the 20261110110000 text';
  end if;
end
$rb$;

commit;
