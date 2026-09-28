-- ROLLBACK for 20261114120007 — the Homer K24 goes back to stating no heading.
--
-- 🟢 NOTHING BREAKS. A blank `hsn_code` is OMITTED from both papers rather than
--    ruled as a gap, so the K24's invoice and contract simply lose the
--    `HSN CODE: 84433250` line and read as they did before. No frontend change
--    accompanies this file, so there is none to undo.
--
-- ⚠ A K24 PAPER ALREADY ISSUED KEEPS ITS HEADING. `oc_document_payload` freezes
--   an issued document, so this cannot reach one. Only papers generated after
--   this runs lose the line.
--
-- ⚠ THE OTHER FIVE MACHINES ARE NOT TOUCHED. Their 84433910 was in the master
--   before 20261114120007 and belongs to no migration in this series.

begin;

do $guard$
declare v_now text;
begin
  select hsn_code into v_now from public.fms_ocpi_machines where name = 'Homer K24';
  if v_now is null then raise exception 'R8a rollback: Homer K24 already has no heading — nothing to undo'; end if;
  if v_now <> '84433250' then
    raise exception 'R8a rollback: Homer K24 now reads %, not the value this migration wrote. That is a hand edit — record it, then comment out this guard.', v_now;
  end if;
end $guard$;

update public.fms_ocpi_machines
   set hsn_code = null, updated_at = now()
 where name = 'Homer K24' and hsn_code = '84433250';

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 5 then raise exception 'R8a rollback: expected 5 coded machines to remain, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code = '84433910';
  if v_n <> 5 then raise exception 'R8a rollback: the five 84433910 machines were disturbed — % remain', v_n; end if;
end $post$;

commit;
