-- B8 · K64 is TWO build widths sold under one record.
--
--   Laxmipati (folder 109)  HM3200B-TK64-A1   -- 3.2 m
--   Modi      (folder 120)  HM1800B-TK64-A1   -- 1.8 m
--
-- We held only the 1800 and printed it, so a 3.2 m machine went out under the
-- 1.8 m code. Client's decision 07-09-2026: split into two machines.
--
-- 🔴 THE TWO WIDTH SPEC ROWS ARE DELIBERATELY OMITTED ON THE 3.2 m CLONE.
--    K64's spec table hardcodes `Max. Printing width: 1800 mm` and
--    `Max. Fabric width: 1800 mm`. Carrying those onto a 3.2 m machine would put
--    a WRONG technical spec on a signed contract — worse than the model-number
--    error this file exists to fix. The real figures are not recoverable: folder
--    109's paper is a Performa Invoice and states no spec table (read back with
--    pdf.js, not assumed), and there is no signed K64 order confirmation in
--    either year — that is B4. `renderSpecRows` DROPS an emptied row rather than
--    drawing a blank, so the contract omits those two lines until the client
--    supplies them. NOTHING WAS INVENTED.
--
-- ⚠ STILL NEEDED FROM THE CLIENT: Max. Printing width and Max. Fabric width for
--   the 3.2 m build. Until then its spec table is 11 rows where the 1.8 m has 13.

begin;

do $assert$
declare v_k64 int; v_existing int;
begin
  select count(*) into v_k64 from public.fms_ocpi_machines where name = 'K64';
  if v_k64 <> 1 then raise exception 'B8 pre 1: expected exactly one machine named K64, found %', v_k64; end if;
  select count(*) into v_existing from public.fms_ocpi_machines where name in ('K64 — 1.8 m', 'K64 — 3.2 m');
  if v_existing <> 0 then raise exception 'B8 pre 2: split names already exist (%) — this file has run before', v_existing; end if;
  if not exists (select 1 from public.fms_ocpi_machines where name = 'K64' and machine_model_no = 'HM1800B-TK64-A1') then
    raise exception 'B8 pre 3: K64 does not hold the 1800 code — re-read before running';
  end if;
end $assert$;

update public.fms_ocpi_machines set name = 'K64 — 1.8 m', updated_at = now() where name = 'K64';

insert into public.fms_ocpi_machines (
  name, doc_title, intro_text, machine_model_no, supply_description, spec_rows,
  composition, header_fields, signoff_style, has_template, active, sort_order,
  billing_name, category_id, needs_dryer, opt_air_blade, opt_external_centering,
  opt_ink_dust_exhauster, opt_chilling_system, machine_warranty, head_warranty,
  dryer_warranty, hsn_code, manufacturer, country_of_origin, sales_page_id)
select
  'K64 — 3.2 m', doc_title, intro_text, 'HM3200B-TK64-A1',
  replace(supply_description, 'HM1800B-TK64-A1', 'HM3200B-TK64-A1'),
  (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
     from jsonb_array_elements(spec_rows) with ordinality t(e, ord)
    where e->>'label' not in ('Max. Printing width', 'Max. Fabric width')),
  composition, header_fields, signoff_style, has_template, active, sort_order + 1,
  billing_name, category_id, needs_dryer, opt_air_blade, opt_external_centering,
  opt_ink_dust_exhauster, opt_chilling_system, machine_warranty, head_warranty,
  dryer_warranty, hsn_code, manufacturer, country_of_origin, sales_page_id
from public.fms_ocpi_machines where name = 'K64 — 1.8 m';

insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order, active)
select n.id, s.key, s.title, replace(s.body, 'HM1800B-TK64-A1', 'HM3200B-TK64-A1'), s.sort_order, s.active
  from public.fms_ocpi_machine_sections s
  join public.fms_ocpi_machines o on o.id = s.machine_id and o.name = 'K64 — 1.8 m'
 cross join lateral (select id from public.fms_ocpi_machines where name = 'K64 — 3.2 m') n;

insert into public.fms_ocpi_machine_head_types (machine_id, head_type_id)
select n.id, h.head_type_id
  from public.fms_ocpi_machine_head_types h
  join public.fms_ocpi_machines o on o.id = h.machine_id and o.name = 'K64 — 1.8 m'
 cross join lateral (select id from public.fms_ocpi_machines where name = 'K64 — 3.2 m') n;

do $post$
declare v_18 record; v_32 record; v_bad int;
begin
  select id, machine_model_no,
         (select count(*) from public.fms_ocpi_machine_sections s where s.machine_id = m.id) sec,
         (select count(*) from public.fms_ocpi_machine_head_types h where h.machine_id = m.id) ht,
         jsonb_array_length(spec_rows) specs
    into v_18 from public.fms_ocpi_machines m where name = 'K64 — 1.8 m';
  select id, machine_model_no,
         (select count(*) from public.fms_ocpi_machine_sections s where s.machine_id = m.id) sec,
         (select count(*) from public.fms_ocpi_machine_head_types h where h.machine_id = m.id) ht,
         jsonb_array_length(spec_rows) specs
    into v_32 from public.fms_ocpi_machines m where name = 'K64 — 3.2 m';

  if v_32.machine_model_no <> 'HM3200B-TK64-A1' then
    raise exception 'B8 post 1: the 3.2 m clone carries model %', v_32.machine_model_no; end if;
  if v_32.sec <> v_18.sec or v_32.ht <> v_18.ht then
    raise exception 'B8 post 2: clone has % sections / % head types, original has % / %', v_32.sec, v_32.ht, v_18.sec, v_18.ht; end if;
  if v_32.specs <> v_18.specs - 2 then
    raise exception 'B8 post 3: expected the clone to drop exactly 2 spec rows, it has % vs %', v_32.specs, v_18.specs; end if;

  select count(*) into v_bad from public.fms_ocpi_machine_sections s
   where s.machine_id = v_32.id and s.body like '%HM1800B%';
  if v_bad <> 0 then raise exception 'B8 post 4: % section(s) on the 3.2 m still carry the 1800 code', v_bad; end if;
  if (select supply_description from public.fms_ocpi_machines where id = v_32.id) like '%HM1800B%' then
    raise exception 'B8 post 5: the 3.2 m supply description still carries the 1800 code'; end if;
  if (select spec_rows::text from public.fms_ocpi_machines where id = v_32.id) like '%1800 mm%' then
    raise exception 'B8 post 6: a 1800 mm width row survived onto the 3.2 m machine'; end if;
end $post$;

commit;
