-- ===========================================================================
-- PRODUCTION ENTRY FMS — M/C TESTING: add BYPASS (admin-only) + reorder target.
--
-- Two changes to Testing of M/C:
--  1) A third outcome BYPASS, available ONLY to admins. Like an approval it
--     advances the card, but it is recorded distinctly (mc_status='bypassed' +
--     mc_bypassed_by/at) so bypassed cards/steps stay auditable.
--  2) REORDER: an approval / bypass now advances to PACKING MATERIAL TRANSFER
--     (pm_transfer) — the Packing Material Handover step has been removed.
--
-- Additive: mc_bypassed_by / mc_bypassed_at. Replace-only for the M/C RPCs
-- (record based on 20260728190000; editable/update based on 20260725120200).
-- ===========================================================================

alter table public.fms_production_requests add column if not exists mc_bypassed_by uuid references auth.users on delete set null;
alter table public.fms_production_requests add column if not exists mc_bypassed_at timestamptz;
comment on column public.fms_production_requests.mc_status is
  'M/C testing result: approved | rejected | bypassed. Approval or bypass advances the card to packing-material transfer; a rejection keeps it in M/C testing for a re-test. Bypass is admin-only and stamps mc_bypassed_by/at.';

create or replace function public.fms_production_record_mc_testing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_result text; v_date date;
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_mc_testing' then raise exception 'This job card is not awaiting M/C testing (status %)', v_status; end if;
  if not public.fms_production_can_act('mc_testing', p_req, v_uid) then raise exception 'Not authorized to record M/C testing'; end if;

  v_result := lower(nullif(trim(p->>'mc_result'), ''));
  if v_result is null or v_result not in ('approved','rejected','bypassed') then raise exception 'Choose Approve, Reject or Bypass'; end if;
  if v_result = 'bypassed' and not public.is_admin(v_uid) then raise exception 'Only an admin can bypass M/C testing'; end if;
  v_date := coalesce(nullif(trim(p->>'mc_test_date'),'')::date, current_date);

  update public.fms_production_requests set
    mc_actual_date     = v_date,
    mc_status          = v_result,
    mc_remarks         = nullif(trim(p->>'mc_remarks'), ''),
    mc_attachment_path = nullif(trim(p->>'mc_attachment_path'), ''),
    mc_attachment_name = nullif(trim(p->>'mc_attachment_name'), ''),
    mc_bypassed_by     = case when v_result = 'bypassed' then v_uid else mc_bypassed_by end,
    mc_bypassed_at     = case when v_result = 'bypassed' then now() else mc_bypassed_at end,
    mc_by = v_uid
  where id = p_req;

  if v_result in ('approved','bypassed') then
    update public.fms_production_requests set
      mc_at = coalesce(mc_at, now()),
      status = 'awaiting_pm_transfer', current_step = 'pm_transfer'
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'mc_testing',
      'M/C testing ' || v_result || ' for ' || coalesce(v_no,'a job card') || ' — ready for packing-material transfer.',
      public.fms_production_step_owner_ids('pm_transfer'), jsonb_build_object('req_no', v_no));
  else
    perform public.fms_production_announce('request', p_req, 'mc_testing_rejected',
      'M/C testing rejected for ' || coalesce(v_no,'a job card') || ' — a re-test is required.',
      public.fms_production_step_owner_ids('mc_testing'), jsonb_build_object('req_no', v_no));
  end if;
end $$;
grant execute on function public.fms_production_record_mc_testing(uuid, jsonb) to authenticated;

-- M/C testing now editable until PACKING MATERIAL TRANSFER is recorded.
create or replace function public.fms_production_mc_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fms_production_requests r
    where r.id = p_req and r.mc_at is not null and r.status = 'awaiting_pm_transfer');
$$;
grant execute on function public.fms_production_mc_editable(uuid) to authenticated;

create or replace function public.fms_production_update_mc_testing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('mc_testing', p_req, v_uid) then raise exception 'Not authorized to edit M/C testing'; end if;
  if not public.fms_production_mc_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'M/C testing can no longer be edited: the packing-material transfer has already been recorded (status %).', v_status;
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
