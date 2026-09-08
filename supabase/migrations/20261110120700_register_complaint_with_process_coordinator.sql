-- ===========================================================================
-- Complaint (RM/FG) FMS — PROCESS COORDINATOR REGISTRATION (Phase 8).
--
-- Re-creates the two cross-module readers with one extra arm each:
--   pc_master_requests()      + fms_complaint_master_requests
--   pc_step_owner_contacts()  + fms_complaint_step_owners
--
-- ⚠ `create or replace` ON A UNION FUNCTION MEANS RETYPING EVERY ARM, and
--   dropping one by accident makes that module's approvals vanish from the
--   coordinator's desk with NO error anywhere. Both bodies below are copied
--   forward verbatim from 20261012120200 / 20261012120300 with a single arm
--   added; the assertion at the foot counts the arms and refuses a shrink.
--
-- ⚠ app_id IS THE MANIFEST ID. Three modules do not match their table prefix:
--   fms_purchase_* → 'procurement', fms_hr_* → 'hr-recruitment',
--   fms_exit_* → 'hr-exit'. Complaint deliberately matches ('complaint' /
--   fms_complaint_*).
--
-- Purely ADDITIVE: two function replacements. No table, column, row or policy
-- touched.
--
-- Reversal: re-apply 20261012120200 and 20261012120300 as they stand.
-- ===========================================================================

begin;

create or replace function public.pc_master_requests()
returns table (
  app_id             text,
  request_id         uuid,
  master_type        text,
  proposed_payload   jsonb,
  status             text,
  requested_by       uuid,
  requester_name     text,
  reviewed_by        uuid,
  reviewer_name      text,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz,
  updated_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pc_is_coordinator(auth.uid()) then
    raise exception 'you do not have access to the Process Coordinator dashboard';
  end if;

  return query
  with raw as (
    select 'procurement'::text       as app_id, r.* from public.fms_purchase_master_requests   r
    union all
    select 'import'::text,                 r.* from public.fms_import_master_requests     r
    union all
    select 'hr-recruitment'::text,         r.* from public.fms_hr_master_requests         r
    union all
    select 'hr-exit'::text,                r.* from public.fms_exit_master_requests       r
    union all
    select 'office-supplies'::text,        r.* from public.fms_supplies_master_requests   r
    union all
    select 'production-entry'::text,       r.* from public.fms_production_master_requests r
    union all
    select 'order-to-dispatch'::text,      r.* from public.fms_dispatch_master_requests   r
    union all
    select 'asset-maintenance'::text,      r.* from public.fms_asset_master_requests      r
    union all
    select 'ocpi'::text,                   r.* from public.fms_ocpi_master_requests       r
    union all
    select 'travel-desk'::text,            r.* from public.fms_travel_master_requests     r
    union all
    select 'complaint'::text,              r.* from public.fms_complaint_master_requests  r
  )
  select
    raw.app_id,
    raw.id,
    raw.master_type,
    raw.proposed_payload,
    raw.status,
    raw.requested_by,
    req.name,
    raw.reviewed_by,
    rev.name,
    raw.review_note,
    raw.resolved_master_id,
    raw.created_at,
    raw.updated_at
  from raw
  left join public.profiles req on req.id = raw.requested_by
  left join public.profiles rev on rev.id = raw.reviewed_by
  order by (raw.status = 'pending') desc, raw.created_at desc;
end;
$$;

comment on function public.pc_master_requests() is
  'Every module''s master requests in one result set, for the Process Coordinator dashboard. '
  'Gated by pc_is_coordinator(). app_id is the MANIFEST id (procurement / hr-recruitment / hr-exit), '
  'not the table prefix. Sampling and customer-onboarding have no master_requests table and are absent.';

revoke all on function public.pc_master_requests() from public;
grant execute on function public.pc_master_requests() to authenticated;


create or replace function public.pc_step_owner_contacts()
returns table (
  app_id      text,
  step_key    text,
  location_id uuid,
  user_id     uuid,
  name        text,
  phone       text,
  email       text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pc_is_coordinator(auth.uid()) then
    raise exception 'you do not have access to the Process Coordinator dashboard';
  end if;

  return query
  with src as (
    select 'asset-maintenance'::text as app_id, o.step_key, null::uuid as location_id, o.employee_ids from public.fms_asset_step_owners      o
    union all
    select 'customer-onboarding'::text, o.step_key, null::uuid,        o.employee_ids from public.fms_customer_step_owners   o
    union all
    select 'order-to-dispatch'::text,   o.step_key, o.location_id,     o.employee_ids from public.fms_dispatch_step_owners   o
    union all
    select 'hr-exit'::text,             o.step_key, null::uuid,        o.employee_ids from public.fms_exit_step_owners       o
    union all
    select 'hr-recruitment'::text,      o.step_key, null::uuid,        o.employee_ids from public.fms_hr_step_owners         o
    union all
    select 'import'::text,              o.step_key, null::uuid,        o.employee_ids from public.fms_import_step_owners     o
    union all
    select 'ocpi'::text,                o.step_key, null::uuid,        o.employee_ids from public.fms_ocpi_step_owners       o
    union all
    select 'production-entry'::text,    o.step_key, null::uuid,        o.employee_ids from public.fms_production_step_owners o
    union all
    select 'procurement'::text,         o.step_key, null::uuid,        o.employee_ids from public.fms_purchase_step_owners   o
    union all
    select 'sampling'::text,            o.step_key, null::uuid,        o.employee_ids from public.fms_sampling_step_owners   o
    union all
    select 'office-supplies'::text,     o.step_key, null::uuid,        o.employee_ids from public.fms_supplies_step_owners   o
    union all
    select 'travel-desk'::text,         o.step_key, null::uuid,        o.employee_ids from public.fms_travel_step_owners     o
    union all
    select 'complaint'::text,           o.step_key, null::uuid,        o.employee_ids from public.fms_complaint_step_owners  o
  )
  select
    src.app_id,
    src.step_key,
    src.location_id,
    u.uid,
    p.name,
    p.phone,
    p.email
  from src
  -- `on true`, not an inner join: an unowned step must survive as a null row.
  left join lateral unnest(src.employee_ids) as u(uid) on true
  left join public.profiles p on p.id = u.uid
  order by src.app_id, src.step_key, p.name nulls first;
end;
$$;

comment on function public.pc_step_owner_contacts() is
  'For every FMS step, its owners with name/phone/email, for the Process Coordinator dashboard. '
  'Gated by pc_is_coordinator(). Reads employee_ids ONLY — department_ids/designation_id are not '
  'ownership. A step with no owner returns one row with a null user_id so it can render as '
  '"No owner set". app_id is the MANIFEST id, not the table prefix.';

revoke all on function public.pc_step_owner_contacts() from public;
grant execute on function public.pc_step_owner_contacts() to authenticated;


do $mig$
declare
  v_mr  int;
  v_soc int;
begin
  -- Count the arms. This is the guard against a copy-forward that silently
  -- dropped somebody else's module.
  v_mr := (length(pg_get_functiondef('public.pc_master_requests()'::regprocedure))
           - length(replace(pg_get_functiondef('public.pc_master_requests()'::regprocedure), 'union all', '')))
          / length('union all');
  if v_mr < 10 then
    raise exception 'pc_master_requests lost an arm: expected at least 10 union-alls, found %', v_mr;
  end if;

  v_soc := (length(pg_get_functiondef('public.pc_step_owner_contacts()'::regprocedure))
            - length(replace(pg_get_functiondef('public.pc_step_owner_contacts()'::regprocedure), 'union all', '')))
           / length('union all');
  if v_soc < 12 then
    raise exception 'pc_step_owner_contacts lost an arm: expected at least 12 union-alls, found %', v_soc;
  end if;

  if position('fms_complaint_master_requests' in
              pg_get_functiondef('public.pc_master_requests()'::regprocedure)) = 0 then
    raise exception 'pc_master_requests does not reach the Complaint module';
  end if;
  if position('fms_complaint_step_owners' in
              pg_get_functiondef('public.pc_step_owner_contacts()'::regprocedure)) = 0 then
    raise exception 'pc_step_owner_contacts does not reach the Complaint module';
  end if;
end $mig$;

commit;
