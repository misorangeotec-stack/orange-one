-- ===========================================================================
-- PRODUCTION ENTRY FMS — AUTO LOT/BATCH (ISSUE SLIP) NUMBER + FG TOTAL QTY.
--
-- The issue slip no longer takes a typed "Lot/Batch Card Number". It is now
-- AUTO-GENERATED in the format  YY MM - NNNN  (e.g. 2607-0001):
--   YY  = two-digit calendar year   (to_char(current_date,'YY'))
--   MM  = two-digit calendar month  (to_char(current_date,'MM'))
--   NNNN = a SINGLE CONTINUOUS 4-digit counter (NOT reset monthly) seeded once
--          by an admin ("starting number") and incremented +1 per job card.
-- The generated number is stored in `jobcard_no` (the column the UI already
-- shows as the Lot/Batch Card), replacing the client-supplied value. `req_no`
-- (PRD-….) is unchanged.
--
-- The issue slip also captures an FG TOTAL QUANTITY to produce (new fg_qty
-- column) — the raw-material line quantities must sum to it (enforced in the UI;
-- stored here for reporting).
--
-- Numbering:
--   * config key `batch_seq_start` (jsonb {"start": N}) — the admin start value.
--   * counter scope 'BATCH' in fms_production_counters holds the running value.
--   * fms_production_next_batch_seq() returns greatest(last+1, start) atomically,
--     so raising the start jumps the sequence up and lowering it never goes back
--     (no duplicate numbers).
--
-- Purely ADDITIVE. Reversal: drop fg_qty + next_batch_seq and restore the
-- submit RPC body from 20260728250000.
-- ===========================================================================

alter table public.fms_production_requests add column if not exists fg_qty numeric;
comment on column public.fms_production_requests.fg_qty is
  'FG total quantity to produce for this job card (issue slip). The raw-material line quantities must sum to it.';

-- ---------------------------------------------------------------------------
-- Continuous batch counter honouring the admin-configured starting number.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_next_batch_seq()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start integer;
  v_next  integer;
begin
  select greatest(coalesce((value->>'start')::integer, 1), 1)
    into v_start
  from public.fms_production_config
  where key = 'batch_seq_start';
  v_start := coalesce(v_start, 1);

  insert into public.fms_production_counters (scope, last_value)
  values ('BATCH', v_start)
  on conflict (scope) do update
    set last_value = greatest(public.fms_production_counters.last_value + 1, v_start),
        updated_at = now()
  returning last_value into v_next;

  return v_next;
end $$;
comment on function public.fms_production_next_batch_seq() is
  'Next continuous batch sequence value = greatest(last+1, configured start). Seeds the BATCH counter at the start on first use.';
grant execute on function public.fms_production_next_batch_seq() to authenticated;

-- ---------------------------------------------------------------------------
-- RAISE a job card: auto-generate the batch number into jobcard_no; capture the
-- FG total quantity. (Based on 20260728250000; the only changes are the
-- jobcard_no generation, the dropped "job card number required" guard, and
-- fg_qty.)
-- ---------------------------------------------------------------------------
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
  v_bseq   integer;
  v_batch  text;
  v_fy     text  := public.fms_production_fy_code(current_date);
  v_uid    uuid  := auth.uid();
  v_name   text  := nullif(trim(p->>'requester_name'), '');
  v_lines  jsonb := coalesce(p->'bom_lines', '[]'::jsonb);
  v_first  jsonb;
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

  -- Normalise the BOM: must be an array; drop blank rows (no raw_material_id).
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'bom_lines must be a JSON array';
  end if;
  select coalesce(jsonb_agg(l), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(v_lines) l
  where coalesce(trim(l->>'raw_material_id'), '') <> '';

  v_first := v_lines->0;  -- NULL when the BOM is empty

  v_rm   := coalesce(nullif(trim(v_first->>'raw_material_id'), ''), nullif(trim(p->>'raw_material_id'), ''));
  v_qty  := coalesce(nullif(v_first->>'required_qty', ''),          nullif(p->>'required_qty', ''));
  v_unit := coalesce(nullif(v_first->>'unit_id', ''),               nullif(p->>'unit_id', ''));

  if v_rm is null then raise exception 'At least one raw material is required'; end if;
  if (p->>'fg_item_id') is null or trim(p->>'fg_item_id') = '' then raise exception 'Finished-good item is required'; end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  -- Internal reference number (PRD-2627-0001).
  v_seq := public.fms_production_next_seq('PRD-' || v_fy);
  v_no  := 'PRD-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  -- Lot/Batch (Issue Slip) number: YYMM-NNNN, continuous NNNN.
  v_bseq  := public.fms_production_next_batch_seq();
  v_batch := to_char(current_date, 'YY') || to_char(current_date, 'MM') || '-' || lpad(v_bseq::text, 4, '0');

  insert into public.fms_production_requests (
    req_no, jobcard_no, category_id, raw_material_id, required_qty, unit_id, fg_item_id, fg_qty,
    bom_lines, issue_remarks, raised_by, requester_name, status, current_step, submitted_at
  ) values (
    v_no,
    v_batch,
    nullif(p->>'category_id','')::uuid,
    v_rm::uuid,
    nullif(v_qty,'')::numeric,
    nullif(v_unit,'')::uuid,
    (p->>'fg_item_id')::uuid,
    nullif(p->>'fg_qty','')::numeric,
    v_lines,
    nullif(trim(p->>'issue_remarks'), ''),
    v_uid, v_name,
    'awaiting_material_handover', 'material_handover', now()
  )
  returning id into v_id;

  perform public.fms_production_announce(
    'request', v_id, 'raised',
    'Job card ' || v_no || ' (' || v_batch || ') raised — ready for material handover confirmation.',
    public.fms_production_step_owner_ids('material_handover'),
    jsonb_build_object('req_no', v_no)
  );

  return v_id;
end $$;
grant execute on function public.fms_production_submit_request(jsonb) to authenticated;
