-- ===========================================================================
-- General Purchase FMS — who may RAISE a request, and where an HOD's own
-- request goes.
--
-- WHY
--   1. Raising was open to everyone holding the module grant. `requests/new`
--      carried no route guard and fms_supplies_submit_request asked only for a
--      signed-in user. The business wants a named list.
--   2. Every approval-needing request took the same two hops — department HOD,
--      then Management. When the HOD is the one raising it, that first hop is
--      either self-approval or a detour through a colleague with no standing to
--      judge it. An HOD's own request should go straight to Management.
--
-- WHAT THIS DOES
--   A. Two new fms_supplies_config keys — `requesters` and `hod_designations`
--      — both admin-write, following `process_coordinators`.
--   B. Two predicates: fms_supplies_can_raise / fms_supplies_is_hod_designation.
--   C. A `first_approval_skipped` flag on the request, so a skipped step reads
--      as skipped rather than as forever-pending.
--   D. submit + update_request refuse a raiser who is not on the list, and
--      route an HOD's request to `pending_second_approval`.
--   E..G. Three fixes for machinery that assumed first approval ALWAYS happens
--      when requires_approval is true. Each is a real defect once (D) ships:
--        E. first_approval_editable is `status = 'pending_second_approval'`
--           alone — a skipped request sits at exactly that status with a null
--           first_approved_at, so the department HOD could "correct" a decision
--           that was never made.
--        F. resume_status falls through to 'pending_first_approval' whenever
--           first_approved_at is null — so holding and resuming a skipped
--           request would silently reroute it to the step it skipped.
--        G. the `raised` email points at the First-approval queue for anything
--           not awaiting handover. A Management approver clicking that lands on
--           Access Denied: canSeeQueue('first_approval') is false for them.
--
-- ⚠ THE 20260720100000 RULE IS NOT TOUCHED. First approval still belongs to
--   fms_supplies_departments.hod_user_id and ONLY to them; there is still no
--   fall-through to the step-owner list, in either the read gate or the act
--   gate. This migration changes which step a request STARTS at, never who may
--   act on one.
--
-- ⚠ PREREQUISITE: the HOD test reads profiles.designation_id, which the
--   org-masters per-user backfill has not populated yet. Until a leader has a
--   designation assigned in Admin -> Users they are treated as non-HOD and
--   routed to their department HOD — today's behaviour. Nothing breaks; the
--   skip simply never fires. The two self-approval guards in (D) cover the
--   worst case in the meantime.
--
-- ADDITIVE ONLY: one nullable-by-default column, two functions, two seeded
-- config rows. No table, column or row is dropped.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. Config keys.
-- ---------------------------------------------------------------------------
insert into public.fms_supplies_config (key, value)
values ('requesters', jsonb_build_object('user_ids', '[]'::jsonb))
on conflict (key) do nothing;

insert into public.fms_supplies_config (key, value)
values ('hod_designations', jsonb_build_object('designation_ids', '[]'::jsonb))
on conflict (key) do nothing;

comment on table public.fms_supplies_config is
  'Key/value singletons (jsonb) for General Purchase. Keys in use: '
  '`step_sla` -> { "<step_key>": { "anchor": "<step_key>", "days": 1 }, ... }; '
  '`process_coordinators` -> { "user_ids": [ ... ] }; '
  '`requesters` -> { "user_ids": [ ... ] } — who may raise a request, EMPTY MEANS NOBODY BUT ADMINS; '
  '`hod_designations` -> { "designation_ids": [ ... ] } — designations whose holders skip the HOD approval. '
  'Admin-write only: this table was deliberately excluded from the master-owner relaxation in 20260715180000.';

-- ---------------------------------------------------------------------------
-- B. Predicates.
--
-- Both are SECURITY DEFINER for the same reason: the caller is asking about
-- THEMSELVES, but is_hod_designation reads public.profiles, whose RLS
-- (self OR admin OR hod-of OR same_department) would hide the row from a
-- submit made on behalf of someone in another department.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_can_raise(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and (
       public.is_admin(p_uid)
       or exists (
         select 1
           from public.fms_supplies_config c
          where c.key = 'requesters'
            and p_uid::text in (
                  select jsonb_array_elements_text(coalesce(c.value->'user_ids', '[]'::jsonb)))
       )
     );
$$;
grant execute on function public.fms_supplies_can_raise(uuid) to authenticated;

comment on function public.fms_supplies_can_raise(uuid) is
  'May this person raise a General Purchase request? Admins always; everyone else must be named in fms_supplies_config `requesters`. An EMPTY list admits nobody but admins — that is the intended strict default, not a misconfiguration to fall back from.';

create or replace function public.fms_supplies_is_hod_designation(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
      join public.fms_supplies_config c on c.key = 'hod_designations'
     where p.id = p_uid
       and p.designation_id is not null
       and p.designation_id::text in (
             select jsonb_array_elements_text(coalesce(c.value->'designation_ids', '[]'::jsonb)))
  );
$$;
grant execute on function public.fms_supplies_is_hod_designation(uuid) to authenticated;

comment on function public.fms_supplies_is_hod_designation(uuid) is
  'Does this person hold a designation that counts as HOD for General Purchase routing? Reads profiles.designation_id against fms_supplies_config `hod_designations`. False for anyone with no designation set — which is every user until the org-masters backfill lands, so the HOD skip stays dormant rather than misfiring.';

-- ---------------------------------------------------------------------------
-- C. The flag.
--
-- Needed by THREE readers, not just the UI: first_approval_editable (E) and
-- resume_status (F) both have to tell "skipped" from "not yet done", and both
-- of those look identical on the row otherwise — status pending_second_approval
-- with a null first_approved_at.
-- ---------------------------------------------------------------------------
alter table public.fms_supplies_requests
  add column if not exists first_approval_skipped boolean not null default false;

comment on column public.fms_supplies_requests.first_approval_skipped is
  'True when the request needed approval but bypassed first_approval because its subject is an HOD (by designation), or because the department HOD is the raiser/beneficiary themselves. first_approved_at and first_approver_id stay NULL — this flag is what distinguishes a skipped step from one still owed.';

-- ---------------------------------------------------------------------------
-- D1. Submit — the raise gate, and the HOD route.
--
-- Signature unchanged, so `create or replace` keeps the existing grant.
-- ---------------------------------------------------------------------------
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
  v_subject   uuid;
  v_skip      boolean := false;
  v_mgmt      uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- THE RAISE GATE. The hidden nav item and the route guard are a courtesy;
  -- this is what actually stops a direct RPC call.
  if not public.fms_supplies_can_raise(v_uid) then
    raise exception 'You do not have permission to raise a General Purchase request. Ask an admin to add you in Setup → Raising & Routing.';
  end if;

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

  if v_requires then
    -- The routing SUBJECT is the same person the department was derived from,
    -- so raising on behalf of the Sales HOD skips the approval instead of
    -- routing to that HOD to approve their own request.
    v_subject := coalesce(v_for_user, v_uid);
    select hod_user_id into v_hod from public.fms_supplies_departments where id = v_dept;

    -- The last two disjuncts are a SAFEGUARD, not the rule: never route a
    -- request to its own raiser or beneficiary for approval, whatever the
    -- designations say (or fail to say, while the backfill is outstanding).
    v_skip := public.fms_supplies_is_hod_designation(v_subject)
              or (v_hod is not null and v_hod = v_subject)
              or (v_hod is not null and v_hod = v_uid);

    if v_skip then
      v_mgmt := public.fms_supplies_step_owner_ids('second_approval');
      if v_mgmt is null or cardinality(v_mgmt) = 0 then
        raise exception 'No Management approver is configured. Ask an admin to set one in Setup → Step Owners before raising this request.';
      end if;
      v_status := 'pending_second_approval';
      v_step   := 'second_approval';
    else
      -- There is no fallback approver, so a department without an HOD would
      -- strand the request. Refuse it at the door instead, with the remedy.
      if v_hod is null then
        raise exception 'No HOD is set for department "%". Ask an admin to set one in Masters → Departments before raising this request.',
          coalesce((select name from public.fms_supplies_departments where id = v_dept), '?');
      end if;
      v_status := 'pending_first_approval';
      v_step   := 'first_approval';
    end if;
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
    requires_approval, first_approval_skipped, status, current_step, submitted_at
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
    v_requires and v_skip,
    v_status, v_step, now()
  )
  returning id into v_id;

  -- Announce to whoever is next: Management, the department's HOD alone, or
  -- the handover team.
  if v_requires and v_skip then
    perform public.fms_supplies_announce(
      'request', v_id, 'raised',
      'Supply request ' || v_no || ' for ' || v_for_name || ' needs your management approval.',
      v_mgmt,
      jsonb_build_object('req_no', v_no)
    );
  elsif v_requires then
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

-- ---------------------------------------------------------------------------
-- D2. Edit — the SAME routing rule.
--
-- Editing the category can flip the route, so this recomputes it exactly as
-- submit does. The two bodies are duplicated by design (20260723150000); they
-- must not drift, so the block below is submit's, verbatim.
--
-- No raise gate here: the server rule for editing is requester|admin|
-- coordinator, and correcting a request you already raised is not raising one.
-- Someone dropped from the requester list keeps control of their open request.
-- ---------------------------------------------------------------------------
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
  v_subject   uuid;
  v_skip      boolean := false;
  v_mgmt      uuid[];
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
    v_subject := coalesce(v_for_user, v_uid);
    select hod_user_id into v_hod from public.fms_supplies_departments where id = v_dept;

    v_skip := public.fms_supplies_is_hod_designation(v_subject)
              or (v_hod is not null and v_hod = v_subject)
              or (v_hod is not null and v_hod = v_uid);

    if v_skip then
      v_mgmt := public.fms_supplies_step_owner_ids('second_approval');
      if v_mgmt is null or cardinality(v_mgmt) = 0 then
        raise exception 'No Management approver is configured. Ask an admin to set one in Setup → Step Owners before this request can require approval.';
      end if;
      v_status := 'pending_second_approval';
      v_step   := 'second_approval';
    else
      if v_hod is null then
        raise exception 'No HOD is set for department "%". Ask an admin to set one in Masters → Departments before this request can require approval.',
          coalesce((select name from public.fms_supplies_departments where id = v_dept), '?');
      end if;
      v_status := 'pending_first_approval';
      v_step   := 'first_approval';
    end if;
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
    -- Reset, never OR: an edit can move the route BACK off the skip.
    first_approval_skipped = v_requires and v_skip,
    status                = v_status,
    current_step          = v_step,
    edited_at             = now(),
    edited_by             = v_uid
  where id = v_req;

  -- Re-announce to whoever is now next (the route may have just changed).
  if v_requires and v_skip then
    perform public.fms_supplies_announce(
      'request', v_req, 'edited',
      'Supply request ' || v_no || ' was edited and needs your management approval.',
      v_mgmt,
      jsonb_build_object('req_no', v_no)
    );
  elsif v_requires then
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

-- ---------------------------------------------------------------------------
-- E. You cannot correct a decision that was never made.
--
-- `status = 'pending_second_approval'` used to be sufficient BECAUSE reaching
-- that status meant the first approval had happened. The HOD route breaks that
-- implication, so the condition now says what it always meant.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_first_approval_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_supplies_requests r
     where r.id = p_req
       and r.status = 'pending_second_approval'
       and r.first_approved_at is not null
  );
$$;

comment on function public.fms_supplies_first_approval_editable(uuid) is
  'True while the first-approval decision may still be corrected: actually approved, awaiting the second approval, not held / rejected / cancelled. False for a request that SKIPPED first approval — there is no decision to correct.';

create or replace function public.fms_supplies_update_first_approval(
  p_req uuid, p_approve boolean, p_remarks text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_uid uuid := auth.uid(); v_no text; v_skipped boolean;
begin
  select status, req_no, first_approval_skipped into v_status, v_no, v_skipped
    from public.fms_supplies_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;

  if not public.fms_supplies_can_act('first_approval', p_req, v_uid) then
    raise exception 'Not authorized to change this approval';
  end if;

  if not public.fms_supplies_first_approval_editable(p_req) then
    if v_status in ('rejected','cancelled') then
      raise exception 'This request is % — its first approval can no longer be changed.', v_status;
    elsif v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing its first approval.';
    elsif v_skipped then
      raise exception 'This request skipped first approval — it was raised by an HOD, so there is no decision to change.';
    end if;
    raise exception 'The first approval can no longer be changed: the second approval has already been decided (status %).', v_status;
  end if;

  if not p_approve and coalesce(trim(p_remarks), '') = '' then
    raise exception 'A reason is required when the request is not approved';
  end if;

  if p_approve then
    -- The decision STANDS; only the remark moves. first_approver_id and
    -- first_approved_at are the record of who decided and when — untouched.
    update public.fms_supplies_requests set
      first_remarks = nullif(trim(p_remarks), ''),
      edited_at = now(), edited_by = v_uid
    where id = p_req;
  else
    -- The decision FLIPS: this is a new decision, so it takes a new actor and a
    -- new timestamp, and the stale approved-at is cleared — leaving it would date
    -- an approval that was withdrawn.
    update public.fms_supplies_requests set
      first_approved_at = null,
      first_approver_id = v_uid,
      first_remarks     = nullif(trim(p_remarks), ''),
      rejected_at       = now(),
      reject_stage      = 'first_approval',
      reject_reason     = trim(p_remarks),
      status            = 'rejected',
      current_step      = 'first_approval',
      edited_at = now(), edited_by = v_uid
    where id = p_req;
  end if;

  perform public.fms_supplies_announce('request', p_req, 'first_approval_edited',
    format('First approval on %s changed to %s', coalesce(v_no,'the request'),
           case when p_approve then 'approved' else 'not approved' end),
    '{}'::uuid[], jsonb_build_object('approved', p_approve));
end $$;
grant execute on function public.fms_supplies_update_first_approval(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- F. A held request must resume to the step it actually owes.
--
-- The `else` arm reads "requires approval, first approval not done" and answers
-- 'pending_first_approval'. For a skipped request that is exactly wrong: it
-- would send it back through the hop it was routed around. The flag is checked
-- BELOW first_approved_at so a corrected-then-held request still wins.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.handed_over_at is not null      then 'pending_handover'  -- handover in progress
    when not r.requires_approval           then 'pending_handover'
    when r.second_approved_at is not null  then 'pending_handover'
    when r.first_approved_at is not null   then 'pending_second_approval'
    when r.first_approval_skipped          then 'pending_second_approval'
    else 'pending_first_approval'
  end
  from public.fms_supplies_requests r where r.id = p_req;
$$;

-- ---------------------------------------------------------------------------
-- G. The `raised` email must send Management to the Management queue.
--
-- The old branch was binary — handover, else first approval — because those
-- were the only two statuses a new request could be born at. A skipped request
-- is born at pending_second_approval and fell into the `else`, mailing the
-- Management approver a button to a queue canSeeQueue() denies them.
--
-- Body is 20260809120000's VERBATIM; the marked branch is the only difference.
-- Signature unchanged, so no drop and no re-grant.
-- ---------------------------------------------------------------------------
create or replace function public.fms_supplies_email_payload(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_meta        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b text := '/general-purchase';
  r record;
  mr record;
  v_cat text;
  v_doc text;
  v_subject text; v_eyebrow text; v_headline text; v_action text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb;
  v_note jsonb := '{}'::jsonb;
  v_label text;
  v_name text;
begin
  -- ---- master-data governance ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_supplies_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    v_label := case when coalesce(p_meta->>'masterType', mr.master_type) = 'service_type'
                    then 'service type' else 'item' end;
    v_name  := coalesce(mr.proposed_payload->>'name', 'entry');
    if p_type = 'master_requested' then
      return jsonb_build_object(
        'subject', 'New ' || v_label || ' requested - "' || v_name || '"',
        'eyebrow', 'Master request',
        'headline', 'A new ' || v_label || ' was requested',
        'action', 'requested a new ' || v_label,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Review master requests', 'ctaPath', b || '/master-requests');
    else
      return jsonb_build_object(
        'subject', case when p_type = 'master_approved'
                        then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                        else 'Your ' || v_label || ' request was rejected' end,
        'eyebrow', case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
        'headline', case when p_type = 'master_approved'
                         then 'Your new ' || v_label || ' was approved'
                         else 'Your ' || v_label || ' request was rejected' end,
        'action', case when p_type = 'master_approved' then 'approved a ' || v_label else 'rejected a ' || v_label end,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Open masters', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- request workflow ----
  select req.*,
         c.name  as company_name,
         d.name  as dept_name,
         cat.name as category_name,
         st.name as service_name
    into r
    from public.fms_supplies_requests req
    left join public.fms_supplies_companies     c   on c.id  = req.company_id
    left join public.fms_supplies_departments   d   on d.id  = req.department_id
    left join public.fms_supplies_categories    cat on cat.id = req.category_id
    left join public.fms_supplies_service_types st  on st.id  = req.service_type_id
   where req.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_cat := coalesce(r.category_name, r.service_name, '-');
  v_doc := 'Request #' || r.req_no;

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Item','value', coalesce(nullif(btrim(r.item_name),''), '-')),
    jsonb_build_object('label','Quantity','value', coalesce(r.quantity,'-')),
    jsonb_build_object('label', case when r.request_type = 'services_maintenance' then 'Service' else 'Category' end,
                       'value', v_cat),
    jsonb_build_object('label','Company','value', coalesce(r.company_name,'-')),
    jsonb_build_object('label','Department','value', coalesce(r.dept_name,'-')),
    jsonb_build_object('label','Location','value', coalesce(r.location,'-')),
    jsonb_build_object('label','Requested for','value', coalesce(r.requested_for_name,'-'))
  );

  if p_type = 'raised' then
    v_eyebrow := 'New request'; v_action := 'raised a general purchase request';
    if r.status = 'pending_handover' then
      v_headline  := 'A purchase request is ready to hand over';
      v_cta_label := 'Open Handover queue'; v_cta_path := b || '/queues/handover';
    elsif r.status = 'pending_second_approval' then                                 -- CHANGED (new branch)
      v_headline  := 'A purchase request needs your management approval';
      v_cta_label := 'Open Second-approval queue'; v_cta_path := b || '/queues/second-approval';
    else
      v_headline  := 'A purchase request needs your approval';
      v_cta_label := 'Open First-approval queue'; v_cta_path := b || '/queues/first-approval';
    end if;
    v_subject := 'New purchase request - ' || coalesce(nullif(btrim(r.item_name),''), v_cat);
    if coalesce(btrim(r.reason),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Reason','text', r.reason));
    end if;

  elsif p_type = 'first_approved' then
    v_eyebrow := 'First approval'; v_action := 'gave the first approval';
    v_headline := 'First approval done - ready for management approval';
    v_subject := 'Approved (1/2) - ready for management (' || v_doc || ')';
    v_cta_label := 'Open Second-approval queue'; v_cta_path := b || '/queues/second-approval';
    if coalesce(btrim(r.first_remarks),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','HOD remark','value', r.first_remarks));
    end if;

  elsif p_type = 'second_approved' then
    v_eyebrow := 'Second approval'; v_action := 'gave the second approval';
    v_headline := 'Approved - ready for handover';
    v_subject := 'Approved - ready for handover (' || v_doc || ')';
    v_cta_label := 'Open Handover queue'; v_cta_path := b || '/queues/handover';
    if coalesce(btrim(r.second_remarks),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Management remark','value', r.second_remarks));
    end if;

  elsif p_type in ('first_rejected','second_rejected') then
    v_eyebrow := 'Rejected'; v_action := 'rejected a request';
    v_headline := 'Your purchase request was rejected';
    v_subject := 'Your purchase request was rejected';
    v_cta_label := 'Open my request'; v_cta_path := b || '/requests/' || r.id::text;
    if coalesce(btrim(r.reject_reason),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object(
        'label', 'Reason' || case when r.reject_stage = 'first_approval' then ' (first approval)'
                                   when r.reject_stage = 'second_approval' then ' (second approval)'
                                   else '' end,
        'text', r.reject_reason));
    end if;

  elsif p_type = 'delivered' then
    v_eyebrow := 'Delivered'; v_action := 'handed over the items';
    v_headline := 'Your purchase request was delivered';
    v_subject := 'Delivered - ' || v_doc;
    v_cta_label := 'Open the request'; v_cta_path := b || '/requests/' || r.id::text;
    if r.actual_delivery_date is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Delivered on','value', to_char(r.actual_delivery_date,'DD-MM-YYYY')));
    end if;
    if coalesce(btrim(r.handover_remarks),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Handover note','text', r.handover_remarks));
    end if;

  else
    -- unknown / future type: a clean minimal email from the bell text
    v_eyebrow := 'General Purchase'; v_action := 'updated a request';
    v_headline := coalesce(nullif(btrim(p_text),''), 'General Purchase update');
    v_subject := 'General Purchase: ' || v_headline;
    v_cta_label := 'Open the request'; v_cta_path := b || '/requests/' || r.id::text;
  end if;

  return jsonb_build_object(
    'subject', v_subject, 'eyebrow', v_eyebrow, 'headline', v_headline,
    'action', v_action, 'docLabel', v_doc,
    'rows', v_rows,
    'ctaLabel', v_cta_label, 'ctaPath', v_cta_path
  ) || v_note;
exception when others then
  -- content is best-effort: never let a payload glitch break the announce
  return jsonb_build_object('headline', coalesce(nullif(btrim(p_text),''), 'General Purchase update'));
end $$;

-- ---------------------------------------------------------------------------
-- Self-assertions.
-- ---------------------------------------------------------------------------
do $check$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'fms_supplies_requests'
                    and column_name = 'first_approval_skipped') then
    raise exception 'fms_supplies_requests.first_approval_skipped missing';
  end if;

  if (select count(*) from public.fms_supplies_config
       where key in ('requesters','hod_designations')) <> 2 then
    raise exception 'both new config keys must be seeded';
  end if;

  -- Nobody but an admin may raise until the list is filled — the intended default.
  if public.fms_supplies_can_raise('00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'can_raise must be false for an unknown user against an empty list';
  end if;

  -- No designation is configured yet, so no one skips.
  if exists (select 1 from public.profiles p
              where public.fms_supplies_is_hod_designation(p.id)) then
    raise exception 'is_hod_designation must be false for everyone until hod_designations is configured';
  end if;

  -- The four historical requests keep their route.
  if exists (select 1 from public.fms_supplies_requests where first_approval_skipped) then
    raise exception 'no existing request may be flagged as having skipped first approval';
  end if;
end
$check$;
