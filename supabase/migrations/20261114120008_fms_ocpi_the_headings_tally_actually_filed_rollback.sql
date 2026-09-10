-- ROLLBACK for 20261114120008 — the nine go back to stating no heading.
--
-- 🟢 NOTHING BREAKS. A blank `hsn_code` is OMITTED from the invoice and the
--    contract rather than ruled as a gap, so these nine simply lose their
--    `HSN CODE: …` line. No frontend change accompanies the forward file, so
--    there is none to undo.
--
-- ⚠ RUN THIS BEFORE `20261114120007_..._rollback.sql`, which asserts that
--   exactly 5 machines remain coded. With these nine still in place it counts 14
--   and aborts.
--
-- ⚠ A PAPER ALREADY ISSUED KEEPS ITS HEADING — `oc_document_payload` freezes an
--   issued document. Only papers generated after this runs lose the line.
--
-- ⚠ HOMER K24, POSITION PRINTER, ROCKET, K32 AND BOTH K64s ARE NOT TOUCHED.
--   They were coded by earlier files or by the paper archive and belong to
--   those, not to this one.

begin;

do $guard$
declare v_hand text;
begin
  /*
    A value that no longer matches what 20261114120008 wrote is a HAND EDIT, or
    the client's answer to the K32/K64 conflict landing on these rows too. Either
    way it is not this file's to destroy. Record it, then comment this block out.
  */
  select string_agg(m.name || ' = ' || coalesce(m.hsn_code, 'NULL'), '; ') into v_hand
    from public.fms_ocpi_machines m
    join (values
      ('P8S','84433250'), ('P8D','84433250'), ('Fab Pro 1I','84433250'),
      ('Fab Pro 2I','84433250'), ('Kolorado Alpha 15','84433250'),
      ('Foil Machine','84433250'), ('Pengda PD-1700XD-800','84433910'),
      ('Pengda PD-1800XD-800','84433910'), ('JPK','84433910')
    ) as v(name, hsn) on v.name = m.name
   where m.hsn_code is distinct from v.hsn;
  if v_hand is not null then
    raise exception 'R8b rollback: changed after the migration ran — %. Record them, then comment out this guard.', v_hand;
  end if;
end $guard$;

update public.fms_ocpi_machines set hsn_code = null, updated_at = now()
 where name in ('P8S','P8D','Fab Pro 1I','Fab Pro 2I','Kolorado Alpha 15','Foil Machine',
                'Pengda PD-1700XD-800','Pengda PD-1800XD-800','JPK');

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 6 then raise exception 'R8b rollback: expected 6 coded machines to remain, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is null;
  if v_n <> 23 then raise exception 'R8b rollback: expected 23 uncoded, found %', v_n; end if;
end $post$;

commit;
