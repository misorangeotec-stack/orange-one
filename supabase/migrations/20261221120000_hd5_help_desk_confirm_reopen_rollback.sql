-- ===========================================================================
-- ROLLBACK for 20261221120000_hd5_help_desk_confirm_reopen.sql
--
-- Four functions. Nothing depends on them.
--
-- ⚠ UNSCHEDULE AUTO-CLOSE FIRST if it was ever armed
--   (…_hd5_auto_close_nightly.sql): a cron entry calling a dropped function
--   fails every night, silently, in a log nobody reads.
--
--     select cron.unschedule('help-desk-auto-close');
--
-- ⚠ IT STRANDS ANY TICKET AT `confirm`. Those keep status = 'resolved' with no
--   way to close or reopen them. On a live desk, decide what they are before
--   rolling back — they are answered work waiting on an employee, not rubbish:
--
--     update public.fms_help_tickets
--        set status = 'closed', current_step = null, closed_at = now(),
--            closed_reason = 'auto_closed'
--      where current_step = 'confirm';
--
--   Deliberately NOT run here. Closing somebody's ticket is a decision, and a
--   rollback of behaviour must not quietly make it.
-- ===========================================================================

begin;

drop function if exists public.fms_help_auto_close();
drop function if exists public.fms_help_reopen(uuid, text);
drop function if exists public.fms_help_confirm(uuid, integer, text);
drop function if exists public.fms_help_add_working_days(date, integer);

do $rb$
declare v_stranded int;
begin
  if to_regprocedure('public.fms_help_auto_close()') is not null
     or to_regprocedure('public.fms_help_reopen(uuid,text)') is not null
     or to_regprocedure('public.fms_help_confirm(uuid,integer,text)') is not null
     or to_regprocedure('public.fms_help_add_working_days(date,integer)') is not null then
    raise exception 'rollback left an HD-5 function standing';
  end if;

  select count(*) into v_stranded from public.fms_help_tickets where current_step = 'confirm';
  if v_stranded > 0 then
    raise warning 'HD-5 rollback: % ticket(s) stranded at confirm — see the header', v_stranded;
  end if;
end $rb$;

commit;
