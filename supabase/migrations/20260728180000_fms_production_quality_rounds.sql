-- ===========================================================================
-- PRODUCTION ENTRY FMS — MULTI-ROUND QUALITY CHECKING (approve / reject + retest).
--
-- Quality checking becomes a test log of up to THREE rounds inside the one step:
--   Test 1 (first test) -> if REJECTED, a retest is due in +2 days (Test 2) ->
--   if still rejected, a final Test 3 whose date is entered manually.
-- Any APPROVAL advances the card to M/C testing. No separate retest step.
--
-- Additive: qc_rounds jsonb (the per-round log) + qc_retest_due date (the auto
-- +2-day due for Test 2). The latest round is mirrored into the existing
-- qc_status / qc_actual_date / qc_remarks / qc_attachment_* columns.
-- ===========================================================================

alter table public.fms_production_requests add column if not exists qc_rounds jsonb not null default '[]'::jsonb;
alter table public.fms_production_requests drop constraint if exists fms_production_requests_qc_rounds_is_array;
alter table public.fms_production_requests add constraint fms_production_requests_qc_rounds_is_array
  check (jsonb_typeof(qc_rounds) = 'array');
alter table public.fms_production_requests add column if not exists qc_retest_due date;

comment on column public.fms_production_requests.qc_rounds is
  'Quality test log: array of {round, test_date, result (approved|rejected), remarks, attachment_path, attachment_name}. Up to 3 rounds; an approval advances the card. qc_retest_due carries the auto +2-day due date for Test 2 after a Test 1 rejection.';

-- ---------------------------------------------------------------------------
-- RECORD one test round (approve/reject). Approval advances; a rejection keeps
-- the card in quality checking (retest), Test 1 setting a +2-day due date.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_record_quality(uuid, jsonb);
create or replace function public.fms_production_record_quality(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_rounds jsonb; v_round int; v_result text; v_date date; v_datein text;
begin
  select status, req_no, qc_rounds into v_status, v_no, v_rounds from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if v_status <> 'awaiting_quality' then raise exception 'This job card is not awaiting quality checking (status %)', v_status; end if;
  if not public.fms_production_can_act('quality_check', p_req, v_uid) then raise exception 'Not authorized to record quality checking'; end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_round  := jsonb_array_length(v_rounds) + 1;
  if v_round > 3 then raise exception 'The final quality test has already been recorded'; end if;

  v_result := lower(nullif(trim(p->>'qc_result'), ''));
  if v_result is null or v_result not in ('approved','rejected') then raise exception 'Choose Approve or Reject'; end if;

  v_datein := nullif(trim(p->>'qc_test_date'), '');
  if v_round = 3 and v_datein is null then raise exception 'Enter the test date for the final test'; end if;
  v_date := coalesce(v_datein::date, current_date);

  update public.fms_production_requests set
    qc_rounds = v_rounds || jsonb_build_object(
      'round', v_round, 'test_date', v_date, 'result', v_result,
      'remarks', nullif(trim(p->>'qc_remarks'), ''),
      'attachment_path', nullif(trim(p->>'qc_attachment_path'), ''),
      'attachment_name', nullif(trim(p->>'qc_attachment_name'), '')),
    qc_actual_date = v_date,
    qc_status = v_result,
    qc_remarks = nullif(trim(p->>'qc_remarks'), ''),
    qc_attachment_path = nullif(trim(p->>'qc_attachment_path'), ''),
    qc_attachment_name = nullif(trim(p->>'qc_attachment_name'), ''),
    qc_by = v_uid
  where id = p_req;

  if v_result = 'approved' then
    update public.fms_production_requests set
      qc_at = coalesce(qc_at, now()), qc_retest_due = null,
      status = 'awaiting_mc_testing', current_step = 'mc_testing'
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'quality_check',
      'Quality checking approved for ' || coalesce(v_no,'a job card') || ' (Test ' || v_round || ') — ready for M/C testing.',
      public.fms_production_step_owner_ids('mc_testing'), jsonb_build_object('req_no', v_no));
  else
    -- Rejected: stay in quality. Test 1 rejection schedules a +2-day retest due.
    update public.fms_production_requests set
      qc_retest_due = case when v_round = 1 then v_date + 2 else null end
    where id = p_req;
    perform public.fms_production_announce('request', p_req, 'quality_rejected',
      'Quality Test ' || v_round || ' rejected for ' || coalesce(v_no,'a job card') ||
      case when v_round < 3 then ' — a retest is required.' else ' — final test failed.' end,
      public.fms_production_step_owner_ids('quality_check'), jsonb_build_object('req_no', v_no));
  end if;
end $$;
grant execute on function public.fms_production_record_quality(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- UPDATE — correct the LATEST recorded round's remarks / date / attachment
-- (available after approval, until M/C testing is recorded). Does not change the
-- result or the round count.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_update_quality(uuid, jsonb);
create or replace function public.fms_production_update_quality(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid(); v_rounds jsonb; v_n int; v_last jsonb; v_date date;
begin
  select status, req_no, qc_rounds into v_status, v_no, v_rounds from public.fms_production_requests where id = p_req for update;
  if v_status is null then raise exception 'Job card not found'; end if;
  if not public.fms_production_can_act('quality_check', p_req, v_uid) then raise exception 'Not authorized to edit quality checking'; end if;
  if not public.fms_production_qc_editable(p_req) then
    if v_status = 'on_hold' then raise exception 'This job card is on hold — take it off hold before editing.'; end if;
    raise exception 'Quality checking can no longer be edited: M/C testing has already been recorded (status %).', v_status;
  end if;

  v_rounds := coalesce(v_rounds, '[]'::jsonb);
  v_n := jsonb_array_length(v_rounds);
  if v_n = 0 then raise exception 'There is no quality test to edit'; end if;
  v_last := v_rounds->(v_n - 1);
  v_date := coalesce(nullif(trim(p->>'qc_actual_date'), '')::date, (v_last->>'test_date')::date);

  v_last := v_last
    || jsonb_build_object('test_date', v_date, 'remarks', nullif(trim(p->>'qc_remarks'), ''))
    || case when p ? 'qc_attachment_path'
         then jsonb_build_object('attachment_path', nullif(p->>'qc_attachment_path',''), 'attachment_name', nullif(p->>'qc_attachment_name',''))
         else '{}'::jsonb end;

  update public.fms_production_requests set
    qc_rounds = jsonb_set(v_rounds, array[(v_n - 1)::text], v_last),
    qc_actual_date = v_date,
    qc_remarks = nullif(trim(p->>'qc_remarks'), ''),
    qc_attachment_path = case when p ? 'qc_attachment_path' then nullif(p->>'qc_attachment_path','') else qc_attachment_path end,
    qc_attachment_name = case when p ? 'qc_attachment_name' then nullif(p->>'qc_attachment_name','') else qc_attachment_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_production_announce('request', p_req, 'quality_edited',
    format('Quality checking on %s edited', coalesce(v_no,'the job card')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_production_update_quality(uuid, jsonb) to authenticated;
