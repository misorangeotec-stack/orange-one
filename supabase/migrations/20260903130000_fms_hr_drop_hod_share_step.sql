-- HR Recruitment — remove the "Share to HOD" step (`hod_share`).
--
-- WHY
-- `hod_share` was a button, not work. HR ticked CVs and pressed "Share with HOD",
-- which stamped a timestamp and fired one notification. No form, no fields, no
-- attachment. It was not even a privacy gate: fms_hr_can_read_requisition() grants
-- per REQUISITION, not per stage, so a hiring manager could already see every CV on
-- their own vacancy from the moment it was uploaded. Sharing granted nothing — it
-- only asked for attention, which is precisely what a notification is for.
--
-- Meanwhile it cost the HOD a day of SLA and, because nothing forced the click, CVs
-- silently piled up behind it. The live data when this was written: of 29 candidates,
-- 27 sat at 'hr_shortlisted' waiting for a button nobody had pressed, and NOT ONE had
-- ever been shared — the step had never been completed in production at all.
--
-- It was completed for the first time on 18-08-2026 at 05:23 UTC, while this was being
-- prepared: 8 CVs on MRF-2627-0009 were shared, and the HOD shortlisted all 8 forty
-- seconds later. That is the argument, not a counter-argument. When somebody remembers
-- the button the step adds forty seconds of ceremony and nothing else; when they forget
-- it, CVs sit. 19 are still sitting as this ships — 12 on MRF-2627-0001 and 1 on -0008
-- (4 days), 6 on MRF-2627-0006 (8 days, shortlisted 10-08-2026).
--
-- Those 8 keep their shared_to_hod_at. Nothing below reads or clears it.
--
-- WHAT CHANGES
-- Shortlisting by HR IS the handover. `hr_shortlisted` now pends 'hod_shortlist', so
-- a shortlisted CV is the HOD's work-item immediately, and the digest in
-- fms_hr_notify_hod_pending() tells them so.
--
--   before: resume_uploaded → hr_shortlisted → [share] → shared_with_hod → hod_shortlisted
--   after:  resume_uploaded → hr_shortlisted ─────────────────────────────→ hod_shortlisted
--
-- ===========================================================================
-- ⚠ NOTHING HERE DESTROYS OR REWRITES EXISTING DATA.
--
--   • No table is dropped, no column is dropped, no CHECK constraint is loosened
--     or tightened. 'shared_with_hod' REMAINS a legal stage value and
--     shared_to_hod_at / shared_to_hod_by keep every value they hold.
--   • There is not a single DELETE in this file.
--   • The only UPDATE against a domain table is the guarded repair in §3, which
--     touches 0 rows against today's data, changes ONLY the `stage` column, leaves
--     every timestamp intact, and snapshots anything it would touch into a backup
--     table first. It exists solely so that a CV shared between now and deploy is
--     not left stranded in a stage the app no longer draws.
--   • §7 rewrites one CONFIG key that does not currently exist, and only ever
--     repoints a due-date anchor. It is a no-op today.
--   • The only DROP is of a FUNCTION (§4) — code, not data.
--   • Everything else is CREATE OR REPLACE FUNCTION, plus INSERTs of new
--     notification rows in §6.
-- ===========================================================================


-- ===========================================================================
-- 1. The pending step. THIS is the line that frees the stranded CVs.
--
-- Everything downstream reads through this — buildQueueEntries, the Control
-- Center, My Work Today and the daily digest email — so flipping it moves every
-- 'hr_shortlisted' card onto its HOD's plate at once.
--
-- The 'shared_with_hod' case is KEPT, deliberately. It is unreachable for new
-- work after this migration, but any historical row still resolves correctly
-- rather than falling through to null and vanishing from every queue.
-- ===========================================================================
create or replace function public.fms_hr_pending_step(p_stage text)
returns text language sql immutable as $$
  select case p_stage
    when 'resume_uploaded'  then 'hr_shortlist'
    -- WAS 'hod_share'. Shortlisting by HR is the handover; the HOD owes the next move.
    when 'hr_shortlisted'   then 'hod_shortlist'
    when 'shared_with_hod'  then 'hod_shortlist'   -- legacy rows only
    when 'hod_shortlisted'  then 'telephonic_screening'
    when 'telephonic'       then 'telephonic_screening'
    when 'interview_1'      then 'interview_1'
    when 'interview_2'      then 'interview_2'
    when 'interview_3'      then 'interview_3'
    when 'final_decision'   then 'final_decision'
    else null
  end;
$$;
grant execute on function public.fms_hr_pending_step(text) to authenticated;


-- ===========================================================================
-- 2. The board move.
--
-- ⚠ THIS BODY WAS TAKEN FROM THE LIVE DATABASE (pg_get_functiondef), not from the
--   last migration file that happens to contain the function. 20260812120100 and
--   20260816120300 both record why: a function repaired in place has no canonical
--   source in the repo, and re-issuing it from a stale file silently reverts the
--   repair.
--
-- THREE CHANGES from the live body, all marked CHANGED below:
--
--   a. Forward-move guard now allows rank 2 → 4 (Shortlisted by HR → Shortlisted
--      by HOD). Below the skippable zone the rule is one column at a time, so
--      without this the HOD cannot act on the very cards they now own.
--
--   b. Disqualify authorization. v_pending for an 'hr_shortlisted' card now reads
--      'hod_shortlist', so HR would have lost the ability to drop a CV they had
--      just shortlisted by mistake. HR is added back explicitly.
--
--   c. The 'shared_with_hod' write branch is REMOVED, so the stage becomes
--      unproducible and p_to_stage='shared_with_hod' now raises 'Unknown stage'.
--      That unreachability is what lets the frontend drop the stage from its type
--      system safely. Note this removes only the ability to CREATE the state — the
--      backward-clear below still handles shared_to_hod_at for existing rows.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fms_hr_move_candidate(p_id uuid, p_to_stage text, p jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_joining    date;
  v_onb        uuid;
  v_ids        uuid[] := '{}';
  v_done       timestamptz;
  v_outcome    text;
  v_reason_txt text;
begin
  select c.requisition_id, c.stage into v_req, v_from
    from public.fms_hr_candidates c where c.id = p_id for update;
  if v_req is null then raise exception 'Candidate not found'; end if;
  if v_from = p_to_stage then return; end if;

  select status, positions_required into v_req_status, v_seats
    from public.fms_hr_requisitions where id = v_req for update;
  if v_req_status in ('on_hold','cancelled','closed') and p_to_stage <> 'hired' then
    raise exception 'This requisition is % — candidates cannot be moved', v_req_status;
  end if;

  v_to_step   := public.fms_hr_stage_step(p_to_stage);
  v_pending   := public.fms_hr_pending_step(v_from);
  v_from_rank := public.fms_hr_stage_rank(v_from);
  v_to_rank   := public.fms_hr_stage_rank(p_to_stage);

  if v_from = 'hired' then
    raise exception 'This person has joined — that cannot be undone by moving the card';
  end if;

  if p_to_stage = 'hired' then
    if v_from <> 'finalized' then
      raise exception 'Only a candidate who has been made an offer can be marked hired';
    end if;
  elsif p_to_stage <> 'disqualified' and v_to_rank > v_from_rank then
    -- CHANGED (a): rank 3 ('shared_with_hod') is now a vacant number, so the HOD's
    -- shortlist is two ranks above HR's. Ranks are NOT renumbered — they are
    -- hard-coded thresholds in the backward-clear branch below and in the
    -- frontend's STAGE_RANK — so the skip is spelled out instead.
    if not (v_to_rank = v_from_rank + 1
            or (v_from_rank = 2 and v_to_rank = 4)
            or (v_from_rank >= 4 and v_to_rank <= 10)) then
      raise exception 'That is not a legal forward move (% → %)', v_from, p_to_stage;
    end if;
  end if;

  if v_from = 'disqualified' and v_to_rank >= v_from_rank then
    raise exception 'This candidate is already disqualified';
  end if;

  if p_to_stage = 'disqualified' then
    -- CHANGED (b): an 'hr_shortlisted' card now pends 'hod_shortlist', which is the
    -- HOD's. HR must keep the ability to drop a CV they themselves just shortlisted
    -- in error — otherwise their only correction is to drag it back to Resumes.
    if not (public.fms_hr_can_act(coalesce(v_pending, 'final_decision'), v_req, v_uid)
            or public.fms_hr_can_act('final_decision', v_req, v_uid)
            or (v_from = 'hr_shortlisted' and public.fms_hr_can_act('hr_shortlist', v_req, v_uid))
            or (v_from = 'finalized' and public.fms_hr_can_act('onboarding', v_req, v_uid))) then
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

  if v_to_rank < v_from_rank then
    if v_from = 'finalized' then
      if exists (
        select 1 from public.fms_hr_onboardings o
         where o.candidate_id = p_id and o.completed_at is not null
      ) then
        raise exception 'This person has already joined — their onboarding is complete and cannot be undone by moving the card';
      end if;
      -- A CORRECTION, not an outcome: the offer should not have gone out.
      delete from public.fms_hr_onboardings where candidate_id = p_id;
    end if;

    -- The shared_to_hod_* lines stay: rank 3 is vacant for new work, but a historical
    -- row may still carry those values and a move back must clear them consistently.
    update public.fms_hr_candidates set
      hr_shortlisted_at = case when v_to_rank < 2 then null else hr_shortlisted_at end,
      hr_shortlisted_by = case when v_to_rank < 2 then null else hr_shortlisted_by end,
      shared_to_hod_at  = case when v_to_rank < 3 then null else shared_to_hod_at end,
      shared_to_hod_by  = case when v_to_rank < 3 then null else shared_to_hod_by end,
      hod_decided_at    = case when v_to_rank < 4 then null else hod_decided_at end,
      hod_decided_by    = case when v_to_rank < 4 then null else hod_decided_by end,
      telephonic_at     = case when v_to_rank < 5 then null else telephonic_at end,
      interview1_at     = case when v_to_rank < 6 then null else interview1_at end,
      interview2_at     = case when v_to_rank < 7 then null else interview2_at end,
      interview3_at     = case when v_to_rank < 8 then null else interview3_at end,
      final_decision_at = case when v_to_rank < 9 then null else final_decision_at end,
      decision_remarks  = case when v_to_rank < 9 then null else decision_remarks end,
      finalized_at = null, finalized_by = null, offered_ctc = null, joined_at = null,
      disqualified_at = null, disqualification_reason_id = null, disqualification_note = null
    where id = p_id;

    delete from public.fms_hr_interviews
     where candidate_id = p_id and round > greatest(-1, v_to_rank - 5);
  end if;

  if p_to_stage = 'hr_shortlisted' then
    update public.fms_hr_candidates
       set stage = p_to_stage, hr_shortlisted_at = now(), hr_shortlisted_by = v_uid
     where id = p_id;

  -- CHANGED (c): the 'shared_with_hod' branch that stood here is gone. With
  -- fms_hr_share_candidates_with_hod dropped in §4, the stage is now unreachable
  -- and this falls through to the 'Unknown stage' guard at the bottom.

  elsif p_to_stage = 'hod_shortlisted' then
    update public.fms_hr_candidates
       set stage = p_to_stage, hod_decided_at = now(), hod_decided_by = v_uid
     where id = p_id;

  elsif p_to_stage in ('telephonic','interview_1','interview_2','interview_3') then
    v_round := case p_to_stage when 'telephonic' then 0
                               else substring(p_to_stage from 'interview_(\d)')::integer end;

    if jsonb_typeof(p->'interviewer_ids') = 'array' then
      select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_ids
        from jsonb_array_elements_text(p->'interviewer_ids') as t(x)
       where coalesce(trim(x), '') <> '';
    elsif coalesce(p->>'interviewer_id', '') <> '' then
      v_ids := array[(p->>'interviewer_id')::uuid];
    end if;

    if cardinality(v_ids) = 0 and coalesce(trim(p->>'interviewer_name'), '') = '' then
      raise exception 'Say who is taking this interview';
    end if;

    insert into public.fms_hr_interviews (
      candidate_id, round, interviewer_ids, interviewer_id, interviewer_name,
      scheduled_on, status, created_by
    )
    values (
      p_id, v_round, v_ids, v_ids[1],
      nullif(trim(p->>'interviewer_name'), ''),
      nullif(p->>'scheduled_on','')::date,
      'scheduled', v_uid
    )
    on conflict (candidate_id, round) do update set
      interviewer_ids  = excluded.interviewer_ids,
      interviewer_id   = excluded.interviewer_id,
      interviewer_name = excluded.interviewer_name,
      scheduled_on     = excluded.scheduled_on,
      status           = 'scheduled',
      held_at          = null;

    update public.fms_hr_candidates set stage = p_to_stage where id = p_id;

  elsif p_to_stage = 'final_decision' then
    update public.fms_hr_candidates
       set stage = p_to_stage, final_decision_at = now(),
           decision_remarks = coalesce(nullif(trim(p->>'decision_remarks'), ''), decision_remarks)
     where id = p_id;

  elsif p_to_stage = 'finalized' then
    v_taken := public.fms_hr_seats_taken(v_req, p_id);
    if v_taken >= v_seats then
      raise exception 'All % seat(s) on this requisition are already filled', v_seats;
    end if;

    v_joining := nullif(p->>'joining_date','')::date;

    update public.fms_hr_candidates set
      stage = 'finalized', finalized_at = now(), finalized_by = v_uid,
      offered_ctc = nullif(p->>'offered_ctc','')::numeric,
      decision_remarks = coalesce(nullif(trim(p->>'decision_remarks'), ''), decision_remarks)
    where id = p_id;

    -- DO UPDATE, not DO NOTHING: an earlier offer may have been declined and that
    -- row deliberately kept. Offering again must not inherit the old verdict —
    -- and must not assert a new one either. A re-offer is a fresh question, so it
    -- resets to 'pending' and waits for the same answer as any other offer.
    insert into public.fms_hr_onboardings (
      candidate_id, requisition_id, created_by,
      joining_date, joining_date_set_at, joining_date_by
    )
    values (
      p_id, v_req, v_uid,
      v_joining,
      case when v_joining is not null then now() end,
      case when v_joining is not null then v_uid end
    )
    on conflict (candidate_id) do update set
      requisition_id      = excluded.requisition_id,
      joining_date        = coalesce(excluded.joining_date, public.fms_hr_onboardings.joining_date),
      joining_date_set_at = coalesce(excluded.joining_date_set_at, public.fms_hr_onboardings.joining_date_set_at),
      joining_date_by     = coalesce(excluded.joining_date_by, public.fms_hr_onboardings.joining_date_by),
      offer_status        = 'pending',
      offer_status_reason = null,
      offer_decided_at    = null,
      offer_decided_by    = null
    returning id into v_onb;

    if v_onb is null then
      select id into v_onb from public.fms_hr_onboardings where candidate_id = p_id;
    end if;

    if v_joining is not null and v_onb is not null then
      insert into public.fms_hr_onboarding_checks (
        onboarding_id, item_id, item_key, name, description,
        requires_file, allows_link, due_days, sort_order
      )
      select v_onb, i.id, i.key, i.name, i.description,
             i.requires_file, i.allows_link, i.due_days, i.sort_order
        from public.fms_hr_onboarding_items i
       where i.active
       order by i.sort_order, i.name
      on conflict (onboarding_id, item_key) do nothing;
    end if;

  elsif p_to_stage = 'hired' then
    select o.completed_at into v_done
      from public.fms_hr_onboardings o where o.candidate_id = p_id;
    if v_done is null then
      raise exception 'Their onboarding is not complete yet — the offer must be accepted and every checklist item ticked before they can be marked hired';
    end if;

    update public.fms_hr_candidates set stage = 'hired' where id = p_id;

  elsif p_to_stage = 'disqualified' then
    if v_from = 'finalized' then
      if exists (
        select 1 from public.fms_hr_onboardings o
         where o.candidate_id = p_id and o.completed_at is not null
      ) then
        raise exception 'This person has already joined — mark them hired, or record a did-not-join on the onboarding screen';
      end if;

      -- THE OUTCOME, KEPT. The seat is freed either way (fms_hr_seats_taken excludes
      -- declined/no_show), and this is the only record the acceptance rate reads.
      v_outcome := lower(coalesce(nullif(trim(p->>'offer_outcome'), ''), 'declined'));
      if v_outcome not in ('declined','no_show') then
        raise exception 'Unknown offer outcome % — expected declined or no_show', v_outcome;
      end if;

      v_reason_txt := nullif(trim(p->>'disqualification_note'), '');
      if v_reason_txt is null then
        select d.name into v_reason_txt
          from public.fms_hr_disqualification_reasons d
         where d.id = nullif(p->>'disqualification_reason_id','')::uuid;
      end if;
      v_reason_txt := coalesce(v_reason_txt, 'The offer was not taken up');

      update public.fms_hr_onboardings set
        offer_status        = v_outcome,
        offer_status_reason = v_reason_txt,
        offer_decided_at    = now(),
        offer_decided_by    = coalesce(offer_decided_by, v_uid)
      where candidate_id = p_id;
    end if;

    update public.fms_hr_candidates set
      stage = 'disqualified', disqualified_at = now(),
      disqualification_reason_id = nullif(p->>'disqualification_reason_id','')::uuid,
      disqualification_note = nullif(trim(p->>'disqualification_note'), '')
    where id = p_id;

    if v_from = 'finalized' then
      perform public.fms_hr_sync_requisition_fill(v_req);
    end if;

  elsif p_to_stage = 'resume_uploaded' then
    update public.fms_hr_candidates set stage = 'resume_uploaded' where id = p_id;

  else
    raise exception 'Unknown stage %', p_to_stage;
  end if;
end $function$;


-- ===========================================================================
-- 3. Rescue any card left mid-handover. GUARDED, REVERSIBLE, 0 ROWS TODAY.
--
-- `select count(*) ... where stage = 'shared_with_hod'` returns 0 immediately before
-- this was applied, so the block does nothing. It is not theoretical, though: the
-- Share button WAS pressed on 18-08 while this was being prepared, and those 8 CVs
-- only avoided this branch because the HOD happened to decide on them within the
-- minute. Anyone caught mid-handover would otherwise sit in a stage §2 has just made
-- unproducible and the frontend no longer draws.
--
-- What it does NOT do: it does not clear shared_to_hod_at or shared_to_hod_by, it
-- does not touch hr_shortlisted_at (already set on any such row — being shared
-- requires having been shortlisted first, so the card keeps a valid SLA anchor),
-- and it does not delete anything. It changes exactly one column, on rows that
-- would otherwise be orphaned, and snapshots them first.
-- ===========================================================================
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.fms_hr_candidates where stage = 'shared_with_hod';

  if v_n = 0 then
    raise notice 'fms_hr: no candidates in shared_with_hod — nothing to migrate.';
  else
    -- Snapshot before touching anything, so the change is trivially reversible.
    create table if not exists public.fms_hr_shared_with_hod_backup (
      candidate_id     uuid primary key,
      stage            text,
      shared_to_hod_at timestamptz,
      shared_to_hod_by uuid,
      backed_up_at     timestamptz not null default now()
    );
    alter table public.fms_hr_shared_with_hod_backup enable row level security;

    insert into public.fms_hr_shared_with_hod_backup
      (candidate_id, stage, shared_to_hod_at, shared_to_hod_by)
    select id, stage, shared_to_hod_at, shared_to_hod_by
      from public.fms_hr_candidates
     where stage = 'shared_with_hod'
    on conflict (candidate_id) do nothing;

    update public.fms_hr_candidates
       set stage = 'hr_shortlisted'
     where stage = 'shared_with_hod';

    raise notice 'fms_hr: moved % candidate(s) from shared_with_hod to hr_shortlisted; timestamps preserved, originals in fms_hr_shared_with_hod_backup.', v_n;
  end if;
end $$;


-- ===========================================================================
-- 4. Retire the share RPC.
--
-- This is the other producer of 'shared_with_hod'. Dropping it (together with §2c)
-- makes the stage genuinely unreachable, which is the precondition for the
-- frontend removing it from CandidateStage — a cast there, not a check.
--
-- A FUNCTION, not data. Nothing in the running app calls it after this release;
-- the only other caller is the checked-in demo seed, updated in the same commit.
-- ===========================================================================
drop function if exists public.fms_hr_share_candidates_with_hod(uuid[]);


-- ===========================================================================
-- 5. The digest — "N CVs awaiting your shortlist".
--
-- ONE notification per requisition, not one per CV. HR shortlists a card at a time
-- and the old flow's whole point was to batch ("5–10 CVs at a time"), so a ping per
-- card would replace one useful nudge with ten pieces of noise. While an unread
-- digest exists for a requisition, further shortlists UPDATE it; created_at is
-- bumped so it floats back to the top of a bell that sorts newest-first.
--
-- It writes fms_hr_notifications directly rather than going through
-- fms_hr_announce, deliberately: announce always INSERTS and also writes an
-- immutable activity row, and an audit trail must not be rewritten to keep a
-- counter current. The per-move activity row still comes from announce (called by
-- the store with an empty recipient list, which writes the trail and skips the
-- fan-out).
--
-- SECURITY DEFINER is required — RLS lets a user insert notifications only for
-- themselves, and this writes rows for other people.
--
-- Only ever INSERTs new rows or marks its own digests read. It never touches a
-- notification it did not create (`type = 'hod_shortlist_pending'`).
-- ===========================================================================
create or replace function public.fms_hr_notify_hod_pending(p_requisition uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_n      integer;
  v_mrf    text;
  v_text   text;
  v_mgrs   uuid[];
  m        uuid;
begin
  if p_requisition is null then return; end if;

  -- auth.uid() is null when this runs from a migration (§6) or a cron job; in that
  -- case there is no caller to authorize and nobody to skip as "the actor".
  if v_uid is not null and not public.fms_hr_can_read_requisition(p_requisition, v_uid) then
    return;
  end if;

  select r.mrf_no, coalesce(r.hiring_manager_ids, '{}'::uuid[])
    into v_mrf, v_mgrs
    from public.fms_hr_requisitions r
   where r.id = p_requisition;
  if v_mrf is null then return; end if;

  -- Counted here rather than passed in, so the text can never drift from the board.
  select count(*) into v_n
    from public.fms_hr_candidates c
   where c.requisition_id = p_requisition
     and c.stage = 'hr_shortlisted';

  v_text := format('%s CV%s awaiting your shortlist — %s',
                   v_n, case when v_n = 1 then '' else 's' end, v_mrf);

  foreach m in array v_mgrs loop
    if m is null or m = v_uid then continue; end if;

    if v_n = 0 then
      -- Nothing left to shortlist: retire our own stale digest rather than leaving
      -- it claiming CVs that are no longer there. Marked read, never deleted.
      update public.fms_hr_notifications
         set read_at = now()
       where user_id = m
         and type = 'hod_shortlist_pending'
         and entity_id = p_requisition
         and read_at is null;
    else
      update public.fms_hr_notifications
         set text = v_text, created_at = now(), actor_id = v_uid
       where user_id = m
         and type = 'hod_shortlist_pending'
         and entity_id = p_requisition
         and read_at is null;

      -- No unique constraint on this table, so update-then-insert is what keeps it
      -- to one row per (manager, requisition).
      if not found then
        insert into public.fms_hr_notifications
          (user_id, type, entity_type, entity_id, text, actor_id)
        values
          (m, 'hod_shortlist_pending', 'requisition', p_requisition, v_text, v_uid);
      end if;
    end if;
  end loop;
end $$;

grant execute on function public.fms_hr_notify_hod_pending(uuid) to authenticated;

comment on function public.fms_hr_notify_hod_pending(uuid) is
  'One rolling "N CVs awaiting your shortlist" notification per requisition, for its hiring managers. Replaces the manual Share-to-HOD ping.';


-- ===========================================================================
-- 6. Tell the HODs about the backlog this release hands them.
--
-- 27 CVs across 4 requisitions have been waiting behind a button nobody pressed;
-- §1 has just made them the HODs' work. Without this they would appear silently —
-- and, because the clock runs honestly from hr_shortlisted_at, appear already
-- overdue — with nobody given a reason to look.
--
-- INSERTs only. Touches no existing row.
-- ===========================================================================
do $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select distinct c.requisition_id as id
      from public.fms_hr_candidates c
      join public.fms_hr_requisitions req on req.id = c.requisition_id
     where c.stage = 'hr_shortlisted'
       and req.status not in ('on_hold','cancelled','closed')
  loop
    perform public.fms_hr_notify_hod_pending(r.id);
    v_n := v_n + 1;
  end loop;
  raise notice 'fms_hr: notified hiring managers on % requisition(s) holding shortlisted CVs.', v_n;
end $$;


-- ===========================================================================
-- 7. Due-date config repair. DEFENSIVE — the key does not exist today.
--
-- fms_hr_config.step_sla is unset at seed (the frontend merges a stored map over
-- its code defaults), and a live check confirms it is still absent, so this is a
-- no-op right now. But if an admin saves Setup → Due Dates before this deploys,
-- the row will hold a 'hod_share' entry and anchor 'hod_shortlist' on it — and
-- once hod_share leaves STEPS that anchor resolves to nothing, silently wiping
-- every HOD due date.
--
-- Repoints the anchor and drops the dead key. Never creates the row, never touches
-- any other key, never alters any other step's configured days.
-- ===========================================================================
update public.fms_hr_config
   set value = (value - 'hod_share')
             || case
                  when value ? 'hod_shortlist'
                  then jsonb_build_object(
                         'hod_shortlist',
                         (value -> 'hod_shortlist') || jsonb_build_object('anchor', 'hr_shortlist')
                       )
                  else '{}'::jsonb
                end
 where key = 'step_sla'
   and (value ? 'hod_share' or value #>> '{hod_shortlist,anchor}' = 'hod_share');


-- ===========================================================================
-- 8. Left deliberately untouched
--
--   • fms_hr_candidates.stage CHECK constraint — still admits 'shared_with_hod'.
--     Unreachable is enough; loosening or tightening a constraint on a live table
--     is a risk this change does not need to take.
--   • shared_to_hod_at / shared_to_hod_by — columns and every value in them.
--   • fms_hr_stage_rank() and fms_hr_stage_step() — their 'shared_with_hod' cases
--     remain as dead safety nets, so a stray row still ranks and routes sanely.
--   • fms_hr_config 'min_cvs_to_share' — the frontend stops reading it; the row
--     stays.
--   • The fms_hr_step_owners row for 'hod_share'. This is NOT tidiness:
--     fms_hr_is_recruitment_staff() grants candidate-PII read to anyone owning a
--     non-'mrf' step, so deleting a step-owner row can silently revoke somebody's
--     access to candidate names, phones and CVs. The row becomes invisible the
--     moment STEPS drops the key, and costs nothing where it is.
--   • Every RLS policy. Read access was never staged — fms_hr_can_read_requisition
--     grants per requisition — so a hiring manager's visibility is unchanged.
-- ===========================================================================
