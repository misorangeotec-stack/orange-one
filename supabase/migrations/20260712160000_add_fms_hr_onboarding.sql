-- ===========================================================================
-- HR Recruitment FMS — ONBOARDING (Phase 6).
--
-- A finalized candidate is not a hire. Onboarding is what turns one into the
-- other: HR sets the joining date, works a checklist, and records whether the
-- person actually accepted the offer and turned up.
--
-- Tables:
--   fms_hr_onboardings        — one per finalized candidate (offer outcome, joining
--                               date, employee code, completion)
--   fms_hr_onboarding_checks  — one row per checklist item per onboarding,
--                               SNAPSHOTTED from the active master at seed time
--
-- RPCs (SECURITY DEFINER; lock the row, authorize via fms_hr_can_act('onboarding',…),
-- validate the transition, and STAMP THE FACT ON THE DOMAIN ROW):
--   fms_hr_set_onboarding_date      — seeds the checks from the ACTIVE master items
--   fms_hr_set_offer_status         — declined / no-show frees the seat
--   fms_hr_toggle_onboarding_check  — enforces requires_file; completion → joined
--   fms_hr_set_employee_code
--
-- ---------------------------------------------------------------------------
-- THE TWO THINGS THIS PHASE EXISTS TO GET RIGHT:
--
-- 1. A DECLINED CANDIDATE MUST STOP CONSUMING A SEAT.
--    Phase 4's finalize guard counted `stage = 'finalized'`. That was correct
--    until a candidate could decline. It is not any more: an MRF for 4 people, one
--    of whom declines, could never be filled — the 4th seat would stay occupied by
--    someone who never turned up. fms_hr_seats_taken() is now the single definition
--    of a consumed seat (finalized, and NOT declined / no-showed), and
--    fms_hr_move_candidate is re-issued to use it.
--
-- 2. THE REQUISITION CLOSES ON *JOINED*, NOT ON *FINALIZED*.
--    Finalizing someone is a promise; joining is the fact. So the auto-close hangs
--    off onboarding completion (fms_hr_sync_requisition_fill), and the same
--    function REOPENS a requisition whose seat count falls back below target.
--
-- And the standing rule of this codebase (20260708120900): never infer that a step
-- happened from the activity trail — `fms_hr_announce` is best-effort and swallows
-- its own failures. Every tick, the offer decision, the joining date and the
-- completion each write an authoritative column on a real domain row, inside the RPC.
-- ---------------------------------------------------------------------------
--
-- The checklist is CONFIG-DRIVEN: items come from the active rows of
-- fms_hr_onboarding_items (Setup → Masters). Adding, renaming or reordering an item
-- changes the NEXT onboarding with no code change; onboardings already in progress
-- keep the snapshot they were seeded with, so history does not get rewritten.
--
-- Purely ADDITIVE. Reversal (reverse order):
--   drop function fms_hr_set_employee_code, fms_hr_toggle_onboarding_check,
--                 fms_hr_set_offer_status, fms_hr_set_onboarding_date,
--                 fms_hr_try_complete_onboarding, fms_hr_sync_requisition_fill,
--                 fms_hr_seats_joined, fms_hr_seats_taken, fms_hr_step_owner_ids;
--   re-run 20260712150000's fms_hr_move_candidate;
--   drop table fms_hr_onboarding_checks, fms_hr_onboardings;
--   alter table fms_hr_candidates drop column joined_at;
-- ===========================================================================

-- ===========================================================================
-- The candidate's OWN record that they actually turned up.
--
-- The onboarding row carries completed_at, but this belongs on the candidate too:
-- it is what the pipeline report ("how many offers actually became hires") reads,
-- and it is the column the backward-move guard checks.
-- ===========================================================================
alter table public.fms_hr_candidates
  add column if not exists joined_at timestamptz;

comment on column public.fms_hr_candidates.joined_at is
  'When the person actually joined (their onboarding completed). NULL for a finalized candidate who has not turned up yet.';

-- ===========================================================================
-- fms_hr_onboardings — one per finalized candidate. Created by the finalize move.
--
-- offer_status is the seat-accounting field: 'declined' and 'no_show' release the
-- seat back to the requisition. It is deliberately separate from the checklist —
-- "did they accept?" is not a document, it is the fact everything else hangs on.
-- ===========================================================================
create table if not exists public.fms_hr_onboardings (
  id                  uuid primary key default gen_random_uuid(),
  -- One onboarding per candidate. A backward move out of 'finalized' deletes it
  -- (see fms_hr_move_candidate), so re-finalizing starts a clean one.
  candidate_id        uuid not null unique references public.fms_hr_candidates on delete cascade,
  requisition_id      uuid not null references public.fms_hr_requisitions on delete cascade,

  -- HR sets this FIRST. It is what unlocks the checklist, and every item's due date
  -- is measured from it (addWorkingDays(joining_date, item.due_days)).
  joining_date        date,
  joining_date_set_at timestamptz,

  offer_status        text not null default 'pending'
                        check (offer_status in ('pending','accepted','declined','no_show')),
  offer_status_reason text,                    -- required when declined / no_show
  offer_decided_at    timestamptz,

  employee_code       text,                    -- the ID from the HR system
  employee_code_at    timestamptz,

  -- THE authoritative "this person joined" fact. Set only when every checklist item
  -- is done AND the offer was accepted. This — not the finalize move — is what fills
  -- a seat and closes the requisition.
  completed_at        timestamptz,

  created_by          uuid references auth.users on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists fms_hr_onboardings_req_idx    on public.fms_hr_onboardings (requisition_id);
create index if not exists fms_hr_onboardings_status_idx on public.fms_hr_onboardings (offer_status);

comment on table public.fms_hr_onboardings is
  'One onboarding per finalized candidate. offer_status declined/no_show releases the seat; completed_at means they actually joined.';

drop trigger if exists trg_fms_hr_onboardings_updated on public.fms_hr_onboardings;
create trigger trg_fms_hr_onboardings_updated
  before update on public.fms_hr_onboardings
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- fms_hr_onboarding_checks — the checklist, SNAPSHOTTED.
--
-- name / requires_file / allows_link / due_days / sort_order are copied from the
-- master at seed time rather than joined live. That is the point: HR renaming
-- "Police verification" or dropping an item next quarter must not silently rewrite
-- what a hire from last quarter was actually asked for. item_id keeps the
-- provenance link (nullable, so deleting a master row does not erase history).
-- ===========================================================================
create table if not exists public.fms_hr_onboarding_checks (
  id             uuid primary key default gen_random_uuid(),
  onboarding_id  uuid not null references public.fms_hr_onboardings on delete cascade,
  item_id        uuid references public.fms_hr_onboarding_items on delete set null,
  item_key       text not null,

  name           text not null,
  description    text,
  requires_file  boolean not null default false,
  allows_link    boolean not null default false,
  due_days       integer not null default 0,
  sort_order     integer not null default 0,

  done           boolean not null default false,
  done_at        timestamptz,
  done_by        uuid references auth.users on delete set null,
  file_path      text,
  file_name      text,
  link_url       text,
  -- The sheet's "Reason (If Pending)" columns: why this is still not done.
  pending_reason text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (onboarding_id, item_key)
);

create index if not exists fms_hr_onboarding_checks_onb_idx on public.fms_hr_onboarding_checks (onboarding_id);

comment on table public.fms_hr_onboarding_checks is
  'One row per checklist item per onboarding, snapshotted from the ACTIVE fms_hr_onboarding_items at seed time so later master edits never rewrite history.';

drop trigger if exists trg_fms_hr_onboarding_checks_updated on public.fms_hr_onboarding_checks;
create trigger trg_fms_hr_onboarding_checks_updated
  before update on public.fms_hr_onboarding_checks
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- RLS — read follows the requisition (an onboarding names a person, their salary
-- and their documents). Direct writes are admin-only; everything real is an RPC.
-- ===========================================================================
alter table public.fms_hr_onboardings enable row level security;
drop policy if exists fms_hr_onboardings_select on public.fms_hr_onboardings;
create policy fms_hr_onboardings_select on public.fms_hr_onboardings
  for select to authenticated using (public.fms_hr_can_read_requisition(requisition_id, auth.uid()));
drop policy if exists fms_hr_onboardings_write_admin on public.fms_hr_onboardings;
create policy fms_hr_onboardings_write_admin on public.fms_hr_onboardings
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

alter table public.fms_hr_onboarding_checks enable row level security;
drop policy if exists fms_hr_onboarding_checks_select on public.fms_hr_onboarding_checks;
create policy fms_hr_onboarding_checks_select on public.fms_hr_onboarding_checks
  for select to authenticated using (
    exists (
      select 1 from public.fms_hr_onboardings o
      where o.id = onboarding_id
        and public.fms_hr_can_read_requisition(o.requisition_id, auth.uid())
    )
  );
drop policy if exists fms_hr_onboarding_checks_write_admin on public.fms_hr_onboarding_checks;
create policy fms_hr_onboarding_checks_write_admin on public.fms_hr_onboarding_checks
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- SEAT ACCOUNTING — the single definition of "this seat is taken".
-- ===========================================================================

-- A seat is consumed by a FINALIZED candidate who has not declined and has not
-- failed to turn up. Before Phase 6 this was simply `stage = 'finalized'`, which
-- was right only because nobody could decline yet.
create or replace function public.fms_hr_seats_taken(p_req uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.fms_hr_candidates c
    left join public.fms_hr_onboardings o on o.candidate_id = c.id
   where c.requisition_id = p_req
     and c.stage = 'finalized'
     and (p_exclude is null or c.id <> p_exclude)
     and coalesce(o.offer_status, 'pending') not in ('declined','no_show');
$$;
grant execute on function public.fms_hr_seats_taken(uuid, uuid) to authenticated;

-- A seat is FILLED only when the person actually joined: offer accepted and every
-- checklist item done. This is what closes the requisition.
create or replace function public.fms_hr_seats_joined(p_req uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.fms_hr_onboardings o
   where o.requisition_id = p_req
     and o.offer_status = 'accepted'
     and o.completed_at is not null;
$$;
grant execute on function public.fms_hr_seats_joined(uuid) to authenticated;

-- The owners of a step, for notification fan-out.
create or replace function public.fms_hr_step_owner_ids(p_step text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select o.employee_ids from public.fms_hr_step_owners o where o.step_key = p_step),
    '{}'::uuid[]
  );
$$;
grant execute on function public.fms_hr_step_owner_ids(text) to authenticated;

-- ===========================================================================
-- THE AUTO-CLOSE — and its mirror image, the auto-REOPEN.
--
-- Called whenever the joined count can have changed. Closing and reopening are the
-- same question asked twice ("are all the seats filled?"), so they live in one
-- function: a requisition can never be closed and short-staffed at the same time.
-- ===========================================================================
create or replace function public.fms_hr_sync_requisition_fill(p_req uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats  integer;
  v_status text;
  v_no     text;
  v_joined integer;
begin
  select positions_required, status, mrf_no
    into v_seats, v_status, v_no
    from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then return; end if;

  v_joined := public.fms_hr_seats_joined(p_req);

  if v_joined >= v_seats and v_status = 'sourcing' then
    update public.fms_hr_requisitions
       set status = 'closed', closed_at = now()
     where id = p_req;
    perform public.fms_hr_announce(
      'requisition', p_req, 'closed',
      v_no || ' closed — all ' || v_seats || ' seat(s) filled',
      public.fms_hr_step_owner_ids('resume_upload')
    );

  elsif v_joined < v_seats and v_status = 'closed' then
    -- Someone we counted as hired is no longer hired. The vacancy is real again.
    update public.fms_hr_requisitions
       set status = 'sourcing', current_step = 'resume_upload', closed_at = null
     where id = p_req;
    perform public.fms_hr_announce(
      'requisition', p_req, 'reopened',
      v_no || ' reopened — ' || (v_seats - v_joined) || ' seat(s) open again',
      public.fms_hr_step_owner_ids('resume_upload')
    );
  end if;
end $$;
grant execute on function public.fms_hr_sync_requisition_fill(uuid) to authenticated;

-- ===========================================================================
-- fms_hr_move_candidate — RE-ISSUED (Phase 4 / 20260712150000 definition), with
-- three changes and nothing else:
--
--   • the finalize guard counts fms_hr_seats_taken(), not raw 'finalized' rows;
--   • finalizing CREATES the onboarding row (offer pending, checklist locked until
--     HR sets the joining date);
--   • moving a card back out of 'finalized' deletes that onboarding — unless the
--     person has already joined, which is not a misdrop to undo.
-- ===========================================================================
drop function if exists public.fms_hr_move_candidate(uuid, text, jsonb);
create or replace function public.fms_hr_move_candidate(p_id uuid, p_to_stage text, p jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_req        uuid;
  v_from       text;
  v_req_status text;
  v_seats      integer;
  v_taken      integer;
  v_to_step    text;
  v_pending    text;
  v_from_rank  integer;
  v_to_rank    integer;
  v_round      integer;
begin
  select c.requisition_id, c.stage into v_req, v_from
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_from = p_to_stage then return; end if;

  select status, positions_required into v_req_status, v_seats
    from public.fms_hr_requisitions where id = v_req for update;
  if v_req_status in ('on_hold','cancelled','closed') then
    raise exception 'This requisition is % — candidates cannot be moved', v_req_status;
  end if;

  v_to_step   := public.fms_hr_stage_step(p_to_stage);
  v_pending   := public.fms_hr_pending_step(v_from);
  v_from_rank := public.fms_hr_stage_rank(v_from);
  v_to_rank   := public.fms_hr_stage_rank(p_to_stage);

  -- ---- 1. Is this transition legal at all? (checked FIRST, for a clear error) --
  if p_to_stage <> 'disqualified' and v_to_rank > v_from_rank and v_to_rank <> v_from_rank + 1 then
    raise exception 'A candidate must move one column at a time (% → %)', v_from, p_to_stage;
  end if;
  if v_from in ('finalized','disqualified') and v_to_rank >= v_from_rank then
    raise exception 'This candidate is already %', v_from;
  end if;

  -- ---- 2. May this person do it? -----------------------------------------
  if p_to_stage = 'disqualified' then
    if not (public.fms_hr_can_act(coalesce(v_pending, 'final_decision'), v_req, v_uid)
            or public.fms_hr_can_act('final_decision', v_req, v_uid)) then
      raise exception 'Not authorized to disqualify this candidate';
    end if;

  elsif v_to_rank < v_from_rank then
    if not (public.fms_hr_can_act(coalesce(v_pending, 'final_decision'), v_req, v_uid)
            or public.fms_hr_can_act(v_to_step, v_req, v_uid)) then
      raise exception 'Not authorized to move this candidate back to %', p_to_stage;
    end if;

  else
    if not public.fms_hr_can_act(v_to_step, v_req, v_uid) then
      raise exception 'Not authorized to move this candidate to %', p_to_stage;
    end if;
  end if;

  -- ---- 3. Moving BACKWARDS undoes the stages being reversed ---------------
  if v_to_rank < v_from_rank then
    -- Un-finalizing is for a misdrop, not for a change of heart about someone who
    -- has already walked through the door.
    if v_from = 'finalized' then
      if exists (
        select 1 from public.fms_hr_onboardings o
         where o.candidate_id = p_id and o.completed_at is not null
      ) then
        raise exception 'This person has already joined — their onboarding is complete and cannot be undone by moving the card';
      end if;
      delete from public.fms_hr_onboardings where candidate_id = p_id;   -- cascades to the checks
    end if;

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
      finalized_at = null, finalized_by = null, offered_ctc = null, joined_at = null,
      disqualified_at = null, disqualification_reason_id = null, disqualification_note = null
    where id = p_id;

    delete from public.fms_hr_interviews
     where candidate_id = p_id and round > greatest(0, v_to_rank - 4);
  end if;

  -- ---- 4. The move -------------------------------------------------------
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

    -- A seat held by someone who declined or never turned up is NOT taken.
    v_taken := public.fms_hr_seats_taken(v_req, p_id);
    if v_taken >= v_seats then
      raise exception 'All % seat(s) on this requisition are already filled', v_seats;
    end if;

    update public.fms_hr_candidates set
      stage = 'finalized', finalized_at = now(), finalized_by = v_uid,
      offered_ctc = nullif(p->>'offered_ctc','')::numeric
    where id = p_id;

    -- Finalizing opens the onboarding. The checklist stays locked until HR enters a
    -- joining date — that is the event the item due dates are measured from.
    insert into public.fms_hr_onboardings (candidate_id, requisition_id, created_by)
    values (p_id, v_req, v_uid)
    on conflict (candidate_id) do nothing;

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
-- RPC — set (or change) the joining date. This is what UNLOCKS the checklist.
--
-- The checks are seeded ONCE, from the ACTIVE master items, and snapshotted. A
-- later date change moves every item's due date (they are all measured from the
-- joining date) but never touches the item list — an onboarding in flight must not
-- silently grow a new box because someone edited Settings this morning.
-- ===========================================================================
drop function if exists public.fms_hr_set_onboarding_date(uuid, date);
create or replace function public.fms_hr_set_onboarding_date(p_onb uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_req    uuid;
  v_status text;
  v_done   timestamptz;
  v_seeded integer;
begin
  if p_date is null then raise exception 'A joining date is required'; end if;

  select requisition_id, offer_status, completed_at
    into v_req, v_status, v_done
    from public.fms_hr_onboardings where id = p_onb for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;
  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to run this onboarding';
  end if;
  if v_status in ('declined','no_show') then
    raise exception 'This candidate did not join — the onboarding no longer applies';
  end if;
  if v_done is not null then
    raise exception 'This onboarding is already complete';
  end if;

  update public.fms_hr_onboardings
     set joining_date = p_date, joining_date_set_at = now()
   where id = p_onb;

  select count(*) into v_seeded from public.fms_hr_onboarding_checks where onboarding_id = p_onb;
  if v_seeded = 0 then
    insert into public.fms_hr_onboarding_checks (
      onboarding_id, item_id, item_key, name, description,
      requires_file, allows_link, due_days, sort_order
    )
    select p_onb, i.id, i.key, i.name, i.description,
           i.requires_file, i.allows_link, i.due_days, i.sort_order
      from public.fms_hr_onboarding_items i
     where i.active
     order by i.sort_order, i.name
    on conflict (onboarding_id, item_key) do nothing;
  end if;
end $$;
grant execute on function public.fms_hr_set_onboarding_date(uuid, date) to authenticated;

-- ===========================================================================
-- Completion. Called from BOTH the last tick and the offer acceptance, because
-- either can be the last thing to land — and a person has not "joined" until both
-- are true. Doing it this way means HR never gets an error for ticking a box in the
-- "wrong" order; the onboarding simply completes when it is genuinely complete.
-- ===========================================================================
create or replace function public.fms_hr_try_complete_onboarding(p_onb uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req    uuid;
  v_cand   uuid;
  v_status text;
  v_done   timestamptz;
  v_total  integer;
  v_ticked integer;
  v_name   text;
  v_no     text;
  v_mgrs   uuid[];
begin
  select requisition_id, candidate_id, offer_status, completed_at
    into v_req, v_cand, v_status, v_done
    from public.fms_hr_onboardings where id = p_onb for update;
  if v_req is null or v_done is not null then return; end if;
  if v_status <> 'accepted' then return; end if;   -- no acceptance, no joining

  select count(*), count(*) filter (where done)
    into v_total, v_ticked
    from public.fms_hr_onboarding_checks where onboarding_id = p_onb;
  if v_total = 0 or v_ticked < v_total then return; end if;

  update public.fms_hr_onboardings set completed_at = now() where id = p_onb;
  -- The seat is filled on the CANDIDATE row too — that is what the pipeline report
  -- reads, and what the backward-move guard checks.
  update public.fms_hr_candidates set joined_at = now() where id = v_cand;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.hiring_manager_ids into v_no, v_mgrs
    from public.fms_hr_requisitions r where r.id = v_req;

  perform public.fms_hr_announce(
    'onboarding', p_onb, 'joined',
    coalesce(v_name, 'The candidate') || ' has joined — onboarding complete (' || coalesce(v_no, '') || ')',
    coalesce(v_mgrs, '{}'::uuid[]) || public.fms_hr_step_owner_ids('probation_m1')
  );

  -- A seat is only filled when someone actually turns up. THIS is what closes the
  -- requisition — never the finalize move.
  perform public.fms_hr_sync_requisition_fill(v_req);
end $$;
grant execute on function public.fms_hr_try_complete_onboarding(uuid) to authenticated;

-- ===========================================================================
-- RPC — the offer outcome.
--
-- 'accepted'            → carry on (and complete, if the checklist is already done)
-- 'declined' / 'no_show' → the seat is released and the requisition reopens.
--                          The candidate STAYS finalized: they were offered the job,
--                          and that is what the offer-acceptance rate is measured on.
-- ===========================================================================
drop function if exists public.fms_hr_set_offer_status(uuid, text, text);
create or replace function public.fms_hr_set_offer_status(p_onb uuid, p_status text, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_req   uuid;
  v_cand  uuid;
  v_done  timestamptz;
  v_name  text;
  v_no    text;
  v_seats integer;
begin
  if p_status not in ('accepted','declined','no_show') then
    raise exception 'Unknown offer outcome %', p_status;
  end if;

  select requisition_id, candidate_id, completed_at
    into v_req, v_cand, v_done
    from public.fms_hr_onboardings where id = p_onb for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;
  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to run this onboarding';
  end if;
  if v_done is not null then
    raise exception 'This person has already joined — the offer outcome cannot be changed';
  end if;
  if p_status in ('declined','no_show') and coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the offer was not taken up';
  end if;

  update public.fms_hr_onboardings set
    offer_status        = p_status,
    offer_status_reason = case when p_status = 'accepted' then null else trim(p_reason) end,
    offer_decided_at    = now()
  where id = p_onb;

  select c.name into v_name from public.fms_hr_candidates c where c.id = v_cand;
  select r.mrf_no, r.positions_required into v_no, v_seats
    from public.fms_hr_requisitions r where r.id = v_req;

  if p_status = 'accepted' then
    perform public.fms_hr_announce(
      'onboarding', p_onb, 'offer_accepted',
      coalesce(v_name, 'The candidate') || ' accepted the offer (' || coalesce(v_no, '') || ')',
      public.fms_hr_step_owner_ids('onboarding')
    );
    -- The checklist may already be finished — acceptance can be the last thing to land.
    perform public.fms_hr_try_complete_onboarding(p_onb);
  else
    perform public.fms_hr_announce(
      'onboarding', p_onb, 'offer_' || p_status,
      coalesce(v_name, 'The candidate') || ' did not take up the offer (' || coalesce(v_no, '')
        || ') — ' || trim(p_reason) || '. The seat is open again.',
      coalesce((select r.hiring_manager_ids from public.fms_hr_requisitions r where r.id = v_req), '{}'::uuid[])
        || public.fms_hr_step_owner_ids('resume_upload')
    );
    -- The seat is freed the moment offer_status flips (fms_hr_seats_taken excludes
    -- declined / no-show). This reopens the requisition if it had already closed.
    perform public.fms_hr_sync_requisition_fill(v_req);
  end if;
end $$;
grant execute on function public.fms_hr_set_offer_status(uuid, text, text) to authenticated;

-- ===========================================================================
-- RPC — tick / untick one checklist item.
--
-- Ticking STAMPS THE DATE automatically (done_at) — HR never types it. An item
-- flagged requires_file cannot be ticked without one; an item still pending takes
-- the reason instead. Every item accepts a file, a Drive link, or both.
-- ===========================================================================
drop function if exists public.fms_hr_toggle_onboarding_check(uuid, boolean, text, text, text, text);
create or replace function public.fms_hr_toggle_onboarding_check(
  p_check          uuid,
  p_done           boolean,
  p_file_path      text default null,
  p_file_name      text default null,
  p_link_url       text default null,
  p_pending_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_onb       uuid;
  v_needsfile boolean;
  v_name      text;
  v_file      text;
  v_req       uuid;
  v_joining   date;
  v_status    text;
  v_done      timestamptz;
begin
  select k.onboarding_id, k.requires_file, k.name, k.file_path
    into v_onb, v_needsfile, v_name, v_file
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

  if p_done then
    v_file := coalesce(nullif(p_file_path, ''), v_file);
    if v_needsfile and v_file is null then
      raise exception '% needs a file before it can be ticked', v_name;
    end if;

    update public.fms_hr_onboarding_checks set
      done           = true,
      done_at        = now(),          -- stamped automatically; HR never types a date
      done_by        = v_uid,
      file_path      = v_file,
      file_name      = coalesce(nullif(p_file_name, ''), file_name),
      link_url       = coalesce(nullif(trim(p_link_url), ''), link_url),
      pending_reason = null
    where id = p_check;

  else
    update public.fms_hr_onboarding_checks set
      done           = false,
      done_at        = null,
      done_by        = null,
      file_path      = coalesce(nullif(p_file_path, ''), file_path),
      file_name      = coalesce(nullif(p_file_name, ''), file_name),
      link_url       = coalesce(nullif(trim(p_link_url), ''), link_url),
      pending_reason = nullif(trim(p_pending_reason), '')
    where id = p_check;
  end if;

  -- Completion is decided here, not by the UI: the last tick (with the offer
  -- accepted) means the person joined, which fills a seat and may close the vacancy.
  perform public.fms_hr_try_complete_onboarding(v_onb);
end $$;
grant execute on function public.fms_hr_toggle_onboarding_check(uuid, boolean, text, text, text, text) to authenticated;

-- ===========================================================================
-- RPC — the Employee ID from the HR system. Captured on the onboarding, not as a
-- checklist row: it is a value, not a task.
-- ===========================================================================
drop function if exists public.fms_hr_set_employee_code(uuid, text);
create or replace function public.fms_hr_set_employee_code(p_onb uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req uuid;
begin
  select requisition_id into v_req from public.fms_hr_onboardings where id = p_onb for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;
  if not public.fms_hr_can_act('onboarding', v_req, v_uid) then
    raise exception 'Not authorized to run this onboarding';
  end if;
  if coalesce(trim(p_code), '') = '' then raise exception 'An employee ID is required'; end if;

  update public.fms_hr_onboardings
     set employee_code = trim(p_code), employee_code_at = now()
   where id = p_onb;
end $$;
grant execute on function public.fms_hr_set_employee_code(uuid, text) to authenticated;
