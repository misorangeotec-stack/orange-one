-- B1 (part two) · The eleven machines no invoice ever named — answered by the
--                  client, 10-Sep-2026.
--
-- WHY THEY WERE BLANK
--   `20261114120005` filled 18 of 29 `sales_name` values by reading the Subject
--   line off real Performa Invoices in `Misc/Bushra Reports/OCPI/2025.26 OC&PI`
--   and `2026.27 OC&PI`. These eleven machines have never been invoiced through
--   either folder, so there was nothing to read and they were deliberately left
--   NULL rather than guessed at.
--
-- WHERE THESE ELEVEN COME FROM
--   The client was shown each machine beside the string its Subject line ALREADY
--   printed under the pre-B1 fallback (`machine_model_no`, or the picker name
--   where there is no code), corrected ONE of them, and confirmed the other ten
--   verbatim. So this is a client decision on named values, not an inference.
--
--     MP5000              MS JP7  →  MP5000        ← the one correction
--     Fab Pro 3I          Fab Pro 3i               ← ten confirmed as they stood
--     JPK                 MS-JPK-evo V4
--     P8D                 HM1800R-P8D-A1
--     Kolorado Alpha 16   Kolorado Alpha 16
--     Pengda 1700XD-1000  PD-1700XD-1000
--     Pengda 1800XD-800   Pengda PD-1800XD-800
--     Mini Lario          Mini Lario
--     Book Printer        Book Printer
--     Foil Machine        Foil Machine
--     Label Printer       Label Printer
--
-- 🔴 THIS FILE DELIBERATELY OMITS `20261114120005`'s POST-CHECK 3, and the
--    omission is the point. That check aborted if `sales_name = machine_model_no`,
--    on the reasoning that a sales name repeating the factory code has defeated
--    B1. Three of these eleven do exactly that — P8D (`HM1800R-P8D-A1`),
--    Fab Pro 3I (`Fab Pro 3i`) and Pengda PD-1700XD-1000 (`PD-1700XD-1000`) —
--    and the client confirmed them anyway. Re-asserting that rule here would
--    abort on the client's own answer. It stays absent BY DECISION; do not
--    "restore" it.
--
--    ⚠ MP5000 is the proof that this was read rather than rubber-stamped: it was
--      the only one where the code was rejected in favour of a real name. The
--      other two code-shaped answers were seen in the same list and kept.
--
-- 🟢 NOTHING ELSE CHANGES. No frontend edit is needed — `piPdf.ts` has read
--    `salesName` ahead of `machineModelNo` since 20261114120005 shipped, so
--    these eleven simply stop falling back. Every machine in the master now
--    carries a name, and the Subject line's `machine_model_no` fallback becomes
--    unreachable in practice (kept for a machine added later with no name yet).

begin;

do $assert$
declare v_n int; v_bad text;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='fms_ocpi_machines' and column_name='sales_name';
  if v_n <> 1 then raise exception 'B1b pre 1: sales_name is absent — apply 20261114120005 first'; end if;

  select count(*) into v_n from public.fms_ocpi_machines where sales_name is null;
  if v_n <> 11 then raise exception 'B1b pre 2: expected exactly 11 unnamed machines, found % — the master moved', v_n; end if;

  -- Every name below must land on a machine that is CURRENTLY blank. A row that
  -- has since been filled by hand would be silently overwritten otherwise.
  select string_agg(m.name, ', ') into v_bad
    from public.fms_ocpi_machines m
   where m.name in ('Fab Pro 3I','JPK','MP5000','P8D','Kolorado Alpha 16',
                    'Pengda PD-1700XD-1000','Pengda PD-1800XD-800','Mini Lario',
                    'Book Printer','Foil Machine','Label Printer')
     and m.sales_name is not null;
  if v_bad is not null then raise exception 'B1b pre 3: already named by hand, would be overwritten: %', v_bad; end if;
end $assert$;

update public.fms_ocpi_machines set sales_name = v.sales_name, updated_at = now()
  from (values
    ('MP5000',                'MP5000'),               -- corrected off `MS JP7`
    ('Fab Pro 3I',            'Fab Pro 3i'),
    ('JPK',                   'MS-JPK-evo V4'),
    ('P8D',                   'HM1800R-P8D-A1'),
    ('Kolorado Alpha 16',     'Kolorado Alpha 16'),
    ('Pengda PD-1700XD-1000', 'PD-1700XD-1000'),
    ('Pengda PD-1800XD-800',  'Pengda PD-1800XD-800'),
    ('Mini Lario',            'Mini Lario'),
    ('Book Printer',          'Book Printer'),
    ('Foil Machine',          'Foil Machine'),
    ('Label Printer',         'Label Printer')
  ) as v(name, sales_name)
 where public.fms_ocpi_machines.name = v.name;

do $post$
declare v_n int; v_bad text;
begin
  select count(*) into v_n from public.fms_ocpi_machines where sales_name is null;
  if v_n <> 0 then raise exception 'B1b post 1: % machine(s) still unnamed — a name did not match', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where sales_name is not null;
  if v_n <> 29 then raise exception 'B1b post 2: expected 29 named machines, found %', v_n; end if;

  -- MP5000 is the one correction; if it reads as its model code this ran wrong.
  select sales_name into v_bad from public.fms_ocpi_machines where name = 'MP5000';
  if v_bad <> 'MP5000' then raise exception 'B1b post 3: MP5000 reads % — the correction did not land', v_bad; end if;

  -- The 18 read off real papers must be untouched by this file.
  select string_agg(name || ' = ' || sales_name, '; ') into v_bad
    from public.fms_ocpi_machines
   where (name = 'Homer K24'        and sales_name <> 'HOMER K24')
      or (name = 'K64 — 1.8 m'      and sales_name <> 'HOMER K64')
      or (name = 'P8S'              and sales_name <> 'Sub Pro II+')
      or (name = 'Rocket'           and sales_name <> 'ROCKET MACHINE');
  if v_bad is not null then raise exception 'B1b post 4: a paper-read name was disturbed: %', v_bad; end if;

  select string_agg(name, ', ') into v_bad from public.fms_ocpi_machines
   where sales_name ~* '(head|printhead|coverage|meter|mtr)';
  if v_bad is not null then raise exception 'B1b post 5: a per-deal fact leaked into the sales name on: %', v_bad; end if;

  select string_agg(name, ', ') into v_bad from public.fms_ocpi_machines
   where sales_name <> btrim(sales_name) or sales_name = '';
  if v_bad is not null then raise exception 'B1b post 6: untrimmed or empty sales name on: %', v_bad; end if;
end $post$;

commit;
