-- ===========================================================================
-- PRODUCTION ENTRY FMS — REORDER THE CHAIN (Production → M/C testing).
--
-- Part of the larger reorder that moves Quality Check BEFORE the Log Book Entry
-- and drops Packing Material Handover. This migration owns the ONE piece that is
-- a pure successor change with no feature work: PRODUCTION ENTRY now advances to
-- M/C TESTING (it used to advance to Quality Checking).
--
-- New linear order:
--   issue_slip → material_handover → rm_transfer → quality_check →
--   transfer_slip(log book) → production_entry → mc_testing → pm_transfer →
--   packing_entry → ready_to_dispatch → fg_transfer → closed
-- (rm_transfer→quality and quality→log-book live in the additional_issue_slip
--  migration; mc_testing→pm_transfer in the mc_bypass migration; packing→
--  ready_to_dispatch and the final resume_status in the ready_to_dispatch
--  migration.)
--
-- Replace-only. Based on the current (Tally-posting) production RPCs from
-- 20260728230000_fms_production_move_metrics_to_logbook.sql.
-- ===========================================================================

-- Production entry advances to M/C testing (was quality checking).
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
    pe_tally_entry  = nullif(trim(p->>'pe_tally_entry'), ''),
    pe_remarks      = nullif(trim(p->>'pe_remarks'), ''),
    pe_at = coalesce(pe_at, now()), pe_by = coalesce(pe_by, v_uid),
    status = 'awaiting_mc_testing', current_step = 'mc_testing'
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_entry',
    'Production entry recorded for ' || coalesce(v_no,'a job card') || ' — ready for M/C testing.',
    public.fms_production_step_owner_ids('mc_testing'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_production_record_production(uuid, jsonb) to authenticated;

-- Production entry is now editable until M/C TESTING is recorded (was quality).
create or replace function public.fms_production_pe_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.pe_at is not null and r.status = 'awaiting_mc_testing');
$$;
grant execute on function public.fms_production_pe_editable(uuid) to authenticated;

create or replace function public.fms_production_update_production(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('production_entry', p_req, v_uid) then raise exception 'Not authorized to edit the production entry'; end if;
  if not public.fms_production_pe_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'The production entry can no longer be edited: M/C testing has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    pe_actual_date  = coalesce(nullif(p->>'pe_actual_date','')::date, pe_actual_date),
    pe_tally_entry  = nullif(trim(p->>'pe_tally_entry'), ''),
    pe_remarks      = nullif(trim(p->>'pe_remarks'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'production_edited',
    format('Production entry on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_production(uuid, jsonb) to authenticated;
