-- Rollback for 20270114120000_fms_hr_future_reference.sql
--
-- What happens to parked candidates: dropping the columns removes the mark, so every
-- candidate still in Future Reference simply reappears on the vacancy they were parked
-- from, at the stage they were at. Who parked them and why is discarded — export the
-- bucket first if that is worth keeping.
--
-- Restores fms_hr_notify_hod_pending() to its 20260903130000 body, then drops the
-- RPCs, policies, predicates, config row and columns — policies before the columns
-- they read.

begin;

create or replace function public.fms_hr_notify_hod_pending(p_requisition uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_n      integer;
  v_mrf    text;
  v_text   text;
  v_mgrs   uuid[];
  m        uuid;
begin
  if p_requisition is null then return; end if;

  -- auth.uid() is null when this runs from a migration (§6) or a cron job; in that
  -- case there is no caller to authorize and nobody to skip as "the actor".
  if v_uid is not null and not public.fms_hr_can_read_requisition(p_requisition, v_uid) then
    return;
  end if;

  select r.mrf_no, coalesce(r.hiring_manager_ids, '{}'::uuid[])
    into v_mrf, v_mgrs
    from public.fms_hr_requisitions r
   where r.id = p_requisition;
  if v_mrf is null then return; end if;

  -- Counted here rather than passed in, so the text can never drift from the board.
  select count(*) into v_n
    from public.fms_hr_candidates c
   where c.requisition_id = p_requisition
     and c.stage = 'hr_shortlisted';

  v_text := format('%s CV%s awaiting your shortlist — %s',
                   v_n, case when v_n = 1 then '' else 's' end, v_mrf);

  foreach m in array v_mgrs loop
    if m is null or m = v_uid then continue; end if;

    if v_n = 0 then
      -- Nothing left to shortlist: retire our own stale digest rather than leaving
      -- it claiming CVs that are no longer there. Marked read, never deleted.
      update public.fms_hr_notifications
         set read_at = now()
       where user_id = m
         and type = 'hod_shortlist_pending'
         and entity_id = p_requisition
         and read_at is null;
    else
      update public.fms_hr_notifications
         set text = v_text, created_at = now(), actor_id = v_uid
       where user_id = m
         and type = 'hod_shortlist_pending'
         and entity_id = p_requisition
         and read_at is null;

      -- No unique constraint on this table, so update-then-insert is what keeps it
      -- to one row per (manager, requisition).
      if not found then
        insert into public.fms_hr_notifications
          (user_id, type, entity_type, entity_id, text, actor_id)
        values
          (m, 'hod_shortlist_pending', 'requisition', p_requisition, v_text, v_uid);
      end if;
    end if;
  end loop;
end $$;

drop policy if exists "fms hr docs read future ref" on storage.objects;
drop policy if exists fms_hr_requisitions_select_future_ref on public.fms_hr_requisitions;
drop policy if exists fms_hr_activity_select_future_ref on public.fms_hr_activity;
drop policy if exists fms_hr_candidates_select_future_ref on public.fms_hr_candidates;

drop function if exists public.fms_hr_move_to_pipeline(uuid, uuid, text);
drop function if exists public.fms_hr_save_future_reference(uuid, text);
drop function if exists public.fms_hr_is_future_ref_candidate(uuid);
drop function if exists public.fms_hr_is_future_ref_viewer(uuid);

delete from public.fms_hr_config where key = 'future_ref_viewers';

drop index if exists public.fms_hr_candidates_future_ref_idx;
alter table public.fms_hr_candidates drop column if exists future_ref_note;
alter table public.fms_hr_candidates drop column if exists future_ref_by;
alter table public.fms_hr_candidates drop column if exists future_ref_at;

commit;
