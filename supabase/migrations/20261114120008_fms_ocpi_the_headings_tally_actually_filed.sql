-- R8 (part two) · Nine more customs headings, taken from what Tally ACTUALLY
--                  FILED — the only source left once the paper archive ran dry.
--
-- WHERE THIS CAME FROM, AND WHY IT IS NOT THE STOCK-ITEM MASTER
--   The client's Tally screen shows `HSN/SAC : 84433250` on the stock item
--   master. That value is NOT in the ConnectWave mirror: all 17,689 StockItem
--   payloads were scanned and NOT ONE mentions HSN anywhere. The connector's
--   FETCH names the legacy `HSNCODE` field (entities.go:86), but TallyPrime
--   keeps the value in a separate `HSNDETAILS.LIST` sub-collection that the
--   FETCH never asks for — and a Tally collection FETCH silently drops every
--   nested list it does not name. The connector's own header records that trap
--   in the other direction for BANKALLOCATIONS.
--
--   🟢 THE VOUCHERS CARRY IT INSTEAD. 83,247 of them. Every inventory line holds
--      `GSTHSNNAME`, which is the heading as ACTUALLY FILED against that
--      invoice — a stronger source than the master, because it is what was
--      declared rather than what was typed on a settings screen.
--
-- THE NINE, EACH READ OFF REAL INVOICE LINES
--
--   machine                Tally stock item                          HSN        lines/sales
--   P8S                    DIGITAL PRINTING MACHINE (HM1800R-P8S-A1#…)  84433250   12 / 9
--   P8D                    DIGITAL PRINTING MACHINE (HM1800R-P8D-A1#…)  84433250    9 / 6
--   Fab Pro 1I             DIGITAL PRINTING MACHINE_FAB PRO 1i-…        84433250   many
--   Fab Pro 2I             DIGITAL PRINTING MACHINE_FAB PRO 2i-…        84433250   many
--   Kolorado Alpha 15      SUBLIMATION PRINTER KOLORADO ALPHA 15        84433250   25 / 15
--   Foil Machine           FOILJET HJ-1816L DIGITAL INKJET PRINTER      84433250    4 / 4
--   Pengda PD-1700XD-800   HEAT TRANSFER MACHINE (PD-1700XD-800) (75%)  84433910   15 / 12
--   Pengda PD-1800XD-800   HEAT TRANSFER MACHINE (PD-1800XD-800) (75%)  84433910    3 / 2
--   JPK                    JPK EVO PRINTER-1800MM                       84433910    1 / 0
--
-- ⚠ P8D IS SPLIT IN TALLY AND THE MODEL CODE BREAKS THE TIE. Nine lines under
--   `HM1800R-P8D-A1` read 84433250; seven under the older `HM1800R-P8D-166/167/
--   168#` read 84433910. `fms_ocpi_machines.machine_model_no` for P8D is
--   `HM1800R-P8D-A1` exactly, so the machine we sell is the one on 84433250.
--   The 84433910 rows are a different, earlier build under the same family.
--
-- 🔴 JPK RESTS ON A SINGLE LINE THAT WAS NEVER A SALE. One inventory entry,
--    zero sales vouchers — a stock or purchase movement. It is the only evidence
--    that exists and it agrees with both Pengdas, but it is thin. Flagged here
--    so nobody later reads it as well-attested.
--
-- 🔴 NOT IN THIS FILE — HOMER K32 AND K64. Tally filed both under 84433250; the
--    signed invoices state 84433910 (folders 78, 82, 83, 119 for the K32; 109
--    and 120 for the K64). Our master holds the PAPER value. That is a GST
--    classification disagreement between what the customer was sent and what was
--    declared, and it is the client's call, not a migration's. Both rows are
--    left exactly as they are until it is answered.
--
-- 🟢 THE ONES THAT AGREE ARE UNTOUCHED. Homer K24 (84433250, applied by
--    20261114120007 off the papers) and Position Printer (84433910) read the
--    same in both sources. Rocket keeps its paper value — Tally has no whole
--    machine line for it at all.
--
-- ⚠ FAMILY INFERENCE IS DELIBERATELY NOT DONE HERE. Ten more machines could
--   plausibly inherit a sibling's heading — Fab Pro 3I from 1I/2I, the six
--   Kolorado Alpha II/III variants and Alpha 16 from Alpha 15, PD-1700XD-1000
--   from the other two Pengdas. A sales name guessed from a sibling is a
--   cosmetic risk; a customs heading guessed from a sibling is a mis-declaration.
--   They stay blank until someone confirms them.
--
-- 🟢 A BLANK HEADING STILL PRINTS NOTHING. Filling nine machines adds a line to
--    nine machines' papers and changes nothing else.

begin;

do $assert$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 6 then raise exception 'R8b pre 1: expected 6 machines already coded, found % — apply 20261114120007 first', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where name in ('P8S','P8D','Fab Pro 1I','Fab Pro 2I','Kolorado Alpha 15','Foil Machine',
                  'Pengda PD-1700XD-800','Pengda PD-1800XD-800','JPK')
     and hsn_code is not null;
  if v_n <> 0 then raise exception 'R8b pre 2: % of the nine already carry a heading', v_n; end if;

  -- The two in dispute must still hold the PAPER value when this runs.
  select count(*) into v_n from public.fms_ocpi_machines
   where name in ('Homer K32','K64 — 1.8 m','K64 — 3.2 m') and hsn_code = '84433910';
  if v_n <> 3 then raise exception 'R8b pre 3: the K32/K64 rows have moved — re-open the conflict before running this'; end if;
end $assert$;

update public.fms_ocpi_machines set hsn_code = v.hsn, updated_at = now()
  from (values
    ('P8S',                  '84433250'),
    ('P8D',                  '84433250'),
    ('Fab Pro 1I',           '84433250'),
    ('Fab Pro 2I',           '84433250'),
    ('Kolorado Alpha 15',    '84433250'),
    ('Foil Machine',         '84433250'),
    ('Pengda PD-1700XD-800', '84433910'),
    ('Pengda PD-1800XD-800', '84433910'),
    ('JPK',                  '84433910')
  ) as v(name, hsn)
 where public.fms_ocpi_machines.name = v.name
   and public.fms_ocpi_machines.hsn_code is null;

do $post$
declare v_n int; v_bad text;
begin
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 15 then raise exception 'R8b post 1: expected 15 coded machines, found % — a name did not match', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is null;
  if v_n <> 14 then raise exception 'R8b post 2: expected 14 still uncoded, found %', v_n; end if;

  -- The disputed pair must be exactly as it was.
  select count(*) into v_n from public.fms_ocpi_machines
   where name in ('Homer K32','K64 — 1.8 m','K64 — 3.2 m') and hsn_code = '84433910';
  if v_n <> 3 then raise exception 'R8b post 3: the K32/K64 rows were disturbed — they are not this file''s to change'; end if;

  -- And so must the three that were already settled.
  select string_agg(name || ' = ' || coalesce(hsn_code,'NULL'), '; ') into v_bad
    from public.fms_ocpi_machines
   where (name = 'Homer K24'        and hsn_code is distinct from '84433250')
      or (name = 'Position Printer' and hsn_code is distinct from '84433910')
      or (name = 'Rocket'           and hsn_code is distinct from '84433910');
  if v_bad is not null then raise exception 'R8b post 4: a settled heading moved: %', v_bad; end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where hsn_code is not null and hsn_code !~ '^\d{8}$';
  if v_n <> 0 then raise exception 'R8b post 5: % heading(s) are not 8 bare digits', v_n; end if;

  -- Only the two headings the whole estate uses. A third means a typo.
  select string_agg(distinct hsn_code, ', ') into v_bad from public.fms_ocpi_machines
   where hsn_code is not null and hsn_code not in ('84433250','84433910');
  if v_bad is not null then raise exception 'R8b post 6: unexpected heading(s): %', v_bad; end if;
end $post$;

commit;
