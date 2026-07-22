-- ===========================================================================
-- PRODUCTION ENTRY FMS — REWORK STEP "PRODUCTION ENTRY".
--
-- The production entry now shows the log-book items (read-only) and captures, at
-- the top: the FG item + Expected Qty (Σ actual use from the log book), Scrap,
-- Actual Output (expected − scrap) and a Lab Testing Qty.
--
-- Additive: pe_expected_qty + pe_lab_qty columns. scrap_qty / actual_qty reuse
-- the existing columns (actual_qty = actual output). pe_status / lot_no are no
-- longer captured here (kept, unused). Reversal: drop the two columns and restore
-- the two RPC bodies.
-- ===========================================================================

alter table public.fms_production_requests add column if not exists pe_expected_qty numeric;
alter table public.fms_production_requests add column if not exists pe_lab_qty      numeric;

comment on column public.fms_production_requests.pe_expected_qty is
  'Expected FG quantity at production entry — the total actual-use quantity carried from the log book. actual_qty (Actual Output) = pe_expected_qty − scrap_qty; pe_lab_qty is the lab-testing quantity.';

-- ---------------------------------------------------------------------------
-- RECORD (production_entry -> quality): expected / scrap / actual output / lab.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_record_production(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_production' then raise exception 'This job card is not awaiting production entry (status %)', v_status; end if;
  if not public.fms_production_can_act('production_entry', p_req, v_uid) then raise exception 'Not authorized to record production entry'; end if;

  update public.fms_production_requests set
    pe_actual_date  = coalesce(nullif(p->>'pe_actual_date','')::date, current_date),
    pe_expected_qty = nullif(p->>'pe_expected_qty','')::numeric,
    scrap_qty       = nullif(p->>'scrap_qty','')::numeric,
    actual_qty      = nullif(p->>'actual_qty','')::numeric,
    pe_lab_qty      = nullif(p->>'pe_lab_qty','')::numeric,
    pe_remarks      = nullif(trim(p->>'pe_remarks'), ''),
    pe_at = coalesce(pe_at, now()), pe_by = coalesce(pe_by, v_uid),
    status = 'awaiting_quality', current_step = 'quality_check'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_entry',
    'Production entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for quality checking.',
    public.fms_production_step_owner_ids('quality_check'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_production(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- UPDATE (correct until quality checking): same fields.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_update_production(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('production_entry', p_req, v_uid) then raise exception 'Not authorized to edit the production entry'; end if;
  if not public.fms_production_pe_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The production entry can no longer be edited: quality checking has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    pe_actual_date  = coalesce(nullif(p->>'pe_actual_date','')::date, pe_actual_date),
    pe_expected_qty = nullif(p->>'pe_expected_qty','')::numeric,
    scrap_qty       = nullif(p->>'scrap_qty','')::numeric,
    actual_qty      = nullif(p->>'actual_qty','')::numeric,
    pe_lab_qty      = nullif(p->>'pe_lab_qty','')::numeric,
    pe_remarks      = nullif(trim(p->>'pe_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_edited',
    format('Production entry on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_production(uuid, jsonb) to authenticated;
