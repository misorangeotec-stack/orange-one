-- ===========================================================================
-- LEARNING & DEVELOPMENT — THE ANNUAL TRAINING PLAN (LD-2).
--
-- The tables landed with the workflow migration so a session could name the plan
-- line it fulfils from its first row. These are the RPCs that write them.
--
-- WHY THE PLAN EXISTS AT ALL: the source document is entirely request-driven —
-- somebody spots a need, it is approved, it becomes a session. Saloni's KPI sheet
-- scores something the document never mentions:
--     "Annual training calendar publication — 2% — uploaded by January with
--      session dates and participant plan"
--     "Training calendar adherence — 5% — planned sessions completed as scheduled"
-- Adherence has no meaning without a plan to adhere to. The client confirmed both
-- doors on 21-09-2026: a published yearly plan AND mid-year ad-hoc requests.
--
-- ⚠ PUBLICATION IS ONE-WAY AND VERSIONED. A published plan is frozen; changing
--   it creates a NEW revision that supersedes it and keeps the original readable.
--   Without that, "was the calendar published by January" is worth nothing — a
--   plan that can be quietly rewritten in November can be back-fitted to whatever
--   actually happened and score its 2% for nothing.
--
-- Rollback: 20261215120400_ld2_annual_plan_rollback.sql
-- ===========================================================================

-- Who may work the plan: the scheduling step's owners, coordinators, admins.
create or replace function public.fms_ld_can_plan(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fms_ld_is_coordinator(p_uid)
      or public.fms_ld_is_step_owner('session_scheduling', p_uid);
$$;
grant execute on function public.fms_ld_can_plan(uuid) to authenticated;

create or replace function public.fms_ld_create_plan(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_fy text;
begin
  if not public.fms_ld_can_plan(v_uid) then
    raise exception 'Not authorised to build the training plan';
  end if;
  v_fy := coalesce(nullif(p_payload->>'fy_code',''), public.fms_ld_fy_code(current_date));
  if coalesce(p_payload->>'title','') = '' then raise exception 'A title is required'; end if;

  -- One DRAFT per financial year is plenty; a second is almost always a mistake.
  if exists (select 1 from public.fms_ld_plans where fy_code = v_fy and status = 'draft') then
    raise exception 'There is already a draft plan for %', v_fy;
  end if;

  insert into public.fms_ld_plans (fy_code, title, note, created_by)
  values (v_fy, p_payload->>'title', p_payload->>'note', v_uid)
  returning id into v_id;

  perform public.fms_ld_announce('plan', v_id, 'ld_plan_created',
    'Training plan started for ' || v_fy, '{}'::uuid[]);
  return v_id;
end $$;
grant execute on function public.fms_ld_create_plan(jsonb) to authenticated;

create or replace function public.fms_ld_upsert_plan_line(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid := nullif(p_payload->>'id','')::uuid;
  v_plan uuid := nullif(p_payload->>'plan_id','')::uuid;
  v_status text;
begin
  if not public.fms_ld_can_plan(v_uid) then
    raise exception 'Not authorised to edit the training plan';
  end if;

  if v_id is not null then
    select p.status into v_status from public.fms_ld_plans p
      join public.fms_ld_plan_lines l on l.plan_id = p.id where l.id = v_id;
    v_plan := (select plan_id from public.fms_ld_plan_lines where id = v_id);
  else
    select status into v_status from public.fms_ld_plans where id = v_plan;
  end if;

  if v_status is null then raise exception 'Plan not found'; end if;
  -- ⚠ A PUBLISHED PLAN IS FROZEN. Revise it instead (fms_ld_revise_plan).
  if v_status <> 'draft' then
    raise exception 'This plan is % and cannot be edited — start a revision instead', v_status;
  end if;
  if coalesce(p_payload->>'title','') = '' then raise exception 'A title is required'; end if;
  if nullif(p_payload->>'planned_month','') is null then raise exception 'A month is required'; end if;

  if v_id is null then
    insert into public.fms_ld_plan_lines
      (plan_id, planned_month, title, session_type_ids, department_ids,
       planned_headcount, planned_hours, estimated_cost, note)
    values (v_plan,
            date_trunc('month', (p_payload->>'planned_month')::date)::date,
            p_payload->>'title',
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(
              coalesce(p_payload->'session_type_ids','[]'::jsonb)) t(x)), '{}'::uuid[]),
            coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(
              coalesce(p_payload->'department_ids','[]'::jsonb)) t(x)), '{}'::uuid[]),
            nullif(p_payload->>'planned_headcount','')::int,
            nullif(p_payload->>'planned_hours','')::numeric,
            nullif(p_payload->>'estimated_cost','')::numeric,
            p_payload->>'note')
    returning id into v_id;
  else
    update public.fms_ld_plan_lines
       set planned_month = date_trunc('month', (p_payload->>'planned_month')::date)::date,
           title = p_payload->>'title',
           session_type_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(
             coalesce(p_payload->'session_type_ids','[]'::jsonb)) t(x)), session_type_ids),
           department_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(
             coalesce(p_payload->'department_ids','[]'::jsonb)) t(x)), department_ids),
           planned_headcount = nullif(p_payload->>'planned_headcount','')::int,
           planned_hours = nullif(p_payload->>'planned_hours','')::numeric,
           estimated_cost = nullif(p_payload->>'estimated_cost','')::numeric,
           note = p_payload->>'note'
     where id = v_id;
  end if;

  return v_id;
end $$;
grant execute on function public.fms_ld_upsert_plan_line(jsonb) to authenticated;

create or replace function public.fms_ld_delete_plan_line(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_used int;
begin
  if not public.fms_ld_can_plan(auth.uid()) then raise exception 'Not authorised'; end if;
  select p.status into v_status from public.fms_ld_plans p
    join public.fms_ld_plan_lines l on l.plan_id = p.id where l.id = p_id;
  if v_status is null then raise exception 'Plan line not found'; end if;
  if v_status <> 'draft' then raise exception 'A published plan cannot be edited'; end if;

  -- ⚠ A line a session already points at is NOT deletable. Removing it would
  --   orphan the session's adherence link and quietly turn a planned training
  --   into an ad-hoc one — i.e. improve the adherence score by deleting evidence.
  select count(*) into v_used from public.fms_ld_sessions where plan_line_id = p_id;
  if v_used > 0 then
    raise exception 'A session is already linked to this line — unlink it first';
  end if;

  delete from public.fms_ld_plan_lines where id = p_id;
end $$;
grant execute on function public.fms_ld_delete_plan_line(uuid) to authenticated;

/*
 * Publish. One-way.
 *
 * ⚠ RECORDS THE DATE IT HAPPENED, which is the whole point: the KPI line is
 *   "uploaded by January", so the stamp is the evidence. A plan with no lines is
 *   refused — publishing an empty calendar would score the 2% for nothing.
 */
create or replace function public.fms_ld_publish_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_status text; v_lines int; v_fy text;
begin
  if not public.fms_ld_can_plan(v_uid) then raise exception 'Not authorised to publish the plan'; end if;
  select status, fy_code into v_status, v_fy from public.fms_ld_plans where id = p_plan_id for update;
  if v_status is null then raise exception 'Plan not found'; end if;
  if v_status <> 'draft' then raise exception 'This plan is already %', v_status; end if;

  select count(*) into v_lines from public.fms_ld_plan_lines where plan_id = p_plan_id;
  if v_lines = 0 then raise exception 'Add at least one planned training before publishing'; end if;

  update public.fms_ld_plans
     set status = 'published', published_at = now(), published_by = v_uid
   where id = p_plan_id;

  perform public.fms_ld_announce('plan', p_plan_id, 'ld_plan_published',
    'Training plan for ' || v_fy || ' published — ' || v_lines || ' trainings planned',
    '{}'::uuid[]);
end $$;
grant execute on function public.fms_ld_publish_plan(uuid) to authenticated;

/*
 * Revise a published plan: copy it to a new draft, mark the old one superseded.
 *
 * ⚠ THE ORIGINAL STAYS READABLE. That is what makes the publication date mean
 *   anything — a reviser cannot rewrite what January said.
 */
create or replace function public.fms_ld_revise_plan(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_new uuid; v_rev int; v_fy text; v_title text; v_status text;
begin
  if not public.fms_ld_can_plan(v_uid) then raise exception 'Not authorised'; end if;
  select fy_code, title, revision, status into v_fy, v_title, v_rev, v_status
    from public.fms_ld_plans where id = p_plan_id for update;
  if v_fy is null then raise exception 'Plan not found'; end if;
  if v_status <> 'published' then raise exception 'Only a published plan can be revised'; end if;

  insert into public.fms_ld_plans (fy_code, title, status, revision, supersedes_id, created_by)
  values (v_fy, v_title, 'draft', v_rev + 1, p_plan_id, v_uid)
  returning id into v_new;

  insert into public.fms_ld_plan_lines
    (plan_id, planned_month, title, session_type_ids, department_ids, designation_ids,
     band_ids, planned_headcount, planned_hours, estimated_cost, note, sort_order)
  select v_new, planned_month, title, session_type_ids, department_ids, designation_ids,
         band_ids, planned_headcount, planned_hours, estimated_cost, note, sort_order
    from public.fms_ld_plan_lines where plan_id = p_plan_id;

  update public.fms_ld_plans set status = 'superseded' where id = p_plan_id;

  perform public.fms_ld_announce('plan', v_new, 'ld_plan_revised',
    'Training plan for ' || v_fy || ' revised (revision ' || (v_rev + 1) || ')', '{}'::uuid[]);
  return v_new;
end $$;
grant execute on function public.fms_ld_revise_plan(uuid) to authenticated;

/** Point a session at the plan line it fulfils, or unlink it. */
create or replace function public.fms_ld_link_session_to_plan(
  p_session_id uuid,
  p_plan_line_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fms_ld_can_plan(auth.uid()) then raise exception 'Not authorised'; end if;
  update public.fms_ld_sessions set plan_line_id = p_plan_line_id where id = p_session_id;
  perform public.fms_ld_announce('session', p_session_id,
    case when p_plan_line_id is null then 'ld_plan_unlinked' else 'ld_plan_linked' end,
    case when p_plan_line_id is null then 'Unlinked from the annual plan'
         else 'Linked to the annual plan' end, '{}'::uuid[]);
end $$;
grant execute on function public.fms_ld_link_session_to_plan(uuid, uuid) to authenticated;
