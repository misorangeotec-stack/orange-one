-- ===========================================================================
-- ROLLBACK for 20261130120000_nr7_requisition_targets.sql
--
-- Restores the three live RPCs to the bodies they were running before NR-7,
-- copied verbatim from pg_proc.prosrc on 21-09-2026, then removes everything
-- NR-7 added. Running this leaves the module exactly as it was.
--
-- It DOES discard the NR-7 data: the numbers HR typed, and the new/repeat
-- labels on candidates. Nothing that existed before NR-7 is touched.
-- ===========================================================================

-- 1 ── the approval RPCs, back to four arguments -----------------------------

drop function if exists public.fms_hr_decide_mrf(uuid, text, text, text, jsonb);

create or replace function public.fms_hr_decide_mrf(
  p_req uuid, p_stage text, p_decision text, p_remarks text default ''::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_step   text;
begin
  if p_stage not in ('hr','mgmt') then raise exception 'Unknown approval stage %', p_stage; end if;
  if p_decision not in ('approve','reject','send_back') then
    raise exception 'Unknown decision %', p_decision;
  end if;

  v_step := case when p_stage = 'hr' then 'hr_head_approval' else 'mgmt_approval' end;

  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;

  if p_stage = 'hr'   and v_status <> 'hr_review'   then
    raise exception 'This requisition is not awaiting HR Head approval (status %)', v_status;
  end if;
  if p_stage = 'mgmt' and v_status <> 'mgmt_review' then
    raise exception 'This requisition is not awaiting Management approval (status %)', v_status;
  end if;

  if not public.fms_hr_can_act(v_step, p_req, v_uid) then
    raise exception 'Not authorized to decide this requisition';
  end if;
  if p_decision in ('reject','send_back') and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when rejecting or sending back';
  end if;

  if p_decision = 'approve' then
    if p_stage = 'hr' then
      update public.fms_hr_requisitions set
        hr_approved_at = now(), hr_approver_id = v_uid, hr_remarks = nullif(trim(p_remarks),''),
        status = 'mgmt_review', current_step = 'mgmt_approval'
      where id = p_req;
    else
      update public.fms_hr_requisitions set
        mgmt_approved_at = now(), mgmt_approver_id = v_uid, mgmt_remarks = nullif(trim(p_remarks),''),
        status = 'posting', current_step = 'job_posting'
      where id = p_req;
    end if;

  elsif p_decision = 'reject' then
    update public.fms_hr_requisitions set
      status = 'rejected', rejected_at = now(), reject_reason = trim(p_remarks), decided_by = v_uid
    where id = p_req;

  else -- send_back
    update public.fms_hr_requisitions set
      status = 'sent_back', sent_back_at = now(), sent_back_reason = trim(p_remarks), decided_by = v_uid
    where id = p_req;
  end if;
end
$fn$;

grant execute on function public.fms_hr_decide_mrf(uuid, text, text, text) to anon, authenticated, service_role;

drop function if exists public.fms_hr_update_decide_mrf(uuid, text, text, text, jsonb);

create or replace function public.fms_hr_update_decide_mrf(
  p_req uuid, p_stage text, p_decision text, p_remarks text default ''::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_status text;
  v_uid    uuid := auth.uid();
  v_step   text;
begin
  if p_stage not in ('hr','mgmt') then raise exception 'Unknown approval stage %', p_stage; end if;
  if p_decision not in ('approve','reject','send_back') then
    raise exception 'Unknown decision %', p_decision;
  end if;

  v_step := case when p_stage = 'hr' then 'hr_head_approval' else 'mgmt_approval' end;

  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;

  if p_stage = 'hr' and v_status <> 'mgmt_review' then
    raise exception 'The HR Head approval can no longer be edited (the requisition is %)', v_status;
  end if;
  if p_stage = 'mgmt' and v_status <> 'posting' then
    raise exception 'The Management approval can no longer be edited (the requisition is %)', v_status;
  end if;

  if not public.fms_hr_can_act(v_step, p_req, v_uid) then
    raise exception 'Not authorized to edit this approval';
  end if;
  if p_decision in ('reject','send_back') and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when rejecting or sending back';
  end if;

  if p_decision = 'approve' then
    if p_stage = 'hr' then
      update public.fms_hr_requisitions set
        hr_remarks = nullif(trim(p_remarks),''), edited_at = now(), edited_by = v_uid
      where id = p_req;
    else
      update public.fms_hr_requisitions set
        mgmt_remarks = nullif(trim(p_remarks),''), edited_at = now(), edited_by = v_uid
      where id = p_req;
    end if;

  elsif p_decision = 'reject' then
    update public.fms_hr_requisitions set
      status = 'rejected', rejected_at = now(), reject_reason = trim(p_remarks), decided_by = v_uid,
      hr_approved_at   = case when p_stage = 'hr'   then null else hr_approved_at end,
      mgmt_approved_at = case when p_stage = 'mgmt' then null else mgmt_approved_at end,
      current_step = v_step, edited_at = now(), edited_by = v_uid
    where id = p_req;

  else -- send_back
    update public.fms_hr_requisitions set
      status = 'sent_back', sent_back_at = now(), sent_back_reason = trim(p_remarks), decided_by = v_uid,
      hr_approved_at   = case when p_stage = 'hr'   then null else hr_approved_at end,
      mgmt_approved_at = case when p_stage = 'mgmt' then null else mgmt_approved_at end,
      current_step = 'mrf_resubmit', edited_at = now(), edited_by = v_uid
    where id = p_req;
  end if;
end
$fn$;

grant execute on function public.fms_hr_update_decide_mrf(uuid, text, text, text) to anon, authenticated, service_role;

-- 2 ── adding a CV, back to the pre-NR-7 body --------------------------------

create or replace function public.fms_hr_add_candidates(p_req uuid, p_candidates jsonb)
returns setof uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_fy     text := public.fms_hr_fy_code(current_date);
  c        jsonb;
  v_id     uuid;
  v_no     text;
  v_ack    text;
  v_sha    text;
  v_dup    record;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status <> 'sourcing' then
    raise exception 'CVs can only be added once the job is posted (status %)', v_status;
  end if;
  if not public.fms_hr_can_act('resume_upload', p_req, v_uid) then
    raise exception 'Not authorized to add candidates to this requisition';
  end if;
  if p_candidates is null or jsonb_array_length(p_candidates) = 0 then
    raise exception 'No candidates supplied';
  end if;

  for c in select * from jsonb_array_elements(p_candidates) loop
    if coalesce(trim(c->>'name'), '') = '' then
      raise exception 'Every candidate needs a name';
    end if;

    v_sha := nullif(trim(c->>'resume_sha256'), '');
    v_ack := nullif(trim(c->>'duplicate_ack'), '');

    select * into v_dup
      from public.fms_hr_candidate_duplicate(
             p_req, nullif(trim(c->>'email'), ''), nullif(trim(c->>'phone'), ''), v_sha);

    if v_dup.id is not null and v_ack is null then
      raise exception '% is already on this vacancy as % — % — matched on %. Tick "Add anyway" if this is deliberate.',
        trim(c->>'name'), v_dup.candidate_no, public.fms_hr_stage_label(v_dup.stage), v_dup.signal;
    end if;

    v_no := 'CAN-' || v_fy || '-' || lpad(public.fms_hr_next_seq('CAN-' || v_fy)::text, 4, '0');

    insert into public.fms_hr_candidates (
      requisition_id, candidate_no, name, phone, email, current_company, experience_years,
      skills, notes, source_platform_id, resume_path, resume_name, resume_sha256,
      parse_status, parsed_json, stage, uploaded_at, created_by
    ) values (
      p_req, v_no,
      trim(c->>'name'),
      nullif(trim(c->>'phone'), ''),
      nullif(trim(c->>'email'), ''),
      nullif(trim(c->>'current_company'), ''),
      nullif(c->>'experience_years','')::numeric,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(c->'skills','[]'::jsonb)) x), '{}'::text[]),
      nullif(trim(c->>'notes'), ''),
      nullif(c->>'source_platform_id','')::uuid,
      nullif(c->>'resume_path',''),
      nullif(c->>'resume_name',''),
      v_sha,
      coalesce(nullif(c->>'parse_status',''), 'manual'),
      coalesce(c->'parsed_json', '{}'::jsonb),
      'resume_uploaded', now(), v_uid
    )
    returning id into v_id;

    if v_dup.id is not null then
      perform public.fms_hr_announce(
        'requisition', p_req, 'duplicate_override',
        format('%s (%s) was added although %s is already on this vacancy — matched on %s. Reason: %s',
               trim(c->>'name'), v_no, v_dup.candidate_no, v_dup.signal, v_ack),
        '{}'::uuid[],
        jsonb_build_object('candidate_id', v_id, 'matched_candidate_id', v_dup.id,
                           'matched_candidate_no', v_dup.candidate_no,
                           'signal', v_dup.signal, 'reason', v_ack));
    end if;

    return next v_id;
  end loop;
end
$fn$;

-- 3 ── NR-7's own objects ----------------------------------------------------

drop function if exists public.fms_hr_set_requisition_targets(uuid, jsonb);
drop function if exists public.fms_hr_apply_targets(uuid, jsonb, uuid);
drop function if exists public.fms_hr_candidate_seen_before(text, text, text, uuid);

alter table public.fms_hr_candidates
  drop constraint if exists fms_hr_candidates_repeat_of_fkey;

alter table public.fms_hr_candidates
  drop column if exists is_repeat,
  drop column if exists repeat_of_candidate_id,
  drop column if exists repeat_signal,
  drop column if exists duplicate_ack;

alter table public.fms_hr_requisitions
  drop constraint if exists fms_hr_requisitions_targets_sane;

alter table public.fms_hr_requisitions
  drop column if exists target_close_days,
  drop column if exists cv_target,
  drop column if exists shortlist_target,
  drop column if exists director_cv_target,
  drop column if exists targets_set_at,
  drop column if exists targets_set_by;
