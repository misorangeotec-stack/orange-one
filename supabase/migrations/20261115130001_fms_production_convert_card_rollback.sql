-- ===========================================================================
-- ROLLBACK for 20261115130000_fms_production_convert_card.sql
--
-- ⚠ RUN ONLY IF NO CONVERT CARDS EXIST, or you have decided what should happen
--   to them. The card_type CHECK is narrowed back to two values, so any row
--   still carrying 'convert' would make the constraint un-addable — the guard
--   below stops with a clear message instead of half-applying.
--
--   The unique index on jobcard_no is KEPT. It is correct regardless of this
--   feature (two job cards sharing a Lot/Batch number are indistinguishable
--   everywhere downstream), and dropping it would silently re-open that door.
--   Drop it by hand if you truly want it gone.
--
-- To restore the intake function itself, re-run
-- 20261115120000_fms_production_drop_pm_transfer_move_mc.sql, whose section 6
-- recreates fms_production_submit_request with only the two original branches.
-- ===========================================================================

do $do$
declare v_convert int;
begin
  select count(*) into v_convert
    from public.fms_production_requests where card_type = 'convert';
  if v_convert > 0 then
    raise exception
      'Cannot roll back: % job card(s) have card_type = convert. Decide what they should become (most likely card_type = production, since a convert card runs the identical chain) and update them first.',
      v_convert;
  end if;
end
$do$;

alter table public.fms_production_requests drop constraint if exists fms_production_requests_card_type_check;
alter table public.fms_production_requests add constraint fms_production_requests_card_type_check
  check (card_type in ('production','repackaging'));

comment on column public.fms_production_requests.card_type is
  'production | repackaging. Repackaging is a traded FG that is only repacked; it is raised straight into the packing entry and skips the manufacturing steps and M/C testing.';
