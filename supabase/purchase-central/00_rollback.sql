-- ===========================================================================
-- PURCHASE (DOMESTIC) ROLLBACK - undoes private.purchase_central_cutover().
--
-- Install this BEFORE the cutover (the cutover refuses to run without it).
--
--     select private.purchase_central_rollback();
--
-- WHAT IT PUTS BACK
--   Every requisition, line, quotation, shortlist row and PO gets its legacy
--   company / vendor / item id back from the private.pcm_*_before snapshots;
--   the foreign keys point at the legacy fms_purchase_* tables again; the two
--   server functions get their pre-cutover bodies back; the 'procurement' tick
--   added to existing ledgers is removed; the portal vendors and items the
--   cutover created are deleted. Then it checks every column against the
--   snapshot and drops the snapshots, so the cutover could run again.
--
-- ⚠ IT REFUSES ONCE PURCHASE HAS MOVED ON. A requisition, line, quotation,
--   shortlist row or PO created after the cutover carries a central id that has
--   no legacy equivalent, and there is no honest way to invent one. The guard
--   names what it found; resolve that by hand before retrying. Rollback is the
--   escape hatch for the first hours, not a way to leave after a month.
--
-- ⚠ A ROLLBACK NOBODY HAS RUN IS NOT A ROLLBACK (CENTRAL-MASTERS.md, item 19).
--   Rehearse it: begin; select private.purchase_central_cutover();
--                       select private.purchase_central_rollback(); rollback;
-- ===========================================================================

create or replace function private.purchase_central_rollback()
returns text
language plpgsql
set search_path to 'public'
as $pcmrb$
declare
  v_n    int;
  v_def  text;
  v_bad  int;
begin
  set local lock_timeout = '3s';

  if to_regclass('private.pcm_company_map') is null then
    raise exception 'ABORT: no cutover to roll back (private.pcm_company_map does not exist)';
  end if;

  -- ========================================== 0. nothing new since cutover ==
  select (select count(*) from public.fms_purchase_requests t
           where not exists (select 1 from private.pcm_requests_before b where b.id = t.id))
       + (select count(*) from public.fms_purchase_pos t
           where not exists (select 1 from private.pcm_pos_before b where b.id = t.id))
       + (select count(*) from public.fms_purchase_request_items t
           where not exists (select 1 from private.pcm_request_items_before b where b.id = t.id))
       + (select count(*) from public.fms_purchase_quotations t
           where not exists (select 1 from private.pcm_quotations_before b where b.id = t.id))
       + (select count(*) from public.fms_purchase_request_vendors t
           where not exists (select 1 from private.pcm_request_vendors_before b where b.id = t.id))
       + (select count(*) from public.fms_purchase_vendor_item_prices)
    into v_bad;
  if v_bad > 0 then
    raise exception 'ABORT: % Purchase row(s) were created after the cutover and carry central ids with no legacy equivalent. Resolve them by hand first.', v_bad;
  end if;

  -- ========================================================= 1. the rows ====
  alter table public.fms_purchase_requests      disable trigger trg_fms_purchase_requests_updated;
  alter table public.fms_purchase_pos           disable trigger trg_fms_purchase_pos_updated;
  alter table public.fms_purchase_request_items disable trigger trg_fms_purchase_request_items_updated;

  alter table public.fms_purchase_requests      drop constraint fms_purchase_requests_company_id_fkey;
  alter table public.fms_purchase_pos           drop constraint fms_purchase_pos_company_id_fkey,
                                                drop constraint fms_purchase_pos_vendor_id_fkey;
  alter table public.fms_purchase_request_items drop constraint fms_purchase_request_items_item_id_fkey,
                                                drop constraint fms_purchase_request_items_final_vendor_id_fkey;
  alter table public.fms_purchase_quotations    drop constraint fms_purchase_quotations_vendor_id_fkey;
  alter table public.fms_purchase_request_vendors drop constraint fms_purchase_request_vendors_vendor_id_fkey;
  alter table public.fms_purchase_vendor_item_prices
    drop constraint fms_purchase_vendor_item_prices_vendor_id_fkey,
    drop constraint fms_purchase_vendor_item_prices_item_id_fkey;

  update public.fms_purchase_requests t set company_id = b.company_id
    from private.pcm_requests_before b where b.id = t.id;
  update public.fms_purchase_pos t set company_id = b.company_id, vendor_id = b.vendor_id
    from private.pcm_pos_before b where b.id = t.id;
  update public.fms_purchase_request_items t set item_id = b.item_id, final_vendor_id = b.final_vendor_id
    from private.pcm_request_items_before b where b.id = t.id;
  update public.fms_purchase_quotations t set vendor_id = b.vendor_id
    from private.pcm_quotations_before b where b.id = t.id;
  update public.fms_purchase_request_vendors t set vendor_id = b.vendor_id
    from private.pcm_request_vendors_before b where b.id = t.id;

  alter table public.fms_purchase_requests
    add constraint fms_purchase_requests_company_id_fkey
      foreign key (company_id) references public.fms_purchase_companies(id) on delete restrict;
  alter table public.fms_purchase_pos
    add constraint fms_purchase_pos_company_id_fkey
      foreign key (company_id) references public.fms_purchase_companies(id) on delete restrict,
    add constraint fms_purchase_pos_vendor_id_fkey
      foreign key (vendor_id) references public.fms_purchase_vendors(id) on delete restrict;
  alter table public.fms_purchase_request_items
    add constraint fms_purchase_request_items_item_id_fkey
      foreign key (item_id) references public.fms_purchase_items(id) on delete restrict,
    add constraint fms_purchase_request_items_final_vendor_id_fkey
      foreign key (final_vendor_id) references public.fms_purchase_vendors(id) on delete set null;
  alter table public.fms_purchase_quotations
    add constraint fms_purchase_quotations_vendor_id_fkey
      foreign key (vendor_id) references public.fms_purchase_vendors(id) on delete restrict;
  alter table public.fms_purchase_request_vendors
    add constraint fms_purchase_request_vendors_vendor_id_fkey
      foreign key (vendor_id) references public.fms_purchase_vendors(id) on delete restrict;
  alter table public.fms_purchase_vendor_item_prices
    add constraint fms_purchase_vendor_item_prices_vendor_id_fkey
      foreign key (vendor_id) references public.fms_purchase_vendors(id) on delete cascade,
    add constraint fms_purchase_vendor_item_prices_item_id_fkey
      foreign key (item_id) references public.fms_purchase_items(id) on delete cascade;

  alter table public.fms_purchase_requests      enable trigger trg_fms_purchase_requests_updated;
  alter table public.fms_purchase_pos           enable trigger trg_fms_purchase_pos_updated;
  alter table public.fms_purchase_request_items enable trigger trg_fms_purchase_request_items_updated;

  -- ===================================================== 2. the functions ===
  for v_def in select definition from private.pcm_functions_before loop
    execute v_def;
  end loop;

  -- ================================================ 3. the central masters ==
  update public.mst_parties mp set modules = b.modules
    from private.pcm_party_modules_before b where b.id = mp.id;

  --    Only rows the cutover itself created, and only once nothing points at
  --    them - a foreign key from anywhere else fails this loudly, which is the
  --    right outcome (somebody started using it; decide by hand).
  delete from public.mst_parties where id in (select id from private.pcm_seeded_parties);
  get diagnostics v_n = row_count;
  if v_n <> (select count(*) from private.pcm_seeded_parties) then
    raise exception 'ABORT: removed % of % portal vendors', v_n, (select count(*) from private.pcm_seeded_parties);
  end if;
  delete from public.mst_items where id in (select id from private.pcm_seeded_items);
  get diagnostics v_n = row_count;
  if v_n <> (select count(*) from private.pcm_seeded_items) then
    raise exception 'ABORT: removed % of % portal items', v_n, (select count(*) from private.pcm_seeded_items);
  end if;

  -- ========================================================= 4. verify ======
  select (select count(*) from (
            select id, company_id from public.fms_purchase_requests
            except select id, company_id from private.pcm_requests_before) x)
       + (select count(*) from (
            select id, company_id, vendor_id from public.fms_purchase_pos
            except select id, company_id, vendor_id from private.pcm_pos_before) x)
       + (select count(*) from (
            select id, request_id, item_id, final_vendor_id from public.fms_purchase_request_items
            except select id, request_id, item_id, final_vendor_id from private.pcm_request_items_before) x)
       + (select count(*) from (
            select id, request_item_id, vendor_id from public.fms_purchase_quotations
            except select id, request_item_id, vendor_id from private.pcm_quotations_before) x)
       + (select count(*) from (
            select id, request_id, vendor_id from public.fms_purchase_request_vendors
            except select id, request_id, vendor_id from private.pcm_request_vendors_before) x)
    into v_bad;
  if v_bad > 0 then
    raise exception 'ABORT: % row(s) do not match the pre-cutover snapshot after rollback', v_bad;
  end if;

  select count(*) into v_bad
    from private.pcm_functions_before b
    join pg_proc p on p.proname = b.proname
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where pg_get_functiondef(p.oid) <> b.definition;
  if v_bad > 0 then
    raise exception 'ABORT: % function(s) did not come back byte-identical', v_bad;
  end if;

  -- ===================================================== 5. clear the way ===
  drop table private.pcm_requests_before, private.pcm_pos_before,
             private.pcm_request_items_before, private.pcm_quotations_before,
             private.pcm_request_vendors_before, private.pcm_functions_before,
             private.pcm_seeded_parties, private.pcm_seeded_items,
             private.pcm_party_modules_before, private.pcm_company_map,
             private.pcm_vendor_use, private.pcm_vendor_map,
             private.pcm_item_use, private.pcm_item_map;

  return 'Purchase rollback OK - every row, key and function is back on the legacy masters.';
end
$pcmrb$;

revoke all on function private.purchase_central_rollback() from public, anon, authenticated;
