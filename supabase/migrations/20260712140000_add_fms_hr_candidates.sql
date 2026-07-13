-- ===========================================================================
-- HR Recruitment FMS — CANDIDATES + INTERVIEWS (Phase 4).
--
-- The Kanban board. One card = one candidate against one requisition.
--
--   Resumes Uploaded → Shortlisted by HR → Shared with HOD → Shortlisted by HOD
--   → Interview R1 (HR) → R2 (HOD) → R3 (Director) → Final Decision
--   → Finalized | Disqualified
--
-- Tables:
--   fms_hr_candidates  — the card, + ONE authoritative timestamp per stage
--   fms_hr_interviews  — (candidate, round) → interviewer, date, result, remarks
--
-- RPCs (SECURITY DEFINER; lock, authorize via fms_hr_can_act, validate the
-- transition, stamp the stage's timestamp column):
--   fms_hr_add_candidates            — BULK. HR gets 50 CVs, not one.
--   fms_hr_update_candidate
--   fms_hr_move_candidate            — THE board move
--   fms_hr_share_candidates_with_hod — BULK. The sheet says "5–10 CVs at a time".
--   fms_hr_hod_decide                — BULK. The HOD returns their picks.
--   fms_hr_record_interview_result   — closes a round; may auto-advance the card
--
-- ---------------------------------------------------------------------------
-- FOUR DECISIONS WORTH KNOWING:
--
-- 1. STAGE vs STEP. `stage` is the column the card SITS IN. The step that is DUE
--    on it is the one that moves it OUT (a card in "Resumes Uploaded" has
--    `hr_shortlist` pending). That mapping lives in lib/queues.ts, and it is why
--    a card's overdue chip, the step's queue page and the Control Center count are
--    all the same number — there is only one of them.
--
-- 2. "SCHEDULED" IS NOT "CONDUCTED". Moving a card into a round means the
--    interview is BOOKED (interviewer + date). A separate result closes it. The
--    sheet collapses these into one column, which is exactly where SLA slippage
--    hides — a candidate can sit "in Round 2" for three weeks and look fine.
--
-- 3. A CARD CAN GO BACKWARDS. HR will misdrop a card. Every move is logged, and a
--    backward move clears the timestamps of the stages it undoes, so the due dates
--    recompute honestly rather than staying stamped for something that got undone.
--
-- 4. YOU CANNOT FINALIZE MORE PEOPLE THAN THE REQUISITION ASKED FOR.
--    Enforced here, under a row lock, not in the UI.
-- ---------------------------------------------------------------------------
--
-- Purely ADDITIVE. Reversal: drop the 6 RPCs, then fms_hr_interviews, fms_hr_candidates.
-- ===========================================================================

create table if not exists public.fms_hr_candidates (
  id              uuid primary key default gen_random_uuid(),
  requisition_id  uuid not null references public.fms_hr_requisitions on delete cascade,
  candidate_no    text unique,                        -- CAN-2627-0001

  -- Captured at upload. AI-extracted from the CV (Phase 5) but ALWAYS confirmed by
  -- a human before it lands here — `parsed_json` keeps what the model actually said
  -- so extraction quality stays auditable.
  name            text not null,
  phone           text,
  email           text,
  current_company text,
  experience_years numeric(4,1),
  skills          text[] not null default '{}',
  notes           text,

  source_platform_id uuid references public.fms_hr_job_platforms on delete set null,
  resume_path     text,
  resume_name     text,
  parse_status    text not null default 'manual' check (parse_status in ('ok','failed','manual')),
  parsed_json     jsonb not null default '{}'::jsonb,

  stage           text not null default 'resume_uploaded' check (stage in (
                    'resume_uploaded','hr_shortlisted','shared_with_hod','hod_shortlisted',
                    'interview_1','interview_2','interview_3','final_decision',
                    'finalized','disqualified')),

  -- ---- AUTHORITATIVE per-stage timestamps -------------------------------
  -- Every board move stamps one of these INSIDE the RPC. Nothing infers a stage
  -- from the activity trail (it is best-effort and a failed announce is swallowed).
  uploaded_at        timestamptz not null default now(),
  hr_shortlisted_at  timestamptz,
  hr_shortlisted_by  uuid references auth.users on delete set null,
  shared_to_hod_at   timestamptz,
  shared_to_hod_by   uuid references auth.users on delete set null,
  hod_decided_at     timestamptz,
  hod_decided_by     uuid references auth.users on delete set null,
  interview1_at      timestamptz,      -- when the round was HELD, not booked
  interview2_at      timestamptz,
  interview3_at      timestamptz,
  final_decision_at  timestamptz,      -- reached the Final Decision column
  finalized_at       timestamptz,
  finalized_by       uuid references auth.users on delete set null,
  offered_ctc        numeric(12,2),    -- the agreed salary. Recorded nowhere before this.
  disqualified_at    timestamptz,
  disqualification_reason_id uuid references public.fms_hr_disqualification_reasons on delete set null,
  disqualification_note text,

  created_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists fms_hr_candidates_req_idx   on public.fms_hr_candidates (requisition_id);
create index if not exists fms_hr_candidates_stage_idx on public.fms_hr_candidates (stage);
-- Duplicate detection ("this person already applied to MRF-2627-0003").
create index if not exists fms_hr_candidates_phone_idx on public.fms_hr_candidates (phone) where phone is not null;
create index if not exists fms_hr_candidates_email_idx on public.fms_hr_candidates (lower(email)) where email is not null;

drop trigger if exists trg_fms_hr_candidates_updated on public.fms_hr_candidates;
create trigger trg_fms_hr_candidates_updated
  before update on public.fms_hr_candidates
  for each row execute function public.set_updated_at();

create table if not exists public.fms_hr_interviews (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references public.fms_hr_candidates on delete cascade,
  round          integer not null check (round between 1 and 3),
  interviewer_id uuid references auth.users on delete set null,
  -- The interviewer may be an external consultant who has no portal login.
  interviewer_name text,
  scheduled_on   date,
  held_at        timestamptz,          -- null while the round is only BOOKED
  status         text not null default 'scheduled'
                   check (status in ('scheduled','selected','rejected','on_hold','no_show')),
  remarks        text,
  document_path  text,
  document_name  text,
  created_by     uuid references auth.users on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (candidate_id, round)
);

drop trigger if exists trg_fms_hr_interviews_updated on public.fms_hr_interviews;
create trigger trg_fms_hr_interviews_updated
  before update on public.fms_hr_interviews
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- RLS — read follows the requisition (these rows are candidate PII).
-- ===========================================================================
alter table public.fms_hr_candidates enable row level security;
drop policy if exists fms_hr_candidates_select on public.fms_hr_candidates;
create policy fms_hr_candidates_select on public.fms_hr_candidates
  for select to authenticated using (public.fms_hr_can_read_requisition(requisition_id, auth.uid()));
drop policy if exists fms_hr_candidates_write_admin on public.fms_hr_candidates;
create policy fms_hr_candidates_write_admin on public.fms_hr_candidates
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_hr_interviews enable row level security;
drop policy if exists fms_hr_interviews_select on public.fms_hr_interviews;
create policy fms_hr_interviews_select on public.fms_hr_interviews
  for select to authenticated using (
    exists (
      select 1 from public.fms_hr_candidates c
      where c.id = candidate_id
        and public.fms_hr_can_read_requisition(c.requisition_id, auth.uid())
    )
  );
drop policy if exists fms_hr_interviews_write_admin on public.fms_hr_interviews;
create policy fms_hr_interviews_write_admin on public.fms_hr_interviews
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- Helper: the workflow step a target stage belongs to (for authorization).
-- Keep in step with STAGE_STEP in lib/queues.ts.
-- ===========================================================================
create or replace function public.fms_hr_stage_step(p_stage text)
returns text
language sql
immutable
as $$
  select case p_stage
    when 'hr_shortlisted'  then 'hr_shortlist'
    when 'shared_with_hod' then 'hod_share'
    when 'hod_shortlisted' then 'hod_shortlist'
    when 'interview_1'     then 'interview_1'
    when 'interview_2'     then 'interview_2'
    when 'interview_3'     then 'interview_3'
    when 'final_decision'  then 'final_decision'
    when 'finalized'       then 'final_decision'
    when 'disqualified'    then 'final_decision'
    else 'resume_upload'
  end;
$$;

-- Board order, so a move can tell forwards from backwards.
create or replace function public.fms_hr_stage_rank(p_stage text)
returns integer
language sql
immutable
as $$
  select case p_stage
    when 'resume_uploaded'  then 1
    when 'hr_shortlisted'   then 2
    when 'shared_with_hod'  then 3
    when 'hod_shortlisted'  then 4
    when 'interview_1'      then 5
    when 'interview_2'      then 6
    when 'interview_3'      then 7
    when 'final_decision'   then 8
    when 'finalized'        then 9
    when 'disqualified'     then 9
    else 0
  end;
$$;

-- ===========================================================================
-- RPC — add candidates in BULK. HR receives CVs in batches.
-- p_candidates: [{name, phone, email, current_company, experience_years,
--                 skills[], resume_path, resume_name, parse_status, parsed_json,
--                 source_platform_id, notes}, …]
-- Returns the new ids.
-- ===========================================================================
drop function if exists public.fms_hr_add_candidates(uuid, jsonb);
create or replace function public.fms_hr_add_candidates(p_req uuid, p_candidates jsonb)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_fy     text := public.fms_hr_fy_code(current_date);
  c        jsonb;
  v_id     uuid;
  v_no     text;
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

    v_no := 'CAN-' || v_fy || '-' || lpad(public.fms_hr_next_seq('CAN-' || v_fy)::text, 4, '0');

    insert into public.fms_hr_candidates (
      requisition_id, candidate_no, name, phone, email, current_company, experience_years,
      skills, notes, source_platform_id, resume_path, resume_name, parse_status, parsed_json,
      stage, uploaded_at, created_by
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
      coalesce(nullif(c->>'parse_status',''), 'manual'),
      coalesce(c->'parsed_json', '{}'::jsonb),
      'resume_uploaded', now(), v_uid
    )
    returning id into v_id;

    return next v_id;
  end loop;
end $$;
grant execute on function public.fms_hr_add_candidates(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — edit a candidate's details (name/phone/email/… — never their stage).
-- ===========================================================================
drop function if exists public.fms_hr_update_candidate(uuid, jsonb);
create or replace function public.fms_hr_update_candidate(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req uuid;
  v_uid uuid := auth.uid();
begin
  select requisition_id into v_req from public.fms_hr_candidates where id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if not public.fms_hr_can_act('resume_upload', v_req, v_uid) then
    raise exception 'Not authorized to edit this candidate';
  end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'A name is required'; end if;

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
    resume_name      = coalesce(nullif(p->>'resume_name',''), resume_name)
  where id = p_id;
end $$;
grant execute on function public.fms_hr_update_candidate(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — THE BOARD MOVE.
--
-- p_to_stage : the target column
-- p          : the payload that move requires
--                interview_1..3 → {interviewer_id | interviewer_name, scheduled_on}
--                finalized      → {offered_ctc}
--                disqualified   → {disqualification_reason_id, disqualification_note}
--
-- A move is never a silent state write: each one carries the fact that justifies
-- it, which is why the UI opens a modal on every drop.
-- ===========================================================================
drop function if exists public.fms_hr_move_candidate(uuid, text, jsonb);
create or replace function public.fms_hr_move_candidate(p_id uuid, p_to_stage text, p jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_req       uuid;
  v_from      text;
  v_req_status text;
  v_seats     integer;
  v_taken     integer;
  v_step      text;
  v_from_rank integer;
  v_to_rank   integer;
  v_round     integer;
begin
  select c.requisition_id, c.stage into v_req, v_from
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;

  if v_from in ('finalized','disqualified') and p_to_stage in ('finalized','disqualified') then
    raise exception 'This candidate is already %', v_from;
  end if;
  if v_from = p_to_stage then return; end if;

  select status, positions_required into v_req_status, v_seats
    from public.fms_hr_requisitions where id = v_req for update;
  if v_req_status in ('on_hold','cancelled','closed') then
    raise exception 'This requisition is % — candidates cannot be moved', v_req_status;
  end if;

  v_step      := public.fms_hr_stage_step(p_to_stage);
  v_from_rank := public.fms_hr_stage_rank(v_from);
  v_to_rank   := public.fms_hr_stage_rank(p_to_stage);

  -- Disqualifying is the exception: whoever is handling the candidate right now
  -- may drop them, not only the Final Decision owner.
  if p_to_stage = 'disqualified' then
    if not (public.fms_hr_can_act(public.fms_hr_stage_step(v_from), v_req, v_uid)
            or public.fms_hr_can_act(v_step, v_req, v_uid)) then
      raise exception 'Not authorized to disqualify this candidate';
    end if;
  elsif not public.fms_hr_can_act(v_step, v_req, v_uid) then
    raise exception 'Not authorized to move this candidate to %', p_to_stage;
  end if;

  -- A forward jump must be exactly one column. Backwards may go any distance
  -- (correcting a misdrop), and disqualifying may come from anywhere.
  if p_to_stage <> 'disqualified' and v_to_rank > v_from_rank and v_to_rank <> v_from_rank + 1 then
    raise exception 'A candidate must move one column at a time (% → %)', v_from, p_to_stage;
  end if;

  -- ---- moving BACKWARDS: undo the stages being reversed ------------------
  -- Otherwise a stale timestamp would keep a due date anchored to something that
  -- was taken back.
  if v_to_rank < v_from_rank then
    update public.fms_hr_candidates set
      hr_shortlisted_at = case when v_to_rank < 2 then null else hr_shortlisted_at end,
      hr_shortlisted_by = case when v_to_rank < 2 then null else hr_shortlisted_by end,
      shared_to_hod_at  = case when v_to_rank < 3 then null else shared_to_hod_at end,
      shared_to_hod_by  = case when v_to_rank < 3 then null else shared_to_hod_by end,
      hod_decided_at    = case when v_to_rank < 4 then null else hod_decided_at end,
      hod_decided_by    = case when v_to_rank < 4 then null else hod_decided_by end,
      interview1_at     = case when v_to_rank < 5 then null else interview1_at end,
      interview2_at     = case when v_to_rank < 6 then null else interview2_at end,
      interview3_at     = case when v_to_rank < 7 then null else interview3_at end,
      final_decision_at = case when v_to_rank < 8 then null else final_decision_at end,
      finalized_at = null, finalized_by = null, offered_ctc = null,
      disqualified_at = null, disqualification_reason_id = null, disqualification_note = null
    where id = p_id;
    -- Drop any interview rounds that no longer exist on this path.
    delete from public.fms_hr_interviews
     where candidate_id = p_id and round > greatest(0, v_to_rank - 4);
  end if;

  -- ---- the move itself ---------------------------------------------------
  if p_to_stage = 'hr_shortlisted' then
    update public.fms_hr_candidates
       set stage = p_to_stage, hr_shortlisted_at = now(), hr_shortlisted_by = v_uid
     where id = p_id;

  elsif p_to_stage = 'shared_with_hod' then
    update public.fms_hr_candidates
       set stage = p_to_stage, shared_to_hod_at = now(), shared_to_hod_by = v_uid
     where id = p_id;

  elsif p_to_stage = 'hod_shortlisted' then
    update public.fms_hr_candidates
       set stage = p_to_stage, hod_decided_at = now(), hod_decided_by = v_uid
     where id = p_id;

  elsif p_to_stage in ('interview_1','interview_2','interview_3') then
    -- Entering a round BOOKS it. The result (and held_at) comes separately —
    -- "scheduled" and "conducted" are different facts.
    v_round := substring(p_to_stage from 'interview_(\d)')::integer;
    if (p->>'interviewer_id') is null and coalesce(trim(p->>'interviewer_name'), '') = '' then
      raise exception 'Say who is taking this interview';
    end if;

    insert into public.fms_hr_interviews (candidate_id, round, interviewer_id, interviewer_name, scheduled_on, status, created_by)
    values (
      p_id, v_round,
      nullif(p->>'interviewer_id','')::uuid,
      nullif(trim(p->>'interviewer_name'), ''),
      nullif(p->>'scheduled_on','')::date,
      'scheduled', v_uid
    )
    on conflict (candidate_id, round) do update set
      interviewer_id   = excluded.interviewer_id,
      interviewer_name = excluded.interviewer_name,
      scheduled_on     = excluded.scheduled_on,
      status           = 'scheduled',
      held_at          = null;

    update public.fms_hr_candidates set stage = p_to_stage where id = p_id;

  elsif p_to_stage = 'final_decision' then
    update public.fms_hr_candidates
       set stage = p_to_stage, final_decision_at = now()
     where id = p_id;

  elsif p_to_stage = 'finalized' then
    if v_from <> 'final_decision' then
      raise exception 'A candidate can only be finalized from the Final Decision column';
    end if;
    -- You cannot hire more people than the vacancy asked for.
    select count(*) into v_taken
      from public.fms_hr_candidates
     where requisition_id = v_req and stage = 'finalized' and id <> p_id;
    if v_taken >= v_seats then
      raise exception 'All % seat(s) on this requisition are already filled', v_seats;
    end if;

    update public.fms_hr_candidates set
      stage = 'finalized', finalized_at = now(), finalized_by = v_uid,
      offered_ctc = nullif(p->>'offered_ctc','')::numeric
    where id = p_id;

  elsif p_to_stage = 'disqualified' then
    update public.fms_hr_candidates set
      stage = 'disqualified', disqualified_at = now(),
      disqualification_reason_id = nullif(p->>'disqualification_reason_id','')::uuid,
      disqualification_note = nullif(trim(p->>'disqualification_note'), '')
    where id = p_id;

  elsif p_to_stage = 'resume_uploaded' then
    update public.fms_hr_candidates set stage = 'resume_uploaded' where id = p_id;

  else
    raise exception 'Unknown stage %', p_to_stage;
  end if;
end $$;
grant execute on function public.fms_hr_move_candidate(uuid, text, jsonb) to authenticated;

-- ===========================================================================
-- RPC — BULK share with the HOD. The sheet's own instruction is "Short List and
-- Share a minimum of 5–10 CVs with the HOD's" — a batch, not one card at a time.
-- ===========================================================================
drop function if exists public.fms_hr_share_candidates_with_hod(uuid[]);
create or replace function public.fms_hr_share_candidates_with_hod(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare cid uuid;
begin
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Pick at least one candidate'; end if;
  foreach cid in array p_ids loop
    perform public.fms_hr_move_candidate(cid, 'shared_with_hod', '{}'::jsonb);
  end loop;
end $$;
grant execute on function public.fms_hr_share_candidates_with_hod(uuid[]) to authenticated;

-- ===========================================================================
-- RPC — BULK HOD decision: shortlist the ones they picked.
-- ===========================================================================
drop function if exists public.fms_hr_hod_decide(uuid[], boolean, uuid, text);
create or replace function public.fms_hr_hod_decide(
  p_ids       uuid[],
  p_selected  boolean,
  p_reason_id uuid default null,
  p_note      text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare cid uuid;
begin
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Pick at least one candidate'; end if;
  foreach cid in array p_ids loop
    if p_selected then
      perform public.fms_hr_move_candidate(cid, 'hod_shortlisted', '{}'::jsonb);
    else
      perform public.fms_hr_move_candidate(cid, 'disqualified', jsonb_build_object(
        'disqualification_reason_id', coalesce(p_reason_id::text, ''),
        'disqualification_note', coalesce(p_note, '')
      ));
    end if;
  end loop;
end $$;
grant execute on function public.fms_hr_hod_decide(uuid[], boolean, uuid, text) to authenticated;

-- ===========================================================================
-- RPC — record an interview RESULT. This is what closes a round.
--
-- 'selected'  → auto-advances (R1→R2, R2→R3, R3→Final Decision)
-- 'rejected'  → straight to Disqualified
-- others      → the card stays put, visibly unresolved
-- ===========================================================================
drop function if exists public.fms_hr_record_interview_result(uuid, integer, text, text, text, text);
create or replace function public.fms_hr_record_interview_result(
  p_id       uuid,
  p_round    integer,
  p_status   text,
  p_remarks  text default '',
  p_doc_path text default null,
  p_doc_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_req   uuid;
  v_stage text;
  v_step  text;
begin
  if p_round not between 1 and 3 then raise exception 'Round must be 1, 2 or 3'; end if;
  if p_status not in ('selected','rejected','on_hold','no_show') then
    raise exception 'Unknown interview result %', p_status;
  end if;

  select requisition_id, stage into v_req, v_stage
    from public.fms_hr_candidates where id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_stage <> ('interview_' || p_round) then
    raise exception 'This candidate is not in Round % (they are at %)', p_round, v_stage;
  end if;

  v_step := 'interview_' || p_round;
  if not public.fms_hr_can_act(v_step, v_req, v_uid) then
    raise exception 'Not authorized to record Round % for this candidate', p_round;
  end if;

  update public.fms_hr_interviews set
    status  = p_status,
    held_at = now(),
    remarks = nullif(trim(p_remarks), ''),
    document_path = coalesce(p_doc_path, document_path),
    document_name = coalesce(p_doc_name, document_name)
  where candidate_id = p_id and round = p_round;

  if not found then
    raise exception 'Round % was never scheduled for this candidate', p_round;
  end if;

  -- Stamp the round's completion on the CANDIDATE — this is the anchor the next
  -- step's due date is measured from.
  if p_round = 1 then
    update public.fms_hr_candidates set interview1_at = now() where id = p_id;
  elsif p_round = 2 then
    update public.fms_hr_candidates set interview2_at = now() where id = p_id;
  else
    update public.fms_hr_candidates set interview3_at = now() where id = p_id;
  end if;

  if p_status = 'selected' then
    if p_round < 3 then
      -- Booking the next round needs an interviewer, which we do not have yet, so
      -- park the card at the next round with the interview unscheduled. The board
      -- shows it as "to be scheduled".
      insert into public.fms_hr_interviews (candidate_id, round, status, created_by)
      values (p_id, p_round + 1, 'scheduled', v_uid)
      on conflict (candidate_id, round) do nothing;
      update public.fms_hr_candidates set stage = 'interview_' || (p_round + 1) where id = p_id;
    else
      update public.fms_hr_candidates set stage = 'final_decision', final_decision_at = now() where id = p_id;
    end if;

  elsif p_status = 'rejected' then
    update public.fms_hr_candidates set
      stage = 'disqualified', disqualified_at = now(),
      disqualification_note = coalesce(nullif(trim(p_remarks), ''), 'Not selected at Round ' || p_round)
    where id = p_id;
  end if;
end $$;
grant execute on function public.fms_hr_record_interview_result(uuid, integer, text, text, text, text) to authenticated;
