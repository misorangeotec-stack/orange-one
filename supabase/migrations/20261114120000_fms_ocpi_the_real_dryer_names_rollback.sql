-- ROLLBACK for 20261114120000_fms_ocpi_the_real_dryer_names.sql
--
-- Reactivates the six placeholders and deactivates the six real names. The real
-- rows are DEACTIVATED rather than deleted for the same reason the placeholders
-- were: `fms_ocpi_deals.dryer_name` is text, so a deal raised between the apply
-- and this rollback holds a real name that must stay explicable.
--
-- ⚠ Deals are NOT touched. A deal that recorded a real dryer name keeps it;
--   `QuotationForm.tsx:1126-1133` still offers a stored-but-unlisted value.

begin;

update public.fms_ocpi_dryers
   set active = true, updated_at = now()
 where name in (
   'Chinese 2-Chamber Dryer — Electric',
   'Chinese 3-Chamber Dryer — Thermic Fluid',
   'Chinese 4-Chamber Dryer — Gas Fired',
   'Indian 2-Chamber Dryer — Electric',
   'Indian 3-Chamber Dryer — Thermic Fluid',
   'Indian 4-Chamber Dryer — Gas Fired');

update public.fms_ocpi_dryers
   set active = false, updated_at = now()
 where name like 'INDIAN DRYER-%' or name like 'CHINESE DRYER %';

do $post$
declare v_old int; v_new int;
begin
  select count(*) into v_old from public.fms_ocpi_dryers
   where active and name like '%-Chamber Dryer —%';
  select count(*) into v_new from public.fms_ocpi_dryers
   where active and (name like 'INDIAN DRYER-%' or name like 'CHINESE DRYER %');
  if v_old <> 6 or v_new <> 0 then
    raise exception 'B5 rollback: expected 6 placeholders active and 0 real, found % and %', v_old, v_new;
  end if;
end $post$;

commit;
