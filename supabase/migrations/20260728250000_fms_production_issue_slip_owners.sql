-- ===========================================================================
-- PRODUCTION ENTRY FMS — allow OWNERS on the "Raise Request" (issue_slip) step.
--
-- issue_slip used to be un-ownable (CHECK barred it) because every granted user
-- could raise a job card. We now let admins assign owners to it in Setup → Step
-- Owners. Semantics (safe, no lockout): raising stays OPEN to every module user
-- UNLESS owners are configured for issue_slip, in which case only those owners
-- (or an admin / coordinator) may raise. No owners = current behaviour.
--
-- Additive: drop the CHECK; re-check in submit_request. Reversal: restore the
-- CHECK (after clearing any issue_slip rows) and the prior submit RPC body.
-- ===========================================================================

alter table public.fms_production_step_owners
  drop constraint if exists fms_production_step_owners_not_issue;

comment on table public.fms_production_step_owners is
  'Owners per Production Entry FMS workflow step (step_key). employee_ids are the notified/authorized owners; department_ids is a UI filter only. issue_slip (Raise Request) MAY have owners: when set, only they (or admin/coordinator) can raise a job card; when empty, raising is open to every granted user.';

create or replace function public.fms_production_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_no     text;
  v_seq    integer;
  v_fy     text  := public.fms_production_fy_code(current_date);
  v_uid    uuid  := auth.uid();
  v_name   text  := nullif(trim(p->>'requester_name'), '');
  v_lines  jsonb := coalesce(p->'bom_lines', '[]'::jsonb);
  v_first  jsonb;
  -- legacy-mirror values: prefer the first BOM line, else the flat keys.
  v_rm     text;
  v_qty    text;
  v_unit   text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  -- Raise-Request authorization: open to all module users unless issue_slip has
  -- owners configured, in which case only they / admin / coordinator may raise.
  if exists (
    select 1 from public.fms_production_step_owners
    where step_key = 'issue_slip' and coalesce(array_length(employee_ids, 1), 0) > 0
  ) and not public.fms_production_can_act('issue_slip', null, v_uid) then
    raise exception 'You are not authorized to raise a job card. Ask an admin to add you as an owner of the Raise Request step.';
  end if;

  if coalesce(trim(p->>'jobcard_no'), '') = '' then raise exception 'Job card number is required'; end if;

  -- Normalise the BOM: must be an array; drop blank rows (no raw_material_id).
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'bom_lines must be a JSON array';
  end if;
  select coalesce(jsonb_agg(l), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(v_lines) l
  where coalesce(trim(l->>'raw_material_id'), '') <> '';

  v_first := v_lines->0;  -- NULL when the BOM is empty (legacy single-RM call)

  v_rm   := coalesce(nullif(trim(v_first->>'raw_material_id'), ''), nullif(trim(p->>'raw_material_id'), ''));
  v_qty  := coalesce(nullif(v_first->>'required_qty', ''),          nullif(p->>'required_qty', ''));
  v_unit := coalesce(nullif(v_first->>'unit_id', ''),               nullif(p->>'unit_id', ''));

  if v_rm is null then raise exception 'At least one raw material is required'; end if;
  if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then raise exception 'Finished-good item is required'; end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  v_seq := public.fms_production_next_seq('PRD-' || v_fy);
  v_no  := 'PRD-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_production_requests (
    req_no, jobcard_no, category_id, raw_material_id, required_qty, unit_id, fg_item_id,
    bom_lines, issue_remarks, raised_by, requester_name, status, current_step, submitted_at
  ) values (
    v_no,
    trim(p->>'jobcard_no'),
    nullif(p->>'category_id','')::uuid,
    v_rm::uuid,
    nullif(v_qty,'')::numeric,
    nullif(v_unit,'')::uuid,
    (p->>'fg_item_id')::uuid,
    v_lines,
    nullif(trim(p->>'issue_remarks'), ''),
    v_uid, v_name,
    'awaiting_material_handover', 'material_handover', now()
  )
  returning id into v_id;

  perform public.fms_production_announce(
    'request', v_id, 'raised',
    'Job card ' || v_no || ' raised — ready for material handover confirmation.',
    public.fms_production_step_owner_ids('material_handover'),
    jsonb_build_object('req_no', v_no)
  );

  return v_id;
end $$;
grant execute on function public.fms_production_submit_request(jsonb) to authenticated;
