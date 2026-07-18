-- ===========================================================================
-- Office Supplies FMS — first approval is the department's HOD, and ONLY the
-- department's HOD.
--
-- WHY
--   The rule wanted: an employee raises a request → only the HOD of that
--   employee's department may see it and approve it. No other department's HOD.
--
--   Two things defeated that:
--     1. `fms_supplies_can_read_request` had a GLOBAL disjunct —
--        `fms_supplies_is_step_owner('first_approval', uid)`. Anyone named in
--        the Setup "First Approval" list read EVERY request in EVERY
--        department. (Live, that list held exactly one person, and NO
--        department had an hod_user_id at all — so first approval was in
--        practice one org-wide approver, not a per-department HOD.)
--     2. `fms_supplies_requests.department_id` is chosen freely in a dropdown.
--        Nothing tied it to the requester, so anyone could file under another
--        department and route around their own HOD.
--
-- WHAT THIS DOES
--   A. Points the app's department master at the PORTAL department list
--      (public.departments — the one already on every profile), so a
--      requester's department can be derived instead of typed. The app's own
--      11-name list (which mixed departments with sites: Plant-Sachin,
--      Hojiwala, Noida) is retired, not dropped — the 12 historical requests
--      keep resolving their name.
--   B. Pre-fills hod_user_id wherever a department has exactly one 'hod'.
--   C. Makes first approval HOD-only, in the read gate AND the act gate, and
--      empties the Setup list.
--   D. Lets an HOD actually READ the activity trail of a request they can see
--      (they never could — the policy only admitted coordinators + fulfilment
--      staff, so their timeline rendered blank).
--   E. Derives the department server-side on submit, so the locked field on
--      the form cannot be bypassed by calling the RPC directly.
--
-- ADDITIVE ONLY: no table, column, or row is dropped. Retired department rows
-- are flagged active=false; the Setup list row is emptied, not deleted.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. Mirror the portal department list into the app's department master.
-- ---------------------------------------------------------------------------
alter table public.fms_supplies_departments
  add column if not exists org_department_id uuid references public.departments on delete set null;

comment on column public.fms_supplies_departments.org_department_id is
  'The portal department (public.departments) this row stands for. Set → the row is live and a requester whose profiles.department_id matches lands here automatically. Null → a retired pre-mirror row, kept only so historical requests still resolve a name.';

create unique index if not exists fms_supplies_departments_org_dept_idx
  on public.fms_supplies_departments (org_department_id)
  where org_department_id is not null;

-- Link the rows whose names already agree (live, that is 'Marketing' alone).
update public.fms_supplies_departments f
   set org_department_id = d.id,
       updated_at        = now()
  from public.departments d
 where f.org_department_id is null
   and lower(trim(d.name)) = lower(trim(f.name))
   and not exists (
     select 1 from public.fms_supplies_departments x
      where x.org_department_id = d.id
   );

-- Create a row for every portal department that has none yet. Names collide
-- with the retired rows only where they already matched above, so a suffix is
-- never needed; the unique(name) constraint is respected by the NOT EXISTS.
insert into public.fms_supplies_departments (name, org_department_id, active, sort_order)
select d.name, d.id, true, 100 + row_number() over (order by d.name)
  from public.departments d
 where not exists (
        select 1 from public.fms_supplies_departments f where f.org_department_id = d.id)
   and not exists (
        select 1 from public.fms_supplies_departments f
         where lower(trim(f.name)) = lower(trim(d.name)));

-- Retire the pre-mirror rows (Account/Finance, Exim, Collection, Plant-Sachin,
-- Hojiwala, Noida, Sales Team, Service Team, HR, MIS). They vanish from every
-- picker; the 12 requests already pointing at them still read their name.
update public.fms_supplies_departments
   set active = false, updated_at = now()
 where org_department_id is null
   and active;

-- Keep the mirrored rows' names in step with the portal from here on.
create or replace function public.fms_supplies_sync_department_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.fms_supplies_departments
     set name = new.name, updated_at = now()
   where org_department_id = new.id
     and name is distinct from new.name;
  return new;
end $$;

drop trigger if exists fms_supplies_departments_name_sync on public.departments;
create trigger fms_supplies_departments_name_sync
  after update of name on public.departments
  for each row execute function public.fms_supplies_sync_department_name();

-- ---------------------------------------------------------------------------
-- B. Pre-fill the HOD where the answer is unambiguous — exactly one person
--    carrying the 'hod' role inside that department. Everything else (Sales
--    has nine leaders; Administration/AI & tech/Management have only admins)
--    is left null for an admin to set in Masters → Departments.
-- ---------------------------------------------------------------------------
update public.fms_supplies_departments f
   set hod_user_id = c.uid, updated_at = now()
  from (
    select p.department_id as dept, (array_agg(p.id))[1] as uid
      from public.profiles p
      join public.user_roles r on r.user_id = p.id and r.role = 'hod'
     where p.department_id is not null
     group by p.department_id
    having count(distinct p.id) = 1
  ) c
 where f.org_department_id = c.dept
   and f.hod_user_id is null;

-- ---------------------------------------------------------------------------
-- Resolve a person → the live app department row, via their profile.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_department_for_user(p_uid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select f.id
    from public.profiles p
    join public.fms_supplies_departments f on f.org_department_id = p.department_id
   where p.id = p_uid
     and f.active
   limit 1;
$$;
grant execute on function public.fms_supplies_department_for_user(uuid) to authenticated;

comment on function public.fms_supplies_department_for_user(uuid) is
  'The Office Supplies department a person belongs to, derived from profiles.department_id. Null when the profile has no department, or its portal department has no live mirror row.';

-- ---------------------------------------------------------------------------
-- C. First approval is HOD-only.
-- ---------------------------------------------------------------------------

-- READ GATE — the `is_step_owner('first_approval')` disjunct is GONE. The
-- row-scoped exists() already limits an HOD to `d.hod_user_id = p_uid`, i.e.
-- their own department and nobody else's. Fulfilment staff (second_approval +
-- handover owners) keep org-wide read: they process every department.
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
      or exists (
        select 1 from public.fms_supplies_requests r
        left join public.fms_supplies_departments d on d.id = r.department_id
        where r.id = p_req
          and (r.raised_by = p_uid
            or r.requested_for_user_id = p_uid
            or d.hod_user_id = p_uid)
      );
$$;

-- ACT GATE — no fall-through to the step-owner list for first_approval.
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
    return v_hod is not null and v_hod = p_uid;
  end if;

  return public.fms_supplies_is_step_owner(p_step_key, p_uid);
end $$;

-- Empty the Setup list. The row stays so the Setup screen and the step-owner
-- machinery keep their shape; it simply names nobody.
update public.fms_supplies_step_owners
   set employee_ids = '{}'::uuid[], updated_at = now()
 where step_key = 'first_approval';

comment on table public.fms_supplies_step_owners is
  'Owners of second_approval and handover. first_approval is NOT owned here — it routes per request to fms_supplies_departments.hod_user_id, and only to them.';

-- ---------------------------------------------------------------------------
-- D. An HOD must be able to read the trail of a request they can read.
--    Inherits the gate above, so it grants nothing wider department-wise.
-- ---------------------------------------------------------------------------
drop policy if exists fms_supplies_activity_select on public.fms_supplies_activity;
create policy fms_supplies_activity_select on public.fms_supplies_activity
  for select to authenticated
  using (
    public.fms_supplies_is_coordinator(auth.uid())
    or public.fms_supplies_is_fulfilment_staff(auth.uid())
    or (entity_type = 'request'
        and public.fms_supplies_can_read_request(entity_id, auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- E. Submit derives the department server-side.
--    Beneficiary's department wins (raising FOR a Sales person routes to the
--    Sales HOD, not the raiser's), then the raiser's own, then — only when
--    neither profile is mapped — whatever the form sent.
-- ---------------------------------------------------------------------------
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
  v_dept      uuid;
  v_hod       uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  if v_type not in ('new_requirement','services_maintenance') then
    raise exception 'Unknown request type %', v_type;
  end if;
  if (p->>'company_id') is null or trim(p->>'company_id') = '' then raise exception 'Company is required'; end if;
  if coalesce(p->>'location','') not in ('Plant','Office') then raise exception 'Location is required'; end if;
  if coalesce(trim(p->>'quantity'), '') = '' then raise exception 'Quantity is required'; end if;

  -- THE DEPARTMENT IS DERIVED, NOT TRUSTED.
  v_dept := public.fms_supplies_department_for_user(coalesce(v_for_user, v_uid));
  if v_dept is null and v_for_user is not null then
    v_dept := public.fms_supplies_department_for_user(v_uid);
  end if;
  if v_dept is null then
    v_dept := nullif(p->>'department_id','')::uuid;   -- unmapped profile: fall back to the form
  end if;
  if v_dept is null then
    raise exception 'No department is set on your profile. Ask an admin to set it before raising a request.';
  end if;

  if v_type = 'new_requirement' then
    if v_cat is null then raise exception 'Category is required'; end if;
    if coalesce(trim(p->>'item_name'), '') = '' then raise exception 'Item is required'; end if;
    select requires_approval into v_requires from public.fms_supplies_categories where id = v_cat;
    v_requires := coalesce(v_requires, false);
  else
    if (p->>'service_type_id') is null or trim(p->>'service_type_id') = '' then
      raise exception 'Service type is required';
    end if;
    v_requires := false;
  end if;

  if v_for_name is null then
    v_for_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  -- There is no fallback approver any more, so a department without an HOD
  -- would strand the request. Refuse it at the door instead, with the remedy.
  if v_requires then
    select hod_user_id into v_hod from public.fms_supplies_departments where id = v_dept;
    if v_hod is null then
      raise exception 'No HOD is set for department "%". Ask an admin to set one in Masters → Departments before raising this request.',
        coalesce((select name from public.fms_supplies_departments where id = v_dept), '?');
    end if;
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
    v_dept,
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

  -- Announce to whoever is next: the department's HOD alone, or the handover team.
  if v_requires then
    perform public.fms_supplies_announce(
      'request', v_id, 'raised',
      'Supply request ' || v_no || ' for ' || v_for_name || ' needs your approval.',
      array[v_hod],
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
