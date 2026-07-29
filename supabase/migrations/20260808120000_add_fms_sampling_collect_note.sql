-- ===========================================================================
-- SAMPLING FMS — REMARKS ON SAMPLE COLLECT & HANDOVER.
--
-- The collector can now record an optional free-text remark alongside whom they
-- handed the sample to. Named `collect_note`, not `collect_remarks`: every other
-- optional remark on this table is `<step>_note` (sample_received_note,
-- result_received_note, handover_note) and every one of them is labelled
-- "Remarks" in the UI. One naming, one label.
--
-- KEY-GUARD CONTRACT (the same shape 20260806120000 uses for party_testing_date):
--   case when p ? 'collect_note' then nullif(trim(p->>'collect_note'),'') else collect_note end
-- Absent key  ⇒ KEEP what is stored, so the previously deployed frontend — which
--               does not know the field — cannot blank it during the deploy window.
-- Present but empty ⇒ CLEAR it, because the field is optional and must be erasable.
--
-- No `client_v` bump and no deploy-window requirement gate: the rule about gating
-- applies to new REQUIREMENTS, and this field is optional.
--
-- Purely ADDITIVE: one nullable column; two functions re-issued with one added
-- line each and every other statement verbatim.
--
-- REVERSAL:
--   alter table public.fms_sampling_requests drop column collect_note;
--   then re-issue fms_sampling_record_collect from 20260728120000:307 and
--        fms_sampling_update_collect from 20260727120000:386.
-- ===========================================================================

alter table public.fms_sampling_requests
  add column if not exists collect_note text;

comment on column public.fms_sampling_requests.collect_note is
  'Optional remarks captured at sample_collect — anything worth noting about the collection or the hand-over. Labelled "Remarks" in the UI, like sample_received_note / result_received_note / handover_note.';

-- ---------------------------------------------------------------------------
-- record_collect — re-issued IN FULL from 20260728120000:307 (the newest body;
-- it is the one that branches to sample_to_lab vs sample_received on the lab
-- flag). ONE line added to the SET list; the branch, the status transition and
-- the announce are untouched.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_sampling_record_collect(uuid, jsonb);
create or replace function public.fms_sampling_record_collect(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status    text;
  v_no        text;
  v_lab       boolean;
  v_uid       uuid := auth.uid();
  v_recipient uuid := nullif(p->>'handover_recipient_id','')::uuid;
  v_next      text;
  v_step      text;
begin
  select status, req_no, lab_testing_required into v_status, v_no, v_lab
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_collect' then
    raise exception 'This request is not awaiting sample collection (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('sample_collect', p_req, v_uid) then
    raise exception 'Not authorized to record the sample collection';
  end if;

  if v_lab is true then
    v_next := 'awaiting_sample_to_lab';   v_step := 'sample_to_lab';
  else
    v_next := 'awaiting_sample_received'; v_step := 'sample_received';
  end if;

  update public.fms_sampling_requests set
    handover_recipient_id   = v_recipient,
    handover_recipient_name = nullif(trim(p->>'handover_recipient_name'), ''),
    collected_date          = coalesce(nullif(p->>'collected_date','')::date, current_date),
    collect_note            = case when p ? 'collect_note'
                                   then nullif(trim(p->>'collect_note'), '')
                                   else collect_note end,
    collected_at            = coalesce(collected_at, now()),
    collected_by            = coalesce(collected_by, v_uid),
    status = v_next, current_step = v_step
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'collected',
    'Sample collected for ' || coalesce(v_no,'a request') || ' — awaiting handover receipt.',
    (case when v_recipient is not null then array[v_recipient]
          else public.fms_sampling_step_owner_ids(v_step) end),
    jsonb_build_object(
      'req_no', v_no, 'direction', 'inward',
      'eyebrow', 'Sample handed to you',
      'headline', 'A sample has been handed over for you to receive',
      'action', 'handed a sample over to you',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'
    ));
end $$;
grant execute on function public.fms_sampling_record_collect(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- update_collect — re-issued IN FULL from 20260727120000:386, one line added.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_sampling_update_collect(uuid, jsonb);
create or replace function public.fms_sampling_update_collect(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status    text;
  v_no        text;
  v_uid       uuid := auth.uid();
  v_recipient uuid := nullif(p->>'handover_recipient_id','')::uuid;
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('sample_collect', p_req, v_uid) then
    raise exception 'Not authorized to edit the sample collection';
  end if;
  if not public.fms_sampling_collect_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — its collection can no longer be edited.';
    end if;
    raise exception 'The sample collection can no longer be edited: the sample has already been received (status %).', v_status;
  end if;

  update public.fms_sampling_requests set
    handover_recipient_id   = v_recipient,
    handover_recipient_name = nullif(trim(p->>'handover_recipient_name'), ''),
    collected_date          = coalesce(nullif(p->>'collected_date','')::date, collected_date),
    collect_note            = case when p ? 'collect_note'
                                   then nullif(trim(p->>'collect_note'), '')
                                   else collect_note end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'collect_edited',
    format('Sample collection on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_collect(uuid, jsonb) to authenticated;
