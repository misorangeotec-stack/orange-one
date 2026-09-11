-- ===========================================================================
-- ROLLBACK OF 20261117120000_od14_org_items_from_setup.sql
--
-- ⚠ THE MAPPING ROWS THIS CREATED ARE NOT UNDONE, AND MUST NOT BE. They are
--   rows in a governed central master, indistinguishable from ones added in
--   Central Masters → Customer Items, and a customer may already have ordered
--   against them. Rolling back the CODE takes the Setup screen's shortcut away;
--   it does not un-decide what a customer may buy.
--
--   To find what this screen added, if that is ever needed:
--     select * from public.mst_party_items
--      where source = 'portal' and created_by is not null
--        and created_at >= '<when the migration was applied>';
--   (`created_by is not null` is the mark of a person rather than the sync —
--   `source` cannot carry it, because masters-sync overwrites source to
--   'sales_register' the first time the customer actually buys the item.)
--
-- ⚠ PART 2 GOES BACK TO A KNOWN BUG. The restored readiness function counts
--   switched-off mappings as items again, so a customer whose mappings were all
--   withdrawn will read "Ready to switch on: Yes" and open an empty order
--   screen. Restored verbatim anyway, because a rollback that leaves a
--   half-fixed function is worse than one that returns to the state everything
--   else was written against.
-- ===========================================================================

begin;

drop function if exists public.fms_dispatch_set_customer_org_items(uuid[], uuid[], uuid[]);

-- Verbatim as it stood before, from pg_get_functiondef.
create or replace function public.fms_dispatch_customer_org_readiness(
  p_party_ids uuid[], p_notify_user_ids uuid[], p_primary_party_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'missing', coalesce(jsonb_agg(m order by m), '[]'::jsonb),
    'item_count', (
      select count(distinct i.name)
        from public.mst_party_items pi
        join public.mst_items i on i.id = pi.item_id
       where pi.party_id = any (coalesce(p_party_ids, '{}'::uuid[])) and i.active
    )
  )
  from (
    select 'ledgers' as m where coalesce(cardinality(p_party_ids), 0) = 0
    union all
    select 'primary_ledger'
     where p_primary_party_id is null
        or not (p_primary_party_id = any (coalesce(p_party_ids, '{}'::uuid[])))
    union all
    select 'recipients' where coalesce(cardinality(p_notify_user_ids), 0) = 0
    union all
    select 'items' where not exists (
       select 1 from public.mst_party_items pi
        join public.mst_items i on i.id = pi.item_id
        where pi.party_id = any (coalesce(p_party_ids, '{}'::uuid[])) and i.active)
  ) s;
$fn$;

commit;
