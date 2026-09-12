-- ===========================================================================
-- SAMPLING — two changes, both asked for on 10-09-2026.
--
-- 1. The LAB TESTING ATTACHMENT becomes OPTIONAL when completing the lab process.
--    Test comments and "result handed over to" stay required. Only
--    record_lab_complete enforced the file; update_lab_complete already keeps
--    whatever is there when no new file is sent, so it needs no change.
--
-- 2. A raised request can be EDITED until the next bucket acts on it. Everything
--    on the intake form is editable — company, direction, source, party, product,
--    samples, lab gate, collector, hand-over recipient, sender, outcome — by the
--    requester, an admin or a coordinator. The window closes the moment the
--    request's first step is recorded (collected, sent, sent to lab or received),
--    and it is shut while the request is on hold or cancelled.
--
--    Because direction / collector / lab gate decide WHERE a request enters, an
--    edit re-routes it exactly as submit_request would have. That is safe only
--    because nothing downstream has been written yet — which is precisely what
--    fms_sampling_request_editable guarantees.
--
-- Purely ADDITIVE: one function re-issued, two functions added. No table,
-- column, constraint or row is dropped or rewritten. No new status value.
--
-- Clone lineage: record_lab_complete from 20260808120100:221 (the last issue of
-- it); the edit's validation + routing from submit_request at 20260903120000:72.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. record_lab_complete — re-issued IN FULL from 20260808120100:221.
--    ONE change: the "A lab testing attachment is required" raise is gone.
--    With no file, lab_doc_path / lab_doc_name are simply written as null.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_record_lab_complete(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_comment text := nullif(trim(p->>'lab_comment'), '');
  v_doc     text := nullif(p->>'lab_doc_path', '');
  v_to      uuid := nullif(p->>'lab_result_to_id','')::uuid;
  v_to_name text := nullif(trim(p->>'lab_result_to_name'), '');
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_lab_process' then
    raise exception 'This request is not with the lab (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('lab_process', p_req, v_uid) then
    raise exception 'Not authorized to complete the lab process';
  end if;
  if v_comment is null then raise exception 'Test comments are required to complete the lab process'; end if;
  -- (removed) the lab testing attachment is OPTIONAL from 20261116120000.
  if v_to is null and v_to_name is null then
    raise exception 'Record whom the result is handed over to';
  end if;

  update public.fms_sampling_requests set
    lab_completed_date = coalesce(nullif(p->>'lab_completed_date','')::date, current_date),
    lab_comment        = v_comment,
    lab_note           = case when p ? 'lab_note' then nullif(trim(p->>'lab_note'), '') else lab_note end,
    lab_doc_path       = v_doc,
    lab_doc_name       = nullif(p->>'lab_doc_name', ''),
    lab_result_to_id   = v_to,
    lab_result_to_name = v_to_name,
    lab_completed_at   = coalesce(lab_completed_at, now()),
    lab_completed_by   = coalesce(lab_completed_by, v_uid),
    status = 'awaiting_result_received', current_step = 'result_received'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'lab_completed',
    'Lab testing is complete for ' || coalesce(v_no,'a request') || ' — the result is ready to be received.',
    (case when v_to is not null then array[v_to]
          else public.fms_sampling_step_owner_ids('result_received') end),
    jsonb_build_object(
      'req_no', v_no, 'direction', 'inward',
      'eyebrow', 'Lab result ready',
      'headline', 'A lab result has been handed to you',
      'action', 'completed lab testing and handed you the result',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'
    ));
end $function$;
grant execute on function public.fms_sampling_record_lab_complete(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2a. Is the request still editable? TRUE only while it sits at the step it
--     ENTERED on and no step has been recorded against it at all.
--
--     The four entry statuses are the four places submit_request can put a
--     request. awaiting_sample_to_lab / awaiting_sample_received are ALSO where a
--     request lands after collection — the collected_at test is what tells
--     "entered here" (collect skipped) apart from "arrived here" (collected).
--
--     Every step timestamp is checked, not just the first step's, so a legacy row
--     or a resumed one can never slip through on its status alone.
--
--     ⚠ MIRRORED by `isRequestEditable` in frontend/src/apps/sampling/lib/queues.ts.
--       Change one, change both.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_request_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.status in ('awaiting_collect','awaiting_send','awaiting_sample_to_lab','awaiting_sample_received')
       and r.collected_at       is null
       and r.sent_at            is null
       and r.lab_sent_at        is null
       and r.sample_received_at is null
       and r.received_at        is null
       and r.confirmed_at       is null
       and r.tested_at          is null
       and r.resulted_at        is null
       and r.handed_over_at     is null
       and r.lab_started_at     is null
       and r.lab_completed_at   is null
       and r.result_received_at is null
       and r.closed_at          is null
  );
$$;
grant execute on function public.fms_sampling_request_editable(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2b. update_request — edit the intake form of a request that no one has acted
--     on yet. Same payload shape as submit_request (the client sends the SAME
--     builder's output), same rules, same routing. Always validates as the full
--     form: only the current client can call this.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_update_request(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_row       public.fms_sampling_requests%rowtype;
  v_dir       text := nullif(p->>'direction','');
  v_via       text := nullif(p->>'receive_via','');
  v_req       text := nullif(p->>'requirement_type','');
  v_name      text := nullif(trim(p->>'requester_name'), '');
  v_collector uuid := nullif(p->>'collector_id','')::uuid;
  v_recipient uuid := nullif(p->>'handover_recipient_id','')::uuid;
  v_sender    uuid := nullif(p->>'sender_id','')::uuid;
  v_lab_raw   text := nullif(p->>'lab_testing_required','');
  v_lab       boolean;
  v_status    text;
  v_step      text;
  v_skip      boolean := false;
  v_old_actor uuid;
  v_new_actor uuid;
  v_moved     boolean;
  v_recips    uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;

  select * into v_row from public.fms_sampling_requests where id = p_req for update;
  if v_row.id is null then raise exception 'Request not found'; end if;
  -- coalesce: a NULL comparison would make the whole test NULL, which plpgsql
  -- treats as false — and the raise would be skipped.
  if not (coalesce(v_row.raised_by = v_uid, false) or public.is_admin(v_uid) or public.fms_sampling_is_coordinator(v_uid)) then
    raise exception 'Only the requester, an admin or a coordinator can edit this request';
  end if;
  if not public.fms_sampling_request_editable(p_req) then
    if v_row.status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_row.status = 'cancelled' then
      raise exception 'This request is cancelled — it can no longer be edited.';
    end if;
    raise exception 'The next step has already been recorded on this request — it can no longer be edited.';
  end if;

  -- ---- validation: submit_request's rules, full form ----------------------
  if (p->>'company_id') is null or trim(p->>'company_id') = '' then raise exception 'Company is required'; end if;
  if coalesce(v_via, '') not in ('import','domestic','export') then raise exception 'Sample source is required'; end if;
  if coalesce(v_dir, '') not in ('inward','outward') then raise exception 'Direction (Inward/Outward) is required'; end if;
  if coalesce(trim(p->>'product_desc'), '') = '' then raise exception 'Product / description is required'; end if;

  if v_dir = 'inward' then
    if v_via = 'export' then
      raise exception 'An inward sample cannot have Export as its source — choose Import or Domestic';
    end if;
    if coalesce(v_req, '') not in ('competitor','new_product') then
      raise exception 'Requirement type is required for an inward sample';
    end if;
    if v_lab_raw is null then raise exception 'Please choose whether lab testing is required'; end if;
    v_lab := v_lab_raw <> 'false';
  else
    if v_via = 'import' then
      raise exception 'An outward sample cannot have Import as its source — choose Export or Domestic';
    end if;
    v_req := null;
    v_lab := null;
    if coalesce(trim(p->>'party_name'), '') = '' then
      raise exception 'Company name is required for an outward sample';
    end if;
    if coalesce(trim(p->>'party_address'), '') = '' then
      raise exception 'Company address is required for an outward sample';
    end if;
    if coalesce(trim(p->>'party_contact_name'), '') = '' then
      raise exception 'Contact person is required for an outward sample';
    end if;
    if coalesce(trim(p->>'party_contact_mobile'), '') = '' then
      raise exception 'Contact mobile is required for an outward sample';
    end if;
    if v_sender is null then
      raise exception 'Please choose who will send the sample';
    end if;
  end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), v_row.requester_name, 'Requester');
  end if;

  -- ---- routing: identical to submit_request (20260903120000:153) ----------
  if v_dir = 'inward' then
    if v_collector is null then
      v_skip := true;
      if v_lab is true then
        v_status := 'awaiting_sample_to_lab';   v_step := 'sample_to_lab';
      else
        v_status := 'awaiting_sample_received'; v_step := 'sample_received';
      end if;
    else
      v_status := 'awaiting_collect';           v_step := 'sample_collect';
    end if;
  else
    v_status := 'awaiting_send';                v_step := 'send_sample';
  end if;

  -- The per-request actor of the first step, before and after — the person a
  -- raise would have notified alongside the step's owners.
  v_old_actor := case v_row.status
                   when 'awaiting_collect' then v_row.collector_id
                   when 'awaiting_send'    then v_row.sender_id
                   else v_row.handover_recipient_id end;
  v_new_actor := case v_status
                   when 'awaiting_collect' then v_collector
                   when 'awaiting_send'    then v_sender
                   else v_recipient end;
  v_moved := v_status <> v_row.status or v_new_actor is distinct from v_old_actor;

  update public.fms_sampling_requests set
    company_id            = (p->>'company_id')::uuid,
    receive_via           = v_via,
    direction             = v_dir,
    requirement_type      = v_req,
    requester_name        = v_name,
    party_name            = nullif(trim(p->>'party_name'), ''),
    party_address         = case when v_dir = 'outward' then nullif(trim(p->>'party_address'), '') end,
    party_contact_name    = case when v_dir = 'outward' then nullif(trim(p->>'party_contact_name'), '') end,
    party_contact_mobile  = case when v_dir = 'outward' then nullif(trim(p->>'party_contact_mobile'), '') end,
    product_desc          = trim(p->>'product_desc'),
    sample_items          = coalesce(p->'sample_items', '[]'::jsonb),
    collector_id          = case when v_dir = 'inward' then v_collector end,
    handover_name         = nullif(trim(p->>'handover_name'), ''),
    lab_testing_required  = v_lab,
    handover_recipient_id = case when v_dir = 'inward' then v_recipient end,
    handover_recipient_name = case when v_dir = 'inward' then nullif(trim(p->>'handover_recipient_name'), '') end,
    sender_id             = case when v_dir = 'outward' then v_sender end,
    sender_name           = case when v_dir = 'outward' then nullif(trim(p->>'sender_name'), '') end,
    transport_borne       = nullif(p->>'transport_borne', ''),
    desired_result        = nullif(trim(p->>'desired_result'), ''),
    additional_info       = nullif(trim(p->>'additional_info'), ''),
    collect_skipped       = v_skip,
    status                = v_status,
    current_step          = v_step,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  -- Tell the first step's people. When the edit handed the request to a
  -- different step or a different person, it reads like a fresh raise to them;
  -- otherwise it is a heads-up that the details they are about to act on changed.
  -- Owner lookup AFTER the update: on outward it resolves by the (possibly new)
  -- source.
  v_recips := public.fms_sampling_step_owner_ids_for(v_step, p_req);
  if v_new_actor is not null then v_recips := v_recips || v_new_actor; end if;

  perform public.fms_sampling_announce(
    'request', p_req, 'request_edited',
    'Sampling request ' || v_row.req_no || ' was edited' ||
      (case when v_moved then ' and is now ready for the ' ||
              (case v_step when 'send_sample'     then 'sample-sent'
                           when 'sample_collect'  then 'sample-collect'
                           else 'sample-received' end) || ' step.'
            else ' — check the details before you act.' end),
    v_recips,
    jsonb_build_object(
      'req_no', v_row.req_no, 'direction', v_dir,
      'eyebrow', 'Request edited',
      'headline', (case when v_moved then 'A sampling request is now with you'
                        else 'A sampling request you are about to act on was edited' end),
      'action', 'edited a sampling request',
      'docLabel', v_row.req_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'
    )
  );
end $$;
grant execute on function public.fms_sampling_update_request(uuid, jsonb) to authenticated;

commit;
