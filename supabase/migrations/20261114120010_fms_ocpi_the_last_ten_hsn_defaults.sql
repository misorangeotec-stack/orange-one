-- R8 (part four) · The ten remaining headings, filled from their family — as
--                   DEFAULTS, which is the only reason this is now safe to do.
--
-- WHY THIS WAS REFUSED THREE MIGRATIONS AGO AND IS RIGHT NOW
--   `20261114120008` deliberately left these ten blank, and said why: "a guessed
--   sales name is cosmetic; a guessed customs heading is a mis-declaration."
--   That was correct while `fms_ocpi_machines.hsn_code` was the FINAL WORD on
--   what printed.
--
--   `20261114120009` changed what the column means. The heading is now chosen on
--   the DEAL, and the machine's value is what the picker offers FIRST — a
--   starting point a person confirms, with a standing instruction on the form to
--   check it with the export team before the paper goes out. A default that is
--   read, weighed and overridable is a different object from a declaration.
--
--   🔴 THIS FILE IS THEREFORE NOT SAFE TO APPLY WITHOUT 20261114120009 AND THE
--      FRONTEND THAT GOES WITH IT. Against the old behaviour it would silently
--      print ten inferred headings on real invoices with nobody asked. The
--      pre-flight below refuses if `fms_ocpi_deals.hsn_code` is absent.
--
-- THE INFERENCE, AND THE EVIDENCE UNDER IT
--   Not one of these ten appears by name on a Tally invoice line. Each takes the
--   heading its own family carries, with no counter-example anywhere in 83,247
--   vouchers:
--
--     Fab Pro 3I                   84433250   from Fab Pro 1I and 2I (33 lines)
--     Kolorado Alpha 16            84433250   from Kolorado Alpha 15 (25 lines)
--     KoloRado Alpha 3 — 12 heads  84433250   ┐
--     KoloRado Alpha 3.2 — 8       84433250   │ every whole-machine Kolorado
--     KoloRado Alpha 3.2 — 16      84433250   │ Alpha line in Tally is 84433250
--     KoloRado Alpha 3.2 — 24      84433250   │ (28 lines); the 844399* rows in
--     KoloRado Alpha II — 1.8 m    84433250   │ that family are spare parts —
--     KoloRado Alpha II — 1.9 m    84433250   │ dampers, boards, cables — not
--     KoloRado Alpha II — 2.2 m    84433250   ┘ the machine.
--     Pengda PD-1700XD-1000        84433910   from PD-1700XD-800 (15 lines) and
--                                             PD-1800XD-800 (3 lines)
--
-- ⚠ THE FOUR WITH NO FAMILY STAY BLANK, and that is not an oversight: Book
--   Printer, Label Printer, Mini Lario and MP5000 have never been invoiced
--   through Tally and have no sibling to borrow from. Mini Lario has spare-part
--   lines only, never the machine. There is nothing to infer FROM, so nothing is
--   inferred. A blank still prints no line, and a salesperson can pick a heading
--   on the deal — so a blank master no longer blocks a paper.
--
-- ⚠ THE TWO DISPUTED ROWS ARE STILL NOT TOUCHED. Homer K32 and both K64s keep
--   `84433910`, the value on the SIGNED PAPERS, even though Tally filed
--   `84433250`. Under the new design that disagreement stops being a blocker:
--   the paper value is the default and the other is one click away in the
--   picker. Left as-is on purpose — changing a default silently would reverse a
--   decision nobody made.

begin;

do $assert$
declare v_n int;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='fms_ocpi_deals' and column_name='hsn_code';
  if v_n <> 1 then
    raise exception 'R8d pre 1: fms_ocpi_deals.hsn_code is absent — apply 20261114120009 first, or these ten become declarations rather than defaults';
  end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 15 then raise exception 'R8d pre 2: expected 15 machines already coded, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where name in ('Fab Pro 3I','Kolorado Alpha 16','KoloRado Alpha 3 — 12 heads',
                  'KoloRado Alpha 3.2 — 8 heads','KoloRado Alpha 3.2 — 16 heads',
                  'KoloRado Alpha 3.2 — 24 heads','KoloRado Alpha II — 1.8 m, 8 heads',
                  'KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)',
                  'KoloRado Alpha II — 2.2 m, 8 heads','Pengda PD-1700XD-1000')
     and hsn_code is null;
  if v_n <> 10 then raise exception 'R8d pre 3: expected 10 blank machines to fill, found %', v_n; end if;
end $assert$;

update public.fms_ocpi_machines set hsn_code = v.hsn, updated_at = now()
  from (values
    ('Fab Pro 3I',                                    '84433250'),
    ('Kolorado Alpha 16',                             '84433250'),
    ('KoloRado Alpha 3 — 12 heads',                   '84433250'),
    ('KoloRado Alpha 3.2 — 8 heads',                  '84433250'),
    ('KoloRado Alpha 3.2 — 16 heads',                 '84433250'),
    ('KoloRado Alpha 3.2 — 24 heads',                 '84433250'),
    ('KoloRado Alpha II — 1.8 m, 8 heads',            '84433250'),
    ('KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)', '84433250'),
    ('KoloRado Alpha II — 2.2 m, 8 heads',            '84433250'),
    ('Pengda PD-1700XD-1000',                         '84433910')
  ) as v(name, hsn)
 where public.fms_ocpi_machines.name = v.name
   and public.fms_ocpi_machines.hsn_code is null;

do $post$
declare v_n int; v_bad text;
begin
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 25 then raise exception 'R8d post 1: expected 25 coded machines, found % — a name did not match', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is null;
  if v_n <> 4 then raise exception 'R8d post 2: expected 4 still blank, found %', v_n; end if;

  -- Exactly the four with no family to borrow from, by name.
  select string_agg(name, ', ' order by name) into v_bad from public.fms_ocpi_machines where hsn_code is null;
  -- ⚠ THE ORDER IS THE DATABASE'S, NOT ALPHABET-AS-YOU-READ-IT. `order by name`
  --   under this collation puts `Mini Lario` BEFORE `MP5000` — space sorts ahead
  --   of the letter. Writing the list the way it reads to a person failed this
  --   assertion on the first run and rolled the whole file back, which is the
  --   check earning its keep. Compare a SET, not a rendered string, if this is
  --   ever extended.
  if v_bad <> 'Book Printer, Label Printer, Mini Lario, MP5000' then
    raise exception 'R8d post 3: the wrong four are blank — %', v_bad;
  end if;

  -- The disputed pair keeps the PAPER value.
  select count(*) into v_n from public.fms_ocpi_machines
   where name in ('Homer K32','K64 — 1.8 m','K64 — 3.2 m') and hsn_code = '84433910';
  if v_n <> 3 then raise exception 'R8d post 4: the K32/K64 defaults were disturbed'; end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where hsn_code is not null and hsn_code !~ '^\d{8}$';
  if v_n <> 0 then raise exception 'R8d post 5: % heading(s) are not 8 bare digits', v_n; end if;

  select string_agg(distinct hsn_code, ', ') into v_bad from public.fms_ocpi_machines
   where hsn_code is not null and hsn_code not in ('84433250','84433910');
  if v_bad is not null then raise exception 'R8d post 6: unexpected heading(s): %', v_bad; end if;

  -- Nothing here writes a deal.
  select count(*) into v_n from public.fms_ocpi_deals where hsn_code is not null;
  if v_n <> 0 then raise exception 'R8d post 7: % deal(s) were written — this file touches the master only', v_n; end if;
end $post$;

commit;
