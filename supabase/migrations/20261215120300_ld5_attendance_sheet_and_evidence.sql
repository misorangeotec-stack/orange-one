-- ===========================================================================
-- LEARNING & DEVELOPMENT — the attendance sheet and the session evidence.
--
-- The columns already exist (added by 20261215120200); these are the two RPCs
-- that write them, so the files are attached the same way every other change in
-- this module is made — through a function that checks who you are.
--
-- The client asked for the sheet explicitly: HR "can even upload the attendance
-- sheet as well on this part".
--
-- ⚠ THE SHEET IS EVIDENCE BESIDE THE MARKED ROWS, NEVER INSTEAD OF THEM.
--   `fms_ld_close_attendance` still refuses while any nominee has no status, and
--   the KPI line "attendance capture, 100% of sessions" counts marked rows. A
--   scan cannot be counted, sorted, or turned into per-person learning hours.
--
-- ⚠ THE SHEET CAN BE ATTACHED AFTER ATTENDANCE IS CLOSED, deliberately. The
--   paper is often signed in the room and scanned days later, and refusing it
--   then would mean either holding the close open or losing the evidence. The
--   marks are locked; the attachment is not.
--
-- Rollback: 20261215120300_ld5_attendance_sheet_and_evidence_rollback.sql
-- ===========================================================================

create or replace function public.fms_ld_set_attendance_sheet(
  p_session_id uuid,
  p_path       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not public.fms_ld_can_act_session('attendance', p_session_id, v_uid) then
    raise exception 'Not authorised to attach the attendance sheet';
  end if;

  update public.fms_ld_sessions
     set attendance_sheet_path = nullif(p_path, '')
   where id = p_session_id;

  perform public.fms_ld_announce('session', p_session_id,
    case when coalesce(p_path,'') = '' then 'ld_attendance_sheet_removed' else 'ld_attendance_sheet_added' end,
    case when coalesce(p_path,'') = '' then 'Attendance sheet removed' else 'Attendance sheet attached' end,
    '{}'::uuid[]);
end $$;
grant execute on function public.fms_ld_set_attendance_sheet(uuid, text) to authenticated;

/*
 * Session evidence — photos, screenshots, the trainer's log.
 *
 * ⚠ APPENDS. `fms_ld_record_conduct` REPLACES the whole array, because it is
 *   recording one moment; this one adds to it, because evidence arrives in ones
 *   and twos over the following days and a replace would quietly drop whatever
 *   was already there.
 */
create or replace function public.fms_ld_add_evidence(
  p_session_id uuid,
  p_paths      text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if not public.fms_ld_can_act_session('conducted', p_session_id, v_uid) then
    raise exception 'Not authorised to add evidence to this session';
  end if;
  if p_paths is null or array_length(p_paths, 1) is null then return 0; end if;

  update public.fms_ld_sessions
     set evidence_paths = evidence_paths || p_paths
   where id = p_session_id
  returning array_length(evidence_paths, 1) into v_n;

  perform public.fms_ld_announce('session', p_session_id, 'ld_evidence_added',
    array_length(p_paths, 1) || ' file(s) added as session evidence', '{}'::uuid[]);

  return coalesce(v_n, 0);
end $$;
grant execute on function public.fms_ld_add_evidence(uuid, text[]) to authenticated;
