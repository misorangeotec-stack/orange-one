-- ===========================================================================
-- SAMPLING FMS — edit-until-the-next-step.
--
-- The twin of office-supplies 20260719130000 / import 20260719120000. Each stage
-- screen is a pending-only queue; the instant an owner acts the row leaves it.
-- These predicates + RPCs let an owner see and CORRECT what they did — but only
-- until the next step is done.
--
-- HOW "editable until the next step" maps to sampling's status machine:
--   receive_sample  editable while status='awaiting_testing' AND direction='inward'
--                     (received done; testing not yet done)
--   send_sample     editable while status='awaiting_confirm'
--   confirm_receipt editable while status='awaiting_testing' AND direction='outward'
--   testing         editable while status='awaiting_result'
--   result          the LAST step — nothing downstream can lock it, so it STAYS
--                     editable after the request closes (product decision, safe:
--                     there is no derived stage machine to drift). Only on_hold /
--                     cancelled lock it.
--
-- `awaiting_testing` is shared by the inward (post-receive) and outward
-- (post-confirm) paths, so receive/confirm disambiguate on `direction`.
--
-- Every RPC: authorized exactly like its create twin · re-checks the lock
-- SERVER-side (the disabled button is a courtesy, never the gate) · takes a row
-- lock · writes edited_at/edited_by (kept SEPARATE from the step's own *_at/*_by
-- attribution, which is history) · and announces IN THIS TRANSACTION.
--
-- Additive / replace-only. Apply BEFORE the frontend that reads these.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- receive_sample (inward)
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_receipt_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.direction = 'inward'
       and r.received_at is not null and r.status = 'awaiting_testing'
  );
$$;
grant execute on function public.fms_sampling_receipt_editable(uuid) to authenticated;

create or replace function public.fms_sampling_update_receipt(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('receive_sample', p_req, v_uid) then
    raise exception 'Not authorized to edit the sample receipt';
  end if;
  if not public.fms_sampling_receipt_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    end if;
    raise exception 'The sample receipt can no longer be edited: testing has already been recorded (status %).', v_status;
  end if;

  update public.fms_sampling_requests set
    received_date = coalesce(nullif(p->>'received_date','')::date, received_date),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'receipt_edited',
    format('Sample receipt on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_receipt(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- send_sample (outward)
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_send_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.direction = 'outward'
       and r.sent_at is not null and r.status = 'awaiting_confirm'
  );
$$;
grant execute on function public.fms_sampling_send_editable(uuid) to authenticated;

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
    sent_date = coalesce(nullif(p->>'sent_date','')::date, sent_date),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'send_edited',
    format('Sample dispatch on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_send(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_receipt (outward)
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_confirm_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.direction = 'outward'
       and r.confirmed_at is not null and r.status = 'awaiting_testing'
  );
$$;
grant execute on function public.fms_sampling_confirm_editable(uuid) to authenticated;

create or replace function public.fms_sampling_update_confirm(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('confirm_receipt', p_req, v_uid) then
    raise exception 'Not authorized to edit the receipt confirmation';
  end if;
  if not public.fms_sampling_confirm_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    end if;
    raise exception 'The receipt confirmation can no longer be edited: testing has already been recorded (status %).', v_status;
  end if;

  update public.fms_sampling_requests set
    party_received_date = coalesce(nullif(p->>'party_received_date','')::date, party_received_date),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'confirm_edited',
    format('Receipt confirmation on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_confirm(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- testing (both)
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_testing_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.tested_at is not null and r.status = 'awaiting_result'
  );
$$;
grant execute on function public.fms_sampling_testing_editable(uuid) to authenticated;

create or replace function public.fms_sampling_update_testing(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('testing', p_req, v_uid) then
    raise exception 'Not authorized to edit the testing entry';
  end if;
  if not public.fms_sampling_testing_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    end if;
    raise exception 'The testing entry can no longer be edited: the result has already been recorded (status %).', v_status;
  end if;

  update public.fms_sampling_requests set
    testing_completed_date = coalesce(nullif(p->>'testing_completed_date','')::date, testing_completed_date),
    internal_ref           = nullif(trim(p->>'internal_ref'), ''),
    tentative_result_date  = nullif(p->>'tentative_result_date','')::date,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'testing_edited',
    format('Testing entry on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_testing(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- result (both) — the LAST step. Stays editable after close; only on_hold /
-- cancelled lock it. Safe: this app has no derived stage machine.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_result_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.resulted_at is not null and r.status = 'closed'
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
    raise exception 'No result has been recorded on this request yet — there is nothing to edit.';
  end if;
  if coalesce(trim(p->>'result_comment'), '') = '' then
    raise exception 'A result comment is required';
  end if;

  update public.fms_sampling_requests set
    result_comment  = trim(p->>'result_comment'),
    result_owner    = nullif(trim(p->>'result_owner'), ''),
    -- when the caller passes an attachment key it replaces; absent key keeps the current file.
    attachment_path = case when p ? 'attachment_path' then nullif(p->>'attachment_path','') else attachment_path end,
    attachment_name = case when p ? 'attachment_name' then nullif(p->>'attachment_name','') else attachment_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'result_edited',
    format('Result on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_result(uuid, jsonb) to authenticated;
