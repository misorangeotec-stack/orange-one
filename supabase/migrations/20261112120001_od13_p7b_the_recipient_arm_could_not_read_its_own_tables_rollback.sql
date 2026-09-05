-- ===========================================================================
-- ROLLBACK for 20261112120000_od13_p7b_the_recipient_arm_could_not_read_its_own_tables.sql
--
-- Restores the sixth arm of fms_dispatch_orders_select to the inline EXISTS it
-- carried between 20261110110000 and 20261112120000, and drops the helper.
--
-- ⚠ RUNNING THIS RE-OPENS THE DEFECT. A named recipient who is not a
--   coordinator goes back to being unable to see the customer order they are
--   announced about. Only run it if the fix itself has caused a worse problem.
--
-- ⚠ REHEARSED, NOT ASSUMED. Applied on the live database on 05-09-2026,
--   immediately after the forward migration, and then rolled forward again.
--   Both directions verified by re-reading pg_policies and by re-running the
--   as-Jayshree RLS probe (visible after forward, invisible after rollback).
--
-- ⚠ Same ordering rule as the forward file: `alter policy` holds ACCESS
--   EXCLUSIVE on fms_dispatch_orders until COMMIT. Nothing slow lives below it.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

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

drop function if exists public.fms_dispatch_customer_raisers_for(uuid);

do $mig$
begin
  perform 1 from pg_policies
   where schemaname = 'public' and tablename = 'fms_dispatch_orders'
     and policyname = 'fms_dispatch_orders_select'
     and qual like '%fms_dispatch_customer_logins%'
     and qual not like '%fms_dispatch_customer_raisers_for%';
  if not found then
    raise exception 'ABORT: rollback did not restore the inline customer arm';
  end if;
end
$mig$;

commit;
