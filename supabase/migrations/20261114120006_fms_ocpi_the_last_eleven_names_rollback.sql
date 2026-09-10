-- ROLLBACK for 20261114120006 — the eleven go back to blank.
--
-- ⚠ NOTHING BREAKS WHEN THEY DO. `piPdf.ts` reads
--   `salesName ?? machineModelNo ?? name`, so a blanked machine's Subject line
--   falls straight back to what it printed before B1. There is no frontend edit
--   to undo with this file.
--
-- ⚠ RUN THIS BEFORE `20261114120005_rollback.sql`, NOT AFTER. That file's guard
--   aborts when any of these eleven carries a name, because it cannot tell a
--   value this migration wrote from one a person typed on the Machines master.
--   Blanking them here is what lets the guard pass — and if a person HAS since
--   retyped one of them, the guard below catches it first.
--
-- 🟢 THE OTHER 18 ARE NOT TOUCHED. They were read off real invoices by
--    20261114120005 and belong to that file, not this one.

begin;

do $guard$
declare v_hand text;
begin
  /*
    A value that no longer matches what 20261114120006 wrote is a HAND EDIT and
    this file must not destroy it. Record it, then comment this block out.
  */
  select string_agg(m.name || ' = ' || m.sales_name, '; ') into v_hand
    from public.fms_ocpi_machines m
    join (values
      ('MP5000','MP5000'), ('Fab Pro 3I','Fab Pro 3i'), ('JPK','MS-JPK-evo V4'),
      ('P8D','HM1800R-P8D-A1'), ('Kolorado Alpha 16','Kolorado Alpha 16'),
      ('Pengda PD-1700XD-1000','PD-1700XD-1000'),
      ('Pengda PD-1800XD-800','Pengda PD-1800XD-800'), ('Mini Lario','Mini Lario'),
      ('Book Printer','Book Printer'), ('Foil Machine','Foil Machine'),
      ('Label Printer','Label Printer')
    ) as v(name, sales_name) on v.name = m.name
   where m.sales_name is distinct from v.sales_name;
  if v_hand is not null then
    raise exception 'B1b rollback: these were changed after the migration ran — %. Record them, then comment out this guard.', v_hand;
  end if;
end $guard$;

update public.fms_ocpi_machines set sales_name = null, updated_at = now()
 where name in ('Fab Pro 3I','JPK','MP5000','P8D','Kolorado Alpha 16',
                'Pengda PD-1700XD-1000','Pengda PD-1800XD-800','Mini Lario',
                'Book Printer','Foil Machine','Label Printer');

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines where sales_name is null;
  if v_n <> 11 then raise exception 'B1b rollback: expected 11 blanked, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where sales_name is not null;
  if v_n <> 18 then raise exception 'B1b rollback: expected the 18 paper-read names to survive, found %', v_n; end if;
end $post$;

commit;
