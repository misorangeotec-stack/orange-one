-- NR-5 · Nothing HR uploads can be edited, replaced or deleted
--
-- Every attachment in this module was written with `coalesce(new, old)` — an
-- expression that can REPLACE a value and can never NULL one. So "remove" was not
-- merely a missing button: passing an empty value was a silent no-op, and anyone
-- testing by clicking would have reported success.
--
-- THE CONVENTION, from here on, for every attachment parameter:
--
--     NULL / omitted  ->  leave the stored value alone   (unchanged behaviour)
--     ''              ->  CLEAR it to NULL               (new)
--     anything else   ->  store it
--
-- Written everywhere as the same three-armed case, so the next reader does not
-- have to work out which of `coalesce`, `nullif` or bare assignment they are
-- looking at:
--
--     case when p_x is null then col when btrim(p_x) = '' then null else p_x end
--
-- NO SIGNATURE CHANGES. Every fms_hr* function in this database has exactly one
-- signature; adding a `p_clear boolean default false` as a NEW function would make
-- PostgREST resolve a call that omits it against both and fail with PGRST203.
-- FIX-5 avoided precisely this. CREATE OR REPLACE only.
--
-- Two behaviours change, and both were measured against live data first:
--   * video_url — '' used to mean "leave alone"; it now clears.
--   * document_path — used a BARE coalesce, so '' was actually STORED as ''. It
--     now clears. 0 rows affected: no interview document has ever been uploaded.
-- There are ZERO stored empty strings in any of the thirteen attachment columns
-- across the five tables, so nothing existing is reinterpreted. The assertion
-- below refuses to apply if that ever stops being true.

-- ---------------------------------------------------------------------------
-- Assertions FIRST, above every DDL statement. A check placed below the CREATEs
-- would run inside the ACCESS EXCLUSIVE locks they take, holding the whole HR
-- module while it scans.
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_empty integer;
begin
  select
      (select count(*) from public.fms_hr_interviews
        where document_path = '' or document_name = '' or video_url = '')
    + (select count(*) from public.fms_hr_candidates
        where resume_path = '' or resume_name = '' or resume_sha256 = '')
    + (select count(*) from public.fms_hr_onboarding_checks
        where file_path = '' or file_name = '' or link_url = '')
    + (select count(*) from public.fms_hr_probation_reviews
        where file_path = '' or file_name = '')
    + (select count(*) from public.fms_hr_requisitions
        where jd_path = '' or jd_name = '')
    into v_empty;

  if v_empty > 0 then
    raise exception
      'NR-5 refuses to apply: % attachment column(s) hold an empty string. Under the new convention those rows would read as cleared. Null them first.',
      v_empty;
  end if;
end
$assert$;


-- ===========================================================================
-- 1 · fms_hr_record_interview_result — the three media columns learn to clear
-- ===========================================================================
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
  -- the booked panel owns this round too, alongside the hiring manager.
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
    -- (NR-5) '' now CLEARS. Emptying the video box while re-recording a result no
    -- longer silently keeps the wrong link alive. To fix an attachment WITHOUT
    -- re-recording the result — the Round-1 link on a candidate now at Round 3 —
    -- use fms_hr_set_interview_media, which has no stage test.
    document_path = case when p_doc_path is null      then document_path
                         when btrim(p_doc_path) = ''  then null
                         else p_doc_path end,
    document_name = case when p_doc_name is null      then document_name
                         when btrim(p_doc_name) = ''  then null
                         else p_doc_name end,
    video_url     = case when p_video_url is null     then video_url
                         when btrim(p_video_url) = '' then null
                         else btrim(p_video_url) end,
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


-- ===========================================================================
-- 2 · fms_hr_toggle_onboarding_check — the file and the link learn to clear
--
-- The requires_file guard needs no change and must not get one: it sits AFTER the
-- v_file assignment and INSIDE the `if p_done` branch, so a Remove that keeps the
-- item ticked already raises "X needs a file before it can be ticked". Callers
-- must therefore pass the item's CURRENT done state, not `false`.
-- ===========================================================================
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
  -- Also the NR-5 guard: a completed onboarding may already have filled a seat,
  -- closed the vacancy and opened a probation. Removing the evidence under that
  -- is refused, not reversed — fms_hr_try_complete_onboarding has no undo path.
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
  -- (NR-5) '' now CLEARS the stored value instead of meaning "leave it alone".
  v_file := case when p_file_path is null     then v_file
                 when btrim(p_file_path) = '' then null
                 else p_file_path end;
  v_link := case when p_link_url is null      then v_link
                 when btrim(p_link_url) = ''  then null
                 else btrim(p_link_url) end;

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
      file_name      = case when p_file_name is null     then file_name
                            when btrim(p_file_name) = '' then null
                            else p_file_name end,
      link_url       = v_link,
      pending_reason = null
    where id = p_check;

  else
    update public.fms_hr_onboarding_checks set
      done           = false,
      done_at        = null,
      done_by        = null,
      file_path      = v_file,
      file_name      = case when p_file_name is null     then file_name
                            when btrim(p_file_name) = '' then null
                            else p_file_name end,
      link_url       = v_link,
      pending_reason = nullif(trim(p_pending_reason), '')
    where id = p_check;
  end if;

  -- Completion is decided here, not by the UI: the last tick (with the offer
  -- accepted) means the person joined, which fills a seat and may close the vacancy.
  perform public.fms_hr_try_complete_onboarding(v_onb);
end
$fn$;


-- ===========================================================================
-- 3 · fms_hr_record_probation_review — the review form learns to clear
--
-- The ON CONFLICT arm must read p_file_path, NOT excluded.file_path. The INSERT
-- side already applies nullif(p_file_path,''), so by the time the update arm runs
-- `excluded.file_path` is NULL for BOTH "omitted" and "clear" — the distinction
-- the whole convention rests on is gone. Reference the parameter directly.
-- ===========================================================================
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
  -- Also the NR-5 guard: removing the form underneath a decision would rewrite
  -- the basis of that decision, so it is refused rather than reversed.
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
    -- (NR-5) p_file_path, not excluded.file_path — see the header comment.
    file_path   = case when p_file_path is null     then public.fms_hr_probation_reviews.file_path
                       when btrim(p_file_path) = '' then null
                       else p_file_path end,
    file_name   = case when p_file_name is null     then public.fms_hr_probation_reviews.file_name
                       when btrim(p_file_name) = '' then null
                       else p_file_name end,
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


-- ===========================================================================
-- 4 · fms_hr_update_candidate — stops writing the CV columns entirely
--
-- THE TRAP THIS CLOSES. candidatePayload() in hrWrites.ts maps
-- `resume_path: c.resumePath ?? ""`. Under the new convention that empty string
-- would CLEAR the CV, its name and its hash on every save of the candidate edit
-- form NR-5 is about to wire up — silently deleting the document of all 119
-- candidates one edit at a time.
--
-- So this function no longer touches the CV at all. It still READS
-- p->>'resume_sha256' for the FIX-5 duplicate guard, which is what that field is
-- actually for here. The CV moves to fms_hr_set_candidate_resume below, and a
-- typo fix now structurally cannot disturb the document.
-- ===========================================================================
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
    source_platform_id = nullif(p->>'source_platform_id','')::uuid
    -- (NR-5) resume_path / resume_name / resume_sha256 deliberately NOT written.
    -- See the header comment. Use fms_hr_set_candidate_resume.
  where id = p_id;
end
$fn$;


-- ===========================================================================
-- 5 · NEW · fms_hr_set_candidate_resume — replace or remove the CV, alone
--
-- One column family, so a stale browser copy of the candidate form can never
-- overwrite a name or a phone number somebody else has just corrected. This is
-- the same reasoning the module already applies to notes and tags.
--
-- Clearing is all-or-nothing: a resume_name with no resume_path is a label
-- pointing at a document that is not there, so an empty p_path nulls all three.
-- ===========================================================================
create or replace function public.fms_hr_set_candidate_resume(
  p_id uuid,
  p_path text default null::text,
  p_name text default null::text,
  p_sha256 text default null::text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_req   uuid;
  v_old   text;
  v_who   text;
  v_no    text;
  v_clear boolean;
begin
  select c.requisition_id, c.resume_path, c.name
    into v_req, v_old, v_who
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;

  if not public.fms_hr_can_act('resume_upload', v_req, v_uid) then
    raise exception 'Not authorized to change this candidate''s CV';
  end if;

  v_clear := p_path is not null and btrim(p_path) = '';

  if v_clear then
    update public.fms_hr_candidates set
      resume_path = null, resume_name = null, resume_sha256 = null
    where id = p_id;
  else
    update public.fms_hr_candidates set
      resume_path   = case when p_path is null   then resume_path   else p_path end,
      resume_name   = case when p_name is null   then resume_name
                           when btrim(p_name) = '' then null else p_name end,
      resume_sha256 = case when p_sha256 is null then resume_sha256
                           when btrim(p_sha256) = '' then null else p_sha256 end
    where id = p_id;
  end if;

  select r.mrf_no into v_no from public.fms_hr_requisitions r where r.id = v_req;

  -- The trail is written HERE, inside the transaction, and not through the
  -- store's safeAnnounce, which swallows its own failures. The bucket has no
  -- versioning and these tables have no history, so this row is the only record
  -- a removal leaves. Recipients are empty on purpose: an activity line, no bell.
  perform public.fms_hr_announce(
    'candidate', p_id,
    case when v_clear then 'resume_removed' else 'resume_replaced' end,
    case when v_clear
      then 'CV removed for ' || coalesce(v_who, 'this candidate') || coalesce(' (' || v_no || ')', '')
      else 'CV replaced for ' || coalesce(v_who, 'this candidate') || coalesce(' (' || v_no || ')', '')
    end,
    '{}'::uuid[],
    jsonb_build_object('previous_path', v_old, 'new_path', case when v_clear then null else p_path end)
  );
end
$fn$;


-- ===========================================================================
-- 6 · NEW · fms_hr_set_interview_media — fix a round's attachments, any time
--
-- fms_hr_record_interview_result opens with `if v_stage <> v_want then raise`,
-- so the moment a "selected" result advances somebody, their previous round is
-- SEALED: a wrong video link on Round 1 can never be corrected while they sit at
-- Round 3. The only workaround is destructive — dragging the card back runs
-- `delete from fms_hr_interviews where round > ...`, destroying Rounds 2 and 3.
--
-- This changes ONLY the link and the form, and has NO stage test. Authorisation
-- is the round's own step plus its booked panel, exactly as recording it was.
-- ===========================================================================
create or replace function public.fms_hr_set_interview_media(
  p_candidate uuid,
  p_round integer,
  p_doc_path text default null::text,
  p_doc_name text default null::text,
  p_video_url text default null::text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_req  uuid;
  v_step text;
  v_who  text;
  v_no   text;
  v_lbl  text;
begin
  if p_round not between 0 and 3 then
    raise exception 'Round must be 0 (telephonic), 1, 2 or 3';
  end if;
  v_step := case when p_round = 0 then 'telephonic_screening' else 'interview_' || p_round end;
  v_lbl  := case when p_round = 0 then 'the telephonic screen' else 'Round ' || p_round end;

  select c.requisition_id, c.name into v_req, v_who
    from public.fms_hr_candidates c where c.id = p_candidate for update;
  if v_req is null then raise exception 'Candidate not found'; end if;

  if not (public.fms_hr_can_act(v_step, v_req, v_uid)
          or public.fms_hr_is_interview_panel(p_candidate, p_round, v_uid)) then
    raise exception 'Not authorized to change the attachments on % for this candidate', v_lbl;
  end if;

  update public.fms_hr_interviews set
    document_path = case when p_doc_path is null      then document_path
                         when btrim(p_doc_path) = ''  then null
                         else p_doc_path end,
    document_name = case when p_doc_name is null      then document_name
                         when btrim(p_doc_name) = ''  then null
                         else p_doc_name end,
    video_url     = case when p_video_url is null     then video_url
                         when btrim(p_video_url) = '' then null
                         else btrim(p_video_url) end,
    -- Unconditional, unlike record_interview_result which stamps only on a
    -- re-record: reaching this function is ALWAYS an edit.
    edited_at = now(),
    edited_by = v_uid
  where candidate_id = p_candidate and round = p_round;

  if not found then
    raise exception 'That round was never scheduled for this candidate';
  end if;

  select r.mrf_no into v_no from public.fms_hr_requisitions r where r.id = v_req;

  -- entity_type is 'candidate', never 'interview': fms_hr_activity_requisition()
  -- does not resolve 'interview', and the read policy hangs off it — hiring
  -- managers and the requester would lose sight of the row entirely.
  perform public.fms_hr_announce(
    'candidate', p_candidate, 'interview_media_changed',
    'Attachments changed on ' || v_lbl || ' for ' || coalesce(v_who, 'this candidate')
      || coalesce(' (' || v_no || ')', ''),
    '{}'::uuid[],
    jsonb_build_object('round', p_round)
  );
end
$fn$;


-- ===========================================================================
-- 7 · fms_hr_set_requisition_jd — HR and the coordinators can reach it
--
-- This one could ALWAYS clear: jd_path = nullif(trim(p_path),'') with both params
-- defaulting to ''. What it could not do was let HR near it — the guard is
-- `is_admin OR requester`, and it never calls fms_hr_can_act, so NR-4 does not
-- touch it either. On a vacancy a department head raised, HR could not replace
-- the job description at all.
--
-- Purely additive: nobody who could edit it before loses that.
-- ===========================================================================
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
  v_old       text;
  v_no        text;
  v_new       text;
begin
  select requester_id, jd_path, mrf_no into v_requester, v_old, v_no
    from public.fms_hr_requisitions where id = p_req for update;
  if not found then raise exception 'Requisition not found'; end if;

  if not (public.is_admin(v_uid)
          or v_requester = v_uid
          or public.fms_hr_is_coordinator(v_uid)
          or public.fms_hr_can_act('mrf', p_req, v_uid)) then
    raise exception 'Not authorized to attach a JD to this requisition';
  end if;

  update public.fms_hr_requisitions set
    jd_path = nullif(trim(p_path), ''),
    jd_name = nullif(trim(p_name), '')
  where id = p_req
  returning jd_path into v_new;

  -- Only a REPLACE or a REMOVE is worth a line. The first attach happens as part
  -- of raising the MRF, which already announces itself; announcing here too would
  -- put a second row on every new requisition.
  if v_old is not null then
    perform public.fms_hr_announce(
      'requisition', p_req,
      case when v_new is null then 'jd_removed' else 'jd_replaced' end,
      case when v_new is null
        then 'Job description removed' || coalesce(' (' || v_no || ')', '')
        else 'Job description replaced' || coalesce(' (' || v_no || ')', '')
      end,
      '{}'::uuid[],
      jsonb_build_object('previous_path', v_old, 'new_path', v_new)
    );
  end if;
end
$fn$;
