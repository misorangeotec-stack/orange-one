-- FMS — stage-advancement RPC (Phase 3).
--
-- Completing a stage must atomically: stamp the current stage done, advance the
-- entry's current_step_index, and activate the NEXT stage's row. That next row is
-- owned by a DIFFERENT employee, so the Phase-2 owner-RLS on fms_entry_stages
-- blocks a direct client write. This SECURITY DEFINER function is the secure path:
-- it bypasses RLS but re-checks authorization internally (admin or the current
-- stage's assigned owner), mirroring the existing generate_recurring_task_now /
-- add_task_remark pattern.
--
-- The same function also completes the ORIGIN stage right after an entry is
-- created (the New Order flow inserts the entry — RLS-gated to the origin owner —
-- then calls this to mark Generate Order done and activate the next stage).
--
-- The next stage's planned_date is computed client-side (it needs the working-day
-- rule + captured field values, e.g. the vendor dispatch date) and passed in as
-- p_next_planned_date. Purely ADDITIVE. Apply in the identity Supabase project
-- (ref coshondiqdhorwvibrwu) BEFORE the Phase-3 frontend goes live.
--
-- Reversal:
--   drop function if exists public.fms_complete_stage(uuid, jsonb, date);

create or replace function public.fms_complete_stage(
  p_entry_id uuid,
  p_values jsonb default '{}'::jsonb,
  p_next_planned_date date default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idx        integer;
  v_workflow   uuid;
  v_step_count integer;
begin
  -- Lock the entry; capture where it currently sits.
  select current_step_index, workflow_id
    into v_idx, v_workflow
  from public.fms_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'FMS entry % not found', p_entry_id;
  end if;

  -- Authorization: admin, or the assigned owner of the stage being completed.
  if not (public.is_admin(auth.uid()) or public.fms_is_current_owner(p_entry_id, auth.uid())) then
    raise exception 'Not authorized to complete the current stage of this entry';
  end if;

  select count(*) into v_step_count
  from public.fms_workflow_steps
  where workflow_id = v_workflow;

  if v_idx >= v_step_count then
    raise exception 'This entry is already complete';
  end if;

  -- Stamp the current stage done with its captured values.
  update public.fms_entry_stages
     set status = 'done',
         actual_date = now(),
         values = coalesce(p_values, '{}'::jsonb),
         completed_by = auth.uid()
   where entry_id = p_entry_id
     and step_index = v_idx;

  -- Advance: activate the next stage, or mark the entry complete.
  if v_idx + 1 < v_step_count then
    update public.fms_entry_stages
       set status = 'active',
           planned_date = p_next_planned_date
     where entry_id = p_entry_id
       and step_index = v_idx + 1;

    update public.fms_entries
       set current_step_index = v_idx + 1
     where id = p_entry_id;
  else
    update public.fms_entries
       set current_step_index = v_idx + 1,
           status = 'completed'
     where id = p_entry_id;
  end if;

  return v_idx + 1;
end $$;

comment on function public.fms_complete_stage(uuid, jsonb, date) is
  'Atomically complete the entry''s current stage and activate the next (with planned_date). Authz: admin or current-stage owner.';

grant execute on function public.fms_complete_stage(uuid, jsonb, date) to authenticated;
