-- ===========================================================================
-- LEARNING & DEVELOPMENT FMS — PARTICIPANTS AND DELIVERY (LD-3 … LD-8).
--
-- Steps 9–22: nomination, nomination approval, invitation and RSVP, material,
-- conduct, attendance, the assignment (issue → submit → review), feedback, the
-- HR session review, the 30-day effectiveness note, follow-up and closure.
--
-- Depends on 20261215120000 (foundations) and 20261215120100 (workflow).
-- Rollback: 20261215120200_ld3_ld8_participants_and_delivery_rollback.sql
--
-- ⚠ NO ASSESSMENT TABLE, AND THAT IS THE CLIENT'S DECISION, NOT AN OMISSION.
--   21-09-2026: "We don't have to do the proper assessment, like a test or
--   marks. We just need to track whether all the employees have submitted their
--   assignment." §3 step 12 of the source document asks for a post-test with a
--   pass mark; it is deliberately absent, and the two KPI lines that still say
--   "assessment" need re-wording to "assignment" by HR (LD-0's owed list).
--
-- ⚠ FIVE STEPS HERE ARE ROW-OWNED — owed by the person the ROW names, not by a
--   globally configured owner: a nominee's RSVP, their assignment submission and
--   their feedback, and their HOD's nomination and effectiveness note. The
--   client list is ROW_OWNED_STEPS in lib/steps.ts and it MUST match
--   fms_ld_can_act below. Recruitment has shipped that disagreement twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Session columns the later steps need. Additive; every one is nullable.
-- ---------------------------------------------------------------------------
alter table public.fms_ld_sessions
  add column if not exists readiness_confirmed_at timestamptz,
  add column if not exists readiness_by           uuid references auth.users on delete set null,
  add column if not exists invitations_sent_at    timestamptz,
  add column if not exists nominations_closed_at  timestamptz,
  add column if not exists attendance_closed_at   timestamptz,
  add column if not exists attendance_sheet_path  text,
  add column if not exists evidence_paths         text[] not null default '{}',
  add column if not exists trainer_attended       boolean,
  add column if not exists review_note            text,
  add column if not exists review_action_points   text,
  add column if not exists reviewed_by            uuid references auth.users on delete set null,
  add column if not exists reviewed_at            timestamptz,
  add column if not exists actual_cost            numeric(14,2);

comment on column public.fms_ld_sessions.attendance_sheet_path is
  'A scan of the signed sheet — EVIDENCE BESIDE the marked rows, never instead of them. The KPI line "attendance capture, 100% of sessions" counts marked attendance rows; a PDF cannot be counted.';

-- ===========================================================================
-- NOMINATIONS — step 9, and the approval at step 10.
--
-- ⚠ employee_id REFERENCES profiles AND THAT IS THE WHOLE POINT. The client's
--   rule, 21-09-2026: "Only those employees who are there in the system can be
--   nominated. If the user is not there, then we need to first create that user
--   inside the system and then that user will be nominated." A free-text nominee
--   would break attendance, the assignment, the per-employee learning hours and
--   KRA 5 all at once, so there is nowhere to put one.
-- ===========================================================================
create table if not exists public.fms_ld_nominations (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.fms_ld_sessions(id) on delete cascade,
  employee_id    uuid not null references public.profiles(id) on delete restrict,
  source         text not null default 'hr' check (source in ('hod','hr','self')),
  status         text not null default 'proposed' check (status in ('proposed','approved','rejected','withdrawn')),
  nominated_by   uuid references auth.users on delete set null,
  nominated_at   timestamptz not null default now(),
  approved_by    uuid references auth.users on delete set null,
  approved_at    timestamptz,
  reject_reason  text,
  invited_at     timestamptz,
  rsvp           text not null default 'pending' check (rsvp in ('pending','accepted','declined')),
  rsvp_at        timestamptz,
  decline_reason text,
  reminder_1_at  timestamptz,
  reminder_2_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (session_id, employee_id),
  -- §4: "decline reason mandatory".
  constraint fms_ld_nominations_decline_has_reason check (
    rsvp <> 'declined' or coalesce(decline_reason, '') <> ''
  )
);
comment on table public.fms_ld_nominations is
  'One nominated person on one session. Nominated by their HOD or by HR; HR/L&D approves either way (the client made that an explicit step). Only real portal users can be nominated — there is deliberately nowhere to type a name.';
create index if not exists fms_ld_nominations_session_idx on public.fms_ld_nominations (session_id, status);
create index if not exists fms_ld_nominations_employee_idx on public.fms_ld_nominations (employee_id);

-- ===========================================================================
-- MATERIAL — step 12.
--
-- ⚠ EDITABLE AND DELETABLE FROM THE FIRST MIGRATION. NR-5 exists in the work
--   list because every HR attachment shipped write-once and the RPCs
--   structurally could not clear a value. Not repeating that here.
-- ===========================================================================
create table if not exists public.fms_ld_materials (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.fms_ld_sessions(id) on delete cascade,
  title        text not null,
  kind         text not null default 'other' check (kind in ('agenda','pre_read','slides','other')),
  file_path    text,
  link_url     text,
  version      integer not null default 1,
  note         text,
  -- Whose material it is, when HR uploaded it for an external trainer who has no
  -- login. Without this the credit is silently lost.
  trainer_id   uuid references public.fms_ld_trainers(id) on delete set null,
  uploaded_by  uuid references auth.users on delete set null,
  uploaded_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists fms_ld_materials_session_idx on public.fms_ld_materials (session_id);

-- ===========================================================================
-- ATTENDANCE — step 14.
-- ===========================================================================
create table if not exists public.fms_ld_attendance (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.fms_ld_sessions(id) on delete cascade,
  employee_id    uuid not null references public.profiles(id) on delete restrict,
  status         text not null check (status in ('present','absent','partial','approved_exception','not_applicable')),
  minutes        integer,
  reason         text,
  marked_by      uuid references auth.users on delete set null,
  marked_at      timestamptz not null default now(),
  -- Weekly form C4: "absentees followed up within 24 hrs". Nothing else in the
  -- hub records this, and it is one column.
  followed_up_at timestamptz,
  followed_up_by uuid references auth.users on delete set null,
  updated_at     timestamptz not null default now(),
  unique (session_id, employee_id)
);
comment on table public.fms_ld_attendance is
  'One attendance mark per nominee per session. `partial` carries minutes, which is what makes per-employee learning hours (C5, SK-3, KRA 5) computable rather than a guess.';
create index if not exists fms_ld_attendance_session_idx on public.fms_ld_attendance (session_id);
create index if not exists fms_ld_attendance_employee_idx on public.fms_ld_attendance (employee_id);

-- ===========================================================================
-- THE ASSIGNMENT — steps 15, 16, 17. No marks, no pass mark: three timestamps
-- and a file, which is exactly what the KPI lines need.
-- ===========================================================================
create table if not exists public.fms_ld_assignments (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.fms_ld_sessions(id) on delete cascade,
  title       text not null,
  brief       text,
  file_path   text,
  issued_by   uuid references auth.users on delete set null,
  issued_at   timestamptz not null default now(),
  due_at      date,
  updated_at  timestamptz not null default now()
);
create index if not exists fms_ld_assignments_session_idx on public.fms_ld_assignments (session_id);

create table if not exists public.fms_ld_assignment_submissions (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null references public.fms_ld_assignments(id) on delete cascade,
  employee_id      uuid not null references public.profiles(id) on delete restrict,
  file_path        text,
  note             text,
  submitted_at     timestamptz,
  reviewed_by      uuid references auth.users on delete set null,
  reviewed_at      timestamptz,
  outcome          text check (outcome in ('accepted','needs_rework')),
  reviewer_remarks text,
  escalated_at     timestamptz,
  updated_at       timestamptz not null default now(),
  unique (assignment_id, employee_id)
);
comment on table public.fms_ld_assignment_submissions is
  'One row per person per assignment. A row with a null submitted_at is somebody who has NOT submitted — which is the thing the client actually asked to track, so the row is created for every attendee up front rather than on submission.';
create index if not exists fms_ld_submissions_assignment_idx on public.fms_ld_assignment_submissions (assignment_id);
create index if not exists fms_ld_submissions_employee_idx on public.fms_ld_assignment_submissions (employee_id);

-- ===========================================================================
-- FEEDBACK — step 18. One response per participant (§4).
-- ===========================================================================
create table if not exists public.fms_ld_feedback (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.fms_ld_sessions(id) on delete cascade,
  employee_id      uuid not null references public.profiles(id) on delete restrict,
  content_rating   smallint check (content_rating between 1 and 5),
  trainer_rating   smallint check (trainer_rating between 1 and 5),
  relevance_rating smallint check (relevance_rating between 1 and 5),
  overall_rating   smallint not null check (overall_rating between 1 and 5),
  comment          text,
  submitted_at     timestamptz not null default now(),
  unique (session_id, employee_id)
);
comment on table public.fms_ld_feedback is
  'Identity is ALWAYS stored — the KPI counts response rate per person and HR has to chase non-responders. Who may READ the name is the question the client answered: HR/L&D and the HR Head always; an INTERNAL trainer on their own sessions; an external trainer never, because they have no login at all.';
create index if not exists fms_ld_feedback_session_idx on public.fms_ld_feedback (session_id);

-- ===========================================================================
-- 30-DAY EFFECTIVENESS — step 20.
--
-- ⚠ ONE ROW PER (SESSION, HOD), NOT PER ATTENDEE. Client decision 21-09-2026:
--   one form per HOD with ONE overall rating for their department, plus a
--   comment. The attendees are LISTED on the form so the HOD knows who they are
--   rating about, but there is no per-person rating and no column for one.
-- ===========================================================================
create table if not exists public.fms_ld_effectiveness (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.fms_ld_sessions(id) on delete cascade,
  hod_id              uuid not null references public.profiles(id) on delete restrict,
  due_on              date not null,
  rating              smallint check (rating between 1 and 5),
  outcome             text check (outcome in ('effective','partially_effective','not_effective','insufficient_evidence')),
  application_observed text,
  evidence            text,
  improvement_area    text,
  followup_required   boolean not null default false,
  followup_action_id  uuid references public.fms_ld_followup_actions(id) on delete restrict,
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (session_id, hod_id)
);
comment on table public.fms_ld_effectiveness is
  'One 30-day review per HOD per session, covering that HOD''s own attendees. Created when attendance closes, due 30 calendar days after the session (Setup → Effectiveness).';
create index if not exists fms_ld_effectiveness_hod_idx on public.fms_ld_effectiveness (hod_id, submitted_at);

-- ---- updated_at triggers ---------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'nominations','materials','attendance','assignments','assignment_submissions','effectiveness'
  ] loop
    execute format('drop trigger if exists trg_fms_ld_%1$s_updated on public.fms_ld_%1$s', t);
    execute format(
      'create trigger trg_fms_ld_%1$s_updated before update on public.fms_ld_%1$s
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ===========================================================================
-- AUTHORIZATION — extended for the session- and participant-scoped steps.
--
-- ⚠ REPLACES fms_ld_can_act/3 FROM MIGRATION 2. The old signature took only a
--   request id, which cannot answer "may this person mark attendance on THIS
--   session". Same name, one more argument, and the three-argument form is kept
--   so nothing that already calls it breaks.
-- ===========================================================================
create or replace function public.fms_ld_can_act_session(
  p_step_key  text,
  p_session_id uuid,
  p_uid       uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_assignee uuid;
  v_trainer  uuid;
begin
  if p_uid is null then return false; end if;
  if public.fms_ld_is_coordinator(p_uid) then return true; end if;

  select assigned_to into v_assignee
    from public.fms_ld_step_assignees
   where session_id = p_session_id and step_key = p_step_key;
  if v_assignee is not null then return v_assignee = p_uid; end if;

  -- An INTERNAL trainer owns their own session's material and conduct. An
  -- external one has no login, so HR does it for them and falls through to the
  -- step-owner check below.
  if p_step_key in ('pre_material','conducted','attendance','assignment_issue') then
    select t.employee_id into v_trainer
      from public.fms_ld_sessions s
      join public.fms_ld_trainers t on t.id = s.trainer_id
     where s.id = p_session_id and t.trainer_type = 'internal';
    if v_trainer is not null and v_trainer = p_uid then return true; end if;
  end if;

  -- Nomination is owed by the HOD of the people being nominated; the step owner
  -- is the fallback for the 19 employees who resolve to no HOD at all.
  if p_step_key = 'nomination' then
    if exists (
      select 1 from public.fms_ld_nominations n
      where n.session_id = p_session_id
        and public.fms_ld_is_hod_of(p_uid, n.employee_id)
    ) then
      return true;
    end if;
    -- Nobody nominated yet: any HOD may open the screen and start.
    if exists (select 1 from public.user_hods h where h.hod_id = p_uid) then
      return true;
    end if;
  end if;

  return public.fms_ld_is_step_owner(p_step_key, p_uid);
end $$;
grant execute on function public.fms_ld_can_act_session(text, uuid, uuid) to authenticated;

-- May p_uid write THIS person's own participant row (RSVP, submission, feedback)?
create or replace function public.fms_ld_is_participant(p_session_id uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_ld_nominations n
    where n.session_id = p_session_id
      and n.employee_id = p_uid
      and n.status = 'approved'
  );
$$;
grant execute on function public.fms_ld_is_participant(uuid, uuid) to authenticated;

-- ===========================================================================
-- RLS
--
-- Reads: a participant sees their own rows and their session; HR, coordinators
-- and admins see everything; a HOD sees their own people.
-- Writes: RPC-only, so every policy below is admin-gated.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'nominations','materials','attendance','assignments','assignment_submissions',
    'feedback','effectiveness'
  ] loop
    execute format('alter table public.fms_ld_%1$s enable row level security', t);
    execute format('drop policy if exists fms_ld_%1$s_write on public.fms_ld_%1$s', t);
    execute format(
      'create policy fms_ld_%1$s_write on public.fms_ld_%1$s
         for all to authenticated
         using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))', t);
  end loop;
end $$;

-- Materials and assignments belong to the session, which everyone can see; the
-- files themselves are in a private bucket and need a signed URL either way.
drop policy if exists fms_ld_materials_select on public.fms_ld_materials;
create policy fms_ld_materials_select on public.fms_ld_materials
  for select to authenticated using (true);
drop policy if exists fms_ld_assignments_select on public.fms_ld_assignments;
create policy fms_ld_assignments_select on public.fms_ld_assignments
  for select to authenticated using (true);

-- Who is nominated to a session is not a secret — the calendar shows the session
-- and a nominee needs to see who else is coming.
drop policy if exists fms_ld_nominations_select on public.fms_ld_nominations;
create policy fms_ld_nominations_select on public.fms_ld_nominations
  for select to authenticated using (true);
drop policy if exists fms_ld_attendance_select on public.fms_ld_attendance;
create policy fms_ld_attendance_select on public.fms_ld_attendance
  for select to authenticated using (true);

-- ⚠ A SUBMISSION IS THE EMPLOYEE'S OWN WORK. Their colleagues have no business
--   reading it; HR, coordinators and the reviewer do.
drop policy if exists fms_ld_assignment_submissions_select on public.fms_ld_assignment_submissions;
create policy fms_ld_assignment_submissions_select on public.fms_ld_assignment_submissions
  for select to authenticated using (
    employee_id = auth.uid()
    or public.fms_ld_is_coordinator(auth.uid())
    or exists (select 1 from public.fms_ld_step_owners o
                where o.step_key in ('assignment_issue','assignment_review','session_review')
                  and auth.uid() = any(o.employee_ids))
    or public.fms_ld_is_hod_of(auth.uid(), employee_id)
  );

-- ⚠ FEEDBACK CARRIES A NAME AND NOT EVERYONE MAY SEE IT (client, 21-09-2026):
--   HR/L&D and the HR Head always; an INTERNAL trainer on their own sessions;
--   an external trainer never — they have no account, so this needs no arm.
--   Everyone can always read their own.
drop policy if exists fms_ld_feedback_select on public.fms_ld_feedback;
create policy fms_ld_feedback_select on public.fms_ld_feedback
  for select to authenticated using (
    employee_id = auth.uid()
    or public.fms_ld_is_coordinator(auth.uid())
    or exists (select 1 from public.fms_ld_step_owners o
                where o.step_key in ('session_review','feedback','hr_head_approval')
                  and auth.uid() = any(o.employee_ids))
    or exists (select 1 from public.fms_ld_sessions s
                join public.fms_ld_trainers t on t.id = s.trainer_id
               where s.id = fms_ld_feedback.session_id
                 and t.trainer_type = 'internal'
                 and t.employee_id = auth.uid())
  );

drop policy if exists fms_ld_effectiveness_select on public.fms_ld_effectiveness;
create policy fms_ld_effectiveness_select on public.fms_ld_effectiveness
  for select to authenticated using (
    hod_id = auth.uid()
    or public.fms_ld_is_coordinator(auth.uid())
    or exists (select 1 from public.fms_ld_step_owners o
                where o.step_key in ('effectiveness','session_review','followup_decision','closure')
                  and auth.uid() = any(o.employee_ids))
  );

-- ===========================================================================
-- RPCs
-- ===========================================================================

-- ---- step 9 · nominate ------------------------------------------------------
create or replace function public.fms_ld_nominate(
  p_session_id uuid,
  p_employee_ids uuid[],
  p_source text default 'hr'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cap integer;
  v_cur integer;
  v_added integer := 0;
  v_auto boolean;
  e uuid;
begin
  if not public.fms_ld_can_act_session('nomination', p_session_id, v_uid) then
    raise exception 'Not authorised to nominate for this session';
  end if;

  select capacity into v_cap from public.fms_ld_sessions where id = p_session_id;
  select count(*) into v_cur from public.fms_ld_nominations
   where session_id = p_session_id and status in ('proposed','approved');

  -- HR's own nominations are approved by the same hand that made them; the row
  -- still records that it happened rather than pretending there was no step.
  v_auto := public.fms_ld_is_step_owner('nomination_approval', v_uid)
            or public.fms_ld_is_coordinator(v_uid);

  foreach e in array p_employee_ids loop
    if e is null then continue; end if;
    if v_cap is not null and v_cur + v_added >= v_cap then
      raise exception 'This session holds % people and is full', v_cap;
    end if;
    insert into public.fms_ld_nominations
      (session_id, employee_id, source, nominated_by, status, approved_by, approved_at)
    values (p_session_id, e, coalesce(p_source,'hr'), v_uid,
            case when v_auto then 'approved' else 'proposed' end,
            case when v_auto then v_uid else null end,
            case when v_auto then now() else null end)
    on conflict (session_id, employee_id) do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;

  update public.fms_ld_sessions
     set status = case when status = 'scheduled' then 'nomination_open' else status end
   where id = p_session_id;

  perform public.fms_ld_announce('session', p_session_id, 'ld_nominated',
    v_added || ' employee(s) nominated',
    case when v_auto then '{}'::uuid[] else public.fms_ld_step_owner_ids('nomination_approval') end);

  return v_added;
end $$;
grant execute on function public.fms_ld_nominate(uuid, uuid[], text) to authenticated;

-- ---- step 10 · approve or reject a nomination -------------------------------
create or replace function public.fms_ld_decide_nomination(
  p_nomination_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid;
  v_emp uuid;
begin
  select session_id, employee_id into v_session, v_emp
    from public.fms_ld_nominations where id = p_nomination_id for update;
  if v_session is null then raise exception 'Nomination not found'; end if;
  if not public.fms_ld_can_act_session('nomination_approval', v_session, v_uid) then
    raise exception 'Not authorised to approve nominations';
  end if;
  if not p_approve and coalesce(p_reason,'') = '' then
    raise exception 'A reason is required to reject a nomination';
  end if;

  update public.fms_ld_nominations
     set status = case when p_approve then 'approved' else 'rejected' end,
         approved_by = v_uid, approved_at = now(),
         reject_reason = case when p_approve then null else p_reason end
   where id = p_nomination_id;

  perform public.fms_ld_announce('session', v_session,
    case when p_approve then 'ld_nomination_approved' else 'ld_nomination_rejected' end,
    case when p_approve then 'Your nomination was approved' else 'Your nomination was not taken forward: ' || p_reason end,
    array[v_emp]);
end $$;
grant execute on function public.fms_ld_decide_nomination(uuid, boolean, text) to authenticated;

-- ---- step 11 · send invitations, and the nominee's RSVP ---------------------
create or replace function public.fms_ld_send_invitations(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
  v_title text;
  v_date date;
  v_ids uuid[];
begin
  /*
   * ⚠ CHECKED AGAINST `nomination_approval`, NOT `invitation`, AND THAT IS NOT A
   *   TYPO. Step 11 is "Invitation & RSVP" and it has TWO actors: HR sends, the
   *   nominee answers. The step key belongs to the NOMINEE — it is in
   *   ROW_OWNED_STEPS, and fms_ld_rsvp below has no admin arm at all, because an
   *   RSVP entered by somebody else is not an RSVP.
   *
   *   So asking "does this person own `invitation`?" is asking HR to own a step
   *   that is by definition each employee's own, and it refused Saloni outright
   *   the first time this ran. Sending belongs to whoever just finalised the
   *   list, which is the nomination approver.
   */
  if not public.fms_ld_can_act_session('nomination_approval', p_session_id, v_uid) then
    raise exception 'Not authorised to send invitations for this session';
  end if;

  select title, session_date into v_title, v_date
    from public.fms_ld_sessions where id = p_session_id;

  update public.fms_ld_nominations
     set invited_at = coalesce(invited_at, now())
   where session_id = p_session_id and status = 'approved';
  get diagnostics v_n = row_count;

  select coalesce(array_agg(employee_id), '{}'::uuid[]) into v_ids
    from public.fms_ld_nominations
   where session_id = p_session_id and status = 'approved';

  update public.fms_ld_sessions
     set status = case when status in ('scheduled','nomination_open') then 'invited' else status end,
         invitations_sent_at = coalesce(invitations_sent_at, now()),
         nominations_closed_at = coalesce(nominations_closed_at, now())
   where id = p_session_id;

  perform public.fms_ld_announce('session', p_session_id, 'ld_invited',
    'You are invited to ' || v_title || ' on ' || to_char(v_date, 'DD Mon YYYY') || '. Please accept or decline.',
    v_ids);

  return v_n;
end $$;
grant execute on function public.fms_ld_send_invitations(uuid) to authenticated;

-- ⚠ ROW-OWNED: the nominee answers for themselves and nobody else. There is no
--   admin arm here on purpose — an RSVP entered by somebody else is not an RSVP.
create or replace function public.fms_ld_rsvp(
  p_session_id uuid,
  p_accept boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  select id into v_id from public.fms_ld_nominations
   where session_id = p_session_id and employee_id = v_uid and status = 'approved'
   for update;
  if v_id is null then raise exception 'You are not on the list for this session'; end if;
  if not p_accept and coalesce(p_reason,'') = '' then
    raise exception 'Please say why you cannot attend';
  end if;

  update public.fms_ld_nominations
     set rsvp = case when p_accept then 'accepted' else 'declined' end,
         rsvp_at = now(),
         decline_reason = case when p_accept then null else p_reason end
   where id = v_id;

  perform public.fms_ld_announce('session', p_session_id, 'ld_rsvp',
    case when p_accept then 'Accepted the invitation' else 'Declined: ' || p_reason end,
    public.fms_ld_step_owner_ids('nomination_approval'));
end $$;
grant execute on function public.fms_ld_rsvp(uuid, boolean, text) to authenticated;

-- ---- step 12 · material ------------------------------------------------------
create or replace function public.fms_ld_add_material(p_session_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_ids uuid[];
begin
  if not public.fms_ld_can_act_session('pre_material', p_session_id, v_uid) then
    raise exception 'Not authorised to add material to this session';
  end if;
  if coalesce(p_payload->>'title','') = '' then raise exception 'A title is required'; end if;

  insert into public.fms_ld_materials (session_id, title, kind, file_path, link_url, note, uploaded_by)
  values (p_session_id, p_payload->>'title', coalesce(p_payload->>'kind','other'),
          p_payload->>'file_path', p_payload->>'link_url', p_payload->>'note', v_uid)
  returning id into v_id;

  select coalesce(array_agg(employee_id), '{}'::uuid[]) into v_ids
    from public.fms_ld_nominations where session_id = p_session_id and status = 'approved';
  perform public.fms_ld_announce('session', p_session_id, 'ld_material_added',
    'Pre-training material is available: ' || (p_payload->>'title'), v_ids);
  return v_id;
end $$;
grant execute on function public.fms_ld_add_material(uuid, jsonb) to authenticated;

create or replace function public.fms_ld_delete_material(p_material_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  select session_id into v_session from public.fms_ld_materials where id = p_material_id;
  if v_session is null then raise exception 'Material not found'; end if;
  if not public.fms_ld_can_act_session('pre_material', v_session, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  delete from public.fms_ld_materials where id = p_material_id;
  perform public.fms_ld_announce('session', v_session, 'ld_material_removed', 'Material removed', '{}'::uuid[]);
end $$;
grant execute on function public.fms_ld_delete_material(uuid) to authenticated;

create or replace function public.fms_ld_confirm_readiness(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fms_ld_can_act_session('pre_material', p_session_id, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  -- §3 step 9: a session cannot become Ready with nothing shared.
  if not exists (select 1 from public.fms_ld_materials where session_id = p_session_id) then
    raise exception 'Add the agenda or the pre-read before marking this ready';
  end if;
  update public.fms_ld_sessions
     set readiness_confirmed_at = now(), readiness_by = auth.uid(),
         status = case when status in ('scheduled','nomination_open','invited') then 'ready' else status end
   where id = p_session_id;
  perform public.fms_ld_announce('session', p_session_id, 'ld_ready', 'Session is ready to run',
    public.fms_ld_step_owner_ids('conducted'));
end $$;
grant execute on function public.fms_ld_confirm_readiness(uuid) to authenticated;

-- ---- step 13 · conduct -------------------------------------------------------
create or replace function public.fms_ld_record_conduct(p_session_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_outcome text := p_payload->>'outcome';
  v_ids uuid[];
begin
  if not public.fms_ld_can_act_session('conducted', p_session_id, v_uid) then
    raise exception 'Not authorised to record this session';
  end if;
  if v_outcome not in ('conducted','partially_conducted','rescheduled','cancelled') then
    raise exception 'Pick what actually happened';
  end if;
  -- §6: a cancellation or a reschedule needs a reason, and the original stays.
  if v_outcome in ('rescheduled','cancelled') and coalesce(p_payload->>'change_reason','') = '' then
    raise exception 'A reason is required to cancel or reschedule';
  end if;

  update public.fms_ld_sessions
     set outcome = v_outcome,
         actual_start = nullif(p_payload->>'actual_start','')::timestamptz,
         actual_end = nullif(p_payload->>'actual_end','')::timestamptz,
         trainer_attended = (p_payload->>'trainer_attended')::boolean,
         change_reason = p_payload->>'change_reason',
         evidence_paths = coalesce(
           (select array_agg(x) from jsonb_array_elements_text(
              coalesce(p_payload->'evidence_paths','[]'::jsonb)) t(x)), evidence_paths),
         status = case v_outcome
                    when 'cancelled' then 'cancelled'
                    when 'rescheduled' then 'rescheduled'
                    else 'conducted' end
   where id = p_session_id;

  select coalesce(array_agg(employee_id), '{}'::uuid[]) into v_ids
    from public.fms_ld_nominations where session_id = p_session_id and status = 'approved';

  if v_outcome in ('cancelled','rescheduled') then
    perform public.fms_ld_announce('session', p_session_id, 'ld_session_' || v_outcome,
      'Session ' || v_outcome || ': ' || (p_payload->>'change_reason'), v_ids);
  else
    perform public.fms_ld_announce('session', p_session_id, 'ld_conducted',
      'Session conducted — attendance to be marked',
      public.fms_ld_step_owner_ids('attendance'));
  end if;
end $$;
grant execute on function public.fms_ld_record_conduct(uuid, jsonb) to authenticated;

-- ---- step 14 · attendance ----------------------------------------------------
-- p_rows: [{employee_id, status, minutes, reason}]
create or replace function public.fms_ld_mark_attendance(p_session_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r jsonb;
  v_n integer := 0;
begin
  if not public.fms_ld_can_act_session('attendance', p_session_id, v_uid) then
    raise exception 'Not authorised to mark attendance';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) loop
    insert into public.fms_ld_attendance
      (session_id, employee_id, status, minutes, reason, marked_by)
    values (p_session_id, (r->>'employee_id')::uuid, r->>'status',
            nullif(r->>'minutes','')::int, r->>'reason', v_uid)
    on conflict (session_id, employee_id) do update
      set status = excluded.status, minutes = excluded.minutes,
          reason = excluded.reason, marked_by = excluded.marked_by, marked_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
grant execute on function public.fms_ld_mark_attendance(uuid, jsonb) to authenticated;

create or replace function public.fms_ld_follow_up_absentee(p_attendance_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  select session_id into v_session from public.fms_ld_attendance where id = p_attendance_id;
  if v_session is null then raise exception 'Attendance row not found'; end if;
  if not public.fms_ld_can_act_session('attendance', v_session, auth.uid()) then
    raise exception 'Not authorised';
  end if;
  update public.fms_ld_attendance
     set followed_up_at = now(), followed_up_by = auth.uid()
   where id = p_attendance_id;
end $$;
grant execute on function public.fms_ld_follow_up_absentee(uuid) to authenticated;

/*
 * Close attendance — and CREATE THE 30-DAY EFFECTIVENESS TASKS.
 *
 * ⚠ THE TWO ARE ONE ACTION on purpose. The client asked for the HOD to be told
 *   as soon as the session is done and then asked again 30 days later; doing it
 *   here means the task cannot be forgotten, and means "attendance closed" and
 *   "reviews outstanding" can never disagree.
 *
 * ⚠ ATTENDEES WHOSE HOD CANNOT BE RESOLVED PRODUCE NO TASK, and the function
 *   returns how many that was so the screen can SAY SO. On 21-09-2026 that is 19
 *   of 67 people. Silently counting the reviews complete would certify a control
 *   that does not exist.
 */
create or replace function public.fms_ld_close_attendance(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_unmarked integer;
  v_days integer;
  v_date date;
  v_hods uuid[];
  v_no_reviewer integer := 0;
  h uuid;
  -- ⚠ NOT `a`. The unmarked-nominee count below aliases fms_ld_attendance as `a`,
  --   and a record variable of the same name SHADOWS the alias — PL/pgSQL then
  --   resolves `a.employee_id` to the not-yet-assigned record and raises
  --   "record \"a\" is not assigned yet" at runtime, not at create time.
  rec record;
begin
  if not public.fms_ld_can_act_session('attendance', p_session_id, v_uid) then
    raise exception 'Not authorised to close attendance';
  end if;

  -- §3 step 11 / §13: closure is blocked until every nominee carries a status.
  select count(*) into v_unmarked
    from public.fms_ld_nominations n
   where n.session_id = p_session_id and n.status = 'approved'
     and not exists (select 1 from public.fms_ld_attendance a
                      where a.session_id = n.session_id and a.employee_id = n.employee_id);
  if v_unmarked > 0 then
    raise exception '% nominee(s) still have no attendance status', v_unmarked;
  end if;

  select coalesce((value->>'days_after_session')::int, 30) into v_days
    from public.fms_ld_config where key = 'effectiveness';
  select session_date into v_date from public.fms_ld_sessions where id = p_session_id;

  update public.fms_ld_sessions
     set attendance_closed_at = now(), status = 'attendance_closed'
   where id = p_session_id;

  -- One task per HOD who owns at least one ATTENDEE (not merely a nominee —
  -- there is nothing to review about somebody who did not come).
  v_hods := '{}';
  for rec in
    select distinct att.employee_id
      from public.fms_ld_attendance att
     where att.session_id = p_session_id
       and att.status in ('present','partial')
  loop
    declare v_h uuid[] := public.fms_ld_hods_of(rec.employee_id);
    begin
      if array_length(v_h, 1) is null then
        v_no_reviewer := v_no_reviewer + 1;
      else
        foreach h in array v_h loop
          if not (h = any(v_hods)) then v_hods := v_hods || h; end if;
        end loop;
      end if;
    end;
  end loop;

  foreach h in array v_hods loop
    insert into public.fms_ld_effectiveness (session_id, hod_id, due_on)
    values (p_session_id, h, (coalesce(v_date, current_date) + v_days))
    on conflict (session_id, hod_id) do nothing;
  end loop;

  -- Told now, asked in 30 days — the client's own wording.
  if array_length(v_hods, 1) is not null then
    perform public.fms_ld_announce('session', p_session_id, 'ld_hod_notified',
      'Your team attended a training. You will be asked about its effect in ' || v_days || ' days.',
      v_hods);
  end if;

  perform public.fms_ld_announce('session', p_session_id, 'ld_attendance_closed',
    'Attendance closed', public.fms_ld_step_owner_ids('assignment_issue'));

  return jsonb_build_object(
    'hod_tasks', coalesce(array_length(v_hods, 1), 0),
    'no_reviewer', v_no_reviewer);
end $$;
grant execute on function public.fms_ld_close_attendance(uuid) to authenticated;

-- ---- steps 15–17 · the assignment -------------------------------------------
create or replace function public.fms_ld_issue_assignment(p_session_id uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_due date;
  v_days integer;
  v_ids uuid[];
begin
  if not public.fms_ld_can_act_session('assignment_issue', p_session_id, v_uid) then
    raise exception 'Not authorised to issue an assignment';
  end if;
  if coalesce(p_payload->>'title','') = '' then raise exception 'A title is required'; end if;

  select coalesce((value->>'assignment_due_days')::int, 7) into v_days
    from public.fms_ld_config where key = 'feedback_assignment';
  v_due := coalesce(nullif(p_payload->>'due_at','')::date, current_date + coalesce(v_days, 7));

  insert into public.fms_ld_assignments (session_id, title, brief, file_path, due_at, issued_by)
  values (p_session_id, p_payload->>'title', p_payload->>'brief', p_payload->>'file_path', v_due, v_uid)
  returning id into v_id;

  -- ⚠ A ROW PER ATTENDEE UP FRONT, submitted_at null. "Who has not submitted" is
  --   the thing the client asked to track, and it is unanswerable if rows only
  --   appear when somebody submits.
  insert into public.fms_ld_assignment_submissions (assignment_id, employee_id)
  select v_id, att.employee_id
    from public.fms_ld_attendance att
   where att.session_id = p_session_id and att.status in ('present','partial')
  on conflict (assignment_id, employee_id) do nothing;

  select coalesce(array_agg(employee_id), '{}'::uuid[]) into v_ids
    from public.fms_ld_assignment_submissions where assignment_id = v_id;
  perform public.fms_ld_announce('session', p_session_id, 'ld_assignment_issued',
    'Assignment "' || (p_payload->>'title') || '" is due ' || to_char(v_due, 'DD Mon YYYY'), v_ids);
  return v_id;
end $$;
grant execute on function public.fms_ld_issue_assignment(uuid, jsonb) to authenticated;

-- ⚠ ROW-OWNED: an employee submits their own work and nobody else's.
create or replace function public.fms_ld_submit_assignment(p_assignment_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_session uuid;
begin
  select s.id, a.session_id into v_id, v_session
    from public.fms_ld_assignment_submissions s
    join public.fms_ld_assignments a on a.id = s.assignment_id
   where s.assignment_id = p_assignment_id and s.employee_id = v_uid
   for update;
  if v_id is null then raise exception 'This assignment is not yours'; end if;

  update public.fms_ld_assignment_submissions
     set file_path = coalesce(p_payload->>'file_path', file_path),
         note = coalesce(p_payload->>'note', note),
         submitted_at = now()
   where id = v_id;

  perform public.fms_ld_announce('session', v_session, 'ld_assignment_submitted',
    'Assignment submitted', public.fms_ld_step_owner_ids('assignment_review'));
end $$;
grant execute on function public.fms_ld_submit_assignment(uuid, jsonb) to authenticated;

create or replace function public.fms_ld_review_submission(
  p_submission_id uuid, p_outcome text, p_remarks text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_emp uuid;
begin
  select a.session_id, s.employee_id into v_session, v_emp
    from public.fms_ld_assignment_submissions s
    join public.fms_ld_assignments a on a.id = s.assignment_id
   where s.id = p_submission_id;
  if v_session is null then raise exception 'Submission not found'; end if;
  if not public.fms_ld_can_act_session('assignment_review', v_session, auth.uid()) then
    raise exception 'Not authorised to review submissions';
  end if;
  if p_outcome not in ('accepted','needs_rework') then raise exception 'Unknown outcome %', p_outcome; end if;
  if p_outcome = 'needs_rework' and coalesce(p_remarks,'') = '' then
    raise exception 'Say what needs reworking';
  end if;

  update public.fms_ld_assignment_submissions
     set outcome = p_outcome, reviewer_remarks = p_remarks,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_submission_id;

  perform public.fms_ld_announce('session', v_session, 'ld_assignment_reviewed',
    case when p_outcome = 'accepted' then 'Your assignment was accepted'
         else 'Your assignment needs rework: ' || p_remarks end,
    array[v_emp]);
end $$;
grant execute on function public.fms_ld_review_submission(uuid, text, text) to authenticated;

create or replace function public.fms_ld_escalate_submission(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_emp uuid; v_hods uuid[];
begin
  select a.session_id, s.employee_id into v_session, v_emp
    from public.fms_ld_assignment_submissions s
    join public.fms_ld_assignments a on a.id = s.assignment_id
   where s.id = p_submission_id;
  if v_session is null then raise exception 'Submission not found'; end if;
  if not public.fms_ld_can_act_session('assignment_review', v_session, auth.uid()) then
    raise exception 'Not authorised';
  end if;

  update public.fms_ld_assignment_submissions set escalated_at = now() where id = p_submission_id;
  v_hods := public.fms_ld_hods_of(v_emp);
  perform public.fms_ld_announce('session', v_session, 'ld_assignment_escalated',
    'A training assignment from your team is still outstanding', v_hods);
end $$;
grant execute on function public.fms_ld_escalate_submission(uuid) to authenticated;

-- ---- step 18 · feedback ------------------------------------------------------
-- ⚠ ROW-OWNED, and one response per participant (§4).
create or replace function public.fms_ld_submit_feedback(p_session_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not public.fms_ld_is_participant(p_session_id, v_uid) then
    raise exception 'Only people who were on this session can give feedback';
  end if;
  if nullif(p_payload->>'overall_rating','') is null then
    raise exception 'An overall rating is required';
  end if;

  insert into public.fms_ld_feedback
    (session_id, employee_id, content_rating, trainer_rating, relevance_rating, overall_rating, comment)
  values (p_session_id, v_uid,
          nullif(p_payload->>'content_rating','')::smallint,
          nullif(p_payload->>'trainer_rating','')::smallint,
          nullif(p_payload->>'relevance_rating','')::smallint,
          (p_payload->>'overall_rating')::smallint,
          p_payload->>'comment')
  on conflict (session_id, employee_id) do update
    set content_rating = excluded.content_rating,
        trainer_rating = excluded.trainer_rating,
        relevance_rating = excluded.relevance_rating,
        overall_rating = excluded.overall_rating,
        comment = excluded.comment,
        submitted_at = now();

  perform public.fms_ld_announce('session', p_session_id, 'ld_feedback_given',
    'Feedback received', public.fms_ld_step_owner_ids('session_review'));
end $$;
grant execute on function public.fms_ld_submit_feedback(uuid, jsonb) to authenticated;

-- ---- step 19 · HR session review --------------------------------------------
create or replace function public.fms_ld_review_session(p_session_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_req uuid;
begin
  if not public.fms_ld_can_act_session('session_review', p_session_id, v_uid) then
    raise exception 'Not authorised to review this session';
  end if;

  update public.fms_ld_sessions
     set review_note = p_payload->>'review_note',
         review_action_points = p_payload->>'action_points',
         actual_cost = nullif(p_payload->>'actual_cost','')::numeric,
         reviewed_by = v_uid, reviewed_at = now(),
         status = 'in_review'
   where id = p_session_id
  returning request_id into v_req;

  if v_req is not null then
    update public.fms_ld_requests
       set actual_cost = coalesce(nullif(p_payload->>'actual_cost','')::numeric, actual_cost)
     where id = v_req;
  end if;

  perform public.fms_ld_announce('session', p_session_id, 'ld_session_reviewed',
    'Session reviewed', public.fms_ld_step_owner_ids('effectiveness'));
end $$;
grant execute on function public.fms_ld_review_session(uuid, jsonb) to authenticated;

-- ---- step 20 · the HOD's 30-day note ----------------------------------------
-- ⚠ ROW-OWNED by the HOD the task was created for.
create or replace function public.fms_ld_submit_effectiveness(p_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_hod uuid; v_session uuid;
begin
  select hod_id, session_id into v_hod, v_session
    from public.fms_ld_effectiveness where id = p_id for update;
  if v_hod is null then raise exception 'Review not found'; end if;
  if v_hod <> v_uid and not public.fms_ld_is_coordinator(v_uid) then
    raise exception 'This review belongs to somebody else';
  end if;
  if nullif(p_payload->>'outcome','') is null then
    raise exception 'Say whether the training worked';
  end if;

  update public.fms_ld_effectiveness
     set rating = nullif(p_payload->>'rating','')::smallint,
         outcome = p_payload->>'outcome',
         application_observed = p_payload->>'application_observed',
         evidence = p_payload->>'evidence',
         improvement_area = p_payload->>'improvement_area',
         followup_required = coalesce((p_payload->>'followup_required')::boolean, false),
         followup_action_id = nullif(p_payload->>'followup_action_id','')::uuid,
         submitted_at = now()
   where id = p_id;

  perform public.fms_ld_announce('session', v_session, 'ld_effectiveness_given',
    'A 30-day effectiveness review was submitted',
    public.fms_ld_step_owner_ids('followup_decision'));
end $$;
grant execute on function public.fms_ld_submit_effectiveness(uuid, jsonb) to authenticated;

-- ---- steps 21–22 · follow-up and closure ------------------------------------
--
-- ⚠ CLOSURE IS BLOCKED WHILE ANYTHING IS OUTSTANDING (§3 step 17, §13), and the
--   error NAMES what is missing. "Closure blocked" with no reason is the kind of
--   message that makes people stop using a module.
create or replace function public.fms_ld_close_request(p_request_id uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_missing text[] := '{}';
  v_n integer;
begin
  select status into v_status from public.fms_ld_requests where id = p_request_id for update;
  if v_status is null then raise exception 'Training request not found'; end if;
  if not public.fms_ld_can_act('closure', p_request_id, v_uid) then
    raise exception 'Not authorised to close training records';
  end if;
  if v_status = 'closed' then raise exception 'This record is already closed'; end if;

  select count(*) into v_n from public.fms_ld_sessions s
   where s.request_id = p_request_id and s.attendance_closed_at is null
     and coalesce(s.outcome,'') not in ('cancelled');
  if v_n > 0 then v_missing := v_missing || (v_n || ' session(s) with attendance not closed'); end if;

  select count(*) into v_n
    from public.fms_ld_effectiveness e
    join public.fms_ld_sessions s on s.id = e.session_id
   where s.request_id = p_request_id and e.submitted_at is null;
  if v_n > 0 then v_missing := v_missing || (v_n || ' effectiveness review(s) outstanding'); end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'Cannot close yet — %', array_to_string(v_missing, '; ');
  end if;

  update public.fms_ld_requests
     set status = 'closed', closed_by = v_uid, closed_at = now(),
         final_outcome = p_payload->>'final_outcome',
         closure_note = p_payload->>'closure_note',
         actual_cost = coalesce(nullif(p_payload->>'actual_cost','')::numeric, actual_cost)
   where id = p_request_id;

  update public.fms_ld_sessions set status = 'closed'
   where request_id = p_request_id and status not in ('cancelled','rescheduled');

  perform public.fms_ld_announce('request', p_request_id, 'ld_closed',
    'Training record closed', '{}'::uuid[]);
end $$;
grant execute on function public.fms_ld_close_request(uuid, jsonb) to authenticated;

-- Reopen — HR Head only, with a reason, audit trail kept (§6).
create or replace function public.fms_ld_reopen_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not (public.is_admin(v_uid) or public.fms_ld_is_step_owner('hr_head_approval', v_uid)) then
    raise exception 'Only the HR Head may reopen a closed training record';
  end if;
  if coalesce(p_reason,'') = '' then raise exception 'A reason is required to reopen'; end if;

  update public.fms_ld_requests
     set status = 'scheduled', reopened_by = v_uid, reopened_at = now(), reopen_reason = p_reason
   where id = p_request_id and status = 'closed';

  perform public.fms_ld_announce('request', p_request_id, 'ld_reopened',
    'Training record reopened: ' || p_reason, public.fms_ld_step_owner_ids('closure'));
end $$;
grant execute on function public.fms_ld_reopen_request(uuid, text) to authenticated;
