-- HR Recruitment — record WHEN a vacancy was put on hold.
--
-- A held requisition disappears from every queue and every scoreboard, by design: it is
-- parked, not late. But nothing recorded *when* it was parked, so nothing could say how
-- long it had been sitting there — and a budget freeze in March quietly becomes a
-- vacancy nobody ever reopened.
--
-- The Control Center is about to show held vacancies in their own grey strip, with an
-- age ("parked 34 days"). Grey, never red — it was paused deliberately — but never
-- invisible either. That needs a timestamp, and there wasn't one.
--
-- Additive: one nullable column. Existing held rows are back-filled from `updated_at`,
-- which is the closest honest approximation of when they were last changed (and there
-- are none in the live data today, so in practice this back-fill touches nothing).

alter table public.fms_hr_requisitions
  add column if not exists hold_at timestamptz;

comment on column public.fms_hr_requisitions.hold_at is
  'When the vacancy was put on hold. Cleared on resume. Drives the "parked N days" age on the Control Center.';

update public.fms_hr_requisitions
   set hold_at = updated_at
 where status = 'on_hold' and hold_at is null;

-- Stamp it on hold, clear it on resume. Otherwise unchanged.
create or replace function public.fms_hr_hold_requisition(p_req uuid, p_hold boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_step   text;
  v_uid    uuid := auth.uid();
begin
  select status, current_step into v_status, v_step
    from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if not (public.is_admin(v_uid) or public.fms_hr_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can hold a requisition';
  end if;

  if p_hold then
    if v_status in ('closed','cancelled','rejected','on_hold') then
      raise exception 'A % requisition cannot be put on hold', v_status;
    end if;
    if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to hold'; end if;
    update public.fms_hr_requisitions
       set status = 'on_hold', hold_reason = trim(p_reason), hold_at = now()
     where id = p_req;
  else
    if v_status <> 'on_hold' then raise exception 'This requisition is not on hold'; end if;
    -- Resume back to whatever step it was parked at.
    update public.fms_hr_requisitions
       set status = case v_step
                      when 'hr_head_approval' then 'hr_review'
                      when 'mgmt_approval'    then 'mgmt_review'
                      when 'job_posting'      then 'posting'
                      else 'sourcing'
                    end,
           hold_reason = null,
           hold_at = null
     where id = p_req;
  end if;
end $$;

grant execute on function public.fms_hr_hold_requisition(uuid, boolean, text) to authenticated;
