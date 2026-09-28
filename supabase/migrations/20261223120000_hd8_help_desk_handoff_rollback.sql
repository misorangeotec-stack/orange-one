-- ===========================================================================
-- ROLLBACK for 20261223120000_hd8_help_desk_handoff.sql
--
-- Three functions. Nothing depends on them.
--
-- ⚠ TICKETS KEEP THE REFERENCES ALREADY RECORDED. handoff_app_id / _entity_id /
--   _ref stay on the row and the ticket page keeps showing them, which is
--   correct: they are true facts about where the work went. What goes away is
--   the ability to record a new one or clear a wrong one — so if you are rolling
--   back because a reference is wrong, clear it FIRST.
-- ===========================================================================

begin;

drop function if exists public.fms_help_clear_handoff(uuid, text);
drop function if exists public.fms_help_record_handoff(uuid, text, text);
drop function if exists public.fms_help_resolve_handoff_ref(text, text);

do $rb$
declare v_n int;
begin
  if to_regprocedure('public.fms_help_clear_handoff(uuid,text)') is not null
     or to_regprocedure('public.fms_help_record_handoff(uuid,text,text)') is not null
     or to_regprocedure('public.fms_help_resolve_handoff_ref(text,text)') is not null then
    raise exception 'rollback left an HD-8 function standing';
  end if;

  select count(*) into v_n from public.fms_help_tickets where handoff_ref is not null;
  if v_n > 0 then
    raise warning 'HD-8 rollback: % ticket(s) still carry a recorded reference and it can no longer be cleared', v_n;
  end if;
end $rb$;

commit;
