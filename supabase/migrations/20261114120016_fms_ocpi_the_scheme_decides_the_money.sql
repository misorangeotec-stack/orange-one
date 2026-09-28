-- R5 (step 2 of 3) · The SERVER learns the five deal types.
--
-- Step 1 (20261114120015) widened the two CHECK constraints so the database can
-- HOLD the new values. This teaches the writers what they MEAN, and adds the one
-- new column the client's "Local behaves like EX Factory" answer needs.
--
-- 🔴 SHIP THE FRONTEND IN THE SAME RELEASE AS THIS FILE, NOT BEFORE IT AND NOT
--    AFTER IT — see the `delivery_leg` note below, which is a dead end in both
--    directions if the two halves separate.
--
-- 🔴 EVERY BODY IS TRANSFORMED FROM `pg_get_functiondef`, NEVER RETYPED. The last
--    full on-disk body of `fms_ocpi_write_quotation` contains NONE of
--    `delivery_via`, `delivery_port`, `delivery_factory_city` or `delivery_leg`
--    — those exist only as a later transform. Rebuilding from that file would
--    silently delete all four delivery writes and nothing would fail loudly.
--    `20260904065441:41-42` records the same trap for `fms_ocpi_write_oc`.
--
-- ⚠ AND THE FOLDER CANNOT BE REPLAYED. `20260904065441` sorts BEFORE the file
--   that creates the table, so a fresh `db reset` dies on a `pg_get_functiondef`
--   for a function that does not exist yet. Rehearse on the live database inside
--   `begin … rollback`, never on a fresh branch.
--
-- WHAT CHANGES, AND WHY
--   · The currency lock and the GST nulling move from `= 'high_seas'` to the
--     four-value SCHEME list. Client's explicit choice, 10-Sep-2026, made with
--     both readings shown: **an EPCG or MOOWR deal prints NO TAX LINE.** That is
--     a statement about tax on a customer's paper and is recorded, not inferred.
--   · Both cost-bearer columns were nulled for anything that was neither
--     `high_seas` nor `local` — so the three new types would have recorded NO
--     BEARER AT ALL, with neither control on screen to notice. Widened.
--   · `delivery_leg` moves off the deal type and onto the delivery term.
--   · `delivery_destination` is added, and written.

begin;

alter table public.fms_ocpi_deals add column if not exists delivery_destination text;

comment on column public.fms_ocpi_deals.delivery_destination is
  'Where a LOCAL delivery goes — the CUSTOMER''s place. ⚠ NOT `delivery_factory_city`, which is OUR despatching factory. Free text, like `delivery_port`. Written only when `delivery_via = ''Local''` (R5).';

do $assert$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_deals where delivery_destination is not null;
  if v_n <> 0 then raise exception 'R5.2 pre: % deal(s) already hold a destination — this has run before', v_n; end if;
end $assert$;

do $fn$
declare v_src text; v_new text;
begin
  ---------------------------------------------------------- write_quotation --
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_quotation';

  -- 1 · the currency lock: any named scheme, not High Seas alone.
  v_new := replace(v_src,
    E'case when nullif(btrim(p->>''transport_terms''), '''') = ''high_seas'' then ''USD''',
    E'case when nullif(btrim(p->>''transport_terms''), '''') in (''high_seas'', ''hss_epcg'', ''epcg'', ''moowr'') then ''USD''');
  if v_new = v_src then raise exception 'R5.2: write_quotation currency lock did not match'; end if;

  -- 2 · the two scheme-only columns follow the same list, or the three new deal
  --     types record no shipping answer and no cost bearer at all.
  v_new := replace(v_new,
    E'    high_seas_via       = case when v_transport is distinct from ''high_seas'' then null',
    E'    high_seas_via       = case when v_transport not in (''high_seas'', ''hss_epcg'', ''epcg'', ''moowr'') then null');
  v_new := replace(v_new,
    E'    high_seas_cost_by   = case when v_transport is distinct from ''high_seas'' then null',
    E'    high_seas_cost_by   = case when v_transport not in (''high_seas'', ''hss_epcg'', ''epcg'', ''moowr'') then null');

  /*
    3 · 🔴 THE DELIVERY LEG MOVES ONTO THE DELIVERY TERM, AND THIS IS THE HALF
           THAT MAKES THE FORM WORK AT ALL.

           The form asks the leg on every CIF deal now and requires anything it
           shows. Leave this rule on the deal type and the sequence is: answer
           it → save → THIS LINE NULLS IT → reload shows blank → it stays in the
           "still needed" list for ever → **Send for approval becomes impossible
           on every CIF deal that is not high-seas-plus-customer.**

    ⚠ WRITTEN AS THE OR OF THE OLD AND THE NEW CONDITION, DELIBERATELY. A browser
      tab loaded before this release still runs the old visibility rule, so a
      high-seas + EX Factory + customer deal would have the leg on screen and
      required while this rule erased it — the same dead end, aimed at the old
      bundle. Keeping both conditions makes the window harmless. Narrow it to
      `delivery_via = 'CIF'` alone in a follow-up, once no old bundle can be live.
  */
  v_new := replace(v_new,
    E'    delivery_leg          = case when v_transport is distinct from ''high_seas''\n                                   or nullif(btrim(p->>''high_seas_cost_by''), '''') is distinct from ''customer''\n                                 then null else nullif(btrim(p->>''delivery_leg''), '''') end,',
    E'    delivery_leg          = case when nullif(btrim(p->>''delivery_via''), '''') = ''CIF''\n                                   or (v_transport = ''high_seas''\n                                       and nullif(btrim(p->>''high_seas_cost_by''), '''') = ''customer'')\n                                 then nullif(btrim(p->>''delivery_leg''), '''') else null end,\n    delivery_destination  = case when nullif(btrim(p->>''delivery_via''), '''') = ''Local''\n                                 then nullif(btrim(p->>''delivery_destination''), '''') else null end,');

  if v_new = v_src then raise exception 'R5.2: write_quotation was not changed at all'; end if;
  if v_new not like '%hss_epcg%' then raise exception 'R5.2: the scheme list did not land in write_quotation'; end if;
  if v_new not like '%delivery_destination%' then raise exception 'R5.2: delivery_destination did not land'; end if;
  -- 🔴 The four delivery writes must SURVIVE — this is the check that catches a
  --    body rebuilt from a stale file instead of transformed from the live one.
  if v_new not like '%delivery_via%' or v_new not like '%delivery_port%'
     or v_new not like '%delivery_factory_city%' or v_new not like '%delivery_leg%' then
    raise exception 'R5.2: a delivery write was lost — the body was rebuilt, not transformed';
  end if;
  execute v_new;

  ----------------------------------------------------------------- write_oc --
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';

  -- ⚠ The `or v_currency = 'USD'` disjunct STAYS. It is what makes the rule hold
  --   even if a scheme deal ever reaches the writer as rupees — the OCPI-45
  --   defect in miniature. Widening the first disjunct makes it independent of
  --   the currency race rather than replacing it.
  v_new := replace(v_src,
    E'v_rate := case when v_transport = ''high_seas'' or v_currency = ''USD'' then null',
    E'v_rate := case when v_transport in (''high_seas'', ''hss_epcg'', ''epcg'', ''moowr'') or v_currency = ''USD'' then null');
  if v_new = v_src then raise exception 'R5.2: write_oc GST rule did not match'; end if;
  execute v_new;

  ------------------------------------------------------- submit_quotation --
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_submit_quotation';

  -- The "Still needed …" list must never be stricter than the CHECK, and it
  -- names the form's own captions — so the re-captioned bearer moves with it.
  v_new := replace(v_src,
    E'case when d.transport_terms = ''high_seas'' and d.high_seas_via is null',
    E'case when d.transport_terms in (''high_seas'', ''hss_epcg'', ''epcg'', ''moowr'') and d.high_seas_via is null');
  v_new := replace(v_new,
    E'case when d.transport_terms = ''high_seas'' and d.high_seas_cost_by is null',
    E'case when d.transport_terms in (''high_seas'', ''hss_epcg'', ''epcg'', ''moowr'') and d.high_seas_cost_by is null');
  v_new := replace(v_new, E'''High seas cost borne by''', E'''Shipping cost borne by''');
  v_new := replace(v_new,
    E'or coalesce(d.transport_terms, '''') = ''high_seas'')',
    E'or coalesce(d.transport_terms, '''') in (''high_seas'', ''hss_epcg'', ''epcg'', ''moowr''))');
  if v_new = v_src then raise exception 'R5.2: submit_quotation did not match'; end if;
  execute v_new;

  ----------------------------------------------------- generate_quotation --
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_generate_quotation';

  v_new := replace(v_src,
    E'from public.fms_ocpi_deals where id = p_deal) = ''high_seas'')',
    E'from public.fms_ocpi_deals where id = p_deal) in (''high_seas'', ''hss_epcg'', ''epcg'', ''moowr''))');
  if v_new = v_src then raise exception 'R5.2: generate_quotation fx gate did not match'; end if;
  execute v_new;
end $fn$;

do $post$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%hss_epcg%'
     and p.proname in ('fms_ocpi_write_quotation', 'fms_ocpi_write_oc',
                       'fms_ocpi_submit_quotation', 'fms_ocpi_generate_quotation');
  if v_n <> 4 then raise exception 'R5.2 post 1: expected all 4 functions to know the scheme list, found %', v_n; end if;

  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'fms_ocpi_deals'
     and column_name = 'delivery_destination';
  if v_n <> 1 then raise exception 'R5.2 post 2: the destination column is missing'; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_quotation'
     and p.prosrc like '%delivery_destination%' and p.prosrc like '%delivery_factory_city%';
  if v_n <> 1 then raise exception 'R5.2 post 3: write_quotation lost a delivery write'; end if;

  -- Nothing here touches a deal row.
  select count(*) into v_n from public.fms_ocpi_deals
   where transport_terms not in ('high_seas', 'local') and transport_terms is not null;
  if v_n <> 0 then raise exception 'R5.2 post 4: % deal(s) were re-typed — this file writes no data', v_n; end if;
end $post$;

commit;
