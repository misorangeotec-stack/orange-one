-- ===========================================================================
-- OFFICE SUPPLIES PURCHASE FMS — THE REQUEST + APPROVALS (Phase 2).
--
-- One entity per request (case-style, like fms_exit_cases — no header+line split;
-- each request is a single item). ONE AUTHORITATIVE TIMESTAMP COLUMN PER STEP.
--
-- Helpers:
--   fms_supplies_request_hod(req)            — the department's HOD for a request
--   fms_supplies_can_read_request(req, uid)  — the read gate (scoped, NOT `true`)
--   fms_supplies_can_act(step, req, uid)     — the authorization gate
--   fms_supplies_resume_status(req)          — where a held request goes back to
--
-- RPCs (all SECURITY DEFINER; lock the row, validate status, re-check authz,
-- stamp the step's own timestamp, then advance status/current_step):
--   fms_supplies_submit_request, fms_supplies_decide_first_approval,
--   fms_supplies_decide_second_approval, fms_supplies_record_handover,
--   fms_supplies_hold_request, fms_supplies_cancel_request
--
-- ⚠ NEVER INFER A STEP'S COMPLETION FROM THE ACTIVITY TRAIL — announce() is
--   best-effort and swallowed. Every step stamps its own column here.
--
-- Purely ADDITIVE. Reverses (in order):
--   drop function if exists public.fms_supplies_cancel_request(uuid,text);
--   drop function if exists public.fms_supplies_hold_request(uuid,boolean,text);
--   drop function if exists public.fms_supplies_record_handover(uuid,jsonb);
--   drop function if exists public.fms_supplies_decide_second_approval(uuid,boolean,text);
--   drop function if exists public.fms_supplies_decide_first_approval(uuid,boolean,text);
--   drop function if exists public.fms_supplies_submit_request(jsonb);
--   drop function if exists public.fms_supplies_resume_status(uuid);
--   drop function if exists public.fms_supplies_can_act(text,uuid,uuid);
--   drop function if exists public.fms_supplies_can_read_request(uuid,uuid);
--   drop function if exists public.fms_supplies_request_hod(uuid);
--   drop table if exists public.fms_supplies_requests;
-- ===========================================================================

create table if not exists public.fms_supplies_requests (
  id                    uuid primary key default gen_random_uuid(),
  req_no                text not null unique,          -- SUPPLY-2627-0001

  -- ---- intake ------------------------------------------------------------
  company_id            uuid not null references public.fms_supplies_companies on delete restrict,
  location              text not null check (location in ('Plant','Office')),
  department_id         uuid not null references public.fms_supplies_departments on delete restrict,

  -- The requester is the session user; the beneficiary may be someone else
  -- ("Reception raises a laptop for a new joiner").
  raised_by             uuid references auth.users on delete set null,
  requested_for_name    text not null,
  requested_for_user_id uuid references auth.users on delete set null,
  raised_on_behalf      boolean not null default false,

  request_type          text not null check (request_type in ('new_requirement','services_maintenance')),
  category_id           uuid references public.fms_supplies_categories on delete set null,
  service_type_id       uuid references public.fms_supplies_service_types on delete set null,
  item_name             text,                          -- specific item (or free-text "Other")
  quantity              text not null,
  reason                text,

  -- The routing decision, frozen at submit: category.requires_approval AND a
  -- new_requirement. Services/Maintenance is always false.
  requires_approval     boolean not null default false,

  -- STATUSES ARE NOT STEP KEYS. on_hold / cancelled / rejected / delivered live
  -- here and nowhere in StepKey — a status loose in the queue is work owed by nobody.
  status                text not null check (status in (
                          'pending_first_approval','pending_second_approval','pending_handover',
                          'delivered','rejected','on_hold','cancelled')),
  current_step          text not null,

  -- ---- AUTHORITATIVE step timestamps -------------------------------------
  submitted_at          timestamptz not null default now(),

  first_approved_at     timestamptz,
  first_approver_id     uuid references auth.users on delete set null,
  first_remarks         text,

  second_approved_at    timestamptz,
  second_approver_id    uuid references auth.users on delete set null,
  second_remarks        text,

  handed_over_at        timestamptz,
  handover_by           uuid references auth.users on delete set null,
  handover_remarks      text,
  tentative_delivery_date date,
  actual_delivery_date  date,
  delivered_at          timestamptz,

  rejected_at           timestamptz,
  reject_stage          text,                          -- 'first_approval' | 'second_approval'
  reject_reason         text,
  hold_at               timestamptz,
  hold_reason           text,
  cancelled_at          timestamptz,
  cancel_reason         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.fms_supplies_requests is
  'One office-supply requisition (single item). Carries the intake, the routing switch (requires_approval), and one authoritative timestamp per step. Read is scoped by fms_supplies_can_read_request — NOT world-readable.';

create index if not exists fms_supplies_requests_status_idx on public.fms_supplies_requests (status);
create index if not exists fms_supplies_requests_dept_idx   on public.fms_supplies_requests (department_id);
create index if not exists fms_supplies_requests_raised_idx on public.fms_supplies_requests (raised_by);

drop trigger if exists trg_fms_supplies_requests_updated on public.fms_supplies_requests;
create trigger trg_fms_supplies_requests_updated
  before update on public.fms_supplies_requests
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- AUTHORIZATION
-- ===========================================================================

-- The HOD (first approver) for a request = its department's hod_user_id.
create or replace function public.fms_supplies_request_hod(p_req uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.hod_user_id
  from public.fms_supplies_requests r
  join public.fms_supplies_departments d on d.id = r.department_id
  where r.id = p_req;
$$;
grant execute on function public.fms_supplies_request_hod(uuid) to authenticated;

-- ⚠ THE READ GATE — deliberately NOT `using (true)`. This is a universal app
--   (every employee reaches it) and requests are personal, so a select-all policy
--   would show every employee every request. Scoped to: admin / coordinator /
--   fulfilment staff (second_approval + handover owners) / the requester / the
--   beneficiary / the department's HOD / a first_approval fallback owner.
create or replace function public.fms_supplies_can_read_request(p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_supplies_is_coordinator(p_uid)
      or public.fms_supplies_is_fulfilment_staff(p_uid)
      or public.fms_supplies_is_step_owner('first_approval', p_uid)
      or exists (
        select 1 from public.fms_supplies_requests r
        left join public.fms_supplies_departments d on d.id = r.department_id
        where r.id = p_req
          and (r.raised_by = p_uid
            or r.requested_for_user_id = p_uid
            or d.hod_user_id = p_uid)
      );
$$;
grant execute on function public.fms_supplies_can_read_request(uuid, uuid) to authenticated;

-- THE gate every workflow RPC calls.
--   first_approval  → the request's HOD, OR a first_approval fallback owner
--   second_approval → a second_approval owner
--   handover        → a handover owner
-- Admin / coordinator may act on anything.
create or replace function public.fms_supplies_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_hod uuid;
begin
  if public.is_admin(p_uid) or public.fms_supplies_is_coordinator(p_uid) then
    return true;
  end if;

  if p_step_key = 'first_approval' then
    v_hod := public.fms_supplies_request_hod(p_req);
    if v_hod is not null and v_hod = p_uid then
      return true;
    end if;
    -- Fall through to the configured fallback owner (a dept with no HOD set).
  end if;

  return public.fms_supplies_is_step_owner(p_step_key, p_uid);
end $$;
grant execute on function public.fms_supplies_can_act(text, uuid, uuid) to authenticated;

-- Where a held request goes back to when it is taken off hold — derived from its
-- own timestamps and the routing switch, so a stashed status can never go stale.
create or replace function public.fms_supplies_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.handed_over_at is not null    then 'pending_handover'  -- handover in progress
    when not r.requires_approval         then 'pending_handover'
    when r.second_approved_at is not null then 'pending_handover'
    when r.first_approved_at is not null  then 'pending_second_approval'
    else 'pending_first_approval'
  end
  from public.fms_supplies_requests r where r.id = p_req;
$$;
grant execute on function public.fms_supplies_resume_status(uuid) to authenticated;

-- ===========================================================================
-- RLS — read is gated; every write goes through the RPCs below.
-- ===========================================================================
alter table public.fms_supplies_requests enable row level security;
drop policy if exists fms_supplies_requests_select on public.fms_supplies_requests;
create policy fms_supplies_requests_select on public.fms_supplies_requests
  for select to authenticated using (public.fms_supplies_can_read_request(id, auth.uid()));
drop policy if exists fms_supplies_requests_write_admin on public.fms_supplies_requests;
create policy fms_supplies_requests_write_admin on public.fms_supplies_requests
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- RPC — raise a request. THE ORIGIN OF THE WORKFLOW.
-- Open to every signed-in user (this is a universal app). Computes the route.
-- ===========================================================================
drop function if exists public.fms_supplies_submit_request(jsonb);
create or replace function public.fms_supplies_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid;
  v_no        text;
  v_seq       integer;
  v_fy        text := public.fms_supplies_fy_code(current_date);
  v_uid       uuid := auth.uid();
  v_type      text := coalesce(nullif(p->>'request_type',''), 'new_requirement');
  v_cat       uuid := nullif(p->>'category_id','')::uuid;
  v_requires  boolean := false;
  v_status    text;
  v_step      text;
  v_for_user  uuid := nullif(p->>'requested_for_user_id','')::uuid;
  v_for_name  text := nullif(trim(p->>'requested_for_name'), '');
  v_hod       uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  if v_type not in ('new_requirement','services_maintenance') then
    raise exception 'Unknown request type %', v_type;
  end if;
  if (p->>'company_id') is null or trim(p->>'company_id') = '' then raise exception 'Company is required'; end if;
  if (p->>'department_id') is null or trim(p->>'department_id') = '' then raise exception 'Department is required'; end if;
  if coalesce(p->>'location','') not in ('Plant','Office') then raise exception 'Location is required'; end if;
  if coalesce(trim(p->>'quantity'), '') = '' then raise exception 'Quantity is required'; end if;

  if v_type = 'new_requirement' then
    if v_cat is null then raise exception 'Category is required'; end if;
    if coalesce(trim(p->>'item_name'), '') = '' then raise exception 'Item is required'; end if;
    select requires_approval into v_requires from public.fms_supplies_categories where id = v_cat;
    v_requires := coalesce(v_requires, false);
  else
    -- Services/Maintenance: no category, always straight to handover.
    if (p->>'service_type_id') is null or trim(p->>'service_type_id') = '' then
      raise exception 'Service type is required';
    end if;
    v_requires := false;
  end if;

  -- The requester defaults to being the beneficiary; a name is always stored.
  if v_for_name is null then
    v_for_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  if v_requires then
    v_status := 'pending_first_approval';
    v_step   := 'first_approval';
  else
    v_status := 'pending_handover';
    v_step   := 'handover';
  end if;

  v_seq := public.fms_supplies_next_seq('SUPPLY-' || v_fy);
  v_no  := 'SUPPLY-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_supplies_requests (
    req_no, company_id, location, department_id,
    raised_by, requested_for_name, requested_for_user_id, raised_on_behalf,
    request_type, category_id, service_type_id, item_name, quantity, reason,
    requires_approval, status, current_step, submitted_at
  ) values (
    v_no,
    (p->>'company_id')::uuid,
    p->>'location',
    (p->>'department_id')::uuid,
    v_uid,
    v_for_name,
    v_for_user,
    (v_for_user is not null and v_for_user <> v_uid) or (v_for_user is null and v_for_name is not null and v_for_name <> coalesce((select name from public.profiles where id = v_uid), '')),
    v_type,
    v_cat,
    nullif(p->>'service_type_id','')::uuid,
    nullif(trim(p->>'item_name'), ''),
    trim(p->>'quantity'),
    nullif(trim(p->>'reason'), ''),
    v_requires,
    v_status, v_step, now()
  )
  returning id into v_id;

  -- Announce to whoever is next: the HOD (+ fallback owners) or the handover team.
  if v_requires then
    v_hod := public.fms_supplies_request_hod(v_id);
    perform public.fms_supplies_announce(
      'request', v_id, 'raised',
      'Supply request ' || v_no || ' for ' || v_for_name || ' needs your approval.',
      (case when v_hod is not null then array[v_hod] else '{}'::uuid[] end)
        || public.fms_supplies_step_owner_ids('first_approval'),
      jsonb_build_object('req_no', v_no)
    );
  else
    perform public.fms_supplies_announce(
      'request', v_id, 'raised',
      'Supply request ' || v_no || ' for ' || v_for_name || ' is ready for handover.',
      public.fms_supplies_step_owner_ids('handover'),
      jsonb_build_object('req_no', v_no)
    );
  end if;

  return v_id;
end $$;
grant execute on function public.fms_supplies_submit_request(jsonb) to authenticated;

-- ===========================================================================
-- RPC — first approval (the HOD). approve → second approval; reject → terminal.
-- ===========================================================================
drop function if exists public.fms_supplies_decide_first_approval(uuid, boolean, text);
create or replace function public.fms_supplies_decide_first_approval(p_req uuid, p_approve boolean, p_remarks text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
begin
  select status into v_status from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'pending_first_approval' then
    raise exception 'This request is not awaiting first approval (status %)', v_status;
  end if;
  if not public.fms_supplies_can_act('first_approval', p_req, v_uid) then
    raise exception 'Not authorized to approve this request';
  end if;
  if not p_approve and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when the request is not approved';
  end if;

  if p_approve then
    update public.fms_supplies_requests set
      first_approved_at = now(), first_approver_id = v_uid, first_remarks = nullif(trim(p_remarks), ''),
      status = 'pending_second_approval', current_step = 'second_approval'
    where id = p_req;
  else
    update public.fms_supplies_requests set
      first_approver_id = v_uid, first_remarks = nullif(trim(p_remarks), ''),
      rejected_at = now(), reject_stage = 'first_approval', reject_reason = trim(p_remarks),
      status = 'rejected', current_step = 'first_approval'
    where id = p_req;
  end if;
end $$;
grant execute on function public.fms_supplies_decide_first_approval(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- RPC — second approval (Management). approve → handover; reject → terminal.
-- ===========================================================================
drop function if exists public.fms_supplies_decide_second_approval(uuid, boolean, text);
create or replace function public.fms_supplies_decide_second_approval(p_req uuid, p_approve boolean, p_remarks text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
begin
  select status into v_status from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'pending_second_approval' then
    raise exception 'This request is not awaiting second approval (status %)', v_status;
  end if;
  if not public.fms_supplies_can_act('second_approval', p_req, v_uid) then
    raise exception 'Not authorized for the second approval';
  end if;
  if not p_approve and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when the request is not approved';
  end if;

  if p_approve then
    update public.fms_supplies_requests set
      second_approved_at = now(), second_approver_id = v_uid, second_remarks = nullif(trim(p_remarks), ''),
      status = 'pending_handover', current_step = 'handover'
    where id = p_req;
  else
    update public.fms_supplies_requests set
      second_approver_id = v_uid, second_remarks = nullif(trim(p_remarks), ''),
      rejected_at = now(), reject_stage = 'second_approval', reject_reason = trim(p_remarks),
      status = 'rejected', current_step = 'second_approval'
    where id = p_req;
  end if;
end $$;
grant execute on function public.fms_supplies_decide_second_approval(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- RPC — record handover / material confirmation. Marks the handover done and,
-- when a delivery date is supplied, closes the request as delivered.
-- ===========================================================================
drop function if exists public.fms_supplies_record_handover(uuid, jsonb);
create or replace function public.fms_supplies_record_handover(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_uid       uuid := auth.uid();
  v_delivered date := nullif(p->>'actual_delivery_date','')::date;
begin
  select status into v_status from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'pending_handover' then
    raise exception 'This request is not ready for handover (status %)', v_status;
  end if;
  if not public.fms_supplies_can_act('handover', p_req, v_uid) then
    raise exception 'Not authorized to hand over this request';
  end if;

  update public.fms_supplies_requests set
    handed_over_at          = coalesce(handed_over_at, now()),
    handover_by             = v_uid,
    handover_remarks        = nullif(trim(p->>'handover_remarks'), ''),
    tentative_delivery_date = nullif(p->>'tentative_delivery_date','')::date,
    actual_delivery_date    = v_delivered,
    -- A delivery date closes the request; without one it stays open at handover.
    delivered_at            = case when v_delivered is not null then now() else null end,
    status                  = case when v_delivered is not null then 'delivered' else 'pending_handover' end,
    current_step            = 'handover'
  where id = p_req;
end $$;
grant execute on function public.fms_supplies_record_handover(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — park / un-park a request. `on_hold` is a STATUS: it leaves every queue.
-- Admin / coordinator only.
-- ===========================================================================
drop function if exists public.fms_supplies_hold_request(uuid, boolean, text);
create or replace function public.fms_supplies_hold_request(p_req uuid, p_hold boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_uid    uuid := auth.uid();
begin
  select status into v_status from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not (public.is_admin(v_uid) or public.fms_supplies_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can hold a request';
  end if;

  if p_hold then
    if v_status in ('delivered','cancelled','rejected','on_hold') then
      raise exception 'A % request cannot be put on hold', v_status;
    end if;
    if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to hold'; end if;
    update public.fms_supplies_requests
       set status = 'on_hold', hold_at = now(), hold_reason = trim(p_reason)
     where id = p_req;
  else
    if v_status <> 'on_hold' then raise exception 'This request is not on hold'; end if;
    update public.fms_supplies_requests
       set status = public.fms_supplies_resume_status(p_req), hold_at = null, hold_reason = null
     where id = p_req;
  end if;
end $$;
grant execute on function public.fms_supplies_hold_request(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- RPC — cancel a request. The raiser, an admin or a coordinator, before delivery.
-- ===========================================================================
drop function if exists public.fms_supplies_cancel_request(uuid, text);
create or replace function public.fms_supplies_cancel_request(p_req uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_raiser uuid;
  v_uid    uuid := auth.uid();
begin
  select status, raised_by into v_status, v_raiser from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status in ('delivered','cancelled','rejected') then
    raise exception 'This request is already %', v_status;
  end if;
  if not (v_raiser = v_uid or public.is_admin(v_uid) or public.fms_supplies_is_coordinator(v_uid)) then
    raise exception 'Only the requester, an admin or a coordinator can cancel this request';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to cancel'; end if;

  update public.fms_supplies_requests set
    status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason)
  where id = p_req;
end $$;
grant execute on function public.fms_supplies_cancel_request(uuid, text) to authenticated;
