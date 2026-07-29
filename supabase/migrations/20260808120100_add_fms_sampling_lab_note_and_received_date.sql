-- Sampling FMS — two things the inward lab branch was missing.
--
-- 1. `lab_note`         : free remarks on the lab process. ONE field spanning the
--                         step's two passes, so it can be jotted when the sample
--                         reaches the lab and still corrected when testing ends.
--                         It is NOT `lab_comment` — that one is the required
--                         verdict of the test and only exists on pass 2.
--
-- 2. `lab_received_date`: the date the sample was RECEIVED by whoever sends it on
--                         to the lab. Until now the step captured one date, and
--                         the field labelled "Date received" wrote `lab_sent_date`.
--                         From here those are two separate dates and the sent date
--                         may never be earlier than the received date.
--
-- ⚠ `lab_sent_date` CHANGES MEANING with NO backfill — see its column comment.
--
-- Additive only: two new nullable columns, six functions re-issued from their live
-- bodies (pulled with pg_get_functiondef, not from the migration files) with the
-- guarded writes and the ordering check added. Nothing is dropped or rewritten.

begin;

/* ------------------------------- columns ---------------------------------- */

alter table public.fms_sampling_requests
  add column if not exists lab_note          text,
  add column if not exists lab_received_date date;

comment on column public.fms_sampling_requests.lab_note is
  'Remarks on the lab process. Capturable on pass 1 (sample at the lab) and still editable on pass 2. Distinct from lab_comment, which is the required test verdict.';

comment on column public.fms_sampling_requests.lab_received_date is
  'Date the sample was received by the person who sends it to the lab. NO current_date fallback: a client that does not send the key leaves it null, which is what keeps the sent-not-before-received rule from firing against older clients.';

comment on column public.fms_sampling_requests.lab_sent_date is
  'Date the sample was SENT TO THE LAB. Before 08-08-2026 this column backed a field labelled "Date received" — rows written then hold a received date here. DO NOT BACKFILL: the two dates were the same act at the time, so the stored value is correct as a sent date too.';

/* ------------------- sample_to_lab: two dates, one rule -------------------- */

create or replace function public.fms_sampling_record_sample_to_lab(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_ref  text := nullif(trim(p->>'internal_ref'), '');
  -- No current_date fallback on received: an old client never sends the key, so
  -- v_recv stays null for it and the ordering check below can never fire.
  v_recv date := nullif(p->>'lab_received_date','')::date;
  v_sent date := coalesce(nullif(p->>'lab_sent_date','')::date, current_date);
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_sample_to_lab' then
    raise exception 'This request is not awaiting the sample to be sent to the lab (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('sample_to_lab', p_req, v_uid) then
    raise exception 'Not authorized to record the sample receipt';
  end if;
  if v_ref is null then raise exception 'An internal reference number is required'; end if;
  if v_recv is not null and v_sent < v_recv then
    raise exception 'The date sent to the lab cannot be earlier than the date received (sent %, received %).',
      to_char(v_sent, 'DD-MM-YYYY'), to_char(v_recv, 'DD-MM-YYYY');
  end if;

  update public.fms_sampling_requests set
    internal_ref      = v_ref,
    lab_received_date = v_recv,
    lab_sent_date     = v_sent,
    lab_sent_at       = coalesce(lab_sent_at, now()),
    lab_sent_by       = coalesce(lab_sent_by, v_uid),
    status = 'awaiting_lab_process', current_step = 'lab_process'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'sent_to_lab',
    'Sample for ' || coalesce(v_no,'a request') || ' (ref ' || v_ref || ') has reached the lab.',
    public.fms_sampling_step_owner_ids('lab_process'),
    jsonb_build_object(
      'req_no', v_no, 'direction', 'inward',
      'eyebrow', 'Sample at the lab',
      'headline', 'A sample is with the lab — record the tentative result date',
      'action', 'sent a sample to the lab',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'
    ));
end $function$;

create or replace function public.fms_sampling_update_sample_to_lab(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_ref text := nullif(trim(p->>'internal_ref'), '');
  v_recv date; v_sent date;
begin
  -- The stored dates come out with the lock so the ordering check below runs on
  -- the MERGED pair (payload over stored) — a client may send one key, not both.
  select status, req_no, lab_received_date, lab_sent_date
    into v_status, v_no, v_recv, v_sent
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('sample_to_lab', p_req, v_uid) then
    raise exception 'Not authorized to edit the sample receipt';
  end if;
  if not public.fms_sampling_sample_to_lab_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — its receipt can no longer be edited.';
    end if;
    raise exception 'The lab has already finished — the sample receipt can no longer be edited (status %).', v_status;
  end if;
  if v_ref is null then raise exception 'An internal reference number is required'; end if;

  if p ? 'lab_received_date' then v_recv := nullif(p->>'lab_received_date','')::date; end if;
  v_sent := coalesce(nullif(p->>'lab_sent_date','')::date, v_sent);
  if v_recv is not null and v_sent is not null and v_sent < v_recv then
    raise exception 'The date sent to the lab cannot be earlier than the date received (sent %, received %).',
      to_char(v_sent, 'DD-MM-YYYY'), to_char(v_recv, 'DD-MM-YYYY');
  end if;

  update public.fms_sampling_requests set
    internal_ref      = v_ref,
    lab_received_date = v_recv,   -- already the merged value
    lab_sent_date     = v_sent,   -- already the merged value
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'sent_to_lab_edited',
    format('Sample receipt on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $function$;

/* ----------------- lab_process: the remark, on both passes ----------------- */
-- Every write uses the key guard `p ? 'lab_note'`: absent key keeps what is
-- stored (an older client cannot blank it), present-but-empty clears it.

create or replace function public.fms_sampling_record_lab_start(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text; v_no text; v_raiser uuid; v_uid uuid := auth.uid();
  v_date date := nullif(p->>'lab_tentative_date','')::date;
begin
  select status, req_no, raised_by into v_status, v_no, v_raiser
    from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_lab_process' then
    raise exception 'This request is not with the lab (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('lab_process', p_req, v_uid) then
    raise exception 'Not authorized to record the lab process';
  end if;
  if v_date is null then raise exception 'A tentative result date is required'; end if;

  update public.fms_sampling_requests set
    lab_tentative_date = v_date,
    lab_note           = case when p ? 'lab_note' then nullif(trim(p->>'lab_note'), '') else lab_note end,
    lab_started_at     = coalesce(lab_started_at, now()),
    lab_started_by     = coalesce(lab_started_by, v_uid)
  where id = p_req;   -- status/current_step deliberately unchanged

  perform public.fms_sampling_announce('request', p_req, 'lab_started',
    'The lab has the sample for ' || coalesce(v_no,'a request') ||
      ' — result expected by ' || to_char(v_date, 'DD-MM-YYYY') || '.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object(
      'req_no', v_no, 'direction', 'inward',
      'eyebrow', 'Testing under way',
      'headline', 'The lab has your sample',
      'action', 'confirmed the lab has the sample',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'
    ));
end $function$;

create or replace function public.fms_sampling_update_lab_start(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_date date := nullif(p->>'lab_tentative_date','')::date;
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('lab_process', p_req, v_uid) then
    raise exception 'Not authorized to edit the lab process';
  end if;
  if not public.fms_sampling_lab_start_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — the lab process can no longer be edited.';
    end if;
    raise exception 'The lab process is already complete — the tentative date can no longer be changed.';
  end if;
  if v_date is null then raise exception 'A tentative result date is required'; end if;

  update public.fms_sampling_requests set
    lab_tentative_date = v_date,
    lab_note           = case when p ? 'lab_note' then nullif(trim(p->>'lab_note'), '') else lab_note end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'lab_started_edited',
    format('Tentative result date on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $function$;

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
  if v_doc     is null then raise exception 'A lab testing attachment is required to complete the lab process'; end if;
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

create or replace function public.fms_sampling_update_lab_complete(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_comment text := nullif(trim(p->>'lab_comment'), '');
  v_to      uuid := nullif(p->>'lab_result_to_id','')::uuid;
  v_to_name text := nullif(trim(p->>'lab_result_to_name'), '');
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('lab_process', p_req, v_uid) then
    raise exception 'Not authorized to edit the lab process';
  end if;
  if not public.fms_sampling_lab_complete_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — the lab process can no longer be edited.';
    end if;
    raise exception 'The result has already been received — the lab process can no longer be edited (status %).', v_status;
  end if;
  if v_comment is null then raise exception 'Test comments are required'; end if;
  if v_to is null and v_to_name is null then
    raise exception 'Record whom the result is handed over to';
  end if;

  -- The attachment key is sent ONLY when a new file replaces the current one, so an
  -- absent key must keep what is there — the same contract update_result uses.
  update public.fms_sampling_requests set
    lab_completed_date = coalesce(nullif(p->>'lab_completed_date','')::date, lab_completed_date),
    lab_comment        = v_comment,
    lab_note           = case when p ? 'lab_note' then nullif(trim(p->>'lab_note'), '') else lab_note end,
    lab_tentative_date = coalesce(nullif(p->>'lab_tentative_date','')::date, lab_tentative_date),
    lab_doc_path       = case when p ? 'lab_doc_path' then coalesce(nullif(p->>'lab_doc_path',''), lab_doc_path) else lab_doc_path end,
    lab_doc_name       = case when p ? 'lab_doc_path' then coalesce(nullif(p->>'lab_doc_name',''), lab_doc_name) else lab_doc_name end,
    lab_result_to_id   = v_to,
    lab_result_to_name = v_to_name,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'lab_completed_edited',
    format('Lab process on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $function$;

-- create-or-replace keeps the existing ACL; restated so a fresh rebuild is complete.
grant execute on function public.fms_sampling_record_sample_to_lab(uuid, jsonb) to authenticated;
grant execute on function public.fms_sampling_update_sample_to_lab(uuid, jsonb) to authenticated;
grant execute on function public.fms_sampling_record_lab_start(uuid, jsonb)      to authenticated;
grant execute on function public.fms_sampling_update_lab_start(uuid, jsonb)      to authenticated;
grant execute on function public.fms_sampling_record_lab_complete(uuid, jsonb)   to authenticated;
grant execute on function public.fms_sampling_update_lab_complete(uuid, jsonb)   to authenticated;

commit;
