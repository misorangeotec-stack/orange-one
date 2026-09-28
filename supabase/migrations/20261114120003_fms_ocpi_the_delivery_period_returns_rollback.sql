-- ROLLBACK for 20261114120003 - back to OCPI-18's tentative date.
--
-- Roll the FRONTEND back with it. The form asks for a period and the papers print
-- one from `delivery_days`; restoring the date token here without reverting
-- lib/tokens.ts, lib/piPdf.ts, lib/quotationPdf.ts and the form leaves the
-- contract asking for a value nothing supplies - a ruled blank on a signed page.

begin;

update public.fms_ocpi_machine_sections
   set body = replace(body,
         'Shipment Terms: {{delivery_days}} Days from the date of confirmation',
         E'Tentative Machine Delivery Date: {{delivery_date}}\nApplicable from the date of signing of this contract.'),
       updated_at = now()
 where body like '%Shipment Terms: {{delivery_days}} Days from the date of confirmation%';

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machine_sections where body like '%delivery_days%';
  if v_n <> 0 then raise exception 'R1 rollback: % section(s) still hold the days token', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%Tentative Machine Delivery Date: {{delivery_date}}%';
  if v_n <> 22 then raise exception 'R1 rollback: expected 22 date lines restored, found %', v_n; end if;
end $post$;

commit;
