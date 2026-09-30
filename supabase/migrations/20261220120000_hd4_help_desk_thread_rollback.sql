-- ===========================================================================
-- ROLLBACK for 20261220120000_hd4_help_desk_thread.sql
--
-- Three functions. Nothing depends on them.
--
-- ⚠ IT STRANDS ANY TICKET CURRENTLY AT `awaiting_info`. Those rows keep
--   status = 'awaiting_info' and current_step = 'awaiting_info', and with
--   fms_help_answer_info gone there is no way to move them on. Before rolling
--   this back on a live desk, put them back yourself:
--
--     update public.fms_help_tickets
--        set status = 'open', current_step = 'resolve', info_answered_at = now()
--      where current_step = 'awaiting_info';
--
--   That line is NOT run automatically here. A rollback of behaviour must not
--   quietly rewrite the history of work people actually did — and on an empty
--   desk it would have nothing to do anyway.
-- ===========================================================================

begin;

drop function if exists public.fms_help_answer_info(uuid, text, jsonb);
drop function if exists public.fms_help_request_info(uuid, uuid, text, jsonb);
drop function if exists public.fms_help_post_comment(uuid, text, uuid[], jsonb);

do $rb$
declare v_stranded int;
begin
  if to_regprocedure('public.fms_help_answer_info(uuid,text,jsonb)') is not null
     or to_regprocedure('public.fms_help_request_info(uuid,uuid,text,jsonb)') is not null
     or to_regprocedure('public.fms_help_post_comment(uuid,text,uuid[],jsonb)') is not null then
    raise exception 'rollback left an HD-4 function standing';
  end if;

  -- Not fatal: said out loud so it is a decision rather than a discovery.
  select count(*) into v_stranded from public.fms_help_tickets where current_step = 'awaiting_info';
  if v_stranded > 0 then
    raise warning 'HD-4 rollback: % ticket(s) are stranded at awaiting_info — see the header', v_stranded;
  end if;
end $rb$;

commit;
