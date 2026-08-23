-- ===========================================================================
-- PC-1 · pc_step_owner_contacts() — for every FMS step, who owns it and how to
--        reach them.
--
-- This is the half of PC-1 that does not exist anywhere today. The FMS Control
-- Center names the delayed STEP but never the PERSON, and there is no read path
-- in the whole app that reaches an owner's phone or email:
--   · profiles RLS is self + downline + same-department (a sample non-admin
--     sees 7 of 60 rows), and
--   · list_org_people() strips phone and email DELIBERATELY, because the phone
--     doubles as the user's initial login password.
-- So this function is security definer out of necessity, and gated tightly.
--
-- ⚠ employee_ids IS THE ONLY SOURCE OF OWNERSHIP. These tables also carry
--   department_ids and designation_id, and it is tempting to expand them into
--   "everyone in Accounts with the Executive designation". DO NOT. The app's own
--   resolvers never read those columns — shared/lib/fmsOwners.ts resolves step
--   ownership from employee_ids alone, and the HR foundations migration states
--   outright that "AUTHORIZATION COMES SOLELY FROM employee_ids". Expanding
--   them here would invent owners who hold no authority and send the
--   coordinator to ring the wrong person.
--
-- ⚠ A STEP WITH NO OWNER RETURNS A ROW, with a null user_id — it does not
--   vanish. An unowned step is exactly the kind of delay this dashboard exists
--   to surface, so it has to be visible as "No owner set" rather than silently
--   absent. `left join lateral ... on true` is what preserves it: unnest() of an
--   empty array yields no rows, and an inner join would drop the step.
--   Measured 2026-08-23: 7 steps resolve to nobody (6 dispatch, 1 supplies),
--   and four modules — asset, customer, ocpi, travel — have no step-owner rows
--   at all.
--
-- ⚠ app_id IS THE MANIFEST ID. Three do not match their table prefix:
--   fms_purchase_* → 'procurement', fms_hr_* → 'hr-recruitment',
--   fms_exit_* → 'hr-exit'. The screen joins the FMS adapter registry on this.
--
-- ⚠ location_id IS DISPATCH-ONLY. fms_dispatch_step_owners is the one table
--   with several rows per step, keyed by location (null = the fallback grant).
--   Every other arm returns null so the shape stays uniform.
--
-- A non-null user_id with a null name means the owner list references a profile
-- that no longer exists — worth showing as an unknown user rather than hiding.
--
-- Purely ADDITIVE: one new function. No table, column, row or policy touched.
--
-- Reversal: drop function if exists public.pc_step_owner_contacts();
-- ===========================================================================

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
