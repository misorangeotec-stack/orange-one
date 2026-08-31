-- ===========================================================================
-- PC-1 · pc_master_requests() — every module's master requests, in one queue.
--
-- Ten modules each own a fms_<mod>_master_requests table. They are, to the
-- column, identical:
--   id, master_type, proposed_payload, status, requested_by, reviewed_by,
--   review_note, resolved_master_id, created_at, updated_at
-- so this is a plain UNION ALL with the manifest app_id stamped on each arm.
--
-- ⚠ THE app_id STRINGS ARE MANIFEST IDS, not table prefixes, and the two do not
--   match for three modules: fms_purchase_* is 'procurement', fms_hr_* is
--   'hr-recruitment', fms_exit_* is 'hr-exit'. The frontend routes the approve
--   call by this value, so a wrong string here sends an approval to the wrong
--   module's RPC.
--
-- ⚠ SAMPLING AND CUSTOMER ONBOARDING ARE ABSENT ON PURPOSE. Both have master
--   MANAGERS and an is_coordinator function, but neither has a master_requests
--   table — there is nothing to queue. Do not add an arm for them until one
--   exists.
--
-- ⚠ SECURITY DEFINER because it deliberately reads past the per-module RLS on
--   ten tables the coordinator may hold no grant on, and joins profiles (which
--   is scoped self + downline + same-department) for the requester's name. It
--   therefore re-checks the grant itself, exactly as master_report_snapshot()
--   does — the route guard is not enough when the data spans modules the viewer
--   does not hold.
--
-- ⚠ NAMES ONLY FROM profiles. The requester's and reviewer's NAME is returned;
--   their phone and email are not. Contact details are a separate, narrower
--   question answered by pc_step_owner_contacts() for step owners only.
--
-- Purely ADDITIVE: one new function. No table, column, row or policy touched.
--
-- Reversal: drop function if exists public.pc_master_requests();
-- ===========================================================================

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
  -- Pending first, then most recently touched. The screen sorts for itself, but
  -- a sensible default matters for anyone calling this straight from SQL.
  order by (raw.status = 'pending') desc, raw.created_at desc;
end;
$$;

comment on function public.pc_master_requests() is
  'Every module''s master requests in one result set, for the Process Coordinator dashboard. '
  'Gated by pc_is_coordinator(). app_id is the MANIFEST id (procurement / hr-recruitment / hr-exit), '
  'not the table prefix. Sampling and customer-onboarding have no master_requests table and are absent.';

revoke all on function public.pc_master_requests() from public;
grant execute on function public.pc_master_requests() to authenticated;
