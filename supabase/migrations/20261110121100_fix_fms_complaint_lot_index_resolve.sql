-- ===========================================================================
-- Complaint (RM/FG) FMS — LOT INDEX RESOLVER FIX (Phase 10b).
--
-- 20261110120900 shipped fms_complaint_lot_index_resolve() using min(id) to pick
-- the one row out of each name group:
--
--   select lower(btrim(name)) as key, min(id) as id ... having count(*) = 1
--
-- POSTGRES HAS NO min(uuid). The function raised
--
--   42883: function min(uuid) does not exist
--
-- on its first real call, after the extractor had already loaded 31,852 rows —
-- so the index was populated but every party_id and item_id stayed null.
--
-- THE FIX: `(array_agg(id))[1]`. The `having count(*) = 1` already guarantees
-- exactly one row per group, so which aggregate picks it is irrelevant — it just
-- has to be one that accepts a uuid. Using an aggregate that implies "smallest"
-- was misleading anyway: there is no meaningful order over uuids here, and the
-- guarantee comes from the HAVING, not from the aggregate.
--
-- Behaviour is otherwise unchanged: exact, case-insensitive, UNAMBIGUOUS name
-- matches only. A null id is normal and never blocks a lookup — the form falls
-- back to the frozen name, which is what a complaint stores anyway.
--
-- Reversal: re-apply the definition from 20261110120900 (which does not run).
-- ===========================================================================

begin;

create or replace function public.fms_complaint_lot_index_resolve()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parties int;
  v_items   int;
begin
  update public.fms_complaint_lot_index i
     set party_id = p.id
    from (
      select lower(btrim(name)) as key, (array_agg(id))[1] as id
        from public.mst_parties
       where active
       group by lower(btrim(name))
      having count(*) = 1          -- unambiguous only; the aggregate just unwraps it
    ) p
   where i.party_id is null
     and i.party_name is not null
     and lower(btrim(i.party_name)) = p.key;
  get diagnostics v_parties = row_count;

  update public.fms_complaint_lot_index i
     set item_id = it.id
    from (
      select lower(btrim(name)) as key, (array_agg(id))[1] as id
        from public.mst_items
       where active
       group by lower(btrim(name))
      having count(*) = 1
    ) it
   where i.item_id is null
     and i.item_name is not null
     and lower(btrim(i.item_name)) = it.key;
  get diagnostics v_items = row_count;

  return format('parties=%s items=%s', v_parties, v_items);
end $$;

comment on function public.fms_complaint_lot_index_resolve() is
  'Fill party_id / item_id on the lot index by exact, unambiguous, case-insensitive name match. Best-effort: a null id is normal and the form falls back to the name.';
revoke all on function public.fms_complaint_lot_index_resolve() from public;
grant execute on function public.fms_complaint_lot_index_resolve() to service_role;

commit;
