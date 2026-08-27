-- ===========================================================================
-- HR Recruitment — a step owner may HAND A STEP to someone else.
--
-- Fourth module to get the handover, after Import (20260827120000), Purchase RM
-- Domestic (20260827130000) and Office Supplies (20260827140000). This one needed
-- a different SHAPE, and the reason is worth stating before anything else.
--
-- ⚠ WHY THIS IS A TABLE AND NOT A COLUMN.
-- The first three modules each carry ONE approval in flight per entity, so a
-- single `assigned_approver_id` column on that entity says everything. HR does
-- not. A requisition walks through nineteen steps across THREE SCOPES —
-- requisition, candidate and hire (lib/steps.ts) — and several of them are open
-- at once: a requisition can be at `job_posting` while one of its candidates is
-- at `final_decision` and last month's hire is at `probation_m2`. One column
-- could not say which of those was handed over. So the holder is keyed on
-- (requisition, step).
--
-- ⚠ AND WHY (REQUISITION, STEP) IS THE RIGHT KEY, NOT (ENTITY, STEP).
-- Because that is already how this module authorises. Every one of the eighteen
-- RPCs calls fms_hr_can_act(step_key, REQUISITION_ID, uid) — even the hire-scoped
-- ones: fms_hr_record_probation_review resolves probations.requisition_id first
-- and passes that. So keying the holder the same way needs NO signature change
-- and NO call-site change anywhere; the new rule simply lands inside the gate
-- those eighteen RPCs already go through. Read it as "for this requisition, this
-- step is currently held by X" — which for `final_decision` means the offers for
-- that role, not one candidate's.
--
-- ⚠ THE HARD STOP THIS FIXES.
-- fms_hr_can_act__ungated's hiring-manager branch `return`s with NO fall-through:
--
--     if p_step_key in ('hod_shortlist','interview_2','probation_m1',...) then
--       select hiring_manager_ids into v_managers ...
--       return v_managers is not null and p_uid = any(v_managers);   -- and stop
--     end if;
--
-- so for those seven steps the hiring managers are the only non-admins who can
-- ever act, and there is no list an admin could add a second name to. 15 of the
-- 17 live requisitions name exactly ONE hiring manager. Putting the holder check
-- BEFORE that branch is what makes those steps movable at all.
--
-- ⚠ THE READ GATE HAD TO BE WIDENED, EXACTLY AS IN OFFICE SUPPLIES.
-- fms_hr_requisitions' RLS select is fms_hr_can_view_requisition, which is
-- fms_hr_can_read_requisition OR module_is_viewer — and module_is_viewer is
-- `module_level(...) = 'view'` EXACTLY. A receiver holding an *edit* grant who is
-- not already the requester, a hiring manager, a reporting-to or an interviewer
-- matches nothing, so the requisition would not even be readable. Section 5 adds
-- the holder arm.
--
-- ⚠ NOT THE SAME THING AS fms_hr_reassign_interview, WHICH STAYS.
-- That RPC moves ONE INTERVIEW to different interviewers. This moves a STEP.
-- They do not overlap and neither supersedes the other: an interview can be
-- passed to another panel while the requisition's `interview_2` step is held by
-- somebody standing in for the hiring manager. fms_hr_reassign_interview is the
-- in-house precedent this borrows its authority model from — whoever owes the
-- work may pass it on — not a thing being replaced.
--
-- ONE RULE, TWO READERS. The pre-existing ownership test is lifted out verbatim
-- into fms_hr_is_natural_step_owner so that both the gate and the reassign RPC
-- ask the same question: the gate asks "who owns this now" AFTER the holder
-- check, and the reassign RPC asks "who owned it BEFORE" so the original owner
-- can still pull it back. Without that split, handing a step over would strip
-- the hiring manager of the right to take it back.
--
-- ADDITIVE: one new table, three new functions, two create-or-replace bodies
-- that keep their EXACT argument lists.
--
-- NO SERVER-SIDE ANNOUNCE. The store raises it client-side, as in the other
-- modules, so the mail renders with content.
--
-- VERIFIED ON LIVE DATA 2026-08-27, in rolled-back transactions:
--   * 22 authorisation cases, 22 passed. The two that matter most: before the
--     handover NOBODY but the single hiring manager could reach `interview_2`
--     (the no-fall-through return), and after it the holder could and the manager
--     could not — the hard stop opened and the work MOVED rather than being
--     shared. Also proved per-STEP: handing over `interview_2` left the same
--     manager owning `probation_m1` on the same requisition.
--   * The read gate, before and after, exactly as in Office Supplies:
--     fms_hr_can_read_requisition(req, receiver) was FALSE for an edit-level
--     receiver and TRUE once they held a step.
--
--   ⚠ ONE FINDING WORTH CARRYING FORWARD. hr_head_approval and final_decision are
--     both owned by Riya Kumari, who is ALSO the sole process coordinator — and
--     the coordinator arm returns true before the holder check. So for HER a
--     handover ADDS the receiver without removing her, by design: a coordinator
--     oversees the whole flow. It is correct, but it means the QUEUE must follow
--     the holder even for a coordinator, or the handover looks like it did
--     nothing to the one person most likely to use it. The store does that with
--     `stepIsMine`, kept separate from `canActOn`.
--
-- REVERSAL — REHEARSED ON LIVE DATA 2026-08-27 with a handover in flight; 8 of 8
-- passed, and it CONFIRMED the ordering claim below rather than assuming it:
-- dropping fms_hr_is_natural_step_owner first was accepted by Postgres, and the
-- next call to fms_hr_can_act__ungated — for `job_posting`, a step with nothing
-- to do with reassign — failed with 'function ... does not exist'. Restoring the
-- gate body first made the holder row inert immediately, before it was deleted.
--
-- REVERSAL:
--   1. re-run the fms_hr_can_act__ungated body from its previous defining
--      migration, and the fms_hr_can_read_requisition body from its own.
--   2. drop function public.fms_hr_reassign_step(uuid, text, uuid, text);
--      drop function public.fms_hr_is_natural_step_owner(text, uuid, uuid);
--      drop function public.fms_hr_can_receive_reassignment(uuid);
--   3. delete from public.fms_hr_config where key = 'reassign_pool';
--   4. drop table public.fms_hr_step_assignees;
--   Step 1 first here, unlike the other three: this migration's gate body CALLS
--   fms_hr_is_natural_step_owner, so leaving the new gate in place after dropping
--   that helper would break every one of the eighteen RPCs, not just reassign.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Who holds which step.
--
-- One row per (requisition, step) while that step is handed over; the row is
-- DELETED on a hand-back rather than set to null, so "is anything handed over"
-- is a plain existence test and the table stays small.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_hr_step_assignees (
  requisition_id uuid not null references public.fms_hr_requisitions(id) on delete cascade,
  step_key       text not null,
  assigned_to    uuid not null references auth.users on delete cascade,
  assigned_by    uuid references auth.users on delete set null,
  assigned_at    timestamptz not null default now(),
  note           text,
  primary key (requisition_id, step_key)
);

comment on table public.fms_hr_step_assignees is
  'Who is currently holding one STEP of one requisition. Keyed on (requisition_id, step_key) because that is exactly how fms_hr_can_act already authorises - even hire-scoped steps pass their requisition id. A row here REPLACES the natural owner for that step (see fms_hr_can_act__ungated); it is deleted, not nulled, on a hand-back.';

alter table public.fms_hr_step_assignees enable row level security;

-- Readable by anyone who can read the requisition it belongs to, so the UI can
-- show "held by X" wherever it shows the requisition. Written only through the
-- SECURITY DEFINER RPC below, never directly - hence admin-only for writes.
create policy fms_hr_step_assignees_select on public.fms_hr_step_assignees
  for select using (public.fms_hr_can_view_requisition(requisition_id, auth.uid()));

create policy fms_hr_step_assignees_write on public.fms_hr_step_assignees
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.fms_hr_step_assignees to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Who may RECEIVE a handover.
--
-- ⚠ AUTHORIZATION COMES SOLELY FROM user_ids. department_ids is a Setup picker
--   filter and grants nothing.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_can_receive_reassignment(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_hr_config c
     where c.key = 'reassign_pool'
       and p_uid::text in (
         select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
       )
  );
$$;

comment on function public.fms_hr_can_receive_reassignment(uuid) is
  'Is this user on the configured list of people who may be handed an HR Recruitment step? Reads ONLY fms_hr_config.reassign_pool -> user_ids; department_ids in that same row is a Setup picker filter and grants nothing.';

grant execute on function public.fms_hr_can_receive_reassignment(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Who owns a step when NOBODY is holding it.
--
-- This is the pre-existing rule, lifted out of fms_hr_can_act__ungated verbatim
-- and with its admin/coordinator arm left behind (that arm is authority, not
-- ownership, and the reassign RPC needs to ask about ownership specifically).
--
-- Two readers, deliberately:
--   * fms_hr_can_act__ungated asks it AFTER the holder check — who owns it now;
--   * fms_hr_reassign_step asks it directly — who owned it BEFORE, so that the
--     original owner can still take it back after handing it over.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_is_natural_step_owner(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_managers uuid[];
begin
  if p_step_key in (
    'hod_shortlist','interview_2',
    'probation_m1','probation_m2','probation_m3',
    'probation_final','probation_extension'
  ) then
    if p_req is null then return false; end if;
    select hiring_manager_ids into v_managers from public.fms_hr_requisitions where id = p_req;
    return v_managers is not null and p_uid = any(v_managers);
  end if;

  return public.fms_hr_is_step_owner(p_step_key, p_uid);
end $$;

comment on function public.fms_hr_is_natural_step_owner(text, uuid, uuid) is
  'Who owns this step of this requisition when nobody has been handed it - the hiring managers for the seven HOD/probation steps, the configured step owners for everything else. Deliberately excludes the admin/coordinator arm: that is authority, not ownership.';

grant execute on function public.fms_hr_is_natural_step_owner(text, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. can_act__ungated — the holder rule.
--
--    ONE delta: a holder check ahead of everything except admin/coordinator, and
--    the rest of the body delegated to the helper above.
--
--    ⚠ The holder REPLACES the natural owner rather than joining them. An OR
--      would be a SHARE — the step would stay in the hiring manager's queue too,
--      and nothing would have moved.
--
--    ⚠ It sits BEFORE the hiring-manager branch, which is the whole point: that
--      branch `return`s, so anything placed after it is unreachable for the seven
--      steps that need this most.
--
--    Signature unchanged. The gated wrapper fms_hr_can_act is NOT touched and
--    still opens with module_can_edit(p_uid,'hr-recruitment'), so a receiver
--    without an edit grant is refused by the DATABASE. Setup warns about that.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_can_act__ungated(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_holder uuid;
begin
  if public.is_admin(p_uid) or public.fms_hr_is_coordinator(p_uid) then
    return true;
  end if;

  if p_req is not null then
    select assigned_to into v_holder
      from public.fms_hr_step_assignees
     where requisition_id = p_req and step_key = p_step_key;
    if v_holder is not null then
      return v_holder = p_uid;
    end if;
  end if;

  return public.fms_hr_is_natural_step_owner(p_step_key, p_req, p_uid);
end $$;


-- ---------------------------------------------------------------------------
-- 5. can_read_requisition — admit the holder.
--
--    ⚠ WITHOUT THIS THE FEATURE IS A DEAD END, for the same reason it was in
--      Office Supplies. The RLS select on fms_hr_requisitions is
--      fms_hr_can_view_requisition = this OR module_is_viewer, and
--      module_is_viewer is `module_level(...) = 'view'` EXACTLY. A receiver
--      holding an *edit* grant matches none of the existing arms unless they
--      happen to already be the requester, a hiring manager, a reporting-to or
--      an interviewer — so the requisition would not even load.
--
--    ONE delta: the fms_hr_step_assignees arm. Signature unchanged.
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
      or exists (
        select 1 from public.fms_hr_step_assignees a
         where a.requisition_id = p_req and a.assigned_to = p_uid
      )
      or exists (
        select 1
          from public.fms_hr_interviews i
          join public.fms_hr_candidates c on c.id = i.candidate_id
         where c.requisition_id = p_req and p_uid = any(i.interviewer_ids)
      );
$$;


-- ---------------------------------------------------------------------------
-- 6. Hand a step over (or take it back).
--
-- p_assignee NULL = return it to whoever naturally owns the step. That is the
-- "take it back" path, and it is why this is one RPC rather than two.
--
-- WHO MAY CALL IT is deliberately BROADER than who may act: the NATURAL owner
-- keeps the right to pull a step back after handing it over, which the holder
-- rule in section 4 would otherwise deny them.
--
-- WHO MAY RECEIVE is the pool OR the step's natural owner, so it can always be
-- handed back without an admin having to list every hiring manager in the pool.
-- ---------------------------------------------------------------------------
create or replace function public.fms_hr_reassign_step(
  p_req      uuid,
  p_step_key text,
  p_assignee uuid default null,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_holder uuid;
begin
  select status into v_status from public.fms_hr_requisitions where id = p_req for update;
  if v_status is null then raise exception 'Requisition not found'; end if;
  if v_status = 'cancelled' then
    raise exception 'This requisition is cancelled — its steps can no longer be reassigned';
  end if;

  select assigned_to into v_holder from public.fms_hr_step_assignees
   where requisition_id = p_req and step_key = p_step_key;

  if not (public.is_admin(v_uid)
          or public.fms_hr_is_coordinator(v_uid)
          or (v_holder is not null and v_holder = v_uid)
          or public.fms_hr_is_natural_step_owner(p_step_key, p_req, v_uid)) then
    raise exception 'Not authorized to reassign this step';
  end if;

  if p_assignee is null then
    delete from public.fms_hr_step_assignees
     where requisition_id = p_req and step_key = p_step_key;
    return;
  end if;

  if p_assignee = v_uid then
    raise exception 'Pick someone else — a step cannot be reassigned to yourself';
  end if;

  if not (public.fms_hr_can_receive_reassignment(p_assignee)
          or public.fms_hr_is_natural_step_owner(p_step_key, p_req, p_assignee)) then
    raise exception 'That person may not receive a step. Add them in Setup, under Reassignment, first.';
  end if;

  insert into public.fms_hr_step_assignees (requisition_id, step_key, assigned_to, assigned_by, note)
  values (p_req, p_step_key, p_assignee, v_uid, nullif(btrim(p_note), ''))
  on conflict (requisition_id, step_key) do update
    set assigned_to = excluded.assigned_to,
        assigned_by = excluded.assigned_by,
        assigned_at = now(),
        note        = excluded.note;
end $$;

comment on function public.fms_hr_reassign_step(uuid, text, uuid, text) is
  'Hand ONE step of ONE requisition to another person, or pass NULL to return it to its natural owner. Callable by an admin, a process coordinator, the step''s natural owner, or the current holder. Does not announce - the store raises the notification client-side so the email renders with content. Unrelated to fms_hr_reassign_interview, which moves one interview to different interviewers.';

grant execute on function public.fms_hr_reassign_step(uuid, text, uuid, text) to authenticated;

commit;
