-- ROLLBACK for 20261114120014 — the gate demands a delivery DATE again.
--
-- 🔴 THIS RE-BREAKS THE FORM. The date control does not exist any more (R1
--    removed it), so restoring `delivery_date IS NOT NULL` means **no new
--    quotation can be sent for approval** — the exact wall the forward file was
--    written to remove. Run this only to escape a worse problem, and only
--    alongside a revert of R1's frontend.
--
-- 🟢 NO ROW IS DESTROYED EITHER WAY. This changes a constraint, not data, and
--    every deal that exists today carries a delivery date — so the narrowed
--    rule still validates against all of them.
--
-- ⚠ REBUILT FROM THE LIVE DEFINITION, same as the forward file, so whatever
--   other clauses the gate has grown since are carried through untouched.

begin;

do $undo$
declare v_def text; v_new text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname = 'fms_ocpi_complete_when_submitted';
  if v_def is null then raise exception 'R1b rollback: the constraint is not installed'; end if;

  v_new := replace(
    v_def,
    '((delivery_date IS NOT NULL) OR (NULLIF(btrim(COALESCE(delivery_days, ''''::text)), ''''::text) IS NOT NULL))',
    '(delivery_date IS NOT NULL)'
  );
  if v_new = v_def then
    raise exception 'R1b rollback: the widened clause did not match — it has been changed since, re-read it';
  end if;

  execute 'alter table public.fms_ocpi_deals drop constraint fms_ocpi_complete_when_submitted';
  execute 'alter table public.fms_ocpi_deals add constraint fms_ocpi_complete_when_submitted ' || v_new;
end $undo$;

do $post$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.fms_ocpi_deals'::regclass
     and conname = 'fms_ocpi_complete_when_submitted';
  if v_def like '%delivery_days%' then raise exception 'R1b rollback: delivery_days survives'; end if;
  if v_def not like '%delivery_date%' then raise exception 'R1b rollback: delivery_date was lost'; end if;
end $post$;

commit;
