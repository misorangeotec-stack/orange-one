-- ===========================================================================
-- PRODUCTION ENTRY FMS — EDIT THE ISSUE SLIP (step 1).
--
-- Until now the issue slip was final once raised: submit_request only INSERTs,
-- updateStep explicitly excludes the issue_slip step, and direct table writes
-- are admin-only under RLS. A typo in the FG qty or a wrong raw-material line
-- meant cancelling and re-raising the card.
--
-- The rule, in one sentence: an issue slip may be edited while it is still
-- 'awaiting_material_handover' and the ORIGINAL material handover has not been
-- recorded (mh_at is null). The moment handover starts the BOM is in play, so it
-- locks. Note: the Additional-Issue-Slip (QC-reject) loop RE-ENTERS
-- 'awaiting_material_handover', but on such a card mh_at is already set, so
-- testing mh_at is null correctly keeps only a brand-new, never-handed-over slip
-- editable. on_hold / cancelled are different statuses and are excluded too.
--
-- Follows the RPC contract used across this FMS + the Import edit template
-- (20260722120000): a STABLE *_editable() predicate + an RPC that re-checks
-- authz AND state SERVER-side (the hidden button is a courtesy, never the gate),
-- takes a row lock, stamps edited_at/edited_by (columns already exist), mirrors
-- submit_request's BOM normalisation, and announces IN THIS TRANSACTION.
--
-- Purely ADDITIVE. Reversal: drop the two functions below. No columns/data are
-- changed (edited_at/edited_by predate this migration).
-- ===========================================================================

begin;

-- ---- 1. the editable predicate ----------------------------------------------
create or replace function public.fms_production_request_editable(p_req uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_production_requests r
     where r.id = p_req
       and r.status = 'awaiting_material_handover'
       and r.mh_at is null   -- original handover not yet recorded (excludes AIS re-loop)
  );
$$;
grant execute on function public.fms_production_request_editable(uuid) to authenticated;

comment on function public.fms_production_request_editable(uuid) is
  'True while an issue slip may still be edited: awaiting the FIRST material '
  'handover (status awaiting_material_handover AND mh_at is null). Recording '
  'handover, holding, or cancelling the card locks it.';

-- ---- 2. update_request -------------------------------------------------------
-- Edits ONLY the issue-slip fields (fg_item_id, fg_qty, bom_lines + the legacy
-- single-RM mirror, issue_remarks). Never touches jobcard_no, req_no, raised_by,
-- submitted_at, status or current_step. bom_lines is a single jsonb blob (not
-- child rows), so the array is simply replaced — no upsert-by-id needed.

create or replace function public.fms_production_update_request(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid  := auth.uid();
  v_raiser uuid;
  v_status text;
  v_no     text;
  v_lines  jsonb := coalesce(p->'bom_lines', '[]'::jsonb);
  v_first  jsonb;
  v_rm     text;
  v_qty    text;
  v_unit   text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select raised_by, status, req_no
    into v_raiser, v_status, v_no
    from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Issue slip not found'; end if;

  -- Authz: the raiser, an admin, or a process coordinator (mirrors the Cancel gate).
  if not (v_raiser = v_uid or public.is_admin(v_uid) or public.fms_production_is_coordinator(v_uid)) then
    raise exception 'Only the person who raised this issue slip, an admin or a coordinator can edit it';
  end if;

  -- Re-check state server-side. The hidden button is a courtesy, never the gate.
  if not public.fms_production_request_editable(p_req) then
    if v_status = 'on_hold'   then raise exception 'This issue slip is on hold — take it off hold before editing.'; end if;
    if v_status = 'cancelled' then raise exception 'This issue slip was cancelled — it can no longer be edited.'; end if;
    raise exception 'This issue slip can no longer be edited — material handover has already started.';
  end if;

  -- Normalise the BOM: must be an array; drop blank rows (no raw_material_id).
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'bom_lines must be a JSON array'; end if;
  select coalesce(jsonb_agg(l), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(v_lines) l
  where coalesce(trim(l->>'raw_material_id'), '') <> '';

  v_first := v_lines->0;  -- NULL when the BOM is empty
  v_rm    := nullif(trim(v_first->>'raw_material_id'), '');
  v_qty   := nullif(v_first->>'required_qty', '');
  v_unit  := nullif(v_first->>'unit_id', '');

  if v_rm is null then raise exception 'At least one raw material is required'; end if;
  if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then raise exception 'Finished-good item is required'; end if;

  update public.fms_production_requests
     set fg_item_id      = (p->>'fg_item_id')::uuid,
         fg_qty          = nullif(p->>'fg_qty','')::numeric,
         bom_lines       = v_lines,
         raw_material_id = v_rm::uuid,                       -- legacy single-RM mirror
         required_qty    = nullif(v_qty,'')::numeric,
         unit_id         = nullif(v_unit,'')::uuid,
         issue_remarks   = nullif(trim(p->>'issue_remarks'), ''),
         edited_at       = now(),
         edited_by       = v_uid
   where id = p_req;

  -- In-transaction fan-out to the material-handover owners: the BOM they are
  -- about to hand over just changed.
  perform public.fms_production_announce(
    'request', p_req, 'edited',
    'Issue slip ' || coalesce(v_no, '') || ' was edited — please re-check before material handover.',
    public.fms_production_step_owner_ids('material_handover'),
    jsonb_build_object('edited', true)
  );
end $$;
grant execute on function public.fms_production_update_request(uuid, jsonb) to authenticated;

comment on function public.fms_production_update_request(uuid, jsonb) is
  'Edit the issue slip (step 1). Authz: raiser / admin / coordinator. Re-checks '
  'fms_production_request_editable server-side. Updates fg_item_id, fg_qty, '
  'bom_lines (+ legacy mirror) and issue_remarks; stamps edited_at/edited_by; '
  'leaves jobcard_no, req_no, raised_by, submitted_at, status, current_step '
  'untouched.';

commit;
