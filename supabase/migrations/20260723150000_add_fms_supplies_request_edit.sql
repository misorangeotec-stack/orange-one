-- Office Supplies FMS: edit a submitted request, before anyone acts on it.
--
-- Supplies could already be cancelled by its requester but not corrected. A
-- request is editable while nobody has acted: waiting for first approval, OR a
-- no-approval request still waiting for handover. All the audit/cancel columns
-- already exist, so this migration is RPCs only.
--
-- Editing the CATEGORY can flip the route (a category's requires_approval
-- decides whether the request needs approval at all), so update_request
-- recomputes requires_approval / status / current_step exactly as submit does —
-- otherwise a request would strand in the wrong queue.

begin;

create or replace function public.fms_supplies_request_editable(p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_supplies_requests r
     where r.id = p_req
       and (
         r.status = 'pending_first_approval'
         -- A no-approval request is born at pending_handover; it stays editable
         -- until the handover team actually acts.
         or (r.status = 'pending_handover' and r.requires_approval = false and r.handed_over_at is null)
       )
  );
$$;
grant execute on function public.fms_supplies_request_editable(uuid) to authenticated;

comment on function public.fms_supplies_request_editable(uuid) is
  'True while a supply request may still be edited by its requester: awaiting '
  'first approval, or a no-approval request still awaiting handover. Any '
  'approval, handover, hold or rejection locks it.';

-- ---- update ----------------------------------------------------------------
create or replace function public.fms_supplies_update_request(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_req       uuid := nullif(p->>'id','')::uuid;
  v_uid       uuid := auth.uid();
  v_raiser    uuid;
  v_no        text;
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
  if v_req is null then raise exception 'Request id is required'; end if;
  if v_uid is null then raise exception 'Not signed in'; end if;

  select raised_by, req_no into v_raiser, v_no
    from public.fms_supplies_requests where id = v_req for update;
  if v_raiser is null then raise exception 'Request not found'; end if;

  -- Same authz as cancel: requester, admin or coordinator.
  if not (v_raiser = v_uid or public.is_admin(v_uid) or public.fms_supplies_is_coordinator(v_uid)) then
    raise exception 'Only the requester, an admin or a coordinator can edit this request';
  end if;
  -- Re-check state server-side. The hidden button is a courtesy, never the gate.
  if not public.fms_supplies_request_editable(v_req) then
    raise exception 'This request can no longer be edited — it has already been acted on.';
  end if;

  -- Validation, mirroring submit.
  if v_type not in ('new_requirement','services_maintenance') then
    raise exception 'Unknown request type %', v_type;
  end if;
  if (p->>'company_id') is null or trim(p->>'company_id') = '' then raise exception 'Company is required'; end if;
  if coalesce(p->>'location','') not in ('Plant','Office') then raise exception 'Location is required'; end if;
  if coalesce(trim(p->>'quantity'), '') = '' then raise exception 'Quantity is required'; end if;

  -- Department is DERIVED, not trusted — same rule as submit.
  v_dept := public.fms_supplies_department_for_user(coalesce(v_for_user, v_uid));
  if v_dept is null and v_for_user is not null then
    v_dept := public.fms_supplies_department_for_user(v_uid);
  end if;
  if v_dept is null then
    v_dept := nullif(p->>'department_id','')::uuid;
  end if;
  if v_dept is null then
    raise exception 'No department is set on your profile. Ask an admin to set it before editing this request.';
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

  -- Recompute the route from the (possibly changed) category.
  if v_requires then
    select hod_user_id into v_hod from public.fms_supplies_departments where id = v_dept;
    if v_hod is null then
      raise exception 'No HOD is set for department "%". Ask an admin to set one in Masters → Departments before this request can require approval.',
        coalesce((select name from public.fms_supplies_departments where id = v_dept), '?');
    end if;
    v_status := 'pending_first_approval';
    v_step   := 'first_approval';
  else
    v_status := 'pending_handover';
    v_step   := 'handover';
  end if;

  update public.fms_supplies_requests set
    company_id            = (p->>'company_id')::uuid,
    location              = p->>'location',
    department_id         = v_dept,
    requested_for_name    = v_for_name,
    requested_for_user_id = v_for_user,
    raised_on_behalf      = (v_for_user is not null and v_for_user <> v_uid)
                            or (v_for_user is null and v_for_name is not null and v_for_name <> coalesce((select name from public.profiles where id = v_uid), '')),
    request_type          = v_type,
    category_id           = v_cat,
    service_type_id       = nullif(p->>'service_type_id','')::uuid,
    item_name             = nullif(trim(p->>'item_name'), ''),
    quantity              = trim(p->>'quantity'),
    reason                = nullif(trim(p->>'reason'), ''),
    requires_approval     = v_requires,
    status                = v_status,
    current_step          = v_step,
    edited_at             = now(),
    edited_by             = v_uid
  where id = v_req;

  -- Re-announce to whoever is now next (the route may have just changed).
  if v_requires then
    perform public.fms_supplies_announce(
      'request', v_req, 'edited',
      'Supply request ' || v_no || ' was edited and needs your approval.',
      array[v_hod],
      jsonb_build_object('req_no', v_no)
    );
  else
    perform public.fms_supplies_announce(
      'request', v_req, 'edited',
      'Supply request ' || v_no || ' was edited and is ready for handover.',
      public.fms_supplies_step_owner_ids('handover'),
      jsonb_build_object('req_no', v_no)
    );
  end if;
end $function$;
grant execute on function public.fms_supplies_update_request(jsonb) to authenticated;

commit;
