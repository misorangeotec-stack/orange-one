-- ===========================================================================
-- SAMPLING — MACHINE TESTING, a branch that runs AFTER the inward sample work.
--
-- An inward request now carries a second Yes/No gate beside "Lab testing
-- required?": "Machine testing required?". When it is Yes, the request does NOT
-- close where it used to. Instead it enters a THREE-part machine branch:
--
--   Machine Requests (the branch's list) → Machine Testing Process → Result
--
-- WHERE IT JOINS depends on the LAB gate, and the two cases are different:
--   lab YES + machine YES: machine testing is a TAIL on the lab branch —
--       … → lab_process → result_received → machine_process → machine_result → closed
--   lab NO  + machine YES: machine testing REPLACES the no-lab branch's closing
--       step. sample_received never runs; the sample goes to the machine bucket
--       straight off the collection —
--       request → sample_collect → machine_process → machine_result → closed
--   lab NO  + machine NO : unchanged — request → sample_collect → sample_received (closes)
--
-- So a "no lab, machine" request is NEVER a no-lab-bucket request; it is a
-- machine one from the moment it is raised. Either way the branch needs no
-- collect step of its own: collection already happened ahead of it.
--
-- machine_process is ONE step with TWO passes, exactly like lab_process:
--   pass 1 → the tentative result date; saving it says the machine has the
--            sample. The request does NOT move.
--   pass 2 → testing done: comments (required) + an OPTIONAL attachment + whom
--            the result goes to. THAT advances to machine_result.
-- machine_result is the twin of result_received: the person the result was
-- handed to confirms it, which closes the request.
--
-- OUTWARD IS UNTOUCHED — the gate is inward-only, and machine_testing_required
-- is written NULL on every outward row.
--
-- ADDITIVE. New columns (all nullable), two new status values added to the
-- CHECK, and functions re-issued. Nothing is dropped or rewritten, and a row
-- raised before this migration has machine_testing_required NULL, which every
-- test below reads as "not required" — so existing requests close exactly where
-- they always did.
--
-- Clone lineage: the machine RPCs mirror lab_process / result_received
-- (20260728120000 + 20260808120100, with the optional attachment of
-- 20261116120000); submit_request is re-issued from 20260903120000:72;
-- update_request from 20261116120000; can_act from 20260806120000.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns.
-- ---------------------------------------------------------------------------
alter table public.fms_sampling_requests
  -- the gate, asked on the intake form beside lab_testing_required
  add column if not exists machine_testing_required     boolean,
  -- machine_process, pass 1 ------------------------------------------------
  add column if not exists machine_tentative_date       date,
  add column if not exists machine_note                 text,
  add column if not exists machine_started_at           timestamptz,
  add column if not exists machine_started_by           uuid references auth.users on delete set null,
  -- machine_process, pass 2 ------------------------------------------------
  add column if not exists machine_completed_date       date,
  add column if not exists machine_comment              text,
  add column if not exists machine_doc_path             text,
  add column if not exists machine_doc_name             text,
  add column if not exists machine_result_to_id         uuid references auth.users on delete set null,
  add column if not exists machine_result_to_name       text,
  add column if not exists machine_completed_at         timestamptz,
  add column if not exists machine_completed_by         uuid references auth.users on delete set null,
  -- machine_result (closes) -------------------------------------------------
  add column if not exists machine_result_received_date date,
  add column if not exists machine_result_received_note text,
  add column if not exists machine_result_received_at   timestamptz,
  add column if not exists machine_result_received_by   uuid references auth.users on delete set null;

comment on column public.fms_sampling_requests.machine_testing_required is
  'INWARD only. TRUE = the request runs machine testing. WHERE it joins depends on the lab gate: with lab testing it is a tail after result_received; without lab testing it REPLACES sample_received, so collection hands straight to machine_process and the request never enters the no-lab bucket. NULL on every outward row and on every row raised before 20261117120000 - both read as "not required".';

comment on column public.fms_sampling_requests.machine_result_to_id is
  'Whom the machine-testing result is handed to (an app user). The twin of lab_result_to_id: it is what authorizes that person on the machine_result step. NULL when a free-text name was typed - then machine_result falls to that step''s owners.';

-- ---------------------------------------------------------------------------
-- 2. The two new statuses.
-- ---------------------------------------------------------------------------
alter table public.fms_sampling_requests drop constraint if exists fms_sampling_requests_status_check;
alter table public.fms_sampling_requests add  constraint fms_sampling_requests_status_check
  check (status in ('awaiting_receipt','awaiting_send','awaiting_confirm',
                    'awaiting_testing','awaiting_result','awaiting_handover',
                    'awaiting_collect','awaiting_sample_received',
                    'awaiting_sample_to_lab','awaiting_lab_process','awaiting_result_received',
                    'awaiting_machine_process','awaiting_machine_result',
                    'closed','on_hold','cancelled'));

-- ---------------------------------------------------------------------------
-- 3. can_act — re-issued IN FULL from 20260806120000, plus ONE arm: the person
--    the machine result is handed to owns the machine_result step, exactly as
--    lab_result_to_id owns result_received. machine_process has no per-request
--    actor — it belongs to its step owners (Setup → Step Owners).
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_sampling_is_coordinator(p_uid)
      or public.fms_sampling_is_step_owner_for(p_step_key, p_req, p_uid)
      or (p_step_key = 'receive_sample'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.collector_id = p_uid))
      or (p_step_key = 'sample_collect'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.collector_id = p_uid))
      or (p_step_key = 'sample_received'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.handover_recipient_id = p_uid))
      or (p_step_key = 'sample_to_lab'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.handover_recipient_id = p_uid))
      or (p_step_key = 'result_received'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.lab_result_to_id = p_uid))
      -- (new) the machine twin of the arm above.
      or (p_step_key = 'machine_result'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.machine_result_to_id = p_uid))
      or (p_step_key = 'send_sample'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.sender_id = p_uid))
      -- The person the result is being handed over TO owns the handover step —
      -- the outward twin of lab_result_to_id → result_received. This is also why
      -- result_handover is NOT source-scoped: its actor is chosen per request.
      or (p_step_key = 'result_handover'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.result_handover_to_id = p_uid))
      -- Per-source: a Domestic confirmer cannot confirm an Export dispatch.
      -- ADDITIVE to the confirm_receipt source owners, never a replacement.
      or (p_step_key = 'confirm_receipt'
          and exists (select 1
                        from public.fms_sampling_requests r
                        join public.fms_sampling_confirmers c
                          on c.active
                         and c.user_id = p_uid
                         and c.source = public.fms_sampling_confirmer_source(r.receive_via)
                       where r.id = p_req));
$$;
grant execute on function public.fms_sampling_can_act(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. submit_request — re-issued IN FULL from 20260903120000:72.
--
-- ⚠ Re-issued for the SEVENTH time; every version re-states all prior rules.
--
-- ONE change: machine_testing_required is read and stored (inward only). It does
-- NOT affect where a request ENTERS — machine testing is a tail, so the entry
-- routing is untouched. An older client sends no key at all, which stores NULL:
-- exactly today's behaviour.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_sampling_submit_request(jsonb);
create or replace function public.fms_sampling_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid;
  v_no        text;
  v_seq       integer;
  v_fy        text := public.fms_sampling_fy_code(current_date);
  v_uid       uuid := auth.uid();
  v_dir       text := nullif(p->>'direction','');
  v_via       text := nullif(p->>'receive_via','');
  v_req       text := nullif(p->>'requirement_type','');
  v_name      text := nullif(trim(p->>'requester_name'), '');
  v_collector uuid := nullif(p->>'collector_id','')::uuid;
  v_recipient uuid := nullif(p->>'handover_recipient_id','')::uuid;
  v_sender    uuid := nullif(p->>'sender_id','')::uuid;
  v_lab_raw   text := nullif(p->>'lab_testing_required','');
  v_lab       boolean;
  -- (new) the machine gate. Absent key → NULL → not required.
  v_mach_raw  text := nullif(p->>'machine_testing_required','');
  v_mach      boolean;
  v_status    text;
  v_step      text;
  v_recips    uuid[];
  v_skip      boolean := false;
  v_full_form boolean := p ? 'sender_id';
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if (p->>'company_id') is null or trim(p->>'company_id') = '' then raise exception 'Company is required'; end if;
  if v_via not in ('import','domestic','export') then raise exception 'Sample source is required'; end if;
  if v_dir not in ('inward','outward') then raise exception 'Direction (Inward/Outward) is required'; end if;
  if coalesce(trim(p->>'product_desc'), '') = '' then raise exception 'Product / description is required'; end if;

  if v_dir = 'inward' then
    if v_via = 'export' then
      raise exception 'An inward sample cannot have Export as its source — choose Import or Domestic';
    end if;
    if v_req not in ('competitor','new_product') then
      raise exception 'Requirement type is required for an inward sample';
    end if;
    -- An older client that doesn't send the flag defaults to lab testing REQUIRED.
    v_lab := coalesce(v_lab_raw, 'true') <> 'false';
    -- The machine gate has NO such default: silence means NULL, not required.
    v_mach := case when v_mach_raw is null then null else v_mach_raw = 'true' end;
  else
    v_req := null;
    v_lab := null;   -- outward carries no lab-testing decision
    v_mach := null;  -- nor a machine-testing one
    if v_full_form then
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
  end if;

  -- requester_name is NOT NULL — resolve the fallback BEFORE the insert.
  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  -- Entry routing. A request raised WITH a collector always starts at collect,
  -- whichever gates it answered. Without one, collect is skipped and the request
  -- enters at the step that would have followed it — which, for a no-lab request
  -- that needs machine testing, is machine_process rather than sample_received.
  if v_dir = 'inward' then
    if v_collector is null then
      v_skip := true;
      if v_lab is true then
        v_status := 'awaiting_sample_to_lab';     v_step := 'sample_to_lab';
      elsif v_mach is true then
        v_status := 'awaiting_machine_process';   v_step := 'machine_process';
      else
        v_status := 'awaiting_sample_received';   v_step := 'sample_received';
      end if;
    else
      v_status := 'awaiting_collect';             v_step := 'sample_collect';
    end if;
  else
    v_status := 'awaiting_send';                  v_step := 'send_sample';
  end if;

  v_seq := public.fms_sampling_next_seq('SMP-' || v_fy);
  v_no  := 'SMP-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_sampling_requests (
    req_no, company_id, receive_via, direction, requirement_type,
    raised_by, requester_name,
    party_name, party_address, party_contact_name, party_contact_mobile,
    product_desc, colour_qty, sample_items,
    collector_id, collector_name, handover_name,
    lab_testing_required, machine_testing_required,
    handover_recipient_id, handover_recipient_name,
    sender_id, sender_name,
    transport_borne, desired_result, additional_info,
    collect_skipped,
    status, current_step, submitted_at
  ) values (
    v_no, (p->>'company_id')::uuid, v_via, v_dir, v_req,
    v_uid, v_name,
    nullif(trim(p->>'party_name'), ''),
    case when v_dir = 'outward' then nullif(trim(p->>'party_address'), '') end,
    case when v_dir = 'outward' then nullif(trim(p->>'party_contact_name'), '') end,
    case when v_dir = 'outward' then nullif(trim(p->>'party_contact_mobile'), '') end,
    trim(p->>'product_desc'),
    nullif(trim(p->>'colour_qty'), ''),
    coalesce(p->'sample_items', '[]'::jsonb),
    v_collector,
    nullif(trim(p->>'collector_name'), ''),
    nullif(trim(p->>'handover_name'), ''),
    v_lab, v_mach, v_recipient,
    nullif(trim(p->>'handover_recipient_name'), ''),
    case when v_dir = 'outward' then v_sender end,
    case when v_dir = 'outward' then nullif(trim(p->>'sender_name'), '') end,
    nullif(p->>'transport_borne', ''),
    nullif(trim(p->>'desired_result'), ''),
    nullif(trim(p->>'additional_info'), ''),
    v_skip,
    v_status, v_step, now()
  )
  returning id into v_id;

  v_recips := public.fms_sampling_step_owner_ids_for(v_step, v_id);
  if v_dir = 'inward' then
    if v_collector is not null then
      v_recips := v_recips || v_collector;
    elsif v_recipient is not null then
      v_recips := v_recips || v_recipient;
    end if;
  elsif v_dir = 'outward' and v_sender is not null then
    v_recips := v_recips || v_sender;
  end if;

  perform public.fms_sampling_announce(
    'request', v_id, 'raised',
    'Sampling request ' || v_no || ' is ready for the ' ||
      (case when v_dir = 'outward'            then 'sample-sent step.'
            when v_step = 'machine_process'   then 'machine-testing step.'
            when v_skip                       then 'sample-received step.'
            else 'sample-collect step.' end),
    v_recips,
    jsonb_build_object(
      'req_no', v_no, 'direction', v_dir,
      'eyebrow', (case when v_dir = 'outward'          then 'Sample to send'
                       when v_step = 'machine_process' then 'Machine testing'
                       when v_skip                     then 'Sample to receive'
                       else 'Sample to collect' end),
      'headline', (case when v_dir = 'outward'          then 'A sample is ready to be sent'
                        when v_step = 'machine_process' then 'A sample is ready for machine testing'
                        when v_skip                     then 'A sample is ready to be received'
                        else 'A sample is ready to be collected' end),
      'action', (case when v_dir = 'outward'          then 'raised a sample to send'
                      when v_step = 'machine_process' then 'raised a sample for machine testing'
                      when v_skip                     then 'raised a sample for you to receive'
                      else 'raised a sample for you to collect' end),
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || v_id::text,
      'ctaLabel', 'Open in Sampling'
    )
  );

  return v_id;
end $$;
grant execute on function public.fms_sampling_submit_request(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. update_request — re-issued IN FULL from 20261116120000.
--    ONE change: the machine gate is editable too, alongside the lab one.
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
  v_mach_raw  text := nullif(p->>'machine_testing_required','');
  v_mach      boolean;
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
    v_lab  := v_lab_raw <> 'false';
    v_mach := case when v_mach_raw is null then null else v_mach_raw = 'true' end;
  else
    if v_via = 'import' then
      raise exception 'An outward sample cannot have Import as its source — choose Export or Domestic';
    end if;
    v_req := null;
    v_lab := null;
    v_mach := null;
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

  -- ---- routing: identical to submit_request -------------------------------
  if v_dir = 'inward' then
    if v_collector is null then
      v_skip := true;
      if v_lab is true then
        v_status := 'awaiting_sample_to_lab';     v_step := 'sample_to_lab';
      elsif v_mach is true then
        v_status := 'awaiting_machine_process';   v_step := 'machine_process';
      else
        v_status := 'awaiting_sample_received';   v_step := 'sample_received';
      end if;
    else
      v_status := 'awaiting_collect';             v_step := 'sample_collect';
    end if;
  else
    v_status := 'awaiting_send';                  v_step := 'send_sample';
  end if;

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
    machine_testing_required = v_mach,
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

  v_recips := public.fms_sampling_step_owner_ids_for(v_step, p_req);
  if v_new_actor is not null then v_recips := v_recips || v_new_actor; end if;

  perform public.fms_sampling_announce(
    'request', p_req, 'request_edited',
    'Sampling request ' || v_row.req_no || ' was edited' ||
      (case when v_moved then ' and is now ready for the ' ||
              (case v_step when 'send_sample'     then 'sample-sent'
                           when 'sample_collect'  then 'sample-collect'
                           when 'machine_process' then 'machine-testing'
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

-- ---------------------------------------------------------------------------
-- 6. THE HAND-OFF, and it is the COLLECT step that makes the choice on the
--    no-lab side.
--
--    record_collect is re-issued IN FULL from 20260808120000 with one new arm:
--    with no lab testing but machine testing asked for, collection hands the
--    sample to MACHINE TESTING rather than to the sample-received step. A
--    no-lab+machine request therefore never enters the no-lab bucket at all,
--    which is why record_sample_received below needs no machine arm — nothing
--    that needs machine testing can reach it.
--
--    ⚠ The lab gate is tested with `is true`, exactly as submit_request and the
--      original of this function do, so a NULL lab flag (a legacy row) routes the
--      same way in both places.
-- ---------------------------------------------------------------------------
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
  v_mach      boolean;
  v_uid       uuid := auth.uid();
  v_recipient uuid := nullif(p->>'handover_recipient_id','')::uuid;
  v_next      text;
  v_step      text;
begin
  select status, req_no, lab_testing_required, coalesce(machine_testing_required, false)
    into v_status, v_no, v_lab, v_mach
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_collect' then
    raise exception 'This request is not awaiting sample collection (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('sample_collect', p_req, v_uid) then
    raise exception 'Not authorized to record the sample collection';
  end if;

  if v_lab is true then
    v_next := 'awaiting_sample_to_lab';     v_step := 'sample_to_lab';
  elsif v_mach then
    -- (new) no lab, but machine testing: straight to the machine bucket.
    v_next := 'awaiting_machine_process';   v_step := 'machine_process';
  else
    v_next := 'awaiting_sample_received';   v_step := 'sample_received';
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

  -- On the machine arm the sample is not being "handed over" to a person — it
  -- goes to the machine step's owners — so that arm gets its own wording and
  -- deliberately does NOT address the hand-over recipient.
  if v_step = 'machine_process' then
    perform public.fms_sampling_announce('request', p_req, 'machine_pending',
      'Sample collected for ' || coalesce(v_no,'a request') || ' — machine testing is next.',
      public.fms_sampling_step_owner_ids('machine_process'),
      jsonb_build_object(
        'req_no', v_no, 'direction', 'inward',
        'eyebrow', 'Machine testing',
        'headline', 'A sample is ready for machine testing',
        'action', 'collected a sample for machine testing',
        'docLabel', v_no,
        'ctaPath', '/sampling/requests/' || p_req::text,
        'ctaLabel', 'Open in Sampling'
      ));
  else
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
  end if;
end $$;
grant execute on function public.fms_sampling_record_collect(uuid, jsonb) to authenticated;

-- The collection stays correctable until the NEXT step acts — and that step can
-- now be machine_process, so the predicate has to admit that status too or every
-- no-lab+machine collection would lock the instant it was saved.
-- Re-issued from 20260728120000:365.
create or replace function public.fms_sampling_collect_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.collected_at is not null
       and r.status in ('awaiting_sample_received','awaiting_sample_to_lab','awaiting_machine_process')
  );
$$;
grant execute on function public.fms_sampling_collect_editable(uuid) to authenticated;

create or replace function public.fms_sampling_record_result_received(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
  v_mach boolean;
begin
  select status, req_no, raised_by, coalesce(machine_testing_required, false)
    into v_status, v_no, v_raiser, v_mach
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_result_received' then
    raise exception 'This request is not awaiting the result to be received (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('result_received', p_req, v_uid) then
    raise exception 'Not authorized to confirm the result was received';
  end if;

  update public.fms_sampling_requests set
    result_received_date = coalesce(nullif(p->>'result_received_date','')::date, current_date),
    result_received_note = nullif(trim(p->>'result_received_note'), ''),
    result_received_at   = coalesce(result_received_at, now()),
    result_received_by   = coalesce(result_received_by, v_uid),
    closed_at            = case when v_mach then closed_at else coalesce(closed_at, now()) end,
    status       = case when v_mach then 'awaiting_machine_process' else 'closed' end,
    current_step = case when v_mach then 'machine_process'          else 'result_received' end
  where id = p_req;

  if v_mach then
    perform public.fms_sampling_announce('request', p_req, 'machine_pending',
      'Lab result received for ' || coalesce(v_no,'a request') || ' — machine testing is next.',
      public.fms_sampling_step_owner_ids('machine_process'),
      jsonb_build_object(
        'req_no', v_no, 'direction', 'inward',
        'eyebrow', 'Machine testing',
        'headline', 'A sample is ready for machine testing',
        'action', 'passed a sample on for machine testing',
        'docLabel', v_no,
        'ctaPath', '/sampling/requests/' || p_req::text,
        'ctaLabel', 'Open in Sampling'
      ));
  else
    perform public.fms_sampling_announce('request', p_req, 'result_received',
      'Lab result received for ' || coalesce(v_no,'a request') || ' — request closed.',
      (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
      jsonb_build_object('req_no', v_no));
  end if;
end $$;
grant execute on function public.fms_sampling_record_result_received(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. result_received's edit window. It was "editable once the request is
--    closed", which on a lab+machine request would have slammed shut the moment
--    the receipt was saved — that request goes to awaiting_machine_process, not
--    closed. sample_received needs no such change: it only ever runs on a
--    request with no machine testing, which still closes there.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_result_received_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.result_received_at is not null
       and r.status in ('closed','awaiting_machine_process','awaiting_machine_result')
  );
$$;
grant execute on function public.fms_sampling_result_received_editable(uuid) to authenticated;

-- ===========================================================================
-- RPC — machine_process PASS 1. The machine team records when it expects to
-- have a result. The request does NOT move: same step, still open.
-- The twin of fms_sampling_record_lab_start.
-- ===========================================================================
create or replace function public.fms_sampling_record_machine_start(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
  v_date date := nullif(p->>'machine_tentative_date','')::date;
begin
  select status, req_no, raised_by into v_status, v_no, v_raiser
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_machine_process' then
    raise exception 'This request is not with machine testing (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('machine_process', p_req, v_uid) then
    raise exception 'Not authorized to record the machine testing process';
  end if;
  if v_date is null then raise exception 'A tentative result date is required'; end if;

  update public.fms_sampling_requests set
    machine_tentative_date = v_date,
    machine_note           = case when p ? 'machine_note' then nullif(trim(p->>'machine_note'), '') else machine_note end,
    machine_started_at     = coalesce(machine_started_at, now()),
    machine_started_by     = coalesce(machine_started_by, v_uid)
  where id = p_req;   -- status/current_step deliberately unchanged

  perform public.fms_sampling_announce('request', p_req, 'machine_started',
    'Machine testing has started on ' || coalesce(v_no,'a request') ||
      ' — result expected by ' || to_char(v_date, 'DD-MM-YYYY') || '.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object(
      'req_no', v_no, 'direction', 'inward',
      'eyebrow', 'Machine testing under way',
      'headline', 'Machine testing has started on your sample',
      'action', 'started machine testing',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'
    ));
end $$;
grant execute on function public.fms_sampling_record_machine_start(uuid, jsonb) to authenticated;

-- Pass 1 stays correctable for as long as the step is open.
create or replace function public.fms_sampling_machine_start_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.machine_started_at is not null and r.status = 'awaiting_machine_process'
  );
$$;
grant execute on function public.fms_sampling_machine_start_editable(uuid) to authenticated;

create or replace function public.fms_sampling_update_machine_start(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_date date := nullif(p->>'machine_tentative_date','')::date;
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('machine_process', p_req, v_uid) then
    raise exception 'Not authorized to edit the machine testing process';
  end if;
  if not public.fms_sampling_machine_start_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — machine testing can no longer be edited.';
    end if;
    raise exception 'Machine testing is already complete — the tentative date can no longer be changed.';
  end if;
  if v_date is null then raise exception 'A tentative result date is required'; end if;

  update public.fms_sampling_requests set
    machine_tentative_date = v_date,
    machine_note           = case when p ? 'machine_note' then nullif(trim(p->>'machine_note'), '') else machine_note end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'machine_started_edited',
    format('Tentative machine result date on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_machine_start(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — machine_process PASS 2. Testing is done: comments are required, the
-- attachment is OPTIONAL (as on the lab process since 20261116120000), and the
-- request advances to machine_result.
-- ===========================================================================
create or replace function public.fms_sampling_record_machine_complete(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_comment text := nullif(trim(p->>'machine_comment'), '');
  v_doc     text := nullif(p->>'machine_doc_path', '');
  v_to      uuid := nullif(p->>'machine_result_to_id','')::uuid;
  v_to_name text := nullif(trim(p->>'machine_result_to_name'), '');
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_machine_process' then
    raise exception 'This request is not with machine testing (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('machine_process', p_req, v_uid) then
    raise exception 'Not authorized to complete machine testing';
  end if;
  if v_comment is null then raise exception 'Test comments are required to complete machine testing'; end if;
  if v_to is null and v_to_name is null then
    raise exception 'Record whom the result is handed over to';
  end if;

  update public.fms_sampling_requests set
    machine_completed_date = coalesce(nullif(p->>'machine_completed_date','')::date, current_date),
    machine_comment        = v_comment,
    machine_note           = case when p ? 'machine_note' then nullif(trim(p->>'machine_note'), '') else machine_note end,
    machine_doc_path       = v_doc,
    machine_doc_name       = nullif(p->>'machine_doc_name', ''),
    machine_result_to_id   = v_to,
    machine_result_to_name = v_to_name,
    machine_completed_at   = coalesce(machine_completed_at, now()),
    machine_completed_by   = coalesce(machine_completed_by, v_uid),
    status = 'awaiting_machine_result', current_step = 'machine_result'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'machine_completed',
    'Machine testing is complete for ' || coalesce(v_no,'a request') || ' — the result is ready to be received.',
    (case when v_to is not null then array[v_to]
          else public.fms_sampling_step_owner_ids('machine_result') end),
    jsonb_build_object(
      'req_no', v_no, 'direction', 'inward',
      'eyebrow', 'Machine result ready',
      'headline', 'A machine testing result has been handed to you',
      'action', 'completed machine testing and handed you the result',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'
    ));
end $$;
grant execute on function public.fms_sampling_record_machine_complete(uuid, jsonb) to authenticated;

create or replace function public.fms_sampling_machine_complete_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.machine_completed_at is not null and r.status = 'awaiting_machine_result'
  );
$$;
grant execute on function public.fms_sampling_machine_complete_editable(uuid) to authenticated;

create or replace function public.fms_sampling_update_machine_complete(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_comment text := nullif(trim(p->>'machine_comment'), '');
  v_to      uuid := nullif(p->>'machine_result_to_id','')::uuid;
  v_to_name text := nullif(trim(p->>'machine_result_to_name'), '');
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('machine_process', p_req, v_uid) then
    raise exception 'Not authorized to edit machine testing';
  end if;
  if not public.fms_sampling_machine_complete_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — machine testing can no longer be edited.';
    end if;
    raise exception 'The result has already been received — machine testing can no longer be edited (status %).', v_status;
  end if;
  if v_comment is null then raise exception 'Test comments are required'; end if;
  if v_to is null and v_to_name is null then
    raise exception 'Record whom the result is handed over to';
  end if;

  -- The attachment key is sent ONLY when a new file replaces the current one, so
  -- an absent key must keep what is there — the contract update_lab_complete uses.
  update public.fms_sampling_requests set
    machine_completed_date = coalesce(nullif(p->>'machine_completed_date','')::date, machine_completed_date),
    machine_comment        = v_comment,
    machine_note           = case when p ? 'machine_note' then nullif(trim(p->>'machine_note'), '') else machine_note end,
    machine_tentative_date = coalesce(nullif(p->>'machine_tentative_date','')::date, machine_tentative_date),
    machine_doc_path       = case when p ? 'machine_doc_path' then coalesce(nullif(p->>'machine_doc_path',''), machine_doc_path) else machine_doc_path end,
    machine_doc_name       = case when p ? 'machine_doc_path' then coalesce(nullif(p->>'machine_doc_name',''), machine_doc_name) else machine_doc_name end,
    machine_result_to_id   = v_to,
    machine_result_to_name = v_to_name,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'machine_completed_edited',
    format('Machine testing on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_machine_complete(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — machine_result. Whoever machine testing handed the result to confirms
-- it. CLOSES the request. LAST step, so it stays editable after close —
-- mirroring result_received / sample_received / result_handover.
-- ===========================================================================
create or replace function public.fms_sampling_record_machine_result_received(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
begin
  select status, req_no, raised_by into v_status, v_no, v_raiser
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_machine_result' then
    raise exception 'This request is not awaiting the machine result to be received (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('machine_result', p_req, v_uid) then
    raise exception 'Not authorized to confirm the machine result was received';
  end if;

  update public.fms_sampling_requests set
    machine_result_received_date = coalesce(nullif(p->>'machine_result_received_date','')::date, current_date),
    machine_result_received_note = nullif(trim(p->>'machine_result_received_note'), ''),
    machine_result_received_at   = coalesce(machine_result_received_at, now()),
    machine_result_received_by   = coalesce(machine_result_received_by, v_uid),
    closed_at                    = coalesce(closed_at, now()),
    status = 'closed', current_step = 'machine_result'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'machine_result_received',
    'Machine testing result received for ' || coalesce(v_no,'a request') || ' — request closed.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_machine_result_received(uuid, jsonb) to authenticated;

create or replace function public.fms_sampling_machine_result_received_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.machine_result_received_at is not null and r.status = 'closed'
  );
$$;
grant execute on function public.fms_sampling_machine_result_received_editable(uuid) to authenticated;

create or replace function public.fms_sampling_update_machine_result_received(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('machine_result', p_req, v_uid) then
    raise exception 'Not authorized to edit the machine result receipt';
  end if;
  if not public.fms_sampling_machine_result_received_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — its result receipt can no longer be edited.';
    end if;
    raise exception 'No machine result receipt has been recorded on this request yet — there is nothing to edit.';
  end if;

  update public.fms_sampling_requests set
    machine_result_received_date = coalesce(nullif(p->>'machine_result_received_date','')::date, machine_result_received_date),
    machine_result_received_note = nullif(trim(p->>'machine_result_received_note'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'machine_result_received_edited',
    format('Machine result receipt on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_machine_result_received(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. resume_status — re-issued IN FULL from 20260903120000:274.
--
-- The machine arms go FIRST, because they are the newest thing that can have
-- happened to a request. Note the third arm: a machine request that has had its
-- receipt recorded (result_received_at / sample_received_at) is NOT closed any
-- more — it is waiting for machine testing, and must resume there rather than
-- fall into the 'closed' arms below, which is where it would have landed.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    -- machine testing — newest first
    when r.machine_result_received_at is not null then 'closed'
    when r.machine_completed_at       is not null then 'awaiting_machine_result'
    -- Where machine testing PICKS UP depends on the lab gate: after the lab
    -- result on a lab request, and straight after collection on a no-lab one
    -- (which never runs sample_received at all). collect_skipped covers the
    -- no-lab+machine request raised with no collector — it entered here.
    when coalesce(r.machine_testing_required, false)
         and (r.machine_started_at is not null
           or (r.lab_testing_required is true and r.result_received_at is not null)
           or (r.lab_testing_required is distinct from true
               and (r.collected_at is not null or r.collect_skipped)))
      then 'awaiting_machine_process'
    -- terminal
    when r.handed_over_at     is not null then 'closed'
    when r.result_received_at is not null then 'closed'
    when r.sample_received_at is not null then 'closed'
    -- inward, lab branch (newest first)
    when r.lab_completed_at   is not null then 'awaiting_result_received'
    when r.lab_sent_at        is not null then 'awaiting_lab_process'
    -- inward, no-lab branch
    when r.collected_at       is not null then
      case when r.lab_testing_required is true then 'awaiting_sample_to_lab'
           else 'awaiting_sample_received' end
    -- legacy inward + outward tail
    when r.resulted_at        is not null then 'awaiting_handover'
    when r.tested_at          is not null then 'awaiting_result'
    when r.direction = 'inward' then
      case when r.received_at is not null then 'awaiting_testing'
           when r.collect_skipped then
             case when r.lab_testing_required is true then 'awaiting_sample_to_lab'
                  else 'awaiting_sample_received' end
           else 'awaiting_collect' end
    else
      case when r.confirmed_at is not null then 'awaiting_result'
           when r.sent_at      is not null then 'awaiting_confirm'
           else 'awaiting_send' end
  end
  from public.fms_sampling_requests r where r.id = p_req;
$function$;

commit;
