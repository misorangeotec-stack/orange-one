-- ROLLBACK for 20261114120011 — MP5000 goes back to stating no heading.
--
-- 🟢 NOTHING BREAKS. A blank default means the HSN picker opens with nothing
--    pre-selected and, if nobody chooses, the invoice and contract print no HSN
--    line — correct for 30 of 34 real Performa Invoices.
--
-- ⚠ RUN THIS BEFORE `20261114120010_..._rollback.sql`, which asserts that
--   exactly 25 machines remain coded. With MP5000 still coded it counts 26 and
--   aborts.
--
-- ⚠ A DEAL THAT ALREADY CHOSE 84433910 KEEPS IT. `fms_ocpi_deals.hsn_code` is a
--   separate column and this file does not touch it, so a quotation raised while
--   the default was in place still prints what its salesperson confirmed.
--
-- ⚠ THE CLIENT SUPPLIED THIS VALUE DIRECTLY on 10-Sep-2026 — it is not derived
--   from any paper or voucher and cannot be recovered by re-reading the data.
--   The value is `84433910`; it is written here and in the forward migration.

begin;

do $guard$
declare v_now text;
begin
  select hsn_code into v_now from public.fms_ocpi_machines where name = 'MP5000';
  if v_now is null then raise exception 'R8e rollback: MP5000 already has no heading — nothing to undo'; end if;
  if v_now <> '84433910' then
    raise exception 'R8e rollback: MP5000 now reads %, not the value this migration wrote. That is a later edit — record it, then comment out this guard.', v_now;
  end if;
end $guard$;

update public.fms_ocpi_machines
   set hsn_code = null, updated_at = now()
 where name = 'MP5000' and hsn_code = '84433910';

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 25 then raise exception 'R8e rollback: expected 25 coded machines to remain, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is null;
  if v_n <> 4 then raise exception 'R8e rollback: expected 4 blank, found %', v_n; end if;
end $post$;

commit;
