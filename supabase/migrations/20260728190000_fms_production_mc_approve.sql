-- ===========================================================================
-- PRODUCTION ENTRY FMS — M/C TESTING as a SINGLE approve / reject decision.
--
-- Machine testing mirrors quality checking, but with NO retests: the tester
-- records ONE result (approved | reject) with remarks and an optional
-- attachment. An APPROVAL advances the card to packing-material handover; a
-- REJECTION keeps it in M/C testing so the same single test can be re-recorded
-- once the machine issue is resolved (no rounds, no auto retest date).
--
-- Additive: mc_attachment_path / mc_attachment_name for the test report. The
-- result reuses the existing mc_status column ('approved' | 'rejected').
-- ===========================================================================

alter table public.fms_production_requests add column if not exists mc_attachment_path text;
alter table public.fms_production_requests add column if not exists mc_attachment_name text;

comment on column public.fms_production_requests.mc_status is
  'M/C testing result: approved | rejected. Approval advances the card; a rejection keeps it in M/C testing for a re-test.';

-- ---------------------------------------------------------------------------
-- RECORD the M/C test (approve/reject). Approval advances; a rejection stays.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_record_mc_testing(uuid, jsonb);
create or replace function public.fms_production_record_mc_testing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_result text; v_date date;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_mc_testing' then raise exception 'This job card is not awaiting M/C testing (status %)', v_status; end if;
  if not public.fms_production_can_act('mc_testing', p_req, v_uid) then raise exception 'Not authorized to record M/C testing'; end if;

  v_result := lower(nullif(trim(p->>'mc_result'), ''));
  if v_result is null or v_result not in ('approved','rejected') then raise exception 'Choose Approve or Reject'; end if;
  v_date := coalesce(nullif(trim(p->>'mc_test_date'),'')::date, current_date);

  update public.fms_production_requests set
    mc_actual_date     = v_date,
    mc_status          = v_result,
    mc_remarks         = nullif(trim(p->>'mc_remarks'), ''),
    mc_attachment_path = nullif(trim(p->>'mc_attachment_path'), ''),
    mc_attachment_name = nullif(trim(p->>'mc_attachment_name'), ''),
    mc_by = v_uid
  where id = p_req;

  if v_result = 'approved' then
    update public.fms_production_requests set
      mc_at = coalesce(mc_at, now()),
      status = 'awaiting_pm_handover', current_step = 'pm_handover'
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'mc_testing',
      'M/C testing approved for ' || coalesce(v_no,'a job card') || ' — ready for packing-material handover.',
      public.fms_production_step_owner_ids('pm_handover'), jsonb_build_object('req_no', v_no));
  else
    -- Rejected: stay in M/C testing (mc_at left null) so the test can be re-recorded.
    perform public.fms_production_announce('request', p_req, 'mc_testing_rejected',
      'M/C testing rejected for ' || coalesce(v_no,'a job card') || ' — a re-test is required.',
      public.fms_production_step_owner_ids('mc_testing'), jsonb_build_object('req_no', v_no));
  end if;
end $$;
grant execute on function public.fms_production_record_mc_testing(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- UPDATE — correct the recorded M/C test's remarks / date / attachment
-- (available after approval, until packing-material handover is recorded). Does
-- not change the approved/rejected result.
-- ---------------------------------------------------------------------------
create or replace function public.fms_production_update_mc_testing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('mc_testing', p_req, v_uid) then raise exception 'Not authorized to edit M/C testing'; end if;
  if not public.fms_production_mc_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'M/C testing can no longer be edited: packing-material handover has already been recorded (status %).', v_status;
  end if;

  update public.fms_production_requests set
    mc_actual_date     = coalesce(nullif(p->>'mc_actual_date','')::date, mc_actual_date),
    mc_remarks         = nullif(trim(p->>'mc_remarks'), ''),
    mc_attachment_path = case when p ? 'mc_attachment_path' then nullif(p->>'mc_attachment_path','') else mc_attachment_path end,
    mc_attachment_name = case when p ? 'mc_attachment_name' then nullif(p->>'mc_attachment_name','') else mc_attachment_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'mc_testing_edited',
    format('M/C testing on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_mc_testing(uuid, jsonb) to authenticated;
