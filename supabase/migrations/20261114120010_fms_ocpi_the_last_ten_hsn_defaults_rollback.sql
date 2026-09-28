-- ROLLBACK for 20261114120010 — the ten inferred defaults go back to blank.
--
-- 🟢 NOTHING BREAKS. A blank default means the picker opens with no heading
--    pre-selected and, if nobody chooses one, the paper prints no HSN line —
--    which is correct for 30 of 34 real Performa Invoices.
--
-- ⚠ RUN THIS BEFORE `20261114120008_..._rollback.sql`, which asserts that
--   exactly 6 machines remain coded. With these ten still in place it counts 16
--   and aborts.
--
-- ⚠ A DEAL THAT ALREADY CHOSE ONE OF THESE HEADINGS KEEPS IT. `fms_ocpi_deals.
--   hsn_code` is a separate column and this file does not touch it — so a
--   quotation raised while the default was in place still prints what its
--   salesperson confirmed. That is the point of the two-level design.
--
-- ⚠ THE 15 READ FROM PAPERS AND TALLY ARE NOT TOUCHED. They belong to
--   20261114120007 and _120008.

begin;

do $guard$
declare v_hand text;
begin
  select string_agg(m.name || ' = ' || coalesce(m.hsn_code, 'NULL'), '; ') into v_hand
    from public.fms_ocpi_machines m
    join (values
      ('Fab Pro 3I','84433250'), ('Kolorado Alpha 16','84433250'),
      ('KoloRado Alpha 3 — 12 heads','84433250'),
      ('KoloRado Alpha 3.2 — 8 heads','84433250'),
      ('KoloRado Alpha 3.2 — 16 heads','84433250'),
      ('KoloRado Alpha 3.2 — 24 heads','84433250'),
      ('KoloRado Alpha II — 1.8 m, 8 heads','84433250'),
      ('KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)','84433250'),
      ('KoloRado Alpha II — 2.2 m, 8 heads','84433250'),
      ('Pengda PD-1700XD-1000','84433910')
    ) as v(name, hsn) on v.name = m.name
   where m.hsn_code is distinct from v.hsn;
  if v_hand is not null then
    raise exception 'R8d rollback: changed after the migration ran — %. Record them, then comment out this guard.', v_hand;
  end if;
end $guard$;

update public.fms_ocpi_machines set hsn_code = null, updated_at = now()
 where name in ('Fab Pro 3I','Kolorado Alpha 16','KoloRado Alpha 3 — 12 heads',
                'KoloRado Alpha 3.2 — 8 heads','KoloRado Alpha 3.2 — 16 heads',
                'KoloRado Alpha 3.2 — 24 heads','KoloRado Alpha II — 1.8 m, 8 heads',
                'KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)',
                'KoloRado Alpha II — 2.2 m, 8 heads','Pengda PD-1700XD-1000');

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 15 then raise exception 'R8d rollback: expected 15 coded machines to remain, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is null;
  if v_n <> 14 then raise exception 'R8d rollback: expected 14 blank, found %', v_n; end if;
end $post$;

commit;
