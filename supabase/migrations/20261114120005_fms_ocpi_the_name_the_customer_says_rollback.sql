-- ROLLBACK for 20261114120005 — the Subject line goes back to the factory code.
--
-- ⚠ ROLL `lib/piPdf.ts` BACK WITH IT, or rather: you do not have to. The reader
--   is `machine?.salesName?.trim() || machine?.machineModelNo?.trim()`, so
--   dropping the column leaves `salesName` undefined and the subject falls
--   straight back to the model number — exactly the pre-B1 behaviour. The
--   frontend is safe against this file running without it.
--
-- 🔴 RUN `20261114120006_..._rollback.sql` FIRST. That migration filled the 11
--    machines this one left blank, so the guard below WILL abort until it has
--    been undone. That is the guard doing its job, not a fault: it cannot tell a
--    value 20261114120006 wrote from one a person typed on the Machines master,
--    and only that file knows which eleven strings it is responsible for.
--
-- ⚠ THE COLUMN IS DROPPED, NOT BLANKED. It holds nothing a person typed: every
--   value was derived from the papers by this migration and is re-derivable
--   from it. If anyone has since edited a name through the Machines master,
--   THAT IS HAND-ENTERED DATA AND THIS FILE WILL DESTROY IT — check before
--   running:
--
--     select name, sales_name from public.fms_ocpi_machines
--      where sales_name is not null
--        and name in ('Fab Pro 3I','JPK','MP5000','P8D','Kolorado Alpha 16',
--                     'Pengda PD-1700XD-1000','Pengda PD-1800XD-800',
--                     'Mini Lario','Book Printer','Foil Machine','Label Printer');
--
--   Any row returned is a name a person supplied. Write it down first.
--
-- 🟢 NO FROZEN PAPER IS AFFECTED EITHER WAY. `oc_document_payload` snapshots an
--    issued document, so a paper already sent keeps the subject line it went out
--    with regardless of what this column says.

begin;

do $guard$
declare v_hand text;
begin
  select string_agg(name || ' = ' || sales_name, '; ') into v_hand
    from public.fms_ocpi_machines
   where sales_name is not null
     and name in ('Fab Pro 3I','JPK','MP5000','P8D','Kolorado Alpha 16',
                  'Pengda PD-1700XD-1000','Pengda PD-1800XD-800',
                  'Mini Lario','Book Printer','Foil Machine','Label Printer');
  if v_hand is not null then
    raise exception 'B1 rollback: hand-entered sales names would be destroyed — %. Record them, then comment out this guard.', v_hand;
  end if;
end $guard$;

alter table public.fms_ocpi_machines drop column if exists sales_name;

do $post$
declare v_n int;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='fms_ocpi_machines' and column_name='sales_name';
  if v_n <> 0 then raise exception 'B1 rollback: the column survives'; end if;
end $post$;

commit;
