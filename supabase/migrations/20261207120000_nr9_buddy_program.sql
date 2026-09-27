-- ===========================================================================
-- NR-9 · The Buddy Program
--
-- As the client described it on 21-09-2026:
--   • offer accepted  → a buddy is allocated within 24 hours, by HR, final
--   • the buddy is CROSS-DEPARTMENTAL — never the joiner's own department
--   • Day 1           → the Buddy Passport is handed over
--   • over 90 days    → at least 8 interactions; the BUDDY logs each one and HR
--                       CONFIRMS it, and only confirmed ones count
--   • at 90 days      → closes with probation. Confirmed → closed. Probation
--                       extended → the buddy programme extends by the same
--                       period. The joiner leaves → closed, "person left", and
--                       excluded from the KPI rather than scored as a miss.
--   • the joiner then rates the experience; the line scores at 4 of 5 or better
--
-- The passport carries NO task list — the client's answer was that the eight
-- interactions ARE the passport — so there is no checklist table here.
--
-- ADDITIVE ONLY: two new tables, three new step keys, and their functions.
-- ===========================================================================

-- 1 ── the programme ---------------------------------------------------------

create table if not exists public.fms_hr_buddies (
  id              uuid primary key default gen_random_uuid(),
  onboarding_id   uuid not null unique references public.fms_hr_onboardings(id) on delete cascade,
  requisition_id  uuid not null references public.fms_hr_requisitions(id) on delete cascade,
  candidate_id    uuid not null references public.fms_hr_candidates(id) on delete cascade,

  buddy_user_id   uuid not null,
  allocated_at    timestamptz not null default now(),
  allocated_by    uuid,
  /** The 24-hour clock runs from here: the offer being ACCEPTED, not the offer being made. */
  offer_accepted_at timestamptz,

  passport_handed_at timestamptz,
  passport_handed_by uuid,
  /** Day 1 = the joining date. Stamped at allocation so the due date is a fact, not a guess. */
  joining_date    date,

  interaction_target integer not null default 8 check (interaction_target between 1 and 50),
  /** Day 90 from joining, in CALENDAR days — the same clock probation runs on. */
  due_on          date,

  status          text not null default 'open'
                    check (status in ('open', 'closed', 'extended', 'person_left')),
  closed_at       timestamptz,
  closed_by       uuid,
  close_note      text,
  /** When probation is extended, this moves with it. */
  extended_to     date,

  -- the joiner's own verdict (1B.5 — scores at 4 of 5 or better)
  feedback_rating   integer check (feedback_rating between 1 and 5),
  feedback_remarks  text,
  feedback_at       timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.fms_hr_buddies is
  'NR-9. One buddy programme per hire. The buddy is a CROSS-DEPARTMENTAL colleague - enforced in fms_hr_allocate_buddy, not merely hidden in the picker. Only HR is scored for this (KPI 1B.1-1B.5); being a buddy carries no KPI line of its own, which is a decision the client took knowingly on 21-09-2026.';

create table if not exists public.fms_hr_buddy_interactions (
  id           uuid primary key default gen_random_uuid(),
  buddy_id     uuid not null references public.fms_hr_buddies(id) on delete cascade,
  happened_on  date not null,
  mode         text not null check (mode in ('in_person', 'call', 'message', 'other')),
  notes        text,

  -- the buddy writes it …
  logged_at    timestamptz not null default now(),
  logged_by    uuid not null,
  -- … and HR confirms it. Only a CONFIRMED interaction counts toward the eight:
  -- HR carries the score, so an unconfirmed log is work owed, not work done.
  confirmed_at timestamptz,
  confirmed_by uuid,

  created_at   timestamptz not null default now()
);

comment on table public.fms_hr_buddy_interactions is
  'NR-9 / KPI 1B.3. The buddy LOGS each meeting and HR CONFIRMS it (client decision, 21-09-2026). Only confirmed rows count toward the eight - an unconfirmed one is outstanding work on HR''s queue, not a completed interaction.';

create index if not exists fms_hr_buddy_interactions_buddy_idx
  on public.fms_hr_buddy_interactions (buddy_id);

-- 2 ── who may see what ------------------------------------------------------
-- ⚠ SECURITY DEFINER predicates, not inline EXISTS. A policy is evaluated AS THE
--   CALLER, so an inline read of fms_hr_buddies would meet that table's own RLS
--   and come back false for the very people it is meant to admit. That exact bug
--   shipped and was caught on the probation check-ins earlier today.

create or replace function public.fms_hr_is_my_buddy_record(p_buddy uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1
      from public.fms_hr_buddies b
      join public.fms_hr_onboardings o on o.id = b.onboarding_id
     where b.id = p_buddy
       and p_uid is not null
       and (b.buddy_user_id = p_uid or o.employee_user_id = p_uid)
  );
$fn$;

revoke all on function public.fms_hr_is_my_buddy_record(uuid, uuid) from public;
grant execute on function public.fms_hr_is_my_buddy_record(uuid, uuid) to authenticated, service_role;

alter table public.fms_hr_buddies enable row level security;
alter table public.fms_hr_buddy_interactions enable row level security;

drop policy if exists fms_hr_buddies_select on public.fms_hr_buddies;
create policy fms_hr_buddies_select on public.fms_hr_buddies for select
  using (
    public.fms_hr_can_read_requisition(requisition_id, auth.uid())
    or public.fms_hr_is_my_buddy_record(id, auth.uid())
  );

drop policy if exists fms_hr_buddies_write_admin on public.fms_hr_buddies;
create policy fms_hr_buddies_write_admin on public.fms_hr_buddies for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists fms_hr_buddy_interactions_select on public.fms_hr_buddy_interactions;
create policy fms_hr_buddy_interactions_select on public.fms_hr_buddy_interactions for select
  using (
    exists (
      select 1 from public.fms_hr_buddies b
       where b.id = fms_hr_buddy_interactions.buddy_id
         and public.fms_hr_can_read_requisition(b.requisition_id, auth.uid())
    )
    or public.fms_hr_is_my_buddy_record(fms_hr_buddy_interactions.buddy_id, auth.uid())
  );

drop policy if exists fms_hr_buddy_interactions_write_admin on public.fms_hr_buddy_interactions;
create policy fms_hr_buddy_interactions_write_admin on public.fms_hr_buddy_interactions for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.fms_hr_buddies to authenticated;
grant select on public.fms_hr_buddy_interactions to authenticated;

-- 3 ── allocating -------------------------------------------------------------

create or replace function public.fms_hr_allocate_buddy(p_onboarding uuid, p_buddy uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_req   uuid;
  v_cand  uuid;
  v_join  date;
  v_accepted timestamptz;
  v_status text;
  v_dept  uuid;
  v_bdept uuid;
  v_id    uuid;
begin
  select o.requisition_id, o.candidate_id, o.joining_date, o.offer_decided_at, o.offer_status
    into v_req, v_cand, v_join, v_accepted, v_status
    from public.fms_hr_onboardings o where o.id = p_onboarding for update;
  if v_req is null then raise exception 'Onboarding not found'; end if;

  if not public.fms_hr_can_act('buddy_allocation', v_req, v_uid) then
    raise exception 'Not authorized to allocate a buddy on this hire';
  end if;
  if v_status <> 'accepted' then
    raise exception 'A buddy is allocated once the offer is accepted (this one is %)', v_status;
  end if;
  if not exists (select 1 from public.profiles where id = p_buddy) then
    raise exception 'That person does not exist';
  end if;

  -- 🔴 THE CROSS-DEPARTMENT RULE, enforced here rather than merely hidden in the
  -- picker. The whole point of a buddy is somebody outside the joiner's own line
  -- of report; a picker that only hides them is a suggestion, not a rule.
  select department_id into v_dept  from public.fms_hr_requisitions where id = v_req;
  select department_id into v_bdept from public.profiles where id = p_buddy;
  if v_dept is not null and v_bdept is not null and v_dept = v_bdept then
    raise exception 'The buddy must be from a different department — that is the point of the programme';
  end if;

  -- Never the joiner themselves, however the accounts were linked.
  if exists (
    select 1 from public.fms_hr_onboardings o
     where o.id = p_onboarding and o.employee_user_id = p_buddy
  ) then
    raise exception 'Somebody cannot be their own buddy';
  end if;

  insert into public.fms_hr_buddies (
    onboarding_id, requisition_id, candidate_id, buddy_user_id, allocated_by,
    offer_accepted_at, joining_date, due_on
  ) values (
    p_onboarding, v_req, v_cand, p_buddy, v_uid,
    v_accepted, v_join, case when v_join is null then null else v_join + 90 end
  )
  on conflict (onboarding_id) do update
     set buddy_user_id = excluded.buddy_user_id,
         allocated_at  = now(),
         allocated_by  = v_uid,
         updated_at    = now()
  returning id into v_id;

  -- The buddy is told, because nobody has volunteered for this.
  insert into public.fms_hr_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  select p_buddy, 'buddy_allocated', 'buddy', v_id,
         'You are the buddy for ' || coalesce(c.name, 'a new joiner')
           || ' — they join ' || coalesce(to_char(v_join, 'DD-MM-YYYY'), 'shortly'),
         v_uid
    from public.fms_hr_candidates c where c.id = v_cand;

  return v_id;
end
$fn$;

grant execute on function public.fms_hr_allocate_buddy(uuid, uuid) to authenticated;

-- 4 ── handing the passport over ---------------------------------------------

create or replace function public.fms_hr_hand_passport(p_buddy uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid(); v_req uuid; v_done timestamptz;
begin
  select requisition_id, passport_handed_at into v_req, v_done
    from public.fms_hr_buddies where id = p_buddy for update;
  if v_req is null then raise exception 'Buddy programme not found'; end if;
  if v_done is not null then raise exception 'The passport has already been handed over'; end if;
  if not public.fms_hr_can_act('buddy_passport', v_req, v_uid) then
    raise exception 'Not authorized to hand over the passport on this hire';
  end if;

  update public.fms_hr_buddies
     set passport_handed_at = now(), passport_handed_by = v_uid, updated_at = now()
   where id = p_buddy;
end
$fn$;

grant execute on function public.fms_hr_hand_passport(uuid) to authenticated;

-- 5 ── logging an interaction (the buddy) and confirming it (HR) --------------

create or replace function public.fms_hr_log_buddy_interaction(
  p_buddy uuid, p_on date, p_mode text, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_who uuid; v_status text; v_join date; v_id uuid; v_req uuid;
begin
  select buddy_user_id, status, joining_date, requisition_id
    into v_who, v_status, v_join, v_req
    from public.fms_hr_buddies where id = p_buddy for update;
  if v_who is null then raise exception 'Buddy programme not found'; end if;
  if v_status <> 'open' then raise exception 'This buddy programme is % — no further interactions', v_status; end if;

  -- The buddy writes their own. HR confirms; HR does not author.
  if v_uid is distinct from v_who then
    raise exception 'Only the buddy can log their own interactions';
  end if;
  if p_mode not in ('in_person', 'call', 'message', 'other') then
    raise exception 'Unknown kind of interaction %', p_mode;
  end if;
  if p_on > ((now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'An interaction cannot be logged for a future date';
  end if;
  if v_join is not null and p_on < v_join then
    raise exception 'That is before they joined (%)', to_char(v_join, 'DD-MM-YYYY');
  end if;

  insert into public.fms_hr_buddy_interactions (buddy_id, happened_on, mode, notes, logged_by)
  values (p_buddy, p_on, p_mode, nullif(trim(p_notes), ''), v_uid)
  returning id into v_id;

  -- HR is told there is something to confirm: the count they are scored on does
  -- not move until they do.
  insert into public.fms_hr_notifications (user_id, type, entity_type, entity_id, text, actor_id)
  select u, 'buddy_interaction_logged', 'buddy', p_buddy,
         'A buddy interaction is waiting to be confirmed', v_uid
    from unnest(coalesce(public.fms_hr_step_owner_ids('buddy_allocation'), '{}'::uuid[])) u
   where u is not null and u <> v_uid;

  return v_id;
end
$fn$;

grant execute on function public.fms_hr_log_buddy_interaction(uuid, date, text, text) to authenticated;

create or replace function public.fms_hr_confirm_buddy_interaction(p_interaction uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid(); v_req uuid; v_done timestamptz;
begin
  select b.requisition_id, i.confirmed_at into v_req, v_done
    from public.fms_hr_buddy_interactions i
    join public.fms_hr_buddies b on b.id = i.buddy_id
   where i.id = p_interaction for update;
  if v_req is null then raise exception 'Interaction not found'; end if;
  if v_done is not null then raise exception 'That interaction is already confirmed'; end if;

  if not public.fms_hr_can_act('buddy_allocation', v_req, v_uid) then
    raise exception 'Only HR can confirm a buddy interaction';
  end if;

  update public.fms_hr_buddy_interactions
     set confirmed_at = now(), confirmed_by = v_uid where id = p_interaction;
end
$fn$;

grant execute on function public.fms_hr_confirm_buddy_interaction(uuid) to authenticated;

-- 6 ── the joiner's rating ----------------------------------------------------

create or replace function public.fms_hr_rate_buddy(p_buddy uuid, p_rating integer, p_remarks text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid(); v_joiner uuid;
begin
  select o.employee_user_id into v_joiner
    from public.fms_hr_buddies b
    join public.fms_hr_onboardings o on o.id = b.onboarding_id
   where b.id = p_buddy;
  if v_joiner is null then
    raise exception 'No Orange One account is linked to this hire yet — HR links it during onboarding';
  end if;
  -- Their experience, in their own hand. Nobody rates their own buddy programme
  -- on their behalf, an admin included.
  if v_uid is distinct from v_joiner then
    raise exception 'Only the new joiner can rate their own buddy programme';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'The rating is 1 to 5';
  end if;

  update public.fms_hr_buddies
     set feedback_rating = p_rating,
         feedback_remarks = nullif(trim(p_remarks), ''),
         feedback_at = now(),
         updated_at = now()
   where id = p_buddy;
end
$fn$;

grant execute on function public.fms_hr_rate_buddy(uuid, integer, text) to authenticated;

-- 7 ── closing ----------------------------------------------------------------

create or replace function public.fms_hr_close_buddy(p_buddy uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_uid uuid := auth.uid(); v_req uuid; v_status text; v_done integer; v_target integer;
begin
  select requisition_id, status, interaction_target into v_req, v_status, v_target
    from public.fms_hr_buddies where id = p_buddy for update;
  if v_req is null then raise exception 'Buddy programme not found'; end if;
  if v_status <> 'open' then raise exception 'This programme is already %', v_status; end if;
  if p_status not in ('closed', 'person_left') then
    raise exception 'A buddy programme closes as closed or person_left (got %)', p_status;
  end if;
  if not public.fms_hr_can_act('buddy_close', v_req, v_uid) then
    raise exception 'Only HR can close a buddy programme';
  end if;

  -- Closing it properly means the interactions actually happened. "person_left"
  -- is the honest exit and is deliberately NOT held to the count.
  if p_status = 'closed' then
    select count(*) into v_done
      from public.fms_hr_buddy_interactions
     where buddy_id = p_buddy and confirmed_at is not null;
    if v_done < v_target then
      raise exception 'Only % of % interactions are confirmed — close it as "person left", or confirm the rest',
        v_done, v_target;
    end if;
  end if;

  update public.fms_hr_buddies
     set status = p_status, closed_at = now(), closed_by = v_uid,
         close_note = nullif(trim(p_note), ''), updated_at = now()
   where id = p_buddy;
end
$fn$;

grant execute on function public.fms_hr_close_buddy(uuid, text, text) to authenticated;

-- 8 ── extending probation extends the buddy programme ------------------------
-- The client's rule: the two clocks move together. Kept as its own function and
-- called from the probation decision, so neither can be changed without the
-- other being visible.

create or replace function public.fms_hr_extend_buddy_for_probation(p_onboarding uuid, p_months integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  update public.fms_hr_buddies
     set status = 'extended',
         extended_to = coalesce(due_on, joining_date + 90) + (p_months * 30),
         updated_at = now()
   where onboarding_id = p_onboarding and status = 'open';
end
$fn$;

revoke all on function public.fms_hr_extend_buddy_for_probation(uuid, integer) from public;
grant execute on function public.fms_hr_extend_buddy_for_probation(uuid, integer) to service_role;

-- 9 ── the three steps are HR's, and are owned by whoever owns onboarding ------
-- ⚠ Without these rows `fms_hr_can_act` falls through to `fms_hr_is_step_owner`,
--   which finds nobody, and every one of the RPCs above refuses everyone except
--   an admin. A step with no owner is not "open to all" in this module - it is
--   closed to all.

insert into public.fms_hr_step_owners (step_key, department_ids, designation_id, employee_ids)
select k, o.department_ids, o.designation_id, o.employee_ids
  from unnest(array['buddy_allocation', 'buddy_passport', 'buddy_close']) as k
  cross join (select * from public.fms_hr_step_owners where step_key = 'onboarding') o
 where not exists (select 1 from public.fms_hr_step_owners x where x.step_key = k);
