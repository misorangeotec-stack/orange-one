-- ===========================================================================
-- PURCHASE (DOMESTIC) CUTOVER - Purchase FMS moves onto Central Masters.
--
-- Companies, vendors and items stop being Purchase's own hand-typed lists and
-- become the Tally-fed mst_* rows every other module shares - the same move
-- Order to Dispatch made on 2026-08-17 (see CENTRAL-MASTERS.md).
--
-- Installed as a FUNCTION so the dry run, the rehearsal and the real run
-- execute byte-identical code:
--
--     dry run   begin; select private.purchase_central_cutover(); rollback;
--     rehearsal begin; select private.purchase_central_cutover();
--                      select private.purchase_central_rollback(); rollback;
--     real      select private.purchase_central_cutover();
--
-- Needs: migration 20261217120000_fms_purchase_category_item_types.sql, and
--        00_rollback.sql installed BEFORE this runs for real.
--
-- WHAT MOVES
--   fms_purchase_companies (4)  -> mst_companies (Tally books, by alias+site)
--   fms_purchase_vendors        -> mst_parties   (vendor ledgers, per book)
--   fms_purchase_items          -> mst_items     (stock items, per book)
--   and every requisition, requisition line, quotation, shortlist row and PO
--   is repointed. Categories, QC, approvals and every step are untouched.
--
-- ⚠ ONE LEGACY VENDOR CAN BECOME SEVERAL CENTRAL ROWS, AND THAT IS CORRECT.
--   Tally keeps a separate ledger for a firm in every book it trades with, so
--   "Satyam infotec" bought from by both O-tec and Enterprise is two ledgers.
--   The map is therefore keyed (legacy vendor, company book), and each row is
--   pointed at the ledger in ITS OWN requisition's book. Never cross-book: a PO
--   raised by Enterprise against O-tec's ledger would flow into the wrong
--   Tally company - the same trap CENTRAL-MASTERS.md records for customers.
--
-- ⚠ ITEMS MAY CROSS BOOKS, VENDORS MAY NOT. Most of the catalogue is filed under
--   one company's book while both firms buy it (the O2D finding). A legacy item
--   with no twin in its own book but one in another is pointed there rather
--   than duplicated.
--
-- WHAT IS CREATED
--   A used vendor with no ledger of that name in that book, and a used item
--   with no stock item of that name anywhere, become source='portal' rows in
--   the requisition's book, ticked 'procurement'. Nothing is lost; Reconcile
--   merges them onto their Tally twin later, keeping this row's id.
--
-- WHAT IS NOT CARRIED
--   Legacy vendors and items no requisition, quotation or PO ever named. Tally
--   already holds most of them; the rest are listed by 02_report.sql for a
--   human to add through Central Masters if they are still wanted.
--
-- WHAT IT DOES NOT TOUCH, DELIBERATELY
--   The legacy tables themselves. They stay populated and unread, and together
--   with the private.pcm_* snapshots they are the rollback.
-- ===========================================================================

create or replace function private.purchase_central_cutover()
returns text
language plpgsql
set search_path to 'public'
as $pcm$
declare
  v_requests      int;
  v_pos           int;
  v_lines         int;
  v_quotes        int;
  v_shortlist     int;
  v_n             int;
  v_new_id        uuid;
  v_vendor_tally  int;
  v_vendor_flag   int;
  v_vendor_portal int;
  v_item_same     int;
  v_item_other    int;
  v_item_portal   int;
  v_row           record;
begin
  -- Fail fast rather than stall the app if a query is mid-flight.
  set local lock_timeout = '3s';

  -- ================================================== 0. refuse to re-run ==
  if to_regclass('private.pcm_company_map') is not null then
    raise exception 'ABORT: private.pcm_company_map already exists - the cutover has already run';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'fms_purchase_categories'
                    and column_name = 'item_types') then
    raise exception 'ABORT: apply migration 20261217120000_fms_purchase_category_item_types.sql first';
  end if;
  if to_regproc('private.purchase_central_rollback') is null then
    raise exception 'ABORT: install 00_rollback.sql first - never cut over without the way back installed';
  end if;
  --    A vendor-item rate has no company of its own, so there is no book to map
  --    its vendor into. There are none today; refuse rather than guess.
  if exists (select 1 from public.fms_purchase_vendor_item_prices) then
    raise exception 'ABORT: fms_purchase_vendor_item_prices has % row(s); this cutover expects it empty',
      (select count(*) from public.fms_purchase_vendor_item_prices);
  end if;

  select count(*) into v_requests  from public.fms_purchase_requests;
  select count(*) into v_pos       from public.fms_purchase_pos;
  select count(*) into v_lines     from public.fms_purchase_request_items;
  select count(*) into v_quotes    from public.fms_purchase_quotations;
  select count(*) into v_shortlist from public.fms_purchase_request_vendors;

  -- ========================================================== 1. snapshots ==
  create table private.pcm_requests_before      as select id, company_id from public.fms_purchase_requests;
  create table private.pcm_pos_before           as select id, company_id, vendor_id from public.fms_purchase_pos;
  create table private.pcm_request_items_before as select id, request_id, item_id, final_vendor_id from public.fms_purchase_request_items;
  create table private.pcm_quotations_before    as select id, request_item_id, vendor_id from public.fms_purchase_quotations;
  create table private.pcm_request_vendors_before as select id, request_id, vendor_id from public.fms_purchase_request_vendors;

  create table private.pcm_functions_before (proname text primary key, definition text not null);
  insert into private.pcm_functions_before (proname, definition)
  select p.proname, pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_purchase_resolve_master_request', 'fms_purchase_save_sourcing_request');
  if (select count(*) from private.pcm_functions_before) <> 2 then
    raise exception 'ABORT: expected 2 function definitions to snapshot, found %',
      (select count(*) from private.pcm_functions_before);
  end if;

  create table private.pcm_seeded_parties (id uuid primary key);
  create table private.pcm_seeded_items   (id uuid primary key);
  create table private.pcm_party_modules_before (id uuid primary key, modules text[]);

  -- ===================================================== 2. company map ====
  --    Deterministic: "…Enterprise…" -> alias Enterprise, anything else ->
  --    O-tec; the legacy location picks the site's book.
  create table private.pcm_company_map as
  select pc.id                                              as legacy_company_id,
         mc.id                                              as book_id,
         coalesce(mc.alias, mc.name) || ' — ' || coalesce(mc.location, '') as book_label
    from public.fms_purchase_companies pc
    join public.mst_companies mc
      on mc.alias = case when pc.name ilike '%enterprise%' then 'Enterprise' else 'O-tec' end
     and lower(mc.location) = lower(pc.location);

  if (select count(*) from private.pcm_company_map) <> (select count(*) from public.fms_purchase_companies)
     or (select count(distinct legacy_company_id) from private.pcm_company_map)
        <> (select count(*) from public.fms_purchase_companies) then
    raise exception 'ABORT: company map has % rows for % legacy companies - an alias or location did not match exactly once',
      (select count(*) from private.pcm_company_map), (select count(*) from public.fms_purchase_companies);
  end if;

  -- ====================================================== 3. vendor map ====
  --    Every (legacy vendor, book) a transaction actually names.
  create table private.pcm_vendor_use as
  select distinct u.vendor_id as legacy_vendor_id, cm.book_id
    from (
      select pb.vendor_id, pb.company_id from private.pcm_pos_before pb
      union all
      select qb.vendor_id, rb.company_id
        from private.pcm_quotations_before qb
        join private.pcm_request_items_before ib on ib.id = qb.request_item_id
        join private.pcm_requests_before rb on rb.id = ib.request_id
      union all
      select ib.final_vendor_id, rb.company_id
        from private.pcm_request_items_before ib
        join private.pcm_requests_before rb on rb.id = ib.request_id
       where ib.final_vendor_id is not null
      union all
      select vb.vendor_id, rb.company_id
        from private.pcm_request_vendors_before vb
        join private.pcm_requests_before rb on rb.id = vb.request_id
    ) u
    join private.pcm_company_map cm on cm.legacy_company_id = u.company_id;

  create table private.pcm_vendor_map (
    legacy_vendor_id uuid not null,
    book_id          uuid not null,
    target_id        uuid not null,
    how              text not null,   -- tally_vendor | tally_ledger | portal_created
    primary key (legacy_vendor_id, book_id));

  --    The name is compared with case, spaces and punctuation stripped, and
  --    ONLY inside the same book. Built once: 7,800 ledgers x 63 pairs of
  --    regexp_replace in a correlated subquery is what timed out when measured.
  create temp table pcm_party_keys on commit drop as
  select mp.id, mp.company_id, mp.is_vendor, mp.source, mp.active,
         regexp_replace(lower(mp.name), '[^a-z0-9]', '', 'g') as k
    from public.mst_parties mp
   where mp.company_id is not null;

  insert into private.pcm_vendor_map (legacy_vendor_id, book_id, target_id, how)
  select vu.legacy_vendor_id, vu.book_id, pick.id,
         case when pick.is_vendor then 'tally_vendor' else 'tally_ledger' end
    from private.pcm_vendor_use vu
    join public.fms_purchase_vendors fv on fv.id = vu.legacy_vendor_id
    cross join lateral (
      select pk.id, pk.is_vendor
        from pcm_party_keys pk
       where pk.company_id = vu.book_id
         and pk.k = regexp_replace(lower(fv.name), '[^a-z0-9]', '', 'g')
       order by pk.is_vendor desc, (pk.source = 'tally') desc, pk.active desc, pk.id
       limit 1) pick;

  --    A ledger of that name exists in the book but Tally does not file it as
  --    a creditor (it is a customer we also buy from). Point at it - a second
  --    row would be a duplicate - and tick 'procurement' so the vendor picker,
  --    which shows is_vendor OR the tick, still offers it. `modules` is
  --    portal-owned; no sync rewrites it.
  insert into private.pcm_party_modules_before (id, modules)
  select distinct mp.id, mp.modules
    from private.pcm_vendor_map vm
    join public.mst_parties mp on mp.id = vm.target_id
   where vm.how = 'tally_ledger'
     and not (mp.modules @> array['procurement']);
  update public.mst_parties mp
     set modules = array_append(mp.modules, 'procurement')
   where mp.id in (select id from private.pcm_party_modules_before);

  --    No ledger of that name in that book: a portal vendor in that book.
  for v_row in
    select vu.legacy_vendor_id, vu.book_id, fv.name, fv.gstin, fv.contact_name,
           fv.phone, fv.email, fv.address, fv.active, fv.created_by
      from private.pcm_vendor_use vu
      join public.fms_purchase_vendors fv on fv.id = vu.legacy_vendor_id
     where not exists (select 1 from private.pcm_vendor_map vm
                        where vm.legacy_vendor_id = vu.legacy_vendor_id and vm.book_id = vu.book_id)
  loop
    insert into public.mst_parties
      (name, gstin, contact_name, phone, email, address, company_id,
       is_customer, is_vendor, source, modules, active, created_by)
    values (trim(v_row.name), nullif(trim(v_row.gstin), ''), nullif(trim(v_row.contact_name), ''),
            nullif(trim(v_row.phone), ''), nullif(trim(v_row.email), ''), nullif(trim(v_row.address), ''),
            v_row.book_id, false, true, 'portal', array['procurement'], v_row.active, v_row.created_by)
    returning id into v_new_id;
    insert into private.pcm_seeded_parties (id) values (v_new_id);
    insert into private.pcm_vendor_map (legacy_vendor_id, book_id, target_id, how)
    values (v_row.legacy_vendor_id, v_row.book_id, v_new_id, 'portal_created');
  end loop;

  if (select count(*) from private.pcm_vendor_map) <> (select count(*) from private.pcm_vendor_use) then
    raise exception 'ABORT: vendor map has % rows for % (vendor, book) pairs',
      (select count(*) from private.pcm_vendor_map), (select count(*) from private.pcm_vendor_use);
  end if;

  -- ======================================================== 4. item map ====
  create table private.pcm_item_use as
  select distinct ib.item_id as legacy_item_id, cm.book_id
    from private.pcm_request_items_before ib
    join private.pcm_requests_before rb on rb.id = ib.request_id
    join private.pcm_company_map cm on cm.legacy_company_id = rb.company_id;

  create table private.pcm_item_map (
    legacy_item_id uuid not null,
    book_id        uuid not null,
    target_id      uuid not null,
    how            text not null,   -- same_book | other_book | portal_created
    primary key (legacy_item_id, book_id));

  --    Items match on the name with runs of whitespace collapsed and case
  --    ignored, and nothing else - the same conservative rule the item-sheet
  --    load settled on (CENTRAL-MASTERS.md). Punctuation still has to agree.
  create temp table pcm_item_keys on commit drop as
  select mi.id, mi.company_id, mi.source, mi.active,
         regexp_replace(lower(trim(mi.name)), '\s+', ' ', 'g') as k
    from public.mst_items mi;

  insert into private.pcm_item_map (legacy_item_id, book_id, target_id, how)
  select iu.legacy_item_id, iu.book_id, pick.id, pick.how
    from private.pcm_item_use iu
    join public.fms_purchase_items fi on fi.id = iu.legacy_item_id
    cross join lateral (
      select ik.id, case when ik.company_id = iu.book_id then 'same_book' else 'other_book' end as how
        from pcm_item_keys ik
       where ik.k = regexp_replace(lower(trim(fi.name)), '\s+', ' ', 'g')
       order by (ik.company_id = iu.book_id) desc, (ik.source = 'tally') desc, ik.active desc, ik.id
       limit 1) pick;

  --    Nowhere in Tally: a portal item in the requisition's book, typed from
  --    its legacy category so it keeps turning up under that category.
  for v_row in
    select iu.legacy_item_id, iu.book_id, fi.name, fi.unit, fi.active, fi.created_by,
           (select c.item_types[1] from public.fms_purchase_categories c where c.id = fi.category_id) as item_type
      from private.pcm_item_use iu
      join public.fms_purchase_items fi on fi.id = iu.legacy_item_id
     where not exists (select 1 from private.pcm_item_map im
                        where im.legacy_item_id = iu.legacy_item_id and im.book_id = iu.book_id)
  loop
    insert into public.mst_items (name, company_id, unit_id, item_type, source, modules, active, created_by)
    values (trim(v_row.name), v_row.book_id,
            (select u.id from public.mst_units u where upper(u.name) = upper(trim(coalesce(v_row.unit, '')))),
            v_row.item_type, 'portal', array['procurement'], v_row.active, v_row.created_by)
    returning id into v_new_id;
    insert into private.pcm_seeded_items (id) values (v_new_id);
    insert into private.pcm_item_map (legacy_item_id, book_id, target_id, how)
    values (v_row.legacy_item_id, v_row.book_id, v_new_id, 'portal_created');
  end loop;

  if (select count(*) from private.pcm_item_map) <> (select count(*) from private.pcm_item_use) then
    raise exception 'ABORT: item map has % rows for % (item, book) pairs',
      (select count(*) from private.pcm_item_map), (select count(*) from private.pcm_item_use);
  end if;

  -- ================================================ 5. repoint the rows ====
  --    updated_at is left alone: this is a relabel, not an edit, and a queue
  --    that sorted by "last touched" would otherwise reshuffle every row.
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

  --    ⚠ EVERY JOIN BELOW READS THE *_before SNAPSHOTS, never the live column
  --      it is rewriting. Once requests.company_id holds a book id, a join from
  --      a line to "its requisition's legacy company" would match nothing.
  update public.fms_purchase_pos t
     set company_id = cm.book_id, vendor_id = vm.target_id
    from private.pcm_pos_before pb
    join private.pcm_company_map cm on cm.legacy_company_id = pb.company_id
    join private.pcm_vendor_map vm on vm.legacy_vendor_id = pb.vendor_id and vm.book_id = cm.book_id
   where t.id = pb.id;
  get diagnostics v_n = row_count;
  if v_n <> v_pos then raise exception 'ABORT: repointed % of % POs', v_n, v_pos; end if;

  update public.fms_purchase_request_items t
     set item_id = im.target_id
    from private.pcm_request_items_before ib
    join private.pcm_requests_before rb on rb.id = ib.request_id
    join private.pcm_company_map cm on cm.legacy_company_id = rb.company_id
    join private.pcm_item_map im on im.legacy_item_id = ib.item_id and im.book_id = cm.book_id
   where t.id = ib.id;
  get diagnostics v_n = row_count;
  if v_n <> v_lines then raise exception 'ABORT: repointed % of % requisition lines (item)', v_n, v_lines; end if;

  update public.fms_purchase_request_items t
     set final_vendor_id = vm.target_id
    from private.pcm_request_items_before ib
    join private.pcm_requests_before rb on rb.id = ib.request_id
    join private.pcm_company_map cm on cm.legacy_company_id = rb.company_id
    join private.pcm_vendor_map vm on vm.legacy_vendor_id = ib.final_vendor_id and vm.book_id = cm.book_id
   where t.id = ib.id;
  get diagnostics v_n = row_count;
  if v_n <> (select count(*) from private.pcm_request_items_before where final_vendor_id is not null) then
    raise exception 'ABORT: repointed % requisition lines (final vendor), expected %',
      v_n, (select count(*) from private.pcm_request_items_before where final_vendor_id is not null);
  end if;

  update public.fms_purchase_quotations t
     set vendor_id = vm.target_id
    from private.pcm_quotations_before qb
    join private.pcm_request_items_before ib on ib.id = qb.request_item_id
    join private.pcm_requests_before rb on rb.id = ib.request_id
    join private.pcm_company_map cm on cm.legacy_company_id = rb.company_id
    join private.pcm_vendor_map vm on vm.legacy_vendor_id = qb.vendor_id and vm.book_id = cm.book_id
   where t.id = qb.id;
  get diagnostics v_n = row_count;
  if v_n <> v_quotes then raise exception 'ABORT: repointed % of % quotations', v_n, v_quotes; end if;

  update public.fms_purchase_request_vendors t
     set vendor_id = vm.target_id
    from private.pcm_request_vendors_before vb
    join private.pcm_requests_before rb on rb.id = vb.request_id
    join private.pcm_company_map cm on cm.legacy_company_id = rb.company_id
    join private.pcm_vendor_map vm on vm.legacy_vendor_id = vb.vendor_id and vm.book_id = cm.book_id
   where t.id = vb.id;
  get diagnostics v_n = row_count;
  if v_n <> v_shortlist then raise exception 'ABORT: repointed % of % shortlist rows', v_n, v_shortlist; end if;

  update public.fms_purchase_requests t
     set company_id = cm.book_id
    from private.pcm_requests_before rb
    join private.pcm_company_map cm on cm.legacy_company_id = rb.company_id
   where t.id = rb.id;
  get diagnostics v_n = row_count;
  if v_n <> v_requests then raise exception 'ABORT: repointed % of % requisitions', v_n, v_requests; end if;

  --    Same names and delete rules as before; only the target table changes.
  alter table public.fms_purchase_requests
    add constraint fms_purchase_requests_company_id_fkey
      foreign key (company_id) references public.mst_companies(id) on delete restrict;
  alter table public.fms_purchase_pos
    add constraint fms_purchase_pos_company_id_fkey
      foreign key (company_id) references public.mst_companies(id) on delete restrict,
    add constraint fms_purchase_pos_vendor_id_fkey
      foreign key (vendor_id) references public.mst_parties(id) on delete restrict;
  alter table public.fms_purchase_request_items
    add constraint fms_purchase_request_items_item_id_fkey
      foreign key (item_id) references public.mst_items(id) on delete restrict,
    add constraint fms_purchase_request_items_final_vendor_id_fkey
      foreign key (final_vendor_id) references public.mst_parties(id) on delete set null;
  alter table public.fms_purchase_quotations
    add constraint fms_purchase_quotations_vendor_id_fkey
      foreign key (vendor_id) references public.mst_parties(id) on delete restrict;
  alter table public.fms_purchase_request_vendors
    add constraint fms_purchase_request_vendors_vendor_id_fkey
      foreign key (vendor_id) references public.mst_parties(id) on delete restrict;
  alter table public.fms_purchase_vendor_item_prices
    add constraint fms_purchase_vendor_item_prices_vendor_id_fkey
      foreign key (vendor_id) references public.mst_parties(id) on delete cascade,
    add constraint fms_purchase_vendor_item_prices_item_id_fkey
      foreign key (item_id) references public.mst_items(id) on delete cascade;

  alter table public.fms_purchase_requests      enable trigger trg_fms_purchase_requests_updated;
  alter table public.fms_purchase_pos           enable trigger trg_fms_purchase_pos_updated;
  alter table public.fms_purchase_request_items enable trigger trg_fms_purchase_request_items_updated;

  -- ======================================================= 6. functions ====
  --    The only two server functions that name a legacy master.
  execute $ddl$
create or replace function public.fms_purchase_resolve_master_request(
  p_request_id uuid, p_approve boolean, p_payload jsonb default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
-- Central Masters: an approved vendor or item becomes a source='portal' row in
-- mst_parties / mst_items, in the book the request names, ticked 'procurement'.
-- Tally's own copy arrives with the sync; Reconcile merges the two keeping this
-- row's id. Categories and rates stay Purchase's own.
declare
  v_type      text;
  v_status    text;
  v_payload   jsonb;
  v_new_id    uuid;
  v_name      text;
  v_company   uuid;
  v_item_type text;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_purchase_master_requests
  where id = p_request_id
  for update;

  if v_type is null then
    raise exception 'Master request % not found', p_request_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'Master request % is already %', p_request_id, v_status;
  end if;

  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_master_manager(v_type, auth.uid()) or public.pc_is_coordinator(auth.uid())) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);
  v_name    := nullif(trim(v_payload->>'name'), '');
  v_company := nullif(trim(v_payload->>'company_id'), '')::uuid;

  if p_approve then
    if v_type = 'vendor' then
      if v_name is null then raise exception 'A vendor name is required'; end if;
      -- A vendor is a ledger in ONE company's books, exactly as Tally holds it.
      if v_company is null then
        raise exception 'Pick the company whose books this vendor belongs to';
      end if;
      insert into public.mst_parties
        (name, gstin, contact_name, phone, email, address, company_id,
         is_customer, is_vendor, source, modules, created_by)
      values (v_name, nullif(trim(v_payload->>'gstin'), ''), nullif(trim(v_payload->>'contact_name'), ''),
              nullif(trim(v_payload->>'phone'), ''), nullif(trim(v_payload->>'email'), ''),
              nullif(trim(v_payload->>'address'), ''), v_company,
              false, true, 'portal', array['procurement'], auth.uid())
      returning id into v_new_id;

    elsif v_type = 'category' then
      insert into public.fms_purchase_categories (name, created_by)
      values (v_name, auth.uid())
      returning id into v_new_id;

    elsif v_type = 'item_group' then
      -- Retired from the UI, kept so a legacy pending request still resolves.
      insert into public.fms_purchase_item_groups (category_id, name, created_by)
      values ((v_payload->>'category_id')::uuid, v_name, auth.uid())
      returning id into v_new_id;

    elsif v_type = 'item' then
      if v_name is null then raise exception 'An item name is required'; end if;
      if v_company is null then
        raise exception 'Pick the company whose books this item belongs to';
      end if;
      -- Typed from the category it was raised under, so it turns up there on
      -- the requisition line straight away.
      v_item_type := nullif(trim(v_payload->>'item_type'), '');
      if v_item_type is null and nullif(v_payload->>'category_id', '') is not null then
        select c.item_types[1] into v_item_type
          from public.fms_purchase_categories c
         where c.id = (v_payload->>'category_id')::uuid;
      end if;
      insert into public.mst_items (name, company_id, unit_id, item_type, source, modules, created_by)
      values (v_name, v_company,
              (select u.id from public.mst_units u
                where upper(u.name) = upper(trim(coalesce(v_payload->>'unit', '')))),
              v_item_type, 'portal', array['procurement'], auth.uid())
      returning id into v_new_id;

    elsif v_type = 'company' then
      raise exception 'Companies come from Tally now and cannot be added by hand. Ask for the company to be opened in Tally; it appears within 15 minutes.';

    elsif v_type = 'vendor_item_price' then
      insert into public.fms_purchase_vendor_item_prices (vendor_id, item_id, rate, gst_pct, lead_time_days, created_by)
      values (
        (v_payload->>'vendor_id')::uuid,
        (v_payload->>'item_id')::uuid,
        coalesce(nullif(v_payload->>'rate', '')::numeric, 0),
        nullif(v_payload->>'gst_pct', '')::numeric,
        nullif(v_payload->>'lead_time_days', '')::integer,
        auth.uid()
      )
      returning id into v_new_id;

    else
      raise exception 'Unknown master type %', v_type;
    end if;

    update public.fms_purchase_master_requests
       set status = 'approved', reviewed_by = auth.uid(), review_note = p_note,
           resolved_master_id = v_new_id, proposed_payload = v_payload
     where id = p_request_id;
  else
    update public.fms_purchase_master_requests
       set status = 'rejected', reviewed_by = auth.uid(), review_note = p_note
     where id = p_request_id;
  end if;

  return v_new_id;
end $function$
$ddl$;

  execute $ddl$
create or replace function public.fms_purchase_save_sourcing_request(
  p_request_id uuid, p_vendors jsonb, p_recommended_vendor_id uuid, p_lines jsonb,
  p_sourcing_reason text default ''::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req_id     uuid;
  v_company    uuid;
  v_elem       jsonb;
  v_vendor_ct  integer;
  v_line_ct    integer;
  v_locked     uuid;
  v_line_id    uuid;
  v_status     text;
  v_owner      uuid;
  v_qty        numeric(14,3);
  v_rate       numeric(14,2);
  v_gst        numeric(6,2);
  v_lead       integer;
  v_value      numeric(16,2);
  v_remark     text;
begin
  select id, company_id into v_req_id, v_company from public.fms_purchase_requests
   where id = p_request_id for update;
  if v_req_id is null then raise exception 'Requisition not found'; end if;

  if not (public.is_admin(auth.uid()) or public.fms_purchase_is_step_owner('sourcing', auth.uid())) then
    raise exception 'Not authorized to source this requisition';
  end if;

  v_vendor_ct := coalesce(jsonb_array_length(p_vendors), 0);
  if v_vendor_ct < 1 then raise exception 'Shortlist at least one vendor'; end if;
  if v_vendor_ct > 3 then raise exception 'At most three vendors can be shortlisted'; end if;
  if p_recommended_vendor_id is null then raise exception 'Tick the vendor you are recommending'; end if;

  if (select count(distinct e->>'vendor_id') from jsonb_array_elements(p_vendors) e) <> v_vendor_ct then
    raise exception 'Each shortlisted vendor must be different';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_vendors) e
     where (e->>'vendor_id')::uuid = p_recommended_vendor_id
  ) then
    raise exception 'The recommended vendor must be one of the shortlisted vendors';
  end if;

  -- Central Masters: a vendor is a ledger in ONE company's books. The PO this
  -- becomes is booked in the requisition's company, so its vendor must be a
  -- ledger of that same book - or a portal vendor not yet given one. The picker
  -- already narrows to exactly this; the check stops a stale tab or a direct
  -- call from booking one company's purchase against another's ledger.
  if exists (
    select 1 from jsonb_array_elements(p_vendors) e
      left join public.mst_parties mp on mp.id = (e->>'vendor_id')::uuid
     where mp.id is null
        or (mp.company_id is not null and mp.company_id <> v_company)
  ) then
    raise exception 'A shortlisted vendor is not a ledger of this requisition''s company. Reload the page and pick again.';
  end if;

  -- Fewer than three vendors requires a reason. Enforced here, not just in the
  -- form, so it cannot be bypassed by calling the RPC directly.
  if v_vendor_ct < 3 and nullif(p_sourcing_reason,'') is null then
    raise exception 'Give a reason for shortlisting fewer than 3 vendors.';
  end if;

  -- Lines already decided against a vendor pin the rest of the requisition to
  -- that same vendor — otherwise it ends up split across two vendors, which this
  -- model cannot represent and which would silently rewrite an agreed price.
  select ri.final_vendor_id into v_locked
    from public.fms_purchase_request_items ri
   where ri.request_id = p_request_id
     and ri.status in ('approved_pending_po','po')
     and ri.final_vendor_id is not null
   limit 1;
  if v_locked is not null and v_locked is distinct from p_recommended_vendor_id then
    raise exception 'Part of this requisition is already approved against a different vendor (%). All its lines must go to that vendor.',
      (select name from public.mst_parties where id = v_locked);
  end if;

  delete from public.fms_purchase_request_vendors where request_id = p_request_id;
  insert into public.fms_purchase_request_vendors (request_id, vendor_id, is_recommended, remark, sort_order)
  select p_request_id,
         (e->>'vendor_id')::uuid,
         (e->>'vendor_id')::uuid = p_recommended_vendor_id,
         nullif(e->>'remark',''),
         (ord - 1)::integer
    from jsonb_array_elements(p_vendors) with ordinality as t(e, ord);

  v_line_ct := coalesce(jsonb_array_length(p_lines), 0);
  if v_line_ct < 1 then raise exception 'Enter a rate for at least one item'; end if;

  for v_elem in select * from jsonb_array_elements(p_lines) loop
    v_line_id := (v_elem->>'request_item_id')::uuid;

    select ri.status, ri.request_id into v_status, v_owner
      from public.fms_purchase_request_items ri
     where ri.id = v_line_id for update;

    if v_status is null then raise exception 'Item line % not found', v_line_id; end if;
    if v_owner is distinct from p_request_id then
      raise exception 'Item line % does not belong to this requisition', v_line_id;
    end if;
    if v_status not in ('sourcing','approval','on_hold') then
      raise exception 'An item on this requisition is no longer open for sourcing (status %). Reload and try again.', v_status;
    end if;

    v_qty  := (v_elem->>'qty')::numeric;
    v_rate := (v_elem->>'rate')::numeric;
    v_gst  := nullif(v_elem->>'gst_pct','')::numeric;
    v_lead := nullif(v_elem->>'lead_time_days','')::integer;

    if coalesce(v_qty,0) <= 0 then raise exception 'Quantity must be greater than 0'; end if;
    if v_rate is null or v_rate < 0 then raise exception 'Enter a rate of 0 or more for every item'; end if;

    v_value := round(v_qty * v_rate * (1 + coalesce(v_gst,0)/100.0), 2);

    select nullif(e->>'remark','') into v_remark
      from jsonb_array_elements(p_vendors) e
     where (e->>'vendor_id')::uuid = p_recommended_vendor_id limit 1;

    delete from public.fms_purchase_quotations where request_item_id = v_line_id;
    insert into public.fms_purchase_quotations
      (request_item_id, vendor_id, rate, gst_pct, lead_time_days, remark, is_recommended)
    values (v_line_id, p_recommended_vendor_id, v_rate, v_gst, v_lead, v_remark, true);

    update public.fms_purchase_request_items
       set final_vendor_id = p_recommended_vendor_id,
           final_qty       = v_qty,
           final_rate      = v_rate,
           gst_pct         = v_gst,
           lead_time_days  = v_lead,
           line_value      = v_value,
           sourcing_reason = nullif(p_sourcing_reason,''),
           status          = 'approval',
           reject_reason   = null,
           sourced_at      = now(),
           sourced_by      = auth.uid()
     where id = v_line_id;
  end loop;

  update public.fms_purchase_requests
     set sourcing_reason = nullif(p_sourcing_reason,''),
         sourced_at      = now(),
         sourced_by      = auth.uid()
   where id = p_request_id;
end $function$
$ddl$;

  -- ====================================================== 7. post-flight ====
  --    Counts unchanged, nothing orphaned, nothing crossed a book.
  if (select count(*) from public.fms_purchase_requests) <> v_requests
     or (select count(*) from public.fms_purchase_pos) <> v_pos
     or (select count(*) from public.fms_purchase_request_items) <> v_lines
     or (select count(*) from public.fms_purchase_quotations) <> v_quotes
     or (select count(*) from public.fms_purchase_request_vendors) <> v_shortlist then
    raise exception 'ABORT: a row count moved during the cutover';
  end if;

  --    Every vendor sits in the book of the row that names it.
  if exists (select 1 from public.fms_purchase_pos t join public.mst_parties mp on mp.id = t.vendor_id
              where mp.company_id is distinct from t.company_id) then
    raise exception 'ABORT: a PO points at a vendor ledger of a different company';
  end if;
  if exists (select 1 from public.fms_purchase_request_vendors t
               join public.fms_purchase_requests rq on rq.id = t.request_id
               join public.mst_parties mp on mp.id = t.vendor_id
              where mp.company_id is distinct from rq.company_id) then
    raise exception 'ABORT: a shortlisted vendor is a ledger of a different company';
  end if;

  --    Every repointed row still names the same firm / product it named before.
  if exists (select 1 from private.pcm_vendor_map vm
               join public.fms_purchase_vendors fv on fv.id = vm.legacy_vendor_id
               join public.mst_parties mp on mp.id = vm.target_id
              where regexp_replace(lower(fv.name), '[^a-z0-9]', '', 'g')
                    <> regexp_replace(lower(mp.name), '[^a-z0-9]', '', 'g')) then
    raise exception 'ABORT: a vendor was mapped to a differently-named ledger';
  end if;
  if exists (select 1 from private.pcm_item_map im
               join public.fms_purchase_items fi on fi.id = im.legacy_item_id
               join public.mst_items mi on mi.id = im.target_id
              where regexp_replace(lower(trim(fi.name)), '\s+', ' ', 'g')
                    <> regexp_replace(lower(trim(mi.name)), '\s+', ' ', 'g')) then
    raise exception 'ABORT: an item was mapped to a differently-named stock item';
  end if;

  --    The triggers are back on.
  if exists (select 1 from pg_trigger
              where tgname in ('trg_fms_purchase_requests_updated', 'trg_fms_purchase_pos_updated',
                               'trg_fms_purchase_request_items_updated')
                and tgenabled = 'D') then
    raise exception 'ABORT: an updated_at trigger was left disabled';
  end if;

  select count(*) filter (where how = 'tally_vendor'),
         count(*) filter (where how = 'tally_ledger'),
         count(*) filter (where how = 'portal_created')
    into v_vendor_tally, v_vendor_flag, v_vendor_portal
    from private.pcm_vendor_map;
  select count(*) filter (where how = 'same_book'),
         count(*) filter (where how = 'other_book'),
         count(*) filter (where how = 'portal_created')
    into v_item_same, v_item_other, v_item_portal
    from private.pcm_item_map;

  return format(
    'Purchase cutover OK. Requisitions %s, lines %s, POs %s, quotations %s, shortlist rows %s - all repointed. '
    'Vendors (per book): %s Tally vendor, %s Tally ledger ticked for Purchase, %s new portal vendor. '
    'Items (per book): %s same book, %s other book, %s new portal item.',
    v_requests, v_lines, v_pos, v_quotes, v_shortlist,
    v_vendor_tally, v_vendor_flag, v_vendor_portal,
    v_item_same, v_item_other, v_item_portal);
end
$pcm$;

revoke all on function private.purchase_central_cutover() from public, anon, authenticated;
