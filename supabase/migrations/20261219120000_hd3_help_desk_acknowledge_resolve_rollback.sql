-- ===========================================================================
-- ROLLBACK for 20261219120000_hd3_help_desk_acknowledge_resolve.sql
--
-- Two functions, nothing else. No policy or table depends on either, so the
-- order here does not matter — unlike HD-2's, where the storage policies had to
-- go before fms_help_can_see.
--
-- ⚠ IT DOES NOT UNDO WORK ALREADY DONE. Tickets already acknowledged or
--   resolved keep their stamps and stay at the step this migration moved them
--   to, which leaves them sitting at `confirm` with no way to get there again.
--   That is the correct behaviour for a rollback of BEHAVIOUR — it is not a
--   data rollback, and pretending otherwise would rewrite an audit trail.
-- ===========================================================================

begin;

drop function if exists public.fms_help_resolve(uuid, text, jsonb);
drop function if exists public.fms_help_acknowledge(uuid, text);

do $rb$
begin
  if to_regprocedure('public.fms_help_resolve(uuid,text,jsonb)') is not null
     or to_regprocedure('public.fms_help_acknowledge(uuid,text)') is not null then
    raise exception 'rollback left an HD-3 function standing';
  end if;
end $rb$;

commit;
