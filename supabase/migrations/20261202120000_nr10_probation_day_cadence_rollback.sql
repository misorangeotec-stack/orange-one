-- ===========================================================================
-- ROLLBACK for 20261202120000_nr10_probation_day_cadence.sql
--
-- Restores the two functions it replaced to the bodies they were running
-- before NR-10, copied verbatim from pg_proc.prosrc on 21-09-2026, then removes
-- everything NR-10 added.
--
-- It discards NR-10's own data: the check-ins and the joiner-account links.
-- The monthly model is untouched throughout - it was never altered.
-- ===========================================================================

-- 1 ── opening a probation, back to the monthly announcement -----------------

create or replace function public.fms_hr_open_probation(p_onb uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_cand    uuid;
  v_req     uuid;
  v_joining date;
  v_done    timestamptz;
  v_name    text;
  v_no      text;
  v_mgrs    uuid[];
  v_id      uuid;
begin
  if auth.uid() is not null and not public.is_staff(auth.uid()) then
    raise exception 'Not authorized';
  end if;
  select o.candidate_id, o.requisition_id, o.joining_date, o.completed_at
    into v_cand, v_req, v_joining, v_done
    from public.fms_hr_onboardings o where o.id = p_onb;

  if v_done is null or v_joining is null then return; end if;

  insert into public.fms_hr_probations (onboarding_id, candidate_id, requisition_id, joining_date)
  values (p_onb, v_cand, v_req, v_joining)
  on conflict (onboarding_id) do nothing
  returning id into v_id;

  if v_id is null then return; end if;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', v_id, 'opened',
    coalesce(v_name, 'The new hire') || ' is on probation — the Month-1 review is due '
      || to_char(public.fms_hr_add_months(v_joining, 1), 'DD-MM-YYYY')
      || ' (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[])
  );
end
$fn$;

-- 2 ── the ownership rule, back to the monthly key list ----------------------

create or replace function public.fms_hr_is_natural_step_owner(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_managers uuid[];
begin
  if p_step_key in (
    'hod_shortlist','interview_2',
    'probation_m1','probation_m2','probation_m3',
    'probation_final','probation_extension'
  ) then
    if p_req is null then return public.fms_hr_is_step_owner(p_step_key, p_uid); end if;

    select hiring_manager_ids into v_managers from public.fms_hr_requisitions where id = p_req;

    return (v_managers is not null and p_uid = any(v_managers))
        or public.fms_hr_is_step_owner(p_step_key, p_uid);
  end if;

  return public.fms_hr_is_step_owner(p_step_key, p_uid);
end
$fn$;

-- 3 ── NR-10's own objects ---------------------------------------------------

drop function if exists public.fms_hr_submit_probation_checkin(uuid, integer, text, text, text, text, text);
drop function if exists public.fms_hr_is_my_probation(uuid, uuid);
drop function if exists public.fms_hr_seed_probation_checkins(uuid);
drop function if exists public.fms_hr_set_employee_user(uuid, uuid);

drop table if exists public.fms_hr_probation_checkins;

delete from public.fms_hr_step_owners
 where step_key in ('probation_d7','probation_d15','probation_d30','probation_d60','probation_d90');

alter table public.fms_hr_onboardings
  drop constraint if exists fms_hr_onboardings_employee_user_fkey;

alter table public.fms_hr_onboardings
  drop column if exists employee_user_id,
  drop column if exists employee_user_set_at,
  drop column if exists employee_user_set_by;
