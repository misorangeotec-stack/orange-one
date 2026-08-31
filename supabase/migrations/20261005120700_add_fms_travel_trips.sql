-- ===========================================================================
-- Travel Desk FMS — THE TRIP (Phase 3).
--
-- ONE ENTITY, from the request to the settled claim. The approvals, the advance,
-- every booked leg, the expense claim and the settlement all hang off THIS ROW —
-- which is what makes "what was estimated vs what was spent", "what was entitled
-- vs what was booked" and "advance netted against claim" answerable at all.
--
-- ⚠ THE `snap_*` COLUMNS ARE FROZEN AT SUBMIT AND MUST NEVER BE RECOMPUTED.
--   A promotion between the trip and the claim must not re-price the trip, and
--   January's rate revision must not rewrite last March's. This is the same
--   doctrine as OCPI freezing the resolved document on each quotation version:
--   a rule change may not rewrite history.
--
--   `snap_travel_category` in particular is stored, not derived. Deriving it at
--   read time would mean that resolving the band 3 / band 8 contradiction —
--   which is still open — would silently re-price every trip ever taken.
--
-- ⚠ NO WRITE POLICY ON THE TRIP, DELIBERATELY. Every mutation goes through a
--   SECURITY DEFINER RPC, so the RPC is the only write door and the guard cannot
--   be bypassed from the browser. Admin writes go the same way.
--
-- ⚠ THE APPROVER IS SNAPSHOTTED, NOT LOOKED UP. `approver_manager_ids` is
--   copied out of `user_hods` when the trip is submitted, and every manager step
--   routes to that array. A re-org must not silently re-route a trip somebody is
--   already waiting on. hr-exit does exactly this (`reporting_manager_ids`) and
--   its header explains why: there is no HRIS in this portal and `departments`
--   has no `hod_id`, so "the department's HOD" is not a concept here.
--
--   19 of 60 people currently have no `user_hods` row. Most are top-of-tree and
--   correctly have none, but two are ordinary staff, so `submit` falls back to
--   the configured step owners rather than refusing — a trip that cannot be
--   raised because the org chart is incomplete is a worse failure than one that
--   goes to HR.
--
-- Also: fms_travel_can_act, deferred from phase 1 because it must read this row.
-- Also: the Master Report row is switched ON, now that its head_table exists.
--
-- Additive. Reversal (reverse order):
--   update public.master_report_modules set enabled = false where app_id = 'travel-desk';
--   drop function if exists public.fms_travel_submit_trip(uuid);
--   drop function if exists public.fms_travel_delete_draft(uuid);
--   drop function if exists public.fms_travel_save_draft(jsonb, uuid);
--   drop function if exists public.fms_travel_can_act(text, uuid, uuid);
--   drop function if exists public.fms_travel_can_see_trip(uuid, uuid, text, uuid[]);
--   drop table if exists public.fms_travel_passengers;
--   drop table if exists public.fms_travel_trips;
-- ===========================================================================

begin;

create table if not exists public.fms_travel_trips (
  id                      uuid primary key default gen_random_uuid(),
  trip_no                 text unique,          -- TRV-2627-0001, minted on SUBMIT
  status                  text not null default 'draft' check (status in (
                            'draft',
                            'awaiting_manager_approval',
                            'awaiting_director_approval',
                            'returned',
                            'rejected',
                            'awaiting_advance',
                            'awaiting_booking',
                            'booked',
                            'cancellation_requested',
                            'awaiting_claim_review',
                            'awaiting_finance_review',
                            'awaiting_settlement',
                            'closed',
                            'on_hold',
                            'cancelled')),
  current_step            text,

  -- ---- who ---------------------------------------------------------------
  -- raised_by may differ from traveller_id: the Travel Desk coordinator raises
  -- on behalf of senior management (PRD §3).
  raised_by               uuid references auth.users on delete set null,
  traveller_id            uuid references auth.users on delete set null,
  traveller_name          text,
  traveller_employee_code text,

  -- ---- frozen at submit ---------------------------------------------------
  snap_band_no            integer,
  snap_travel_category    text check (snap_travel_category is null
                            or snap_travel_category in ('TC-A','TC-B','TC-C','TC-D')),
  snap_department_id      uuid references public.departments on delete set null,
  snap_designation_id     uuid references public.designations on delete set null,
  snap_base_city_id       uuid references public.fms_travel_cities on delete set null,
  snap_rate_card_id       uuid references public.fms_travel_rate_cards on delete set null,
  approver_manager_ids    uuid[] not null default '{}',
  approver_manager_note   text,

  -- ---- the journey --------------------------------------------------------
  purpose_id              uuid references public.fms_travel_purposes on delete set null,
  purpose_other_remarks   text,
  destination_city_id     uuid references public.fms_travel_cities on delete set null,
  journey_type            text check (journey_type is null
                            or journey_type in ('one_way','round_trip','multi_city')),
  preferred_slot          text check (preferred_slot is null
                            or preferred_slot in ('morning','afternoon','evening','night')),
  planned_departure_date  date,
  planned_return_date     date,
  actual_departure_date   date,
  actual_return_date      date,
  accommodation_required  boolean not null default false,
  estimated_cost          numeric(14,2),
  is_emergency            boolean not null default false,
  emergency_reason        text,

  -- ---- skipped steps ------------------------------------------------------
  -- ⚠ A SKIPPED STEP MUST READ AS SKIPPED, NOT AS FOREVER-PENDING.
  --   20260905120000 (General Purchase) documents three real defects a missing
  --   flag caused: an approver could "correct" a decision never made, resuming a
  --   held request rerouted it to the step it had skipped, and the notification
  --   pointed at a queue the recipient could not open.
  director_approval_skipped boolean not null default false,
  advance_skipped           boolean not null default false,

  -- ---- the advance (§11.1) ------------------------------------------------
  advance_requested        boolean not null default false,
  advance_requested_amount numeric(14,2),
  advance_approved_amount  numeric(14,2),
  advance_paid_amount      numeric(14,2),
  advance_paid_at          timestamptz,
  advance_paid_ref         text,
  advance_paid_mode        text,

  -- ---- money --------------------------------------------------------------
  booking_total    numeric(14,2),
  claim_total      numeric(14,2),
  da_total         numeric(14,2),
  disallowed_total numeric(14,2),
  net_payable      numeric(14,2),
  settled_amount   numeric(14,2),
  settled_at       timestamptz,
  settled_ref      text,

  -- ---- per-step stamps ----------------------------------------------------
  -- ma_ manager approval · da_ director approval · adv_ advance · bk_ booking
  -- cl_ claim · cr_ claim review · fr_ finance review · st_ settlement
  submitted_at timestamptz,
  ma_at timestamptz, ma_by uuid references auth.users on delete set null,
  ma_decision text check (ma_decision is null or ma_decision in ('approve','reject','return')),
  ma_note text,
  da_at timestamptz, da_by uuid references auth.users on delete set null,
  da_decision text check (da_decision is null or da_decision in ('approve','reject','return')),
  da_note text,
  adv_at timestamptz, adv_by uuid references auth.users on delete set null,
  bk_at  timestamptz, bk_by  uuid references auth.users on delete set null,
  cl_at  timestamptz, cl_by  uuid references auth.users on delete set null,
  cr_at  timestamptz, cr_by  uuid references auth.users on delete set null,
  cr_decision text check (cr_decision is null or cr_decision in ('approve','reject','return')),
  cr_note text,
  fr_at  timestamptz, fr_by  uuid references auth.users on delete set null,
  st_at  timestamptz, st_by  uuid references auth.users on delete set null,

  -- ---- lifecycle ----------------------------------------------------------
  returned_at timestamptz, returned_stage text, returned_reason text,
  rejected_at timestamptz, rejected_stage text, reject_reason text,
  hold_at timestamptz, hold_reason text, hold_from_status text,
  cancelled_at timestamptz, cancel_reason text,

  -- ⚠ edited_*, NOT updated_*. updated_at is maintained by a trigger that fires
  --   on EVERY row touch, including the workflow's own writes, so it answers
  --   "when did anything happen" - never "did a human correct this".
  edited_at timestamptz,
  edited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A draft may be as empty as its author likes. Everything past draft must
  -- carry what the approver and the coordinator need to act.
  constraint fms_travel_complete_when_submitted check (
    status = 'draft' or (
          traveller_id is not null
      and nullif(btrim(coalesce(traveller_name, '')), '') is not null
      and purpose_id is not null
      and destination_city_id is not null
      and planned_departure_date is not null
      and estimated_cost is not null
      and snap_travel_category is not null
      and snap_rate_card_id is not null
    )
  ),

  -- A return before the departure is a data-entry slip, not a trip.
  constraint fms_travel_return_after_departure check (
    planned_return_date is null or planned_departure_date is null
    or planned_return_date >= planned_departure_date
  ),
  constraint fms_travel_actual_return_after_departure check (
    actual_return_date is null or actual_departure_date is null
    or actual_return_date >= actual_departure_date
  )
);

comment on table public.fms_travel_trips is
  'One official trip, from the request to the settled expense claim. The snap_* columns are FROZEN at submit so a promotion or a rate revision can never re-price a trip that has already happened.';

create index if not exists fms_travel_trips_status_idx      on public.fms_travel_trips (status);
create index if not exists fms_travel_trips_traveller_idx   on public.fms_travel_trips (traveller_id);
create index if not exists fms_travel_trips_raised_by_idx   on public.fms_travel_trips (raised_by);
create index if not exists fms_travel_trips_departure_idx   on public.fms_travel_trips (planned_departure_date);
create index if not exists fms_travel_trips_created_idx     on public.fms_travel_trips (created_at);
create index if not exists fms_travel_trips_approvers_idx   on public.fms_travel_trips using gin (approver_manager_ids);

drop trigger if exists trg_fms_travel_trips_updated on public.fms_travel_trips;
create trigger trg_fms_travel_trips_updated
  before update on public.fms_travel_trips
  for each row execute function public.set_updated_at();

alter table public.fms_travel_trips enable row level security;


-- ===========================================================================
-- PASSENGERS — who is actually on the ticket.
--
-- ⚠ THE TRIP HAS ONE TRAVELLER AND MANY PASSENGERS, and the difference is the
--   money. Reimbursement is PERSONAL — Policy §11 pays into one employee's bank
--   account — so a trip is one person's claim. The passenger list exists because
--   an airline needs a name, a gender and a date of birth for everybody on the
--   booking, including a colleague or a customer travelling alongside.
--
--   If a second EMPLOYEE also needs to claim, they raise their own trip. A
--   one-request-splits-into-N flow is deliberately out of scope for v1.
-- ===========================================================================
create table if not exists public.fms_travel_passengers (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.fms_travel_trips on delete cascade,
  -- Null for somebody who is not a portal user at all.
  employee_id   uuid references auth.users on delete set null,
  full_name     text not null,
  gender        text check (gender is null or gender in ('male','female','other')),
  date_of_birth date,
  mobile        text,
  email         text,
  is_primary    boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.fms_travel_passengers is
  'Everybody on the booking, for ticketing. The TRAVELLER (fms_travel_trips.traveller_id) is whose claim it is; a passenger is merely a name on the ticket.';

create index if not exists fms_travel_passengers_trip_idx on public.fms_travel_passengers (trip_id);

drop trigger if exists trg_fms_travel_passengers_updated on public.fms_travel_passengers;
create trigger trg_fms_travel_passengers_updated
  before update on public.fms_travel_passengers
  for each row execute function public.set_updated_at();

alter table public.fms_travel_passengers enable row level security;


-- ===========================================================================
-- WHO MAY SEE A TRIP.
--
-- ⚠ TWO COPIES OF THIS RULE EXIST AND THEY MOVE TOGETHER: this function (used
--   by storage policies and the notification fan-out in later phases) and the
--   inlined SELECT policy below. Postgres will not let a policy call a function
--   without paying for it per row, and this table is read on every screen.
--
-- ⚠ A TRIP CARRIES SOMEBODY'S PERSONAL SPENDING. That is why this is tighter
--   than most FMS visibility rules: a draft is private to its author, and an
--   ordinary employee sees their own trips and the ones they approve — not
--   everybody's hotel bills.
-- ===========================================================================
create or replace function public.fms_travel_can_see_trip(
  p_uid       uuid,
  p_raised_by uuid,
  p_traveller uuid,
  p_status    text,
  p_approvers uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and (p_status is distinct from 'draft' or p_raised_by = p_uid or public.is_admin(p_uid))
     and (
          public.is_admin(p_uid)
       or public.fms_travel_is_coordinator(p_uid)
       or p_raised_by = p_uid
       or p_traveller = p_uid
       or p_uid = any(p_approvers)
       or public.module_is_viewer(p_uid, 'travel-desk')
       or exists (select 1 from public.fms_travel_step_owners o
                   where p_uid = any(o.employee_ids))
     );
$$;

comment on function public.fms_travel_can_see_trip(uuid, uuid, uuid, text, uuid[]) is
  'May this user read this trip? Mirrored INLINE in the fms_travel_trips SELECT policy - change one, change the other.';
grant execute on function public.fms_travel_can_see_trip(uuid, uuid, uuid, text, uuid[]) to authenticated;

drop policy if exists fms_travel_trips_select on public.fms_travel_trips;
create policy fms_travel_trips_select
  on public.fms_travel_trips
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and (fms_travel_trips.status is distinct from 'draft'
         or fms_travel_trips.raised_by = (select auth.uid())
         or (select public.is_admin((select auth.uid()))))
    and (
         (select public.is_admin((select auth.uid())))
      or (select public.fms_travel_is_coordinator((select auth.uid())))
      or fms_travel_trips.raised_by = (select auth.uid())
      or fms_travel_trips.traveller_id = (select auth.uid())
      or (select auth.uid()) = any(fms_travel_trips.approver_manager_ids)
      or (select public.module_is_viewer((select auth.uid()), 'travel-desk'))
      or exists (select 1 from public.fms_travel_step_owners o
                  where (select auth.uid()) = any(o.employee_ids))
    )
  );

-- No write policy, deliberately: see the header.

-- Passengers ride on their trip's visibility.
drop policy if exists fms_travel_passengers_select on public.fms_travel_passengers;
create policy fms_travel_passengers_select
  on public.fms_travel_passengers for select to authenticated
  using (exists (select 1 from public.fms_travel_trips t
                  where t.id = fms_travel_passengers.trip_id));


-- ===========================================================================
-- WHO MAY ACT ON A STEP. Deferred from phase 1 — it must read the trip.
--
-- ⚠ THE MANAGER ARM DOES NOT EARLY-RETURN. If this trip's own approvers do not
--   include you, the check FALLS THROUGH to the configured step owners — which
--   is how HR, named once in Settings, can act on any trip's manager approval
--   without being on every trip's snapshot. That is the PRD's "HR: same
--   permissions as HOD".
--
--   hr-exit's fms_exit_can_act does exactly this and its comment is explicit
--   that the arm must not early-return; hr-recruitment's equivalent does, and
--   hr-exit names that as the bug it avoided.
-- ===========================================================================
create or replace function public.fms_travel_can_act(p_step_key text, p_trip uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_approvers uuid[];
begin
  if p_uid is null then return false; end if;
  if not public.module_can_edit(p_uid, 'travel-desk') then return false; end if;
  if public.fms_travel_is_coordinator(p_uid) then return true; end if;

  -- MANAGER_STEPS - mirrored in lib/steps.ts.
  if p_step_key in ('manager_approval', 'claim_review') and p_trip is not null then
    select approver_manager_ids into v_approvers
      from public.fms_travel_trips where id = p_trip;
    if v_approvers is not null and p_uid = any(v_approvers) then
      return true;
    end if;
    -- NO early return. Fall through to the configured owner.
  end if;

  -- Filing your own claim is not a step anybody makes you an owner of.
  if p_step_key = 'claim' and p_trip is not null then
    if exists (select 1 from public.fms_travel_trips t
                where t.id = p_trip and t.traveller_id = p_uid) then
      return true;
    end if;
  end if;

  if public.fms_travel_is_step_owner(p_step_key, p_uid) then return true; end if;

  -- The origin step is open to any editor while nobody owns it.
  return p_step_key = 'request'
     and not exists (select 1 from public.fms_travel_step_owners o
                      where o.step_key = 'request' and array_length(o.employee_ids, 1) > 0);
end $$;

comment on function public.fms_travel_can_act(text, uuid, uuid) is
  'May this user action this step ON THIS TRIP? Coordinators always; the trip own approvers on the two manager steps (ADDITIVE - it falls through to step owners); the traveller on their own claim; otherwise the configured step owners.';
grant execute on function public.fms_travel_can_act(text, uuid, uuid) to authenticated;

commit;
