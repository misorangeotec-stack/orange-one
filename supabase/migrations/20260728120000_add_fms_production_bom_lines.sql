-- ===========================================================================
-- PRODUCTION ENTRY FMS — MULTI-RAW-MATERIAL INTAKE (BOM lines).
--
-- The issue-slip intake stored ONE raw material per job card. A card produces
-- one FG item but may consume MANY raw materials — a bill of materials. We add
-- an INTAKE-ONLY BOM as a jsonb array on the existing card row — NO header/line
-- split (the module is deliberately one-entity-per-card, like fms_sampling_*).
--
-- Each element: { "raw_material_id": uuid-text, "required_qty": text/numeric,
--                 "unit_id": uuid-text }. Reference data ONLY: the ten downstream
-- workflow steps keep their own qty columns and do NOT compute from these lines.
-- The FIRST line is mirrored into the legacy raw_material_id/required_qty/unit_id
-- columns (in fms_production_submit_request) so every existing read path and the
-- material-handover step still show the primary raw material.
--
-- Purely ADDITIVE. Reversal:
--   alter table public.fms_production_requests drop column if exists bom_lines;
-- (and restore the previous fms_production_submit_request body from
--  20260725120100_add_fms_production_requests.sql.)
-- ===========================================================================

alter table public.fms_production_requests
  add column if not exists bom_lines jsonb not null default '[]'::jsonb;

alter table public.fms_production_requests
  drop constraint if exists fms_production_requests_bom_lines_is_array;
alter table public.fms_production_requests
  add constraint fms_production_requests_bom_lines_is_array
  check (jsonb_typeof(bom_lines) = 'array');

comment on column public.fms_production_requests.bom_lines is
  'Intake-only BOM for this job card: JSON array of {raw_material_id, required_qty, unit_id} raw-material lines. Reference data ONLY — the ten downstream workflow steps keep their own qty columns and never compute from these lines. The first line is mirrored into the legacy raw_material_id/required_qty/unit_id columns. Empty [] for cards raised before multi-RM intake (read paths fall back to the legacy single columns).';

-- ===========================================================================
-- RPC — raise a job card, now with a multi-raw-material BOM.
-- Backward compatible: still accepts the legacy flat raw_material_id/required_qty/
-- unit_id keys (used when no bom_lines is sent), and mirrors the first BOM line
-- into those legacy columns so old read paths + the material-handover step keep
-- showing the primary RM. Preserves SECURITY DEFINER / search_path / the
-- signed-in check / the grant.
-- ===========================================================================
drop function if exists public.fms_production_submit_request(jsonb);
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

  -- Mirror the first BOM line into the legacy single-RM columns; else the flat keys.
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
