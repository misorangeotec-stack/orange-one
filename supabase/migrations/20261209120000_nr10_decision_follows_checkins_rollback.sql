-- Rollback for 20261209120000_nr10_decision_follows_checkins.sql
--
-- Puts the monthly-review gates back on both decision RPCs. Everything else in
-- these two functions is byte-identical to what shipped, so this restores them
-- exactly as they were.
--
-- ⚠ Running this makes the probation decision UNREACHABLE again: the forms that
-- wrote fms_hr_probation_reviews were deleted in b2690d30, so the month-3 and
-- month-4 rows these gates ask for can no longer be created from the app. Only
-- run it alongside a frontend rollback to before NR-10.

create or replace function public.fms_hr_decide_probation(
  p_probation uuid,
  p_decision text,
  p_remarks text default ''::text,
  p_permanent_from date default null::date,
  p_employee_code text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_cand    uuid;
  v_join    date;
  v_outcome text;
  v_final   text;
  v_name    text;
  v_no      text;
  v_mgrs    uuid[];
begin
  if p_decision not in ('approve','reject','extend') then
    raise exception 'Unknown probation decision %', p_decision;
  end if;

  select requisition_id, candidate_id, joining_date, outcome, final_status
    into v_req, v_cand, v_join, v_outcome, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_final is not null or v_outcome is not null then
    raise exception 'The three-month decision has already been taken (%)', coalesce(v_final, v_outcome);
  end if;

  -- The decision exists to conclude the reviews. Without the month-3 review there is
  -- nothing to conclude from.
  if not exists (
    select 1 from public.fms_hr_probation_reviews r
     where r.probation_id = p_probation and r.month = 3
  ) then
    raise exception 'Record the month-3 review before taking the final decision';
  end if;

  if not public.fms_hr_can_act('probation_final', v_req, v_uid) then
    raise exception 'Not authorized to decide this probation — that is the hiring manager''s call';
  end if;

  if p_decision = 'approve' then
    if p_permanent_from is null then
      raise exception 'Give the date this person becomes permanent';
    end if;
    if coalesce(trim(p_employee_code), '') = '' then
      raise exception 'Give the final employee ID';
    end if;

    update public.fms_hr_probations set
      outcome         = 'approved',
      outcome_at      = now(),
      outcome_by      = v_uid,
      outcome_remarks = nullif(trim(p_remarks), ''),
      final_status    = 'approved',
      final_status_at = now(),
      permanent_from  = p_permanent_from,
      employee_code   = trim(p_employee_code)
    where id = p_probation;

  elsif p_decision = 'reject' then
    if coalesce(trim(p_remarks), '') = '' then
      raise exception 'Say why probation was not cleared';
    end if;

    -- NOTE the deliberate absence of fms_hr_sync_requisition_fill(v_req) here. This
    -- person joined and filled the seat; the vacancy that hired them is closed and
    -- stays closed. Replacing them is a new MRF, not a reopened old one.
    update public.fms_hr_probations set
      outcome         = 'rejected',
      outcome_at      = now(),
      outcome_by      = v_uid,
      outcome_remarks = trim(p_remarks),
      final_status    = 'rejected',
      final_status_at = now()
    where id = p_probation;

  else -- extend
    update public.fms_hr_probations set
      outcome         = 'extended',
      outcome_at      = now(),
      outcome_by      = v_uid,
      outcome_remarks = nullif(trim(p_remarks), '')
    where id = p_probation;
  end if;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', p_probation,
    case p_decision when 'approve' then 'confirmed' when 'reject' then 'rejected' else 'extended' end,
    coalesce(v_name, 'The new hire') || ' — probation '
      || case p_decision
           when 'approve' then 'cleared; permanent from ' || to_char(p_permanent_from, 'DD-MM-YYYY')
           when 'reject'  then 'not cleared: ' || trim(p_remarks)
           else 'extended by one month; the Month-4 review is due '
                || to_char(public.fms_hr_add_months(v_join, 4), 'DD-MM-YYYY')
         end
      || ' (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[]) || public.fms_hr_step_owner_ids('onboarding')
  );
end $function$;

create or replace function public.fms_hr_decide_extension(
  p_probation uuid,
  p_decision text,
  p_remarks text default ''::text,
  p_permanent_from date default null::date,
  p_employee_code text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_cand    uuid;
  v_outcome text;
  v_ext     text;
  v_final   text;
  v_name    text;
  v_no      text;
  v_mgrs    uuid[];
begin
  if p_decision not in ('approve','reject') then
    raise exception 'An extended probation ends in approve or reject — it cannot be extended again';
  end if;

  select requisition_id, candidate_id, outcome, extension_outcome, final_status
    into v_req, v_cand, v_outcome, v_ext, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_outcome is distinct from 'extended' then
    raise exception 'This probation was not extended — use the three-month decision';
  end if;
  if v_final is not null or v_ext is not null then
    raise exception 'The extended probation has already been decided (%)', coalesce(v_final, v_ext);
  end if;

  if not exists (
    select 1 from public.fms_hr_probation_reviews r
     where r.probation_id = p_probation and r.month = 4
  ) then
    raise exception 'Record the month-4 review before closing the extended probation';
  end if;

  if not public.fms_hr_can_act('probation_final', v_req, v_uid) then
    raise exception 'Not authorized to decide this probation — that is the hiring manager''s call';
  end if;

  if p_decision = 'approve' then
    if p_permanent_from is null then
      raise exception 'Give the date this person becomes permanent';
    end if;
    if coalesce(trim(p_employee_code), '') = '' then
      raise exception 'Give the final employee ID';
    end if;

    update public.fms_hr_probations set
      extension_outcome    = 'approved',
      extension_outcome_at = now(),
      extension_outcome_by = v_uid,
      extension_remarks    = nullif(trim(p_remarks), ''),
      final_status         = 'approved',
      final_status_at      = now(),
      permanent_from       = p_permanent_from,
      employee_code        = trim(p_employee_code)
    where id = p_probation;

  else
    if coalesce(trim(p_remarks), '') = '' then
      raise exception 'Say why the extended probation was not cleared';
    end if;

    -- Same rule as the three-month rejection: the seat was filled, so the requisition
    -- is not touched.
    update public.fms_hr_probations set
      extension_outcome    = 'rejected',
      extension_outcome_at = now(),
      extension_outcome_by = v_uid,
      extension_remarks    = trim(p_remarks),
      final_status         = 'rejected',
      final_status_at      = now()
    where id = p_probation;
  end if;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', p_probation,
    case p_decision when 'approve' then 'confirmed' else 'rejected' end,
    coalesce(v_name, 'The new hire') || ' — extended probation '
      || case p_decision
           when 'approve' then 'cleared; permanent from ' || to_char(p_permanent_from, 'DD-MM-YYYY')
           else 'not cleared: ' || trim(p_remarks)
         end
      || ' (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[]) || public.fms_hr_step_owner_ids('onboarding')
  );
end $function$;
