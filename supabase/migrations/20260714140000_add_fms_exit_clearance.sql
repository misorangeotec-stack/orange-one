-- ===========================================================================
-- HR EXIT / EMPLOYEE SEPARATION FMS — THE LAST WORKING DAY + THE DEPARTMENTAL
-- CLEARANCE CHECKLIST (Phase 3, M3).
--
-- Table:
--   fms_exit_clearance_checks — the materialised per-case checklist, SNAPSHOTTED
--                               from fms_exit_clearance_items at seed time
--
-- Widened (create or replace — the ONLY two existing objects this migration
-- touches, and both only WIDEN access to people who already owe work):
--   fms_exit_can_read_case  + "…or you own a clearance row on this case"
--   fms_exit_can_act        + the `clearance` branch
--
-- RPCs:
--   fms_exit_confirm_lwd            — finalise the LWD; SEED the checklist
--   fms_exit_can_tick_clearance     — may this user work THIS row?
--   fms_exit_toggle_clearance_check — tick / untick, with evidence
--   fms_exit_set_clearance_na       — "not applicable", with a reason
--   fms_exit_try_complete_clearance — stamps clearance_completed_at. THE DB'S CALL.
--
-- Column added (additive, nullable): fms_exit_cases.lwd_confirmed_at
--
-- ---------------------------------------------------------------------------
-- ⚠ SNAPSHOT, DO NOT JOIN.
--
--   Every field a row needs to be worked — name, department, description, owners,
--   requires_file, allows_link, due_days, sort_order, satisfied_by_step — is COPIED
--   from the master at seed time. Renaming "Travel advance settlement", moving it to
--   a different owner or deactivating it next quarter MUST NOT rewrite what last
--   quarter's leaver was actually asked for. item_id keeps the provenance link and is
--   `on delete set null`, so deleting a master row does not erase history.
--   (The shape is fms_hr_onboarding_checks'; the lesson is the same.)
-- ---------------------------------------------------------------------------
-- ⚠ THE DUE DATE IS COMPUTED IN TS, NOT STORED.
--
--   due_days is a SIGNED working-day offset from the LWD, and NEGATIVE IS THE
--   NORMAL CASE (you cannot chase a laptop after the person has walked out). The
--   date itself is derived — `addWorkingDaysSigned(lwd, due_days)` in
--   lib/queues.ts::checkDueIso — which is precisely why RE-CONFIRMING A CHANGED LWD
--   MOVES EVERY DEADLINE AND TOUCHES NO ITEM: there is nothing stored to rewrite.
--
--   It must never pass through resolveStepSla(), which rejects a negative `days`
--   and SILENTLY SUBSTITUTES the step's default.
-- ---------------------------------------------------------------------------
-- ⚠ PHASE 4 WILL `create or replace` fms_exit_confirm_lwd TO ALSO SEED
--   fms_exit_assets FROM THE ACTIVE fms_exit_asset_types. Same idempotent
--   `if count = 0` shape, in the same transaction as the checklist seed.
-- ---------------------------------------------------------------------------
--
-- Purely ADDITIVE. Reverses (in order):
--   drop policy "fms exit docs clearance owner insert" on storage.objects;
--   drop policy "fms exit docs clearance owner read"   on storage.objects;
--   drop function if exists public.fms_exit_set_clearance_na(uuid,text);
--   drop function if exists public.fms_exit_toggle_clearance_check(uuid,boolean,text,text,text,text);
--   drop function if exists public.fms_exit_try_complete_clearance(uuid);
--   drop function if exists public.fms_exit_can_tick_clearance(uuid,uuid);
--   drop function if exists public.fms_exit_confirm_lwd(uuid,date);
--   drop table if exists public.fms_exit_clearance_checks;
--   alter table public.fms_exit_cases drop column if exists lwd_confirmed_at;
--   -- then restore fms_exit_can_read_case / fms_exit_can_act from 20260714130000.
-- ===========================================================================

-- WHEN the last working day was pinned down (as opposed to WHAT it is). The date
-- is the domain event; this is the audit fact — and they are not the same thing,
-- because the date can be re-confirmed.
alter table public.fms_exit_cases
  add column if not exists lwd_confirmed_at timestamptz;

-- ===========================================================================
-- fms_exit_clearance_checks — one row per checklist item per case.
-- ===========================================================================
create table if not exists public.fms_exit_clearance_checks (
  id                          uuid primary key default gen_random_uuid(),
  case_id                     uuid not null references public.fms_exit_cases on delete cascade,
  -- Provenance only. NEVER joined to read the item's fields — see the header.
  item_id                     uuid references public.fms_exit_clearance_items on delete set null,
  item_key                    text not null,

  -- ---- the SNAPSHOT of the master row, as it stood when the LWD was confirmed ----
  name                        text not null,
  department_label            text not null,   -- the group-by dimension on ClearancePanel
  description                 text,
  owner_ids                   uuid[] not null default '{}',   -- empty → the `clearance` step's owners
  owner_is_reporting_manager  boolean not null default false, -- routes per-case, like a MANAGER step
  requires_file               boolean not null default false,
  allows_link                 boolean not null default false,
  due_days                    integer not null default 0,     -- SIGNED, from the LWD. Negative = before it.
  sort_order                  integer not null default 0,
  satisfied_by_step           text,                           -- 'asset_return' | 'handover' → auto-ticked in M4

  -- ---- the work ----
  done                        boolean not null default false,
  done_at                     timestamptz,                    -- stamped SERVER-SIDE. Nobody types a completion date.
  done_by                     uuid references auth.users on delete set null,
  -- The sheet's "Training material (IF APPLICABLE)". A row that does not apply is
  -- SETTLED, not outstanding: it leaves the queue and satisfies the completion test,
  -- exactly like a skipped step does — but it must say why.
  not_applicable              boolean not null default false,
  na_reason                   text,

  file_path                   text,
  file_name                   text,
  link_url                    text,
  -- The sheet's "Reason (If Pending)": why this is STILL not done.
  pending_reason              text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (case_id, item_key)
);

comment on table public.fms_exit_clearance_checks is
  'One clearance row per case, SNAPSHOTTED from the ACTIVE fms_exit_clearance_items when the last working day was confirmed. Its owner may own no workflow step at all (IT, Admin, the Travel Desk) — which is why each outstanding row is its own queue entry and why fms_exit_can_read_case has a clause for it.';

create index if not exists fms_exit_clearance_checks_case_idx  on public.fms_exit_clearance_checks (case_id);
create index if not exists fms_exit_clearance_checks_owner_idx on public.fms_exit_clearance_checks using gin (owner_ids);

drop trigger if exists trg_fms_exit_clearance_checks_updated on public.fms_exit_clearance_checks;
create trigger trg_fms_exit_clearance_checks_updated
  before update on public.fms_exit_clearance_checks
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- ⚠⚠ THE CLAUSE M2 COULD NOT WRITE ⚠⚠
--
-- The IT person, the Admin and the Travel Desk own NO WORKFLOW STEP AT ALL. They
-- own a CLEARANCE ROW. Every other clause of this gate is false for them, so
-- WITHOUT THIS THEY CANNOT OPEN THE VERY CASE THEY OWE WORK ON — the case list is
-- empty, the detail page 404s, and the row they are being chased for is invisible.
--
-- It could not live in 20260714130000: a function body referencing
-- fms_exit_clearance_checks fails at CREATE while the table does not exist.
--
-- This is ALSO precisely why the exit interview (M5) and the settlement (M6) are
-- separate tables with their own narrow gates: this clause hands the clearance crowd
-- the case HEADER, and the header is deliberately free of salary, F&F and interview
-- content. Widen this gate; never widen the header.
--
-- No RLS recursion: SECURITY DEFINER runs as the table owner, for whom RLS is not
-- enforced — the same reason the existing clause may read fms_exit_cases from inside
-- the function that fms_exit_cases' own SELECT policy calls.
-- ===========================================================================
create or replace function public.fms_exit_can_read_case(p_case uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_exit_is_coordinator(p_uid)
      or public.fms_exit_is_exit_staff(p_uid)
      or exists (
        select 1 from public.fms_exit_cases c
        where c.id = p_case
          and (c.employee_user_id = p_uid
            or c.raised_by = p_uid
            or p_uid = any(c.reporting_manager_ids))
      )
      -- …or you own a clearance row on THIS case. (M3.)
      or exists (
        select 1
          from public.fms_exit_clearance_checks k
          join public.fms_exit_cases c on c.id = k.case_id
         where k.case_id = p_case
           and (p_uid = any(k.owner_ids)
             or (k.owner_is_reporting_manager and p_uid = any(c.reporting_manager_ids)))
      );
$$;
grant execute on function public.fms_exit_can_read_case(uuid, uuid) to authenticated;

-- ===========================================================================
-- THE gate every workflow RPC calls — now with the `clearance` branch.
--
-- ⚠ KEEP THE `in (...)` LIST BELOW IN SYNC WITH `MANAGER_STEPS` IN
--   frontend/src/apps/hr-exit/lib/steps.ts. CHANGE ONE, CHANGE THE OTHER.
--   (The same duplication has bitten HR twice.)
--
-- ⚠ MANAGER ACCESS IS ADDITIVE, NOT EXCLUSIVE. fms_hr_can_act() EARLY-RETURNS for
-- its HOD steps, and that is exactly what made them unreachable whenever the
-- manager list was empty. Here a manager is a CO-OWNER: asset_return needs an HOD
-- sign AND an HR sign; handover needs the manager's confirmation AND HR's. So the
-- manager branch falls THROUGH to the configured step owner rather than returning
-- false — which also means a manager who never responds cannot wedge the case.
--
-- The clearance branch is additive in exactly the same way: the configured
-- `clearance` step owner keeps every power they had, and a row's own owner gains
-- the power to work that case's clearance. Ownership of a row is NOT filtered on
-- `done` — otherwise ticking your own row would instantly revoke your right to
-- untick it, which is not an authorization rule, it is a trap.
-- ===========================================================================
create or replace function public.fms_exit_can_act(p_step_key text, p_case uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_managers uuid[];
begin
  if public.is_admin(p_uid) or public.fms_exit_is_coordinator(p_uid) then
    return true;
  end if;

  -- MANAGER_STEPS — mirrored in lib/steps.ts.
  if p_step_key in ('manager_review', 'asset_return', 'handover') and p_case is not null then
    select reporting_manager_ids into v_managers from public.fms_exit_cases where id = p_case;
    if v_managers is not null and p_uid = any(v_managers) then
      return true;
    end if;
    -- NO early return. Fall through to the configured owner.
  end if;

  -- CLEARANCE — the step's owner, OR the owner of a row ON THIS CASE. (M3.)
  if p_step_key = 'clearance' and p_case is not null then
    if exists (
      select 1
        from public.fms_exit_clearance_checks k
        join public.fms_exit_cases c on c.id = k.case_id
       where k.case_id = p_case
         and (p_uid = any(k.owner_ids)
           or (k.owner_is_reporting_manager and p_uid = any(c.reporting_manager_ids)))
    ) then
      return true;
    end if;
    -- NO early return, for the same reason as above.
  end if;

  return public.fms_exit_is_step_owner(p_step_key, p_uid);
end $$;
grant execute on function public.fms_exit_can_act(text, uuid, uuid) to authenticated;

-- ===========================================================================
-- RLS — a clearance row is readable by whoever may read its case; every write is
-- an RPC (the toggle stamps done_at server-side, and completion is the DB's call).
-- ===========================================================================
alter table public.fms_exit_clearance_checks enable row level security;

drop policy if exists fms_exit_clearance_checks_select on public.fms_exit_clearance_checks;
create policy fms_exit_clearance_checks_select on public.fms_exit_clearance_checks
  for select to authenticated using (public.fms_exit_can_read_case(case_id, auth.uid()));

drop policy if exists fms_exit_clearance_checks_write_admin on public.fms_exit_clearance_checks;
create policy fms_exit_clearance_checks_write_admin on public.fms_exit_clearance_checks
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- RPC — CONFIRM THE LAST WORKING DAY. The pivot of the whole application.
--
-- Two things happen, and only one of them is a date:
--   1. `lwd` is finalised. SEVEN downstream SLAs hang off it (clearance, assets,
--      handover, the interview, leave, payroll, the F&F) — none of them can even be
--      *late* until it exists, and all of them move together when it changes.
--   2. THE CHECKLIST IS MATERIALISED, from the ACTIVE master, IDEMPOTENTLY.
--
-- "Exit checklist auto-generated by the HRMS" is step 6 on the source workflow. It
-- is deliberately NOT a step here: a step no human can complete is a queue row owed
-- by nobody, forever. It is a SYSTEM ACTION inside this RPC.
--
-- ⚠ RE-CONFIRMING A CHANGED LWD MOVES EVERY DUE DATE AND TOUCHES NO ITEM.
--   `if count = 0` guards the seed, and the due dates are derived in TS from `lwd`
--   + the snapshotted `due_days` — so there is literally nothing to rewrite. A case
--   in flight must never silently grow, lose or reset a box because HR moved the
--   date by two days or edited the master this morning.
--
-- ⚠ PHASE 4 REPLACES THIS FUNCTION to seed fms_exit_assets from the active asset
--   types in the same way, in the same transaction.
-- ===========================================================================
drop function if exists public.fms_exit_confirm_lwd(uuid, date);
create or replace function public.fms_exit_confirm_lwd(p_case uuid, p_lwd date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_step    text;
  v_no      text;
  v_name    text;
  v_emp     uuid;
  v_mgrs    uuid[];
  v_seeded  integer;
  v_owners  uuid[];
  v_recips  uuid[];
begin
  if p_lwd is null then raise exception 'A last working day is required'; end if;

  select status, current_step, exit_no, employee_name, employee_user_id, reporting_manager_ids
    into v_status, v_step, v_no, v_name, v_emp, v_mgrs
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then raise exception 'Exit case not found'; end if;

  -- The HR Head's approval is what puts a case into 'clearance' at step 'lwd_confirm'.
  -- Re-confirmation is legitimate for as long as the case is still in that phase
  -- (current_step has by then moved on to 'clearance'), which is what lets HR move a
  -- date that was agreed and then changed.
  if v_status <> 'clearance' or v_step not in ('lwd_confirm', 'clearance') then
    raise exception 'This case is not at the last-working-day step (status %, step %)', v_status, v_step;
  end if;
  if not public.fms_exit_can_act('lwd_confirm', p_case, v_uid) then
    raise exception 'Not authorized to confirm the last working day on this exit case';
  end if;

  update public.fms_exit_cases set
    lwd              = p_lwd,
    lwd_confirmed_at = now(),
    current_step     = 'clearance'
  where id = p_case;

  -- ---- SEED THE CHECKLIST. Once, from the ACTIVE master, snapshotted. ----
  select count(*) into v_seeded from public.fms_exit_clearance_checks where case_id = p_case;
  if v_seeded = 0 then
    insert into public.fms_exit_clearance_checks (
      case_id, item_id, item_key,
      name, department_label, description,
      owner_ids, owner_is_reporting_manager,
      requires_file, allows_link, due_days, sort_order, satisfied_by_step
    )
    select p_case, i.id, i.key,
           i.name, i.department_label, i.description,
           i.owner_ids, i.owner_is_reporting_manager,
           i.requires_file, i.allows_link, i.due_days, i.sort_order, i.satisfied_by_step
      from public.fms_exit_clearance_items i
     where i.active
     order by i.sort_order, i.name
    on conflict (case_id, item_key) do nothing;
  end if;

  -- Everyone whose clock just started: the employee, EVERY DISTINCT CLEARANCE OWNER
  -- (a row with no owner falls back to the `clearance` step's owners, so nothing is
  -- ever owed by nobody), and the reporting managers.
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_owners
    from public.fms_exit_clearance_checks k,
         lateral unnest(
           case when cardinality(k.owner_ids) > 0 then k.owner_ids
                else public.fms_exit_step_owner_ids('clearance') end
         ) u
   where k.case_id = p_case;

  v_recips := coalesce(v_owners, '{}'::uuid[])
            || coalesce(v_mgrs, '{}'::uuid[])
            || case when v_emp is null then '{}'::uuid[] else array[v_emp] end;

  perform public.fms_exit_announce(
    'case', p_case, 'lwd_confirmed',
    v_no || ' — the last working day for ' || v_name || ' is ' || to_char(p_lwd, 'DD-MM-YYYY')
         || '. The clearance checklist is now open.',
    v_recips,
    jsonb_build_object('exit_no', v_no, 'lwd', p_lwd)
  );
end $$;
grant execute on function public.fms_exit_confirm_lwd(uuid, date) to authenticated;

-- ===========================================================================
-- May this user work THIS clearance row?
--
-- Deliberately per-ROW, not per-case: a case's rows belong to eight different
-- people, and the IT person has no business ticking Payroll's box. The Panel greys
-- the controls with this; the toggle RPC re-checks it, and IS the gate.
-- ===========================================================================
create or replace function public.fms_exit_can_tick_clearance(p_check uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_exit_is_coordinator(p_uid)
      -- The configured owner of the `clearance` step chases the whole list.
      or public.fms_exit_is_step_owner('clearance', p_uid)
      or exists (
        select 1
          from public.fms_exit_clearance_checks k
          join public.fms_exit_cases c on c.id = k.case_id
         where k.id = p_check
           and (p_uid = any(k.owner_ids)
             or (k.owner_is_reporting_manager and p_uid = any(c.reporting_manager_ids)))
      );
$$;
grant execute on function public.fms_exit_can_tick_clearance(uuid, uuid) to authenticated;

-- ===========================================================================
-- Completion. THE DATABASE'S DECISION, NEVER THE UI'S.
--
-- Every row DONE **or** NOT APPLICABLE ⇒ the clearance step is complete. "Not
-- applicable" settles a row exactly as a tick does (the sheet's "Training material
-- (if applicable)"): it is not outstanding, so it cannot be the thing everyone is
-- waiting for.
--
-- Called from the toggle AND from the NA RPC, because either can be the last thing
-- to land — and, in M4, from the asset-return / handover auto-tick as well.
--
-- Un-ticking a row on a completed case UN-STAMPS the completion: a "complete"
-- clearance with an outstanding row is a lie, and the queue would already have
-- disagreed with the timestamp.
--
-- ⚠ v_total = 0 (the EMPTY-CHECKLIST hole) returns without stamping. Such a case can
--   never self-complete, and that is not something to paper over here — `clearanceDueIso`
--   dates it on the LWD so it goes RED and someone comes looking. Auto-completing an
--   empty checklist would silently mark eight departments cleared that never were.
-- ===========================================================================
create or replace function public.fms_exit_try_complete_clearance(p_case uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_done    timestamptz;
  v_no      text;
  v_name    text;
  v_total   integer;
  v_settled integer;
begin
  select status, clearance_completed_at, exit_no, employee_name
    into v_status, v_done, v_no, v_name
    from public.fms_exit_cases where id = p_case for update;
  if v_status is null then return; end if;

  select count(*), count(*) filter (where done or not_applicable)
    into v_total, v_settled
    from public.fms_exit_clearance_checks where case_id = p_case;

  if v_total = 0 then return; end if;   -- the empty-checklist hole. See the header.

  if v_settled < v_total then
    -- Something has been re-opened. The stamp must go with it.
    if v_done is not null then
      update public.fms_exit_cases set clearance_completed_at = null where id = p_case;
    end if;
    return;
  end if;

  if v_done is not null then return; end if;

  update public.fms_exit_cases set clearance_completed_at = now() where id = p_case;

  perform public.fms_exit_announce(
    'case', p_case, 'clearance_completed',
    v_no || ' — every department has cleared ' || v_name || '.',
    public.fms_exit_step_owner_ids('hr_verification')
      || public.fms_exit_step_owner_ids('payroll_inputs'),
    jsonb_build_object('exit_no', v_no)
  );
end $$;
grant execute on function public.fms_exit_try_complete_clearance(uuid) to authenticated;

-- ===========================================================================
-- RPC — tick / untick one clearance row.
--
-- ⚠ THE EVIDENCE RULE COMES FROM 20260712190000, **NOT** FROM …160000.
--
--   The 160000 version tested the STORED row alone:
--       if v_needsfile and v_file is null then raise …
--   …so it rejected a tick that supplied its evidence IN THE SAME CALL, and ignored
--   `link_url` entirely — which made the screen's offer of "attach a file OR paste a
--   link" a lie. Whatever arrives in THIS call counts:
--
--       evidence = a file  OR  (allows_link AND a link)
--
--   An item with requires_file and allows_link = false still demands a real upload.
--   That is the whole point of that flag: some documents must be held, not pointed at.
--
-- done_at / done_by are stamped SERVER-SIDE. Nobody types a completion date — a
-- self-reported "I did this last Tuesday" is not evidence, it is a claim.
-- ===========================================================================
drop function if exists public.fms_exit_toggle_clearance_check(uuid, boolean, text, text, text, text);
create or replace function public.fms_exit_toggle_clearance_check(
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
  v_uid        uuid := auth.uid();
  v_case       uuid;
  v_needsfile  boolean;
  v_allowslink boolean;
  v_name       text;
  v_file       text;
  v_link       text;
  v_status     text;
  v_lwd        date;
begin
  select k.case_id, k.requires_file, k.allows_link, k.name, k.file_path, k.link_url
    into v_case, v_needsfile, v_allowslink, v_name, v_file, v_link
    from public.fms_exit_clearance_checks k where k.id = p_check for update;
  if v_case is null then raise exception 'Clearance item not found'; end if;

  select c.status, c.lwd into v_status, v_lwd
    from public.fms_exit_cases c where c.id = v_case for update;

  if not public.fms_exit_can_tick_clearance(p_check, v_uid) then
    raise exception 'Not authorized to work this clearance item';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its clearance no longer applies', v_status;
  end if;
  if v_lwd is null then
    raise exception 'Confirm the last working day first — it is what the clearance due dates are measured from';
  end if;

  -- Whatever arrived in THIS call counts as evidence. (20260712190000.)
  v_file := coalesce(nullif(p_file_path, ''), v_file);
  v_link := coalesce(nullif(trim(p_link_url), ''), v_link);

  if p_done then
    if v_needsfile and v_file is null and not (v_allowslink and v_link is not null) then
      raise exception '% needs a file% before it can be ticked',
        v_name,
        case when v_allowslink then ' or a link' else '' end;
    end if;

    update public.fms_exit_clearance_checks set
      done           = true,
      done_at        = now(),   -- server-side. Nobody types a completion date.
      done_by        = v_uid,
      -- A row that has actually been DONE is not "not applicable" — whatever it was
      -- marked before, the truth is now the tick.
      not_applicable = false,
      na_reason      = null,
      file_path      = v_file,
      file_name      = coalesce(nullif(p_file_name, ''), file_name),
      link_url       = v_link,
      pending_reason = null
    where id = p_check;

  else
    -- The undo path, and the "save the reason it is still pending" path — and, since
    -- it returns the row to OUTSTANDING, it is also how a not-applicable row is
    -- brought back (fms_exit_set_clearance_na is one-way by design).
    update public.fms_exit_clearance_checks set
      done           = false,
      done_at        = null,
      done_by        = null,
      not_applicable = false,
      na_reason      = null,
      file_path      = v_file,
      file_name      = coalesce(nullif(p_file_name, ''), file_name),
      link_url       = v_link,
      pending_reason = nullif(trim(p_pending_reason), '')
    where id = p_check;
  end if;

  perform public.fms_exit_try_complete_clearance(v_case);
end $$;
grant execute on function public.fms_exit_toggle_clearance_check(uuid, boolean, text, text, text, text) to authenticated;

-- ===========================================================================
-- RPC — "this one does not apply here".
--
-- The sheet says "Training material (IF APPLICABLE)", and an item that cannot apply
-- must not be able to hold the whole exit hostage. But A REASON IS MANDATORY: a
-- silent N/A is indistinguishable from a row nobody bothered to do, and this is the
-- one control on the screen whose whole purpose is to make work disappear.
--
-- One-way. Bringing a row back to outstanding is fms_exit_toggle_clearance_check(
-- p_check, false) — the same "undo" the screen already offers.
-- ===========================================================================
drop function if exists public.fms_exit_set_clearance_na(uuid, text);
create or replace function public.fms_exit_set_clearance_na(p_check uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_case   uuid;
  v_status text;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why this item does not apply — a silent N/A is a lost step';
  end if;

  select k.case_id into v_case
    from public.fms_exit_clearance_checks k where k.id = p_check for update;
  if v_case is null then raise exception 'Clearance item not found'; end if;

  select c.status into v_status from public.fms_exit_cases c where c.id = v_case for update;

  if not public.fms_exit_can_tick_clearance(p_check, v_uid) then
    raise exception 'Not authorized to work this clearance item';
  end if;
  if v_status in ('withdrawn','rejected','archived') then
    raise exception 'This exit case is % — its clearance no longer applies', v_status;
  end if;

  update public.fms_exit_clearance_checks set
    not_applicable = true,
    na_reason      = trim(p_reason),
    done           = false,
    done_at        = null,
    done_by        = null,
    pending_reason = null
  where id = p_check;

  -- N/A settles a row exactly as a tick does, so it can be the LAST thing to land.
  perform public.fms_exit_try_complete_clearance(v_case);
end $$;
grant execute on function public.fms_exit_set_clearance_na(uuid, text) to authenticated;

-- ===========================================================================
-- STORAGE — ADDITIVE ONLY. The 4 staff policies (M1) and the 3 case policies (M2)
-- are UNTOUCHED. Postgres OR-combines permissive policies, so these purely WIDEN
-- one narrow path for people who already owe work on it.
--
-- ⚠ WITHOUT THESE, A CLEARANCE OWNER CANNOT ATTACH THEIR OWN EVIDENCE. The M1
--   bucket policies are gated on fms_exit_is_exit_staff() / is_coordinator(), and
--   the IT / Admin / Travel-Desk clearance owners are, by construction, NEITHER —
--   they own no workflow step. They would be handed a file input that always 403s.
--   Scoped to cases/<a case they own a row on>/clearance/… and nowhere else, ever.
-- ===========================================================================
drop policy if exists "fms exit docs clearance owner insert" on storage.objects;
create policy "fms exit docs clearance owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fms-exit-docs'
    and (storage.foldername(name))[1] = 'cases'
    and (storage.foldername(name))[3] = 'clearance'
    and exists (
      select 1
        from public.fms_exit_clearance_checks k
        join public.fms_exit_cases c on c.id = k.case_id
       where c.id::text = (storage.foldername(name))[2]
         and (auth.uid() = any(k.owner_ids)
           or (k.owner_is_reporting_manager and auth.uid() = any(c.reporting_manager_ids)))
    )
  );

drop policy if exists "fms exit docs clearance owner read" on storage.objects;
create policy "fms exit docs clearance owner read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fms-exit-docs'
    and (storage.foldername(name))[1] = 'cases'
    and (storage.foldername(name))[3] = 'clearance'
    and exists (
      select 1
        from public.fms_exit_clearance_checks k
        join public.fms_exit_cases c on c.id = k.case_id
       where c.id::text = (storage.foldername(name))[2]
         and (auth.uid() = any(k.owner_ids)
           or (k.owner_is_reporting_manager and auth.uid() = any(c.reporting_manager_ids)))
    )
  );
