-- ===========================================================================
-- ROLLBACK for 20261222120000_hd6_help_desk_reassign_recategorise.sql
--
-- Three functions. Nothing depends on them.
--
-- ⚠ IT DOES NOT UNDO REASSIGNMENTS. Tickets keep the `assignee_id` and the
--   `recategorised_from` they were given, which is correct: those are facts
--   about work people did, not behaviour. A held ticket stays with whoever it
--   was handed to, and the category owners stay out of it until an admin clears
--   the column:
--
--     update public.fms_help_tickets set assignee_id = null where assignee_id is not null;
--
--   Deliberately NOT run here — it would silently re-route live work.
-- ===========================================================================

begin;

drop function if exists public.fms_help_recategorise(uuid, uuid, text);
drop function if exists public.fms_help_reassign(uuid, uuid, text);
drop function if exists public.fms_help_can_receive(uuid);

do $rb$
declare v_held int;
begin
  if to_regprocedure('public.fms_help_recategorise(uuid,uuid,text)') is not null
     or to_regprocedure('public.fms_help_reassign(uuid,uuid,text)') is not null
     or to_regprocedure('public.fms_help_can_receive(uuid)') is not null then
    raise exception 'rollback left an HD-6 function standing';
  end if;

  select count(*) into v_held from public.fms_help_tickets where assignee_id is not null;
  if v_held > 0 then
    raise warning 'HD-6 rollback: % ticket(s) still held by a named assignee — see the header', v_held;
  end if;
end $rb$;

commit;
