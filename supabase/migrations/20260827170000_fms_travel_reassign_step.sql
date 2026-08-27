-- ===========================================================================
-- Travel Desk — a step owner may HAND A STEP to someone else.
--
-- Sixth module. It follows HR Recruitment's (entity, step) TABLE shape, and it
-- differs from every module so far in four ways that matter.
--
-- ⚠ DIFFERENCE 1 — THE APPROVER IS A WRITE-ONCE PER-TRIP SNAPSHOT, AND THIS
--   MIGRATION MUST NOT TOUCH IT.
-- manager_approval and claim_review route to fms_travel_trips.approver_manager_ids,
-- which 20261005120700_add_fms_travel_trips.sql exists to freeze: the snapshot is
-- taken when the trip is raised so that "a re-org must not silently re-route a
-- trip somebody is already waiting on". The obvious implementation of this
-- feature — overwrite approver_manager_ids — would destroy exactly that
-- guarantee, because the column would no longer say who the trip was raised
-- against. So the assignee lives in its OWN table and the snapshot is left
-- untouched. Do not "simplify" this later by writing to that column.
--
-- ⚠ DIFFERENCE 2 — NOBODY OUTSIDE THE ADMINS CAN USE THIS MODULE AT ALL TODAY.
-- fms_travel_can_act opens with `if not module_can_edit(p_uid,'travel-desk')
-- then return false`, ahead of everything — and there are ZERO rows in app_access
-- for travel-desk at level 'edit'. So every non-admin, including the trips'
-- snapshot approvers, is refused before any ownership rule is even consulted.
-- The module is built but not rolled out. Reassignment is therefore correct here
-- and inert until access is granted; the Setup warning about a receiver's module
-- level will fire for every candidate, which is right.
--
--   (An earlier draft of this header claimed the module gate blocks ADMINS too,
--    because it sits above the coordinator arm. The authorisation test disproved
--    it: `module_level` returns 'edit' for any admin unconditionally, so admins
--    pass the gate everywhere. The claim is removed rather than quietly fixed,
--    because it is the sort of thing someone would otherwise re-derive.)
--
-- ⚠ DIFFERENCE 3 — THE READ GATE IS AN INLINE RLS POLICY, NOT A HELPER FUNCTION.
-- Every other module put its read rule in fms_<mod>_can_read_*, which this
-- migration could create-or-replace. Travel's lives in the body of
-- fms_travel_trips_select. Admitting the assignee therefore means ALTER POLICY,
-- reproducing the whole expression with one arm added. It is the same trap as
-- everywhere else — the module arm is module_is_viewer, which is
-- `module_level(...) = 'view'` EXACTLY, so a receiver holding an *edit* grant who
-- is not the traveller, the raiser or a snapshot approver matches nothing and the
-- trip does not load.
--
-- ⚠ DIFFERENCE 4 — HALF THE MODULE HAS NO OWNER AT ALL, AND THIS DOES NOT FIX IT.
-- fms_travel_step_owners holds ZERO rows, so fms_travel_is_step_owner never
-- matches anyone and the director / advance / finance / booking steps are
-- reachable only by a coordinator. Six of the twenty-two live trips also have an
-- EMPTY approver_manager_ids, so even manager_approval has nobody on them.
-- Reassignment cannot help either case — there is nobody to reassign FROM, and a
-- coordinator can already act. Both need the business to name people; filed as
-- PF-14 in WORKLIST.md. What this migration does fix is the sixteen trips that DO
-- have a snapshot approver, where that approver is currently the only non-
-- coordinator who can decide.
--
-- ADDITIVE: one new table, three new functions, one create-or-replace keeping its
-- EXACT argument list, and one ALTER POLICY that only ADDS an arm.
--
-- NO SERVER-SIDE ANNOUNCE. The store raises it client-side.
--
-- VERIFIED ON LIVE DATA 2026-08-27 inside a rolled-back transaction: 19 cases,
-- 19 passed, on TRV-DEMO-01 (the travel-desk edit grants needed to exercise the
-- rules at all were made inside that transaction and rolled back with it; the
-- final SELECT re-checks that nobody has one). The two that matter most:
--   * approver_manager_ids is UNTOUCHED by a reassignment and still names the
--     ORIGINAL approver — the write-once snapshot survives, which is the whole
--     constraint this design exists to respect.
--   * A hand-back therefore returns the step to that original approver, read
--     straight off the untouched column.
--
-- REVERSAL — REHEARSED ON LIVE DATA 2026-08-27, 8 of 8, including the part that
-- is unique to this module: reverting the RLS POLICY with ALTER POLICY and then
-- confirming pg_policies no longer mentions the assignee table. It also confirmed
-- the ordering: dropping fms_travel_is_natural_step_owner first breaks the whole
-- gate, not just reassign, so the body goes back FIRST.
--
-- REVERSAL:
--   1. re-run the fms_travel_can_act body from its previous defining migration.
--      FIRST, as in HR — the new body calls fms_travel_is_natural_step_owner.
--   2. alter policy fms_travel_trips_select ... — drop the assignee arm (the
--      previous expression is in this file's section 5, commented).
--   3. drop function public.fms_travel_reassign_step(uuid, text, uuid, text);
--      drop function public.fms_travel_is_natural_step_owner(text, uuid, uuid);
--      drop function public.fms_travel_can_receive_reassignment(uuid);
--   4. delete from public.fms_travel_config where key = 'reassign_pool';
--   5. drop table public.fms_travel_step_assignees;
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Who holds which step of which trip.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_travel_step_assignees (
  trip_id     uuid not null references public.fms_travel_trips(id) on delete cascade,
  step_key    text not null,
  assigned_to uuid not null references auth.users on delete cascade,
  assigned_by uuid references auth.users on delete set null,
  assigned_at timestamptz not null default now(),
  note        text,
  primary key (trip_id, step_key)
);

comment on table public.fms_travel_step_assignees is
  'Who is currently holding one STEP of one trip. Deliberately SEPARATE from fms_travel_trips.approver_manager_ids, which is a write-once snapshot taken when the trip was raised and must keep saying who the trip was raised against (20261005120700). A row here REPLACES the natural owner for that step without disturbing the snapshot; it is deleted, not nulled, on a hand-back.';

alter table public.fms_travel_step_assignees enable row level security;

-- ⚠⚠ THIS POLICY MUST NOT CONSULT fms_travel_trips, AND THE FIRST DRAFT DID.
--   It read `exists (select 1 from fms_travel_trips t where t.id = trip_id)`, and
--   section 5 below adds an arm to the TRIPS policy that reads THIS table — so
--   the two referenced each other and Postgres refused BOTH with
--   "infinite recursion detected in policy for relation fms_travel_trips".
--   That is not a degraded feature, it is the whole module down: the screen read
--   "Travel Desk could not be loaded" and nothing was readable. Caught in the
--   browser, not by tsc, not by the SQL tests (which run as `postgres`, for whom
--   RLS is not enforced at all — worth remembering, because it means an
--   authorisation suite that passes says nothing about policy recursion).
--
--   It does not need the trips table. This one holds only (trip, step, user)
--   triples — no trip detail, no amounts, nothing a person could not infer from
--   being told a step was passed to them — and the trips policy still governs
--   which TRIPS anyone can see.
create policy fms_travel_step_assignees_select on public.fms_travel_step_assignees
  for select using (auth.uid() is not null);

create policy fms_travel_step_assignees_write on public.fms_travel_step_assignees
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.fms_travel_step_assignees to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Who may RECEIVE a reassignment.
--
-- ⚠ AUTHORIZATION COMES SOLELY FROM user_ids. department_ids is a Setup picker
--   filter and grants nothing.
-- ---------------------------------------------------------------------------
create or replace function public.fms_travel_can_receive_reassignment(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_travel_config c
     where c.key = 'reassign_pool'
       and p_uid::text in (
         select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
       )
  );
$$;

comment on function public.fms_travel_can_receive_reassignment(uuid) is
  'Is this user on the configured list of people who may be handed a Travel Desk step? Reads ONLY fms_travel_config.reassign_pool -> user_ids; department_ids in that same row is a Setup picker filter and grants nothing.';

grant execute on function public.fms_travel_can_receive_reassignment(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Who owns a step when nobody is holding it.
--
-- The pre-existing rule lifted out of fms_travel_can_act, with BOTH the module
-- gate and the coordinator arm left behind — those are authority, not ownership,
-- and the reassign RPC needs ownership specifically so the snapshot approver can
-- take a step back after passing it on.
--
-- The trailing `request` arm is kept verbatim: when nobody is configured to own
-- `request`, everybody owns it, which is how a trip can be raised at all today.
-- ---------------------------------------------------------------------------
create or replace function public.fms_travel_is_natural_step_owner(p_step_key text, p_trip uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_approvers uuid[];
begin
  if p_uid is null then return false; end if;

  if p_step_key in ('manager_approval', 'claim_review') and p_trip is not null then
    select approver_manager_ids into v_approvers
      from public.fms_travel_trips where id = p_trip;
    if v_approvers is not null and p_uid = any(v_approvers) then
      return true;
    end if;
  end if;

  if p_step_key = 'claim' and p_trip is not null then
    if exists (select 1 from public.fms_travel_trips t
                where t.id = p_trip and t.traveller_id = p_uid) then
      return true;
    end if;
  end if;

  if public.fms_travel_is_step_owner(p_step_key, p_uid) then return true; end if;

  return p_step_key = 'request'
     and not exists (select 1 from public.fms_travel_step_owners o
                      where o.step_key = 'request' and array_length(o.employee_ids, 1) > 0);
end $$;

comment on function public.fms_travel_is_natural_step_owner(text, uuid, uuid) is
  'Who owns this step of this trip when nobody has been assigned it - the trip''s snapshot approvers for manager_approval/claim_review, the traveller for claim, otherwise the configured step owners (currently NONE are configured). Excludes the module gate and the coordinator arm: those are authority, not ownership.';

grant execute on function public.fms_travel_is_natural_step_owner(text, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. can_act — the assignee rule.
--
--    Deltas, and only these: an assignee check immediately after the coordinator
--    arm, and the rest delegated to the helper above. The module gate stays
--    exactly where it was, at the very top, ahead of everything.
--
--    ⚠ The assignee REPLACES the natural owner rather than joining them, and it
--      sits ABOVE the manager/claim/step-owner arms so it replaces ALL of them.
--      An OR would be a SHARE: the step would stay in the snapshot approver's
--      queue too and nothing would have moved.
--
--    Signature unchanged. There is no __ungated twin in this module.
-- ---------------------------------------------------------------------------
create or replace function public.fms_travel_can_act(p_step_key text, p_trip uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_assignee uuid;
begin
  if p_uid is null then return false; end if;
  if not public.module_can_edit(p_uid, 'travel-desk') then return false; end if;
  if public.fms_travel_is_coordinator(p_uid) then return true; end if;

  if p_trip is not null then
    select assigned_to into v_assignee
      from public.fms_travel_step_assignees
     where trip_id = p_trip and step_key = p_step_key;
    if v_assignee is not null then
      return v_assignee = p_uid;
    end if;
  end if;

  return public.fms_travel_is_natural_step_owner(p_step_key, p_trip, p_uid);
end $$;


-- ---------------------------------------------------------------------------
-- 5. The trips read policy — admit the assignee.
--
--    ⚠ WITHOUT THIS THE FEATURE IS A DEAD END. The module arm below is
--      module_is_viewer, i.e. `module_level(...) = 'view'` EXACTLY, so a receiver
--      holding an *edit* grant who is not the traveller, the raiser or a snapshot
--      approver matches nothing and the trip does not load.
--
--    ONE arm added. The previous expression was identical minus the
--    fms_travel_step_assignees exists() clause — that is the reversal.
-- ---------------------------------------------------------------------------
alter policy fms_travel_trips_select on public.fms_travel_trips
  using (
    auth.uid() is not null
    and (status is distinct from 'draft' or raised_by = auth.uid() or public.is_admin(auth.uid()))
    and (
      public.is_admin(auth.uid())
      or public.fms_travel_is_coordinator(auth.uid())
      or raised_by = auth.uid()
      or traveller_id = auth.uid()
      or auth.uid() = any(approver_manager_ids)
      or public.module_is_viewer(auth.uid(), 'travel-desk')
      or exists (select 1 from public.fms_travel_step_owners o
                  where auth.uid() = any(o.employee_ids))
      or exists (select 1 from public.fms_travel_step_assignees a
                  where a.trip_id = id and a.assigned_to = auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- 6. Reassign a step (or take it back).
--
-- p_assignee NULL = return it to whoever naturally owns the step — for
-- manager_approval that is the trip's ORIGINAL snapshot approvers, untouched and
-- still on the row, which is the whole reason the snapshot was left alone.
--
-- WHO MAY CALL IT is broader than who may act: the natural owner keeps the right
-- to pull a step back. The module gate is applied to the caller here too, exactly
-- as fms_travel_can_act does, so this RPC cannot be a way around it.
-- ---------------------------------------------------------------------------
create or replace function public.fms_travel_reassign_step(
  p_trip     uuid,
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
  v_uid      uuid := auth.uid();
  v_status   text;
  v_assignee uuid;
begin
  if not public.module_can_edit(v_uid, 'travel-desk') then
    raise exception 'Not authorized to reassign this step';
  end if;

  select status into v_status from public.fms_travel_trips where id = p_trip for update;
  if v_status is null then raise exception 'Trip not found'; end if;
  if v_status in ('draft', 'cancelled', 'closed', 'rejected') then
    raise exception 'This trip is % — its steps can no longer be reassigned', v_status;
  end if;

  select assigned_to into v_assignee from public.fms_travel_step_assignees
   where trip_id = p_trip and step_key = p_step_key;

  if not (public.fms_travel_is_coordinator(v_uid)
          or (v_assignee is not null and v_assignee = v_uid)
          or public.fms_travel_is_natural_step_owner(p_step_key, p_trip, v_uid)) then
    raise exception 'Not authorized to reassign this step';
  end if;

  if p_assignee is null then
    delete from public.fms_travel_step_assignees
     where trip_id = p_trip and step_key = p_step_key;
    return;
  end if;

  if p_assignee = v_uid then
    raise exception 'Pick someone else — a step cannot be reassigned to yourself';
  end if;

  if not (public.fms_travel_can_receive_reassignment(p_assignee)
          or public.fms_travel_is_natural_step_owner(p_step_key, p_trip, p_assignee)) then
    raise exception 'That person may not receive a step. Add them in Setup, under Reassignment, first.';
  end if;

  insert into public.fms_travel_step_assignees (trip_id, step_key, assigned_to, assigned_by, note)
  values (p_trip, p_step_key, p_assignee, v_uid, nullif(btrim(p_note), ''))
  on conflict (trip_id, step_key) do update
    set assigned_to = excluded.assigned_to,
        assigned_by = excluded.assigned_by,
        assigned_at = now(),
        note        = excluded.note;
end $$;

comment on function public.fms_travel_reassign_step(uuid, text, uuid, text) is
  'Reassign ONE step of ONE trip to another person, or pass NULL to return it to its natural owner. Never writes fms_travel_trips.approver_manager_ids - that snapshot is write-once by design. Callable by a coordinator, the step''s natural owner, or the current assignee, and only by someone with travel-desk edit access. Does not announce - the store raises the notification client-side.';

grant execute on function public.fms_travel_reassign_step(uuid, text, uuid, text) to authenticated;

commit;
