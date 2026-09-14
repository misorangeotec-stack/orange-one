-- Rollback of 20261124120000_fms_ocpi_worded_delivery_and_four_billing_names.
--
-- ⚠ Puts "Immediately Days from the date of confirmation" back on QT-M0041's
--   contract. Refuses if a billing name was hand-edited since — that edit is
--   someone's answer and is not ours to erase.

begin;

do $pre$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%Shipment Terms: {{delivery_days}}[[if periodInDays]] Days from the date of confirmation[[/if]]%';
  if v_n <> 22 then raise exception 'rollback pre 1: expected 22 wrapped lines, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where (name in ('Fab Pro 2I', 'Fab Pro 3I')
          and billing_name is distinct from 'LARGE FORMAT INKJET PRINTER[[if heads]] WITH {{head_count}} HEADS[[/if]][[if noHeads]] (WITHOUT PRINTHEADS)[[/if]] WITH STD. ACCESSORIES')
      or (name = 'JPK' and billing_name is distinct from 'MS JPK EVO V4')
      or (name = 'MP5000' and billing_name is distinct from 'INK-JET PRINTING MACHINE MODEL MS-JP7');
  if v_n <> 0 then raise exception 'rollback pre 2: % billing name(s) were edited since — not erasing them', v_n; end if;
end $pre$;

update public.fms_ocpi_machine_sections
   set body = replace(body,
         'Shipment Terms: {{delivery_days}}[[if periodInDays]] Days from the date of confirmation[[/if]]',
         'Shipment Terms: {{delivery_days}} Days from the date of confirmation'),
       updated_at = now()
 where body like '%[[if periodInDays]]%';

update public.fms_ocpi_machines set billing_name = null, updated_at = now()
 where name in ('Fab Pro 2I', 'Fab Pro 3I', 'JPK', 'MP5000');

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machine_sections where body ilike '%periodindays%';
  if v_n <> 0 then raise exception 'rollback post 1: % section(s) still name periodInDays', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%Shipment Terms: {{delivery_days}} Days from the date of confirmation%';
  if v_n <> 22 then raise exception 'rollback post 2: expected 22 bare lines, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where billing_name is null;
  if v_n <> 5 then raise exception 'rollback post 3: expected 5 blank billing names again, found %', v_n; end if;
end $post$;

commit;
