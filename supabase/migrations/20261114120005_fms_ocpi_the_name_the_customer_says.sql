-- B1 · The invoice's SUBJECT line gets the name the customer says, not the
--      factory code — read off the client's own papers, machine by machine.
--
-- WHAT IS WRONG TODAY
--   `piPdf.ts` prints `Subject: Model No: {machine_model_no}`, so folder 120's
--   invoice would go out headed `HM1800B-TK64-A1`. The customer's own copy of
--   that same deal reads `Subject: Model No: HOMER K64(With 64 Heads)`.
--   Wrong on 11 of 11 re-entered contracts.
--
-- WHERE THESE NAMES COME FROM — NOTHING HERE IS INVENTED
--   Every value below was read with pdf.js off the Subject line of a real
--   Performa Invoice in `Misc/Bushra Reports/OCPI/2025.26 OC&PI` and
--   `2026.27 OC&PI`. 43 of the ~60 papers carry a Subject line; it sits on
--   PAGE 3 of the combined PDF (page 1 is the covering letter), which is why an
--   earlier read of page 1 alone found nothing.
--
-- THE CASING RULE, BECAUSE THE PAPERS DISAGREE WITH THEMSELVES
--   `HOMER K24` (7 papers, all 26-27) against `Homer K24` (4 papers, all 25-26);
--   `HOMER K32` (78, 82, 83) against `Homer K32` (119). Rule applied: the
--   PLURALITY across both years, ties broken by the more recent paper. That is
--   what makes the three Homers agree with each other here, which no single
--   paper decides on its own.
--
-- 🔴 `sales_name` IS NOT `billing_name` AND NOT `name`. Three different strings
--    with three jobs, and this migration adds the third:
--      name         `K64 — 1.8 m`      the salesperson's picker, and what every
--                                      existing deal's machine_id resolves to
--      billing_name `DIGITAL INKJET TEXTILE PRINTING MACHINE WITH STANDARD
--                    ACCESSORIES WITH 64 PRINTHEADS`   the invoice ITEM cell and
--                                      the contract's `Product:` line
--      sales_name   `HOMER K64`        the invoice SUBJECT line, and nothing else
--
-- ⚠ THE INTRO TEXT IS NOT A SOURCE FOR THIS, and P8S proves it. Its transcribed
--   `intro_text` reads "the supply of P8S (With 8 Head) Digital Printing
--   Machine" while all five real P8S invoices head the page `Sub Pro II+`. The
--   contract names the machine internally; the invoice names it the way the
--   customer does. So the 11 machines with no invoice are left NULL rather than
--   back-filled from their own contract template.
--
-- ⚠ NO HEAD COUNT IS STORED IN THIS COLUMN. The real papers append one —
--   `HOMER K64(With 64 Heads)`, `ALPHA II (WITHOUT PRINTHEADS)` — but that
--   varies per DEAL, not per machine, and R4 is where it belongs. Baking `(With
--   64 Heads)` into the master would assert 64 heads on a K64 sold without them,
--   which is the exact defect R4 exists to fix.
--
-- ⚠ TWO ROWS ARE A FAMILY INFERENCE, NOT A DIRECT READ, and are marked as such
--   below: `KoloRado Alpha 3.2 — 24 heads` and `KoloRado Alpha II — 2.2 m` have
--   no invoice of their own. Every OTHER member of each family prints one
--   identical name across four and six papers respectively, with the width and
--   the head count carried elsewhere on the page, so the family name is the
--   name. Flagged for the client to confirm.
--
-- 🟢 SAFE ON ITS OWN. The column is additive and nullable, `ocpiFetch` selects
--    `*`, and `piPdf.ts` falls back to today's `machine_model_no` wherever
--    `sales_name` is null — so the 11 unfilled machines print exactly what they
--    print now, and this file changes no paper until the frontend ships.

begin;

alter table public.fms_ocpi_machines add column if not exists sales_name text;

comment on column public.fms_ocpi_machines.sales_name is
  'The short name the CUSTOMER knows the machine by, as the Subject line of a real Performa Invoice prints it (e.g. HOMER K64, Sub Pro II+). Distinct from `name` (the salesperson picker code) and `billing_name` (the long item description). NULL means no real invoice was found for this machine — the Subject line then falls back to `machine_model_no`, as it did before B1.';

do $assert$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines where sales_name is not null;
  if v_n <> 0 then raise exception 'B1 pre: % machine(s) already carry a sales name — this has run before', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines;
  if v_n <> 29 then raise exception 'B1 pre: expected 29 machines, found % — the master moved, re-read the papers', v_n; end if;
end $assert$;

/*
  Matched on `name`, which is the master's own unique key and what every deal
  points at. A machine renamed between writing this and running it must abort
  rather than silently skip — the post-flight count below is what enforces that.
*/
update public.fms_ocpi_machines set sales_name = v.sales_name, updated_at = now()
  from (values
    -- ── read directly off a real invoice's Subject line ──────────────────────
    ('Homer K24',                                   'HOMER K24'),          -- 102,107,112,113,114,118,123 · 91,93,95,97
    ('Homer K32',                                   'HOMER K32'),          -- 78,82,83 · 119
    ('K64 — 1.8 m',                                 'HOMER K64'),          -- 120 (HM1800B-TK64-A1)
    ('K64 — 3.2 m',                                 'HOMER K64'),          -- 109 (HM3200B-TK64-A1)
    ('Rocket',                                      'ROCKET MACHINE'),     -- 121
    ('Position Printer',                            'POSITION PRINTER'),   -- 105,106 · trailing stop dropped
    ('P8S',                                         'Sub Pro II+'),        -- 96,98 · 101,122,126
    ('Fab Pro 1I',                                  'FAB PRO 1i'),         -- 81
    ('Fab Pro 2I',                                  'FAB PRO 2i'),         -- 90,92
    ('Kolorado Alpha 15',                           'Kolorado Alpha 15'),  -- 117,125 · 86 says "Fedar 15", overruled by B11
    ('KoloRado Alpha 3 — 12 heads',                 'KoloRado Alpha III'), -- 88
    ('KoloRado Alpha 3.2 — 8 heads',                'KoloRado Alpha III'), -- 79
    ('KoloRado Alpha 3.2 — 16 heads',               'KoloRado Alpha III'), -- 116,124
    ('KoloRado Alpha II — 1.8 m, 8 heads',          'ALPHA II'),           -- 111
    ('KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)','ALPHA II'),          -- 103,108,110,115,127
    ('Pengda PD-1700XD-800',                        'PD-1700XD-800 Dia'),  -- 87,89,94 · 104 · coverage % dropped, it is per deal
    -- ── family inference · no invoice of its own, flagged for the client ─────
    ('KoloRado Alpha 3.2 — 24 heads',               'KoloRado Alpha III'),
    ('KoloRado Alpha II — 2.2 m, 8 heads',          'ALPHA II')
  ) as v(name, sales_name)
 where public.fms_ocpi_machines.name = v.name;

do $post$
declare v_filled int; v_blank int; v_bad text;
begin
  select count(*) into v_filled from public.fms_ocpi_machines where sales_name is not null;
  if v_filled <> 18 then raise exception 'B1 post 1: expected 18 machines named, found % — a machine name did not match', v_filled; end if;

  select count(*) into v_blank from public.fms_ocpi_machines where sales_name is null;
  if v_blank <> 11 then raise exception 'B1 post 2: expected 11 machines left blank, found %', v_blank; end if;

  -- A sales name that still reads as a factory code has defeated the point.
  select string_agg(name, ', ') into v_bad from public.fms_ocpi_machines
   where sales_name is not null and sales_name = machine_model_no;
  if v_bad is not null then raise exception 'B1 post 3: sales name equals the model code on: %', v_bad; end if;

  -- No head count, no width, no coverage figure — those are per DEAL (see R4).
  select string_agg(name, ', ') into v_bad from public.fms_ocpi_machines
   where sales_name ~* '(head|printhead|coverage|meter|mtr)';
  if v_bad is not null then raise exception 'B1 post 4: a per-deal fact leaked into the sales name on: %', v_bad; end if;

  select string_agg(name, ', ') into v_bad from public.fms_ocpi_machines
   where sales_name is not null and (sales_name <> btrim(sales_name) or sales_name = '');
  if v_bad is not null then raise exception 'B1 post 5: untrimmed or empty sales name on: %', v_bad; end if;
end $post$;

commit;

/*
  🔴 STILL BLANK — 11 MACHINES, AND EVERY ONE OF THEM IS BLANK BECAUSE NO REAL
     INVOICE FOR IT EXISTS IN EITHER YEAR'S FOLDER. They are a client ask, not a
     gap in this file:

       Fab Pro 3I · JPK · MP5000 · P8D · Kolorado Alpha 16 ·
       Pengda PD-1700XD-1000 · Pengda PD-1800XD-800 · Mini Lario ·
       Book Printer · Foil Machine · Label Printer

     Each prints its `machine_model_no` on the Subject line until answered, and
     five of the eleven have no model code either, so those print their picker
     name. Fill them on the Machines master screen — no migration needed.
*/
