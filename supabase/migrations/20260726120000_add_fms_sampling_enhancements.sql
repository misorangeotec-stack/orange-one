-- ===========================================================================
-- SAMPLING FMS — SIX ENHANCEMENTS (schema + workflow).
--
--  1. collector_id  — the request's chosen collector (a per-request assignee for
--     receive_sample). Notified on raise; may record the receipt even if not a
--     configured step owner.
--  2. sample_items  — competitor colour/quantity becomes a jsonb list [{colour,quantity}].
--  4. Result Handover — a NEW step after `result`. Result no longer closes the
--     request; it moves to `awaiting_handover`, and recording the handover closes.
--  5. Send step also captures gate_entry_no + sent_qty.
--
-- CRITICAL: making `result` non-terminal changes what "the last step" means.
--   * result is now editable UNTIL handover (was: editable forever after close).
--   * result_handover is the new last step → editable after close (only hold/
--     cancel lock), mirroring the old result rule.
--   * resume_status must learn the two new branches or an un-hold resolves wrong.
--
-- Purely ADDITIVE (new nullable columns; the status CHECK is only WIDENED). Apply
-- BEFORE the frontend that reads these. Clone lineage: 20260724120100 (workflow)
-- + 20260724120200 (edit-until-next-step).
--
-- Reversal is create-or-replace of the prior bodies + dropping the new columns/
-- functions; kept out of band (this is an in-place amendment of live functions).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A1. New columns + widened status CHECK
-- ---------------------------------------------------------------------------
alter table public.fms_sampling_requests
  add column if not exists collector_id    uuid references auth.users on delete set null,
  add column if not exists sample_items    jsonb not null default '[]'::jsonb,
  add column if not exists gate_entry_no   text,
  add column if not exists sent_qty        text,
  add column if not exists handover_date   date,
  add column if not exists handover_note   text,
  add column if not exists handed_over_at  timestamptz,
  add column if not exists handed_over_by  uuid references auth.users on delete set null;

comment on column public.fms_sampling_requests.collector_id is
  'Competitor-inward: the chosen collector. A per-request assignee for receive_sample — notified on raise, authorized to record the receipt (see fms_sampling_can_act).';
comment on column public.fms_sampling_requests.sample_items is
  'Competitor-inward: [{ "colour": text, "quantity": text }] — the samples to collect. Legacy single value stays in colour_qty.';

alter table public.fms_sampling_requests drop constraint if exists fms_sampling_requests_status_check;
alter table public.fms_sampling_requests add  constraint fms_sampling_requests_status_check
  check (status in ('awaiting_receipt','awaiting_send','awaiting_confirm',
                    'awaiting_testing','awaiting_result','awaiting_handover',
                    'closed','on_hold','cancelled'));

-- ---------------------------------------------------------------------------
-- A2. Authorization — the collector may act on receive_sample for THEIR request.
-- (Everything else unchanged: admin / coordinator / configured step owner.)
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
      or public.fms_sampling_is_step_owner(p_step_key, p_uid)
      or (p_step_key = 'receive_sample'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.collector_id = p_uid));
$$;
grant execute on function public.fms_sampling_can_act(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A6 (resume). Two new branches FIRST so a held post-result request resumes right.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.handed_over_at is not null then 'closed'
    when r.resulted_at    is not null then 'awaiting_handover'
    when r.tested_at      is not null then 'awaiting_result'
    when r.direction = 'inward' then
      case when r.received_at is not null then 'awaiting_testing' else 'awaiting_receipt' end
    else
      case when r.confirmed_at is not null then 'awaiting_testing'
           when r.sent_at      is not null then 'awaiting_confirm'
           else 'awaiting_send' end
  end
  from public.fms_sampling_requests r where r.id = p_req;
$$;
grant execute on function public.fms_sampling_resume_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A3. Submit — store collector_id / sample_items / gate_entry_no / sent_qty and
-- notify the collector (alongside the receive_sample owners) on an inward raise.
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
  v_status    text;
  v_step      text;
  v_recips    uuid[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if (p->>'company_id') is null or trim(p->>'company_id') = '' then raise exception 'Company is required'; end if;
  if v_via not in ('import','domestic') then raise exception 'Sample source (Import/Domestic) is required'; end if;
  if v_dir not in ('inward','outward') then raise exception 'Direction (Inward/Outward) is required'; end if;
  if coalesce(trim(p->>'product_desc'), '') = '' then raise exception 'Product / description is required'; end if;

  if v_dir = 'inward' then
    if v_req not in ('competitor','new_product') then
      raise exception 'Requirement type is required for an inward sample';
    end if;
  else
    v_req := null;
  end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  if v_dir = 'inward' then
    v_status := 'awaiting_receipt'; v_step := 'receive_sample';
  else
    v_status := 'awaiting_send';    v_step := 'send_sample';
  end if;

  v_seq := public.fms_sampling_next_seq('SMP-' || v_fy);
  v_no  := 'SMP-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_sampling_requests (
    req_no, company_id, receive_via, direction, requirement_type,
    raised_by, requester_name,
    party_name, product_desc, colour_qty, sample_items,
    collector_id, collector_name, handover_name,
    transport_borne, desired_result, additional_info,
    status, current_step, submitted_at
  ) values (
    v_no, (p->>'company_id')::uuid, v_via, v_dir, v_req,
    v_uid, v_name,
    nullif(trim(p->>'party_name'), ''),
    trim(p->>'product_desc'),
    nullif(trim(p->>'colour_qty'), ''),
    coalesce(p->'sample_items', '[]'::jsonb),
    v_collector,
    nullif(trim(p->>'collector_name'), ''),
    nullif(trim(p->>'handover_name'), ''),
    nullif(p->>'transport_borne', ''),
    nullif(trim(p->>'desired_result'), ''),
    nullif(trim(p->>'additional_info'), ''),
    v_status, v_step, now()
  )
  returning id into v_id;

  -- The receive_sample owners, plus the chosen collector on an inward raise.
  v_recips := public.fms_sampling_step_owner_ids(v_step);
  if v_dir = 'inward' and v_collector is not null then
    v_recips := v_recips || v_collector;
  end if;

  perform public.fms_sampling_announce(
    'request', v_id, 'raised',
    'Sampling request ' || v_no || ' is ready for the ' ||
      (case when v_dir = 'inward' then 'sample-received step.' else 'sample-sent step.' end),
    v_recips,
    -- The email keys (rendered by send-email only when Sampling email is ON) are
    -- harmless in the activity/bell meta when off.
    jsonb_build_object(
      'req_no', v_no, 'direction', v_dir,
      'eyebrow', (case when v_dir = 'inward' then 'Sample to collect' else 'Sample to send' end),
      'headline', (case when v_dir = 'inward'
                        then 'A sample is ready to be collected'
                        else 'A sample is ready to be sent' end),
      'action', (case when v_dir = 'inward' then 'raised a sample for you to collect'
                                            else 'raised a sample to send' end),
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || v_id::text,
      'ctaLabel', 'Open in Sampling'
    )
  );

  return v_id;
end $$;
grant execute on function public.fms_sampling_submit_request(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- receive_sample — unchanged EXCEPT re-issued so the file is self-contained.
-- (Body identical to 20260724120100; kept here for clone parity is unnecessary,
--  so it is intentionally NOT re-issued. See A5 below for the one that changes.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A4. Send — also store gate_entry_no + sent_qty.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_sampling_record_send(uuid, jsonb);
create or replace function public.fms_sampling_record_send(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_send' then
    raise exception 'This request is not awaiting sample dispatch (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('send_sample', p_req, v_uid) then
    raise exception 'Not authorized to record sample dispatch';
  end if;

  update public.fms_sampling_requests set
    sent_date     = coalesce(nullif(p->>'sent_date','')::date, current_date),
    gate_entry_no = nullif(trim(p->>'gate_entry_no'), ''),
    sent_qty      = nullif(trim(p->>'sent_qty'), ''),
    sent_at       = coalesce(sent_at, now()),
    sent_by       = coalesce(sent_by, v_uid),
    status = 'awaiting_confirm', current_step = 'confirm_receipt'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'sent',
    'Sample sent for ' || coalesce(v_no,'a request') || ' — awaiting receipt confirmation.',
    public.fms_sampling_step_owner_ids('confirm_receipt'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_send(uuid, jsonb) to authenticated;

-- Edit-until-confirm: also correct gate_entry_no + sent_qty.
create or replace function public.fms_sampling_update_send(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('send_sample', p_req, v_uid) then
    raise exception 'Not authorized to edit the sample dispatch';
  end if;
  if not public.fms_sampling_send_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    end if;
    raise exception 'The sample dispatch can no longer be edited: receipt has already been confirmed (status %).', v_status;
  end if;

  update public.fms_sampling_requests set
    sent_date     = coalesce(nullif(p->>'sent_date','')::date, sent_date),
    gate_entry_no = nullif(trim(p->>'gate_entry_no'), ''),
    sent_qty      = nullif(trim(p->>'sent_qty'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'send_edited',
    format('Sample dispatch on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_send(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A5. Result — no longer closes; moves to awaiting_handover and notifies the
-- result_handover owners.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_sampling_record_result(uuid, jsonb);
create or replace function public.fms_sampling_record_result(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_result' then
    raise exception 'This request is not awaiting a result (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('result', p_req, v_uid) then
    raise exception 'Not authorized to record the result';
  end if;
  if coalesce(trim(p->>'result_comment'), '') = '' then
    raise exception 'A result comment is required';
  end if;

  update public.fms_sampling_requests set
    result_comment  = trim(p->>'result_comment'),
    result_owner    = nullif(trim(p->>'result_owner'), ''),
    attachment_path = nullif(p->>'attachment_path', ''),
    attachment_name = nullif(p->>'attachment_name', ''),
    resulted_at = coalesce(resulted_at, now()),
    resulted_by = coalesce(resulted_by, v_uid),
    status = 'awaiting_handover', current_step = 'result_handover'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'resulted',
    'Result recorded for ' || coalesce(v_no,'a request') || ' — ready for handover.',
    public.fms_sampling_step_owner_ids('result_handover'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_result(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A5. Result Handover — the NEW closing step. Records the handover + closes.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_sampling_record_handover(uuid, jsonb);
create or replace function public.fms_sampling_record_handover(p_req uuid, p jsonb)
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
  if v_status <> 'awaiting_handover' then
    raise exception 'This request is not awaiting result handover (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('result_handover', p_req, v_uid) then
    raise exception 'Not authorized to record the result handover';
  end if;

  update public.fms_sampling_requests set
    handover_date  = coalesce(nullif(p->>'handover_date','')::date, current_date),
    handover_note  = nullif(trim(p->>'handover_note'), ''),
    handed_over_at = coalesce(handed_over_at, now()),
    handed_over_by = coalesce(handed_over_by, v_uid),
    closed_at      = coalesce(closed_at, now()),
    status = 'closed', current_step = 'result_handover'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'handed_over',
    'Result handed over for ' || coalesce(v_no,'a request') || ' — request closed.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_handover(uuid, jsonb) to authenticated;

-- ===========================================================================
-- A6. EDIT-UNTIL-NEXT-STEP predicates — reworked because result is no longer
-- terminal. (Twins of 20260724120200.)
-- ===========================================================================

-- result: was editable while status='closed' (last step). Now result HAS a
-- downstream step, so it is editable only while awaiting_handover.
create or replace function public.fms_sampling_result_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.resulted_at is not null and r.status = 'awaiting_handover'
  );
$$;
grant execute on function public.fms_sampling_result_editable(uuid) to authenticated;

create or replace function public.fms_sampling_update_result(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('result', p_req, v_uid) then
    raise exception 'Not authorized to edit the result';
  end if;
  if not public.fms_sampling_result_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — its result can no longer be edited.';
    end if;
    raise exception 'The result can no longer be edited: the handover has already been recorded (status %).', v_status;
  end if;
  if coalesce(trim(p->>'result_comment'), '') = '' then
    raise exception 'A result comment is required';
  end if;

  update public.fms_sampling_requests set
    result_comment  = trim(p->>'result_comment'),
    result_owner    = nullif(trim(p->>'result_owner'), ''),
    attachment_path = case when p ? 'attachment_path' then nullif(p->>'attachment_path','') else attachment_path end,
    attachment_name = case when p ? 'attachment_name' then nullif(p->>'attachment_name','') else attachment_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'result_edited',
    format('Result on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_result(uuid, jsonb) to authenticated;

-- result_handover: the NEW last step. Stays editable after close (only hold/
-- cancel lock), mirroring the old result rule.
create or replace function public.fms_sampling_handover_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.handed_over_at is not null and r.status = 'closed'
  );
$$;
grant execute on function public.fms_sampling_handover_editable(uuid) to authenticated;

create or replace function public.fms_sampling_update_handover(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('result_handover', p_req, v_uid) then
    raise exception 'Not authorized to edit the result handover';
  end if;
  if not public.fms_sampling_handover_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — its handover can no longer be edited.';
    end if;
    raise exception 'No handover has been recorded on this request yet — there is nothing to edit.';
  end if;

  update public.fms_sampling_requests set
    handover_date = coalesce(nullif(p->>'handover_date','')::date, handover_date),
    handover_note = nullif(trim(p->>'handover_note'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'handover_edited',
    format('Result handover on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_handover(uuid, jsonb) to authenticated;
