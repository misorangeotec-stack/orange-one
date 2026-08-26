-- ===========================================================================
-- Interview R2 — the booked panel becomes a real owner of its round.
--
-- WHY. The stage is labelled "Interview R2 — HOD", but every gate in the module
-- reads it as "the requisition's hiring managers" — and fms_hr_submit_mrf defaults
-- that to whoever raised the MRF. Measured on live data: only 4 of 16 requisitions
-- name a HOD at all, so 12 of 16 R2 rounds were offered to a non-head. The heads
-- ARE set up in this module, as the owners of the `mrf` step, and the picker now
-- offers that list (frontend: lib/interviewers.ts).
--
-- Widening the picker alone would be worse than leaving it: a head booked for a
-- round could not READ the candidate (fms_hr_can_read_requisition gates all the
-- candidate PII policies) and could not RECORD the result (fms_hr_can_act). They
-- would be notified about work the database refuses them. This migration closes
-- both, per assignment only.
--
-- ⚠ OWNERSHIP IS ADDITIVE, NOT TRANSFERRED. The requisition's hiring manager keeps
--   the round; the booked panel gains it. That was the explicit decision — a round
--   must never be able to fall between two people.
--
-- ⚠ READ STAYS SCOPED TO THE REQUISITION. Being on a panel grants sight of THAT
--   vacancy's candidates and nothing else. It is deliberately NOT routed through
--   fms_hr_is_recruitment_staff, which would hand over every candidate in the
--   module — and which excludes the `mrf` step for exactly this reason
--   (20260712180000: "may raise a requisition ... grants no read over candidates").
--
-- ⚠ fms_hr_can_act IS LEFT ALONE. Its 3-arg signature is called from inside several
--   already-deployed RPC bodies; re-shaping it to carry a candidate id would mean
--   re-issuing all of them. fms_hr_is_interview_panel is per-candidate and is ORed
--   in at the two RPCs that need it, which is both smaller and more precise.
--
-- NO RECURSION. fms_hr_can_read_requisition is `security definer` and every table
-- it reads is owned by postgres with relforcerowsecurity = false, so RLS is not
-- re-entered inside it. Checked on the live database before writing this; the
-- function already read RLS-enabled fms_hr_requisitions the same way.
--
--   fms_hr_is_interview_panel     — new
--   fms_hr_module_user_ids        — new
--   fms_hr_can_read_requisition   — re-issued, one extra branch
--   fms_hr_record_interview_result— re-issued, body verbatim, gate widened
--   fms_hr_reassign_interview     — new
--
-- Reversal — ⚠ THE ORDER IS LOAD-BEARING, and rehearsing it on 2026-08-25 is how we
-- know. fms_hr_record_interview_result CALLS fms_hr_is_interview_panel, and plpgsql
-- resolves that at execution time, so dropping the helper first leaves the result RPC
-- raising "function does not exist" for every interviewer in the module. RESTORE BOTH
-- FUNCTIONS FIRST, THEN DROP:
--   1. re-apply 20260712180000_fms_hr_restrict_candidate_pii.sql  (restores the read gate)
--   2. re-apply 20260816120100_add_fms_hr_hired_stage.sql          (restores the result RPC —
--      this is the step that removes the call to fms_hr_is_interview_panel)
--   3. drop function if exists public.fms_hr_reassign_interview(uuid, integer, uuid[], text, date);
--      drop function if exists public.fms_hr_is_interview_panel(uuid, integer, uuid);
--      drop function if exists public.fms_hr_module_user_ids();
-- Both re-applies together, then the drops — never a drop on its own.
-- ===========================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Is this user on the BOOKED panel for one candidate's round?
--
-- An empty interviewer_ids is a STUB row — fms_hr_record_interview_result inserts
-- one for the next round when a candidate passes, with no panel and no date. A stub
-- is not a booking, so `= any('{}')` correctly answers false and the round stays
-- with the hiring manager until somebody is actually put on it.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_is_interview_panel(
  p_candidate uuid,
  p_round     integer,
  p_uid       uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_hr_interviews i
     where i.candidate_id = p_candidate
       and i.round = p_round
       and p_uid = any(i.interviewer_ids)
  );
$$;

grant execute on function public.fms_hr_is_interview_panel(uuid, integer, uuid) to authenticated;

comment on function public.fms_hr_is_interview_panel(uuid, integer, uuid) is
  'On the booked panel for this candidate''s round. An empty interviewer_ids (an auto-advance stub) is not a booking.';

-- ---------------------------------------------------------------------------
-- 2. Everyone who can actually OPEN New Recruitment.
--
-- The R2 picker offers the 20 people set up to raise an MRF, and 4 of them hold no
-- app_access row for this module — booking one would send a notification to somebody
-- who lands on Access Denied. The picker cannot work this out for itself: app_access
-- RLS is `user_id = auth.uid() or is_admin(...)`, so a non-admin cannot read anyone
-- else's grant. This exposes the ids only — no emails, no levels — in the same
-- spirit as list_org_people.
--
-- Admins are included because they bypass module checks everywhere else.
-- ---------------------------------------------------------------------------
-- `returns table(user_id uuid)` rather than `setof uuid` on purpose: PostgREST renders
-- a set of scalars and a set of rows differently, and the named column is the shape the
-- client can rely on without sniffing.
create or replace function public.fms_hr_module_user_ids()
returns table(user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id from public.app_access a where a.app_id = 'hr-recruitment'
  union
  select r.user_id from public.user_roles r where r.role = 'admin';
$$;

grant execute on function public.fms_hr_module_user_ids() to authenticated;

comment on function public.fms_hr_module_user_ids() is
  'User ids that can open New Recruitment (an app_access row, or admin). Ids only — app_access RLS hides other people''s grants from the picker.';

-- ---------------------------------------------------------------------------
-- 3. Read gate — add the booked panel.
--
-- Body is 20260712180000's, plus the final branch. Every candidate / interview /
-- onboarding / probation SELECT policy calls this function BY NAME, so replacing it
-- reaches all of them with no policy edits.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_can_read_requisition(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_hr_is_coordinator(p_uid)
      or public.fms_hr_is_recruitment_staff(p_uid)
      or exists (
        select 1 from public.fms_hr_requisitions r
        where r.id = p_req
          and (r.requester_id = p_uid or p_uid = any(r.hiring_manager_ids) or p_uid = any(r.reporting_to_ids))
      )
      -- (new) booked to take a round for somebody on this requisition. Scoped to
      -- this requisition alone — never a blanket grant over the module.
      or exists (
        select 1
          from public.fms_hr_interviews i
          join public.fms_hr_candidates c on c.id = i.candidate_id
         where c.requisition_id = p_req
           and p_uid = any(i.interviewer_ids)
      );
$$;

grant execute on function public.fms_hr_can_read_requisition(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Recording the result — the panel may record the round it was given.
--
-- Body copied VERBATIM from 20260816120100_add_fms_hr_hired_stage.sql (the current
-- definition) so nothing drifts. The only change is the authorization line, marked
-- below. If that file is ever re-issued, this ORed condition must be carried over.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_record_interview_result(
  p_id         uuid,
  p_round      integer,
  p_status     text,
  p_remarks    text default '',
  p_doc_path   text default null,
  p_doc_name   text default null,
  p_video_url  text default null,
  p_next_stage text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  -- A round that already carries a held_at is being RE-recorded — an edit.
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

  -- Stamp the round's completion on the CANDIDATE — the anchor for the next due date.
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
    -- Advance to the chosen round; default to the immediate next when none is
    -- given. Round 3 has no round after it — the card stays put.
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
end $$;

grant execute on function public.fms_hr_record_interview_result(uuid, integer, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Hand a booked round to somebody else.
--
-- Distinct from fms_hr_schedule_interview, which BOOKS an unbooked round: this one
-- requires an existing booking, refuses a round that has already been held, and
-- leaves a different activity type behind so the trail reads "reassigned" rather
-- than "booked". The outgoing panel may hand it on, as may the hiring manager.
--
-- ⚠ A HELD ROUND IS REFUSED. fms_hr_schedule_interview's upsert resets status and
--   NULLs held_at, which is right when re-booking something never conducted — but
--   applied to a recorded result it would silently unmake it, and the candidate's
--   interviewN_at stamp would be left pointing at an interview the panel no longer
--   shows. Correcting a recorded result is what the edit path on the Completed tab
--   is for.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_reassign_interview(
  p_id               uuid,
  p_round            integer,
  p_interviewer_ids  uuid[] default '{}',
  p_interviewer_name text default null,
  p_scheduled_on     date default null
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
  v_want  text;
  v_step  text;
  v_ids       uuid[] := coalesce(p_interviewer_ids, '{}');
  v_held      timestamptz;
  v_found     boolean;
  v_prev_ids  uuid[];
  v_prev_name text;
begin
  if p_round not between 0 and 3 then raise exception 'Round must be 0 (telephonic), 1, 2 or 3'; end if;
  if cardinality(v_ids) = 0 and coalesce(trim(p_interviewer_name), '') = '' then
    raise exception 'Say who is taking this interview';
  end if;

  v_want := case when p_round = 0 then 'telephonic' else 'interview_' || p_round end;
  v_step := case when p_round = 0 then 'telephonic_screening' else 'interview_' || p_round end;

  select requisition_id, stage into v_req, v_stage
    from public.fms_hr_candidates where id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_stage <> v_want then
    raise exception 'This candidate is not at % (they are at %)', v_want, v_stage;
  end if;

  select true, i.held_at, i.interviewer_ids, i.interviewer_name
    into v_found, v_held, v_prev_ids, v_prev_name
    from public.fms_hr_interviews i
   where i.candidate_id = p_id and i.round = p_round;

  -- ⚠ A ROW IS NOT A BOOKING. Recording "selected" inserts a stub row for the next
  -- round with an empty panel, so testing for the row alone let a never-booked round
  -- through to be "handed over" — which is just a booking wearing the wrong word, and
  -- it would announce a handover to people who never had it. Found by calling the RPC
  -- against a live stub row, not by reading it.
  if not coalesce(v_found, false)
     or (coalesce(array_length(v_prev_ids, 1), 0) = 0 and coalesce(btrim(v_prev_name), '') = '') then
    raise exception 'That round has not been booked yet — book it instead';
  end if;
  if v_held is not null then
    raise exception 'That round has already been held, so it cannot be handed over';
  end if;

  -- Whoever owes the round may pass it on: the hiring manager / step owner, or the
  -- panel currently holding it.
  if not (public.fms_hr_can_act(v_step, v_req, v_uid)
          or public.fms_hr_is_interview_panel(p_id, p_round, v_uid)) then
    raise exception 'Not authorized to change who takes this round';
  end if;

  update public.fms_hr_interviews set
    interviewer_ids  = v_ids,
    interviewer_id   = v_ids[1],
    interviewer_name = nullif(trim(p_interviewer_name), ''),
    -- Keep the standing date when none is given: a handover is often "same slot,
    -- different person", and blanking it would drop the round out of every overdue
    -- count while still being somebody's work.
    scheduled_on     = coalesce(p_scheduled_on, scheduled_on),
    status           = 'scheduled',
    edited_at        = now(),
    edited_by        = v_uid
  where candidate_id = p_id and round = p_round;
end $$;

grant execute on function public.fms_hr_reassign_interview(uuid, integer, uuid[], text, date) to authenticated;

comment on function public.fms_hr_reassign_interview(uuid, integer, uuid[], text, date) is
  'Hand a BOOKED, not-yet-held interview round to a different panel. Refuses a held round so a recorded result can never be unmade.';

commit;
