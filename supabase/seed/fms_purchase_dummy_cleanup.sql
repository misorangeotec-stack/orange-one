-- ============================================================================
-- Purchase FMS — scoped dummy-data cleanup
-- ============================================================================
-- Deletes ONLY dummy documents and the demo masters they leave behind.
--
-- SURVIVES (user-confirmed real data):
--   requests : PR-2627-0009 (Rohan), PR-2627-0010 (Vishal), PR-2627-0011 (Bushra)
--   pos      : PO-2627-0011 (Vishal, vendor JIANGYIN BEIFA) + full activity chain
--   master_requests : all 11 -- 9 non-Yash (incl. 2 pending: Rohan PACKING
--                     MATERIAL, Vishal STEAMER) + Yash's 2 post-load ones. None deleted.
--   followups: 1 (Vishal's, on PO-2627-0011)
--
-- DELETED:
--   60 requests  = 45 PR-TEST-* + 10 PR-PDEMO-* + 5 PR-2627-0004..0008 (Yash, pre-master-load)
--   46 pos       = 33 PO-TEST-* +  7 PO-PDEMO-* + 6 PO-2627-0005..0010 (Yash, pre-master-load)
--   31 followups = 21 seeded + 10 Yash (all cascade off the dummy POs)
--   demo masters: 7 items, 3 vendors, 2 companies (by explicit UUID)
--
-- WHY NOT fms_purchase_demo_teardown.sql: that script is NOT scoped -- it runs
-- bare `delete from public.fms_purchase_pos;` / `_vendors;` / `_companies;` and
-- would destroy real data. Never run it.
--
-- WHY BY DOCUMENT, NOT BY ACTOR: Yash raised the dummy 02-09 Jul documents, but
-- he is also the APPROVER on real work (16-Jul: approved Vishal's sourcing line
-- for PO-2627-0011 and two of Vishal's master requests). Deleting rows by actor
-- would gut the real PO's audit trail.
--
-- Usage:
--   dry run : psql "$SUPABASE_DB_URL" -v commit=0 -f this_file.sql
--   commit  : psql "$SUPABASE_DB_URL" -v commit=1 -f this_file.sql
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ---------------------------------------------------------------------------
-- 1. Resolve the dummy document sets ONCE, by explicit scope.
-- ---------------------------------------------------------------------------
create temp table _dummy_reqs on commit drop as
select id, request_no from public.fms_purchase_requests
where request_no like 'PR-TEST-%'
   or request_no like 'PR-PDEMO-%'
   or request_no in ('PR-2627-0004','PR-2627-0005','PR-2627-0006','PR-2627-0007','PR-2627-0008');

create temp table _dummy_pos on commit drop as
select id, po_no from public.fms_purchase_pos
where po_no like 'PO-TEST-%'
   or po_no like 'PO-PDEMO-%'
   or po_no in ('PO-2627-0005','PO-2627-0006','PO-2627-0007','PO-2627-0008','PO-2627-0009','PO-2627-0010');

-- Guard: the real documents must NEVER appear in the dummy sets.
do $$
begin
  if exists (select 1 from _dummy_reqs where request_no in ('PR-2627-0009','PR-2627-0010','PR-2627-0011'))
  or exists (select 1 from _dummy_pos  where po_no = 'PO-2627-0011') then
    raise exception 'ABORT: a real document was caught by the dummy scope';
  end if;
end $$;

-- Derived child sets (needed for the polymorphic activity/notifications wipe).
create temp table _dummy_req_items on commit drop as
select ri.id from public.fms_purchase_request_items ri join _dummy_reqs r on r.id = ri.request_id;

create temp table _dummy_po_items on commit drop as
select pi.id from public.fms_purchase_po_items pi join _dummy_pos p on p.id = pi.po_id;

create temp table _dummy_pis on commit drop as
select x.id from public.fms_purchase_pis x join _dummy_pos p on p.id = x.po_id;

create temp table _dummy_grns on commit drop as
select g.id from public.fms_purchase_grns g join _dummy_pos p on p.id = g.po_id;

-- ---------------------------------------------------------------------------
-- 2. Polymorphic tables first: activity + notifications have NO FK on
--    entity_id, so nothing cascades to them. Delete explicitly.
-- ---------------------------------------------------------------------------
create temp table _dummy_entities on commit drop as
select id from _dummy_reqs
union all select id from _dummy_pos
union all select id from _dummy_req_items
union all select id from _dummy_po_items
union all select id from _dummy_pis
union all select id from _dummy_grns;

delete from public.fms_purchase_notifications where entity_id in (select id from _dummy_entities);
delete from public.fms_purchase_activity      where entity_id in (select id from _dummy_entities);

-- ---------------------------------------------------------------------------
-- 3. PO lifecycle, innermost first (pi_items/grn_items RESTRICT po_items,
--    so PIs and GRNs must go before po_items).
-- ---------------------------------------------------------------------------
delete from public.fms_purchase_grn_items where grn_id in (select id from _dummy_grns);
delete from public.fms_purchase_grns      where po_id  in (select id from _dummy_pos);
delete from public.fms_purchase_pi_items  where pi_id  in (select id from _dummy_pis);
delete from public.fms_purchase_pis       where po_id  in (select id from _dummy_pos);
delete from public.fms_purchase_payments  where po_id  in (select id from _dummy_pos);
delete from public.fms_purchase_tally_bookings where po_id in (select id from _dummy_pos);
delete from public.fms_purchase_followups where po_id  in (select id from _dummy_pos);
delete from public.fms_purchase_po_cancel_requests where po_id in (select id from _dummy_pos);
delete from public.fms_purchase_po_items  where po_id  in (select id from _dummy_pos);
delete from public.fms_purchase_pos       where id     in (select id from _dummy_pos);

-- ---------------------------------------------------------------------------
-- 4. Request side.
-- ---------------------------------------------------------------------------
delete from public.fms_purchase_quotations
  where request_item_id in (select id from _dummy_req_items);
delete from public.fms_purchase_request_items where request_id in (select id from _dummy_reqs);
delete from public.fms_purchase_requests      where id         in (select id from _dummy_reqs);

-- ---------------------------------------------------------------------------
-- 5. Demo masters, by explicit UUID (never by name pattern, never by
--    created_by IS NULL -- real bulk-loaded masters also have a null creator).
--
--    KEPT, deactivated -- RESTRICT-pinned by the real PR-2627-0009:
--      company  1c0ab33a-09e2-4edb-b558-cd07e6da0842  Orange O Tec Enterprise
--      category ceb5c629-5839-4f4d-aea0-b5154af379e0  Raw Material
--      group    43f99f8a-fdb0-4f02-80a8-c3ffe34ef1f3  Reactive powder
--      items    Reactive Yellow 103 / Blue 105 / Brown 101 Powder
--
--    Categories/groups are deliberately NOT deleted: the 2026-06-30 groups also
--    hold early real masters (CL-1, 10LTR, BLACK-MCT, ...) that the 11-Jul
--    reload deactivated. Deleting a category CASCADEs to its groups and items,
--    which would take those with it. They are already inactive and hidden.
-- ---------------------------------------------------------------------------
delete from public.fms_purchase_items where id in (
  'e0e05dcd-9f56-41e9-8423-c1d4450c9079',  -- Isopropyl Alcohol
  'cccfef0a-b6e5-414b-952e-f44a648cb88c',  -- Acetone
  '70f13a7d-f8dd-4cda-adf2-efb0965ee1c8',  -- Blue Pigment
  '35405ccc-2121-4d0b-a6fa-d17e528d1300',  -- Red Pigment
  'a010fe42-4198-483f-b2a6-9c01e7e69218',  -- 5-ply Carton
  '180e06cd-0b08-4c0a-bd29-85c838a1e4c7',  -- Barcode Label
  '6e5ddaeb-1b71-47c2-98f6-e77dbb9b9e27'   -- Cartridge Filter
);

delete from public.fms_purchase_vendors where id in (
  '824bc57b-7def-457c-8587-bed3d1d5b2cb',  -- Acme Chemicals Pvt Ltd   (was active=true)
  'f1f7b710-dabf-40b1-bb38-be17253d156d',  -- BluePack Industries      (was active=true)
  '09a61bba-cdfd-4233-8512-5bbceb3cd58a'   -- FilterPro Supplies       (was active=true)
);

delete from public.fms_purchase_companies where id in (
  '1ad0b7cb-00f4-4dc4-a8a4-384487e902ca',  -- Orange O-tec
  'fed42a93-3718-4067-9f35-619998ff37a3'   -- Colorix
);

-- ---------------------------------------------------------------------------
-- 6. Superseded first-gen engine: drop the 26 seeded demo POs only.
--    PO-1045 (documented real) and PO-2027 (hand-made 29-Jun) are preserved.
-- ---------------------------------------------------------------------------
delete from public.fms_entries
where workflow_id = (select id from public.fms_workflows where key = 'purchase')
  and code like 'PO-2%'
  and code <> 'PO-2027';

-- ---------------------------------------------------------------------------
-- 7. Final assertion: the real data must still be exactly intact.
-- ---------------------------------------------------------------------------
do $$
declare
  n_req  int; n_po int; n_mr int; n_fu int; n_act_real int;
begin
  select count(*) into n_req from public.fms_purchase_requests;
  select count(*) into n_po  from public.fms_purchase_pos;
  select count(*) into n_mr  from public.fms_purchase_master_requests;
  select count(*) into n_fu  from public.fms_purchase_followups;
  select count(*) into n_act_real from public.fms_purchase_activity a
    join public.fms_purchase_pos p on p.id = a.entity_id where p.po_no = 'PO-2627-0011';

  if n_req <> 3 then raise exception 'ABORT: expected 3 surviving requests, got %', n_req; end if;
  if n_po  <> 1 then raise exception 'ABORT: expected 1 surviving PO, got %', n_po; end if;
  -- 11 = 9 non-Yash (Rohan 6, Vishal 3) + Yash's 2 (New Packaging req, yellow),
  -- which are post-master-load and deliberately left in place. None are deleted.
  if n_mr  <> 11 then raise exception 'ABORT: expected 11 master requests, got %', n_mr; end if;
  if n_fu  <> 1 then raise exception 'ABORT: expected 1 followup, got %', n_fu; end if;
  if n_act_real < 5 then raise exception 'ABORT: PO-2627-0011 audit chain damaged (% rows)', n_act_real; end if;

  if not exists (select 1 from public.fms_purchase_requests where request_no = 'PR-2627-0009')
  or not exists (select 1 from public.fms_purchase_requests where request_no = 'PR-2627-0010')
  or not exists (select 1 from public.fms_purchase_requests where request_no = 'PR-2627-0011')
  or not exists (select 1 from public.fms_purchase_pos      where po_no      = 'PO-2627-0011') then
    raise exception 'ABORT: a real document went missing';
  end if;

  raise notice 'OK: 3 requests, 1 PO, 9 master requests, 1 followup, % activity rows on PO-2627-0011', n_act_real;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Commit only when -v commit=1 was passed.
-- ---------------------------------------------------------------------------
\if :commit
  commit;
  \echo '>>> COMMITTED'
\else
  rollback;
  \echo '>>> DRY RUN -- rolled back, nothing changed'
\endif
