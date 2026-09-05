-- ROLLBACK for 20261113120000_nr5_attachments_can_be_cleared.sql
--
-- Restores the five function bodies exactly as they stood on 05-Sep-2026, read
-- back out of pg_proc.prosrc rather than retyped from the migrations that last
-- touched them, and drops the two functions NR-5 introduced.
--
-- ⚠ Running this AFTER the frontend has shipped will break the Replace/Remove
--   controls silently rather than loudly: the buttons keep rendering, the RPCs
--   keep returning success, and the coalesce quietly ignores every clear. If the
--   frontend is live, roll that back first.
--
-- ⚠ It does NOT put deleted files back. Storage has no versioning and these
--   tables have no history. Anything already removed is gone; this only restores
--   the functions' behaviour.

-- ---------------------------------------------------------------------------
-- 1 · fms_hr_record_interview_result — back to coalesce
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_record_interview_result(
  p_id uuid,
  p_round integer,
  p_status text,
  p_remarks text default ''::text,
  p_doc_path text default null::text,
  p_doc_name text default null::text,
  p_video_url text default null::text,
  p_next_stage text default null::text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid        uuid := auth.uid();
  v_req        uuid;
  v_stage      text;
  v_want       text;
  v_step       text;
  v_next       text;
  v_next_round integer;
  v_prev_held  timestamptz;
begin
  if p_round not between 0 and 3 then raise exception 'Round must be 0 (telephonic), 1, 2 or 3'; end if;
  if p_status not in ('selected','rejected','on_hold','no_show') then
    raise exception 'Unknown interview result %', p_status;
  end if;

  v_want := case when p_round = 0 then 'telephonic' else 'interview_' || p_round end;
  v_step := case when p_round = 0 then 'telephonic_screening' else 'interview_' || p_round end;

  select requisition_id, stage into v_req, v_stage
    from public.fms_hr_candidates where id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_stage <> v_want then
    raise exception 'This candidate is not at % (they are at %)', v_want, v_stage;
  end if;
  -- (changed) the booked panel owns this round too, alongside the hiring manager.
  if not (public.fms_hr_can_act(v_step, v_req, v_uid)
          or public.fms_hr_is_interview_panel(p_id, p_round, v_uid)) then
    raise exception 'Not authorized to record this round for this candidate';
  end if;

  select held_at into v_prev_held
    from public.fms_hr_interviews where candidate_id = p_id and round = p_round;

  update public.fms_hr_interviews set
    status  = p_status,
    held_at = now(),
    remarks = nullif(trim(p_remarks), ''),
    document_path = coalesce(p_doc_path, document_path),
    document_name = coalesce(p_doc_name, document_name),
    video_url     = coalesce(nullif(trim(p_video_url), ''), video_url),
    result_recorded_by = coalesce(result_recorded_by, v_uid),
    edited_at = case when v_prev_held is not null then now() else edited_at end,
    edited_by = case when v_prev_held is not null then v_uid else edited_by end
  where candidate_id = p_id and round = p_round;

  if not found then
    raise exception 'That round was never scheduled for this candidate';
  end if;

  if p_round = 0 then
    update public.fms_hr_candidates set telephonic_at = now() where id = p_id;
  elsif p_round = 1 then
    update public.fms_hr_candidates set interview1_at = now() where id = p_id;
  elsif p_round = 2 then
    update public.fms_hr_candidates set interview2_at = now() where id = p_id;
  else
    update public.fms_hr_candidates set interview3_at = now() where id = p_id;
  end if;

  if p_status = 'selected' then
    v_next := nullif(trim(p_next_stage), '');
    if v_next is null then
      v_next := case p_round
                  when 0 then 'interview_1'
                  when 1 then 'interview_2'
                  when 2 then 'interview_3'
                  else null end;
    end if;

    if v_next is not null then
      if v_next not in ('interview_1','interview_2','interview_3') then
        raise exception 'Invalid next stage %', v_next;
      end if;
      if public.fms_hr_stage_rank(v_next) <= public.fms_hr_stage_rank(v_stage) then
        raise exception 'The next stage must be later than the current one';
      end if;

      v_next_round := substring(v_next from 'interview_(\d)')::integer;
      insert into public.fms_hr_interviews (candidate_id, round, status, created_by)
      values (p_id, v_next_round, 'scheduled', v_uid)
      on conflict (candidate_id, round) do nothing;
      update public.fms_hr_candidates set stage = v_next where id = p_id;
    end if;

  elsif p_status = 'rejected' then
    update public.fms_hr_candidates set
      stage = 'disqualified', disqualified_at = now(),
      disqualification_note = coalesce(nullif(trim(p_remarks), ''), 'Not selected at ' || v_want)
    where id = p_id;
  end if;
end
$fn$;


-- ---------------------------------------------------------------------------
-- 2 · fms_hr_toggle_onboarding_check — back to coalesce
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_toggle_onboarding_check(
  p_check uuid,
  p_done boolean,
  p_file_path text default null::text,
  p_file_name text default null::text,
  p_link_url text default null::text,
  p_pending_reason text default null::text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid        uuid := auth.uid();
  v_onb        uuid;
  v_needsfile  boolean;
  v_allowslink boolean;
  v_name       text;
  v_file       text;
  v_link       text;
  v_req        uuid;
  v_joining    date;
  v_status     text;
  v_done       timestamptz;
begin
  select k.onboarding_id, k.requires_file, k.allows_link, k.name, k.file_path, k.link_url
    into v_onb, v_needsfile, v_allowslink, v_name, v_file, v_link
    from public.fms_hr_onboarding_checks k where k.id = p_check for update;
  if v_onb is null then raise exception 'Checklist item not found'; end if;

  select o.requisition_id, o.joining_date, o.offer_status, o.completed_at
    into v_req, v_joining, v_status, v_done
    from public.fms_hr_onboardings o where o.id = v_onb for update;

  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to run this onboarding';
  end if;
  if v_done is not null then
    raise exception 'This onboarding is already complete';
  end if;
  if v_status in ('declined','no_show') then
    raise exception 'This candidate did not join — the checklist no longer applies';
  end if;
  if v_joining is null then
    raise exception 'Set the joining date first — it is what the checklist due dates are measured from';
  end if;

  -- Whatever arrived in THIS call counts as evidence, same as the file always did.
  v_file := coalesce(nullif(p_file_path, ''), v_file);
  v_link := coalesce(nullif(trim(p_link_url), ''), v_link);

  if p_done then
    if v_needsfile and v_file is null and not (v_allowslink and v_link is not null) then
      raise exception '% needs a file% before it can be ticked',
        v_name,
        case when v_allowslink then ' or a Drive link' else '' end;
    end if;

    update public.fms_hr_onboarding_checks set
      done           = true,
      done_at        = now(),          -- stamped automatically; HR never types a date
      done_by        = v_uid,
      file_path      = v_file,
      file_name      = coalesce(nullif(p_file_name, ''), file_name),
      link_url       = v_link,
      pending_reason = null
    where id = p_check;

  else
    update public.fms_hr_onboarding_checks set
      done           = false,
      done_at        = null,
      done_by        = null,
      file_path      = v_file,
      file_name      = coalesce(nullif(p_file_name, ''), file_name),
      link_url       = v_link,
      pending_reason = nullif(trim(p_pending_reason), '')
    where id = p_check;
  end if;

  -- Completion is decided here, not by the UI: the last tick (with the offer
  -- accepted) means the person joined, which fills a seat and may close the vacancy.
  perform public.fms_hr_try_complete_onboarding(v_onb);
end
$fn$;


-- ---------------------------------------------------------------------------
-- 3 · fms_hr_record_probation_review — back to excluded.* coalesce
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_record_probation_review(
  p_probation uuid,
  p_month integer,
  p_status text,
  p_remarks text default ''::text,
  p_file_path text default null::text,
  p_file_name text default null::text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_req     uuid;
  v_cand    uuid;
  v_outcome text;
  v_final   text;
  v_step    text;
  v_missing integer;
  v_name    text;
  v_no      text;
begin
  if p_month is null or p_month not between 1 and 4 then
    raise exception 'A probation review is for month 1, 2, 3 or 4';
  end if;
  if p_status not in ('satisfactory','needs_improvement','unsatisfactory') then
    raise exception 'Unknown review status %', p_status;
  end if;

  select requisition_id, candidate_id, outcome, final_status
    into v_req, v_cand, v_outcome, v_final
    from public.fms_hr_probations where id = p_probation for update;
  if v_req is null then raise exception 'Probation not found'; end if;
  if v_final is not null then
    raise exception 'This probation is already % — no further reviews apply', v_final;
  end if;

  if p_month = 4 then
    if v_outcome is distinct from 'extended' then
      raise exception 'There is no month-4 review unless the probation was extended';
    end if;
  elsif v_outcome is not null then
    raise exception 'The three-month decision has already been taken — month % can no longer be reviewed', p_month;
  end if;

  select count(*) into v_missing
    from generate_series(1, p_month - 1) m
   where not exists (
     select 1 from public.fms_hr_probation_reviews r
      where r.probation_id = p_probation and r.month = m
   );
  if v_missing > 0 then
    raise exception 'Record the earlier month(s) first — % review(s) are still missing before month %', v_missing, p_month;
  end if;

  v_step := case when p_month = 4 then 'probation_extension' else 'probation_m' || p_month end;
  if not public.fms_hr_can_act(v_step, v_req, v_uid) then
    raise exception 'Not authorized to review this person — that is the hiring manager''s call';
  end if;

  insert into public.fms_hr_probation_reviews (
    probation_id, month, status, remarks, file_path, file_name, reviewed_at, reviewer_id
  ) values (
    p_probation, p_month, p_status, nullif(trim(p_remarks), ''),
    nullif(p_file_path, ''), nullif(p_file_name, ''),
    now(), v_uid
  )
  on conflict (probation_id, month) do update set
    status      = excluded.status,
    remarks     = excluded.remarks,
    file_path   = coalesce(excluded.file_path, public.fms_hr_probation_reviews.file_path),
    file_name   = coalesce(excluded.file_name, public.fms_hr_probation_reviews.file_name),
    reviewed_at = now(),
    reviewer_id = v_uid,
    edited_at   = now(),          -- a re-record IS an edit
    edited_by   = v_uid;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no into v_no from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'probation', p_probation, 'review_m' || p_month,
    'Month-' || p_month || ' probation review recorded for ' || coalesce(v_name, 'the new hire')
      || ' — ' || replace(p_status, '_', ' ') || ' (' || coalesce(v_no, '') || ')',
    public.fms_hr_step_owner_ids('onboarding')
  );
end
$fn$;


-- ---------------------------------------------------------------------------
-- 4 · fms_hr_update_candidate — writes the CV columns again
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_update_candidate(
  p_id uuid,
  p jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_req uuid;
  v_uid uuid := auth.uid();
  v_dup record;
begin
  select requisition_id into v_req from public.fms_hr_candidates where id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if not public.fms_hr_can_act('resume_upload', v_req, v_uid) then
    raise exception 'Not authorized to edit this candidate';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'A name is required'; end if;

  if nullif(trim(p->>'duplicate_ack'), '') is null then
    select * into v_dup
      from public.fms_hr_candidate_duplicate(
             v_req, nullif(trim(p->>'email'), ''), nullif(trim(p->>'phone'), ''),
             nullif(trim(p->>'resume_sha256'), ''), p_id);
    if v_dup.id is not null then
      raise exception 'Those details already belong to % on this vacancy — % — matched on %.',
        v_dup.candidate_no, public.fms_hr_stage_label(v_dup.stage), v_dup.signal;
    end if;
  end if;

  update public.fms_hr_candidates set
    name             = trim(p->>'name'),
    phone            = nullif(trim(p->>'phone'), ''),
    email            = nullif(trim(p->>'email'), ''),
    current_company  = nullif(trim(p->>'current_company'), ''),
    experience_years = nullif(p->>'experience_years','')::numeric,
    skills           = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'skills','[]'::jsonb)) x), skills),
    notes            = nullif(trim(p->>'notes'), ''),
    source_platform_id = nullif(p->>'source_platform_id','')::uuid,
    resume_path      = coalesce(nullif(p->>'resume_path',''), resume_path),
    resume_name      = coalesce(nullif(p->>'resume_name',''), resume_name),
    resume_sha256    = coalesce(nullif(p->>'resume_sha256',''), resume_sha256)
  where id = p_id;
end
$fn$;


-- ---------------------------------------------------------------------------
-- 5 · fms_hr_set_requisition_jd — back to admin-or-requester, no announce
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_set_requisition_jd(
  p_req uuid,
  p_path text default ''::text,
  p_name text default ''::text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_requester uuid;
begin
  select requester_id into v_requester
    from public.fms_hr_requisitions where id = p_req for update;
  if not found then raise exception 'Requisition not found'; end if;

  if not (public.is_admin(v_uid) or v_requester = v_uid) then
    raise exception 'Not authorized to attach a JD to this requisition';
  end if;

  update public.fms_hr_requisitions set
    jd_path = nullif(trim(p_path), ''),
    jd_name = nullif(trim(p_name), '')
  where id = p_req;
end
$fn$;


-- ---------------------------------------------------------------------------
-- 6 · The two functions NR-5 introduced
-- ---------------------------------------------------------------------------
drop function if exists public.fms_hr_set_candidate_resume(uuid, text, text, text);
drop function if exists public.fms_hr_set_interview_media(uuid, integer, text, text, text);
