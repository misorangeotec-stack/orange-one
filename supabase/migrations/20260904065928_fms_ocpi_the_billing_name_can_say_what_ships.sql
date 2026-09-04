/*
  OCPI-45 · The Performa Invoice's priced line names the dryer and the centring
  device, when the deal carries them.

  🔴 APPLIED AND THEN ROLLED BACK THE SAME DAY — see the migration immediately
     after this one, `fms_ocpi_take_the_billing_markers_back_out`. It is kept in
     the history because it ran against the live database and because the five
     fragments below are the exact text to re-apply, but IT MUST NOT BE
     RE-RUN ON ITS OWN. Re-apply it only in the SAME RELEASE that ships
     lib/piPdf.ts and ocPdf.ts's rendered Product header.

     What went wrong: two places print this column and only one of them was
     taught to render. The ORDER CONFIRMATION's header line

         ocPdf.ts   header.push(["Product:", machine.billingName]);

     printed the marker verbatim on a freshly generated contract:

         Product: STANDARD DIGITAL DIRECT TO FABRIC TEXTILE PRINTING MACHINE
                  WITH STD. ACC WITH 224 PRINTHEADS[[if

  ── WHY IT EXISTS AT ALL ──────────────────────────────────────────────────

  Folder 119 (Modi Dyeing, Homer K32) is sold WITH a dryer and WITH a centring
  device and its own invoice says so --

      LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH 32 PRINTHEAD
      WITH DRYER WITH CENTRING DEVICE MODEL (HM1800B- TK32-B1)

  -- while ours printed `LARGE FORMAT INKJET PRINTER WITH 32 HEADS WITH STD.
  ACCESSORIES`, naming neither, though the deal recorded both. The CONTRACT was
  right all along, because supply_description is rendered through the condition
  engine and billing_name was a flat string.

  ⚠ THE WORDING IS EACH MACHINE'S OWN, COPIED NOT INVENTED. Every fragment below
    is lifted verbatim from that same machine's supply_description, which is
    already approved contract text and already prints on its order confirmation.
    That is why the phrasing differs between them -- "AND CHINES DRYER" on K24,
    "& DRYER" on K64, "WITH DRYER" on K32 and Rocket. Do NOT tidy them into one
    house style: they are transcriptions.

  ⚠ FIVE MACHINES, AND ONLY FIVE. These are every active machine whose
    supply_description carries a dryer or centring condition while its billing
    name does not. The other 18 keep a billing name with no markers, and
    `render()` returns such a string byte-identically -- so not one of their
    invoices changes by a character.

  ⚠ IDEMPOTENT: each update is guarded on the marker being absent, so re-running
    this changes nothing. Additive -- no column, table or row is dropped, and
    every frozen revision keeps the text it printed.
*/
update public.fms_ocpi_machines
   set billing_name = billing_name || '[[if dryer]] & WITH DRYER[[/if]]'
 where name = 'Fab Pro 1I' and billing_name is not null and billing_name not like '%[[if %';

update public.fms_ocpi_machines
   set billing_name = billing_name || '[[if dryer]] AND CHINES DRYER[[/if]]'
 where name = 'Homer K24' and billing_name is not null and billing_name not like '%[[if %';

update public.fms_ocpi_machines
   set billing_name = billing_name
                      || '[[if dryer]] WITH DRYER[[/if]][[if centering]] WITH CENTRING DEVICE[[/if]]'
 where name = 'Homer K32' and billing_name is not null and billing_name not like '%[[if %';

update public.fms_ocpi_machines
   set billing_name = billing_name
                      || '[[if centering]] AND CENTERING SYSTEM[[/if]][[if dryer]] & DRYER[[/if]]'
 where name = 'K64' and billing_name is not null and billing_name not like '%[[if %';

update public.fms_ocpi_machines
   set billing_name = billing_name || '[[if dryer]] WITH DRYER[[/if]]'
 where name = 'Rocket' and billing_name is not null and billing_name not like '%[[if %';

do $$
declare
  v_marked int;
  v_other  int;
begin
  select count(*) into v_marked
    from public.fms_ocpi_machines
   where name in ('Fab Pro 1I', 'Homer K24', 'Homer K32', 'K64', 'Rocket')
     and billing_name like '%[[if %';
  if v_marked <> 5 then
    raise exception 'OCPI-45: expected 5 billing names to carry a condition, found %', v_marked;
  end if;

  -- and NOTHING else gained one
  select count(*) into v_other
    from public.fms_ocpi_machines
   where billing_name like '%[[if %'
     and name not in ('Fab Pro 1I', 'Homer K24', 'Homer K32', 'K64', 'Rocket');
  if v_other <> 0 then
    raise exception 'OCPI-45: % other billing names carry a condition', v_other;
  end if;
end $$;
