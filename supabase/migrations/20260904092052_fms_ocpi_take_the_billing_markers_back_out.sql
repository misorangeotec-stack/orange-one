/*
  OCPI-45 · ROLLBACK of the billing-name conditions, same day.

  🔴 I PUT MARKERS INTO A STRING THE LIVE CONTRACT PRINTS RAW.
     `fms_ocpi_the_billing_name_can_say_what_ships` added `[[if dryer]]` and
     `[[if centering]]` to five billing names, on the reasoning that piPdf.ts
     renders them. It does -- but the ORDER CONFIRMATION prints the same column
     through a line that does NOT render:

         ocPdf.ts   if (machine.billingName) header.push(["Product:", machine.billingName]);

     Read back off a freshly generated contract with pdf.js:

         Product: STANDARD DIGITAL DIRECT TO FABRIC TEXTILE PRINTING MACHINE
                  WITH STD. ACC WITH 224 PRINTHEADS[[if

     That is on the deployed build, where the frontend fix does not exist at all
     -- master carries no piPdf.ts and this header has never rendered.

  ⚠ THE MIGRATION'S OWN HEADER SAID "THE FRONTEND MUST GO FIRST OR TOGETHER" AND
    I APPLIED IT ANYWAY. The deploy-ordering rule is in CLAUDE.md; writing it
    into the migration is not the same as obeying it.

  🟢 NO CUSTOMER DOCUMENT WAS AFFECTED. Every paper generated in the 35-minute
     window was one of the three test deals QT-M0065..67, checked in SQL by
     `generated_at`.

  ⚠ THE FIX IS NOT TO RENDER HARDER. Two places print this column and only one
    of them was taught to render, so the markers come back only when BOTH do --
    ocPdf.ts's Product header as well as piPdf.ts's item row -- and only in the
    same deploy. Until then the billing names go back to plain text, which is
    what every issued contract has always carried.

  ⚠ IDEMPOTENT AND EXACT: each update strips the one fragment that machine was
    given, so a name that never received one is untouched and re-running changes
    nothing.
*/
update public.fms_ocpi_machines
   set billing_name = replace(billing_name, '[[if dryer]] & WITH DRYER[[/if]]', '')
 where name = 'Fab Pro 1I';

update public.fms_ocpi_machines
   set billing_name = replace(billing_name, '[[if dryer]] AND CHINES DRYER[[/if]]', '')
 where name = 'Homer K24';

update public.fms_ocpi_machines
   set billing_name = replace(
         replace(billing_name, '[[if dryer]] WITH DRYER[[/if]]', ''),
         '[[if centering]] WITH CENTRING DEVICE[[/if]]', '')
 where name = 'Homer K32';

update public.fms_ocpi_machines
   set billing_name = replace(
         replace(billing_name, '[[if centering]] AND CENTERING SYSTEM[[/if]]', ''),
         '[[if dryer]] & DRYER[[/if]]', '')
 where name = 'K64';

update public.fms_ocpi_machines
   set billing_name = replace(billing_name, '[[if dryer]] WITH DRYER[[/if]]', '')
 where name = 'Rocket';

do $$
declare
  v_left int;
begin
  select count(*) into v_left
    from public.fms_ocpi_machines
   where billing_name like '%[[%' or billing_name like '%{{%';
  if v_left <> 0 then
    raise exception 'OCPI-45 rollback: % billing names still carry a marker', v_left;
  end if;
end $$;
