-- ===========================================================================
-- SAMPLING FMS — THE REQUEST + WORKFLOW (Phase 2).
--
-- One entity per request (case-style, like fms_supplies_requests / fms_exit_cases
-- — no header+line split). ONE AUTHORITATIVE TIMESTAMP COLUMN PER STEP.
--
-- TWO PATHS through the same row, chosen by `direction`:
--   inward  : request → receive_sample → testing → result → closed
--   outward : request → send_sample → confirm_receipt → testing → result → closed
-- The two paths converge at `testing`. Steps that don't apply to a request's
-- direction are simply never its current_step, so their queue never shows it.
--
-- Helpers:
--   fms_sampling_can_act(step, req, uid)  — the authorization gate
--   fms_sampling_resume_status(req)       — where a held request goes back to
--
-- RPCs (all SECURITY DEFINER; lock the row, validate status, re-check authz,
-- stamp the step's own timestamp, then advance status/current_step):
--   fms_sampling_submit_request, fms_sampling_record_receipt, _record_send,
--   _record_confirm, _record_testing, _record_result, _hold_request, _cancel_request
--
-- ⚠ NEVER INFER A STEP'S COMPLETION FROM THE ACTIVITY TRAIL — announce() is
--   best-effort and swallowed. Every step stamps its own column here.
--
-- Purely ADDITIVE. Reverses (in order):
--   drop function if exists public.fms_sampling_cancel_request(uuid,text);
--   drop function if exists public.fms_sampling_hold_request(uuid,boolean,text);
--   drop function if exists public.fms_sampling_record_result(uuid,jsonb);
--   drop function if exists public.fms_sampling_record_testing(uuid,jsonb);
--   drop function if exists public.fms_sampling_record_confirm(uuid,jsonb);
--   drop function if exists public.fms_sampling_record_send(uuid,jsonb);
--   drop function if exists public.fms_sampling_record_receipt(uuid,jsonb);
--   drop function if exists public.fms_sampling_submit_request(jsonb);
--   drop function if exists public.fms_sampling_resume_status(uuid);
--   drop function if exists public.fms_sampling_can_act(text,uuid,uuid);
--   drop table if exists public.fms_sampling_requests;
-- ===========================================================================

create table if not exists public.fms_sampling_requests (
  id                    uuid primary key default gen_random_uuid(),
  req_no                text not null unique,          -- SMP-2627-0001

  -- ---- intake (all free text except company + the two enums) -------------
  company_id            uuid not null references public.fms_sampling_companies on delete restrict,
  receive_via           text not null check (receive_via in ('import','domestic')),
  direction             text not null check (direction in ('inward','outward')),
  -- Inward only; null for outward.
  requirement_type      text check (requirement_type in ('competitor','new_product')),

  raised_by             uuid references auth.users on delete set null,
  requester_name        text not null,

  party_name            text,   -- Customer/Company (from, or send-to) OR Supplier name
  product_desc          text,   -- Product name / description & quantity for sampling
  colour_qty            text,   -- competitor: colour & quantity to collect
  collector_name        text,   -- competitor: who collects the sample
  handover_name         text,   -- competitor: whom to hand the competitor sample to
  transport_borne       text check (transport_borne in ('Yes','No')),  -- borne by supplier (inward) / receiver (outward)
  desired_result        text,
  additional_info       text,

  -- STATUSES ARE NOT STEP KEYS. on_hold / cancelled / closed live here and
  -- nowhere in StepKey — a status loose in a queue is work owed by nobody.
  status                text not null check (status in (
                          'awaiting_receipt','awaiting_send','awaiting_confirm',
                          'awaiting_testing','awaiting_result',
                          'closed','on_hold','cancelled')),
  current_step          text not null,

  -- ---- AUTHORITATIVE step timestamps + captured data ---------------------
  submitted_at          timestamptz not null default now(),

  -- receive_sample (inward)
  received_date         date,
  received_at           timestamptz,
  received_by           uuid references auth.users on delete set null,

  -- send_sample (outward)
  sent_date             date,
  sent_at               timestamptz,
  sent_by               uuid references auth.users on delete set null,

  -- confirm_receipt (outward)
  party_received_date   date,
  confirmed_at          timestamptz,
  confirmed_by          uuid references auth.users on delete set null,

  -- testing (both)
  testing_completed_date date,
  internal_ref          text,
  tentative_result_date date,
  tested_at             timestamptz,
  tested_by             uuid references auth.users on delete set null,

  -- result (both) — closes the request
  result_comment        text,
  result_owner          text,
  attachment_path       text,   -- storage object path in fms-sampling-docs
  attachment_name       text,   -- original filename for display
  resulted_at           timestamptz,
  resulted_by           uuid references auth.users on delete set null,
  closed_at             timestamptz,

  -- edit audit (one pair — a request only sits at one step at a time)
  edited_at             timestamptz,
  edited_by             uuid references auth.users on delete set null,

  hold_at               timestamptz,
  hold_reason           text,
  cancelled_at          timestamptz,
  cancel_reason         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.fms_sampling_requests is
  'One sampling request. Carries the intake (all free text except company + enums), the direction that chooses the path, and one authoritative timestamp per step. Read is open to every granted user (the app is per-user granted, not universal); writes go through the RPCs.';

create index if not exists fms_sampling_requests_status_idx on public.fms_sampling_requests (status);
create index if not exists fms_sampling_requests_dir_idx    on public.fms_sampling_requests (direction);
create index if not exists fms_sampling_requests_raised_idx on public.fms_sampling_requests (raised_by);

drop trigger if exists trg_fms_sampling_requests_updated on public.fms_sampling_requests;
create trigger trg_fms_sampling_requests_updated
  before update on public.fms_sampling_requests
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- AUTHORIZATION
-- ===========================================================================

-- THE gate every workflow RPC calls: admin / coordinator / the step's owner.
-- (No approval, no per-request HOD — sampling steps are owned globally.)
create or replace function public.fms_sampling_can_act(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or public.fms_sampling_is_coordinator(p_uid)
      or public.fms_sampling_is_step_owner(p_step_key, p_uid);
$$;
grant execute on function public.fms_sampling_can_act(text, uuid, uuid) to authenticated;

-- Where a held request goes back to — derived from its own timestamps + direction,
-- so a stashed status can never go stale.
create or replace function public.fms_sampling_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.resulted_at is not null then 'closed'
    when r.tested_at   is not null then 'awaiting_result'
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

-- ===========================================================================
-- RLS — read open to every granted user; every write goes through the RPCs.
-- ===========================================================================
alter table public.fms_sampling_requests enable row level security;
drop policy if exists fms_sampling_requests_select on public.fms_sampling_requests;
create policy fms_sampling_requests_select on public.fms_sampling_requests
  for select to authenticated using (true);
drop policy if exists fms_sampling_requests_write_admin on public.fms_sampling_requests;
create policy fms_sampling_requests_write_admin on public.fms_sampling_requests
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ===========================================================================
-- RPC — raise a request. THE ORIGIN OF THE WORKFLOW.
-- ===========================================================================
drop function if exists public.fms_sampling_submit_request(jsonb);
create or replace function public.fms_sampling_submit_request(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_no       text;
  v_seq      integer;
  v_fy       text := public.fms_sampling_fy_code(current_date);
  v_uid      uuid := auth.uid();
  v_dir      text := nullif(p->>'direction','');
  v_via      text := nullif(p->>'receive_via','');
  v_req      text := nullif(p->>'requirement_type','');
  v_name     text := nullif(trim(p->>'requester_name'), '');
  v_status   text;
  v_step     text;
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
    v_req := null;  -- outward carries no requirement type
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
    party_name, product_desc, colour_qty, collector_name, handover_name,
    transport_borne, desired_result, additional_info,
    status, current_step, submitted_at
  ) values (
    v_no, (p->>'company_id')::uuid, v_via, v_dir, v_req,
    v_uid, v_name,
    nullif(trim(p->>'party_name'), ''),
    trim(p->>'product_desc'),
    nullif(trim(p->>'colour_qty'), ''),
    nullif(trim(p->>'collector_name'), ''),
    nullif(trim(p->>'handover_name'), ''),
    nullif(p->>'transport_borne', ''),
    nullif(trim(p->>'desired_result'), ''),
    nullif(trim(p->>'additional_info'), ''),
    v_status, v_step, now()
  )
  returning id into v_id;

  perform public.fms_sampling_announce(
    'request', v_id, 'raised',
    'Sampling request ' || v_no || ' is ready for the ' ||
      (case when v_dir = 'inward' then 'sample-received step.' else 'sample-sent step.' end),
    public.fms_sampling_step_owner_ids(v_step),
    jsonb_build_object('req_no', v_no)
  );

  return v_id;
end $$;
grant execute on function public.fms_sampling_submit_request(jsonb) to authenticated;

-- ===========================================================================
-- RPC — receive_sample (inward). Records the date the product came in.
-- ===========================================================================
drop function if exists public.fms_sampling_record_receipt(uuid, jsonb);
create or replace function public.fms_sampling_record_receipt(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_receipt' then
    raise exception 'This request is not awaiting sample receipt (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('receive_sample', p_req, v_uid) then
    raise exception 'Not authorized to record sample receipt';
  end if;

  update public.fms_sampling_requests set
    received_date = coalesce(nullif(p->>'received_date','')::date, current_date),
    received_at   = coalesce(received_at, now()),
    received_by   = coalesce(received_by, v_uid),
    status = 'awaiting_testing', current_step = 'testing'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'received',
    'Sample received for ' || coalesce(v_no,'a request') || ' — ready for testing.',
    public.fms_sampling_step_owner_ids('testing'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_receipt(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — send_sample (outward). Records the date we dispatched the sample.
-- ===========================================================================
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
    sent_date = coalesce(nullif(p->>'sent_date','')::date, current_date),
    sent_at   = coalesce(sent_at, now()),
    sent_by   = coalesce(sent_by, v_uid),
    status = 'awaiting_confirm', current_step = 'confirm_receipt'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'sent',
    'Sample sent for ' || coalesce(v_no,'a request') || ' — awaiting receipt confirmation.',
    public.fms_sampling_step_owner_ids('confirm_receipt'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_send(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — confirm_receipt (outward). The supplier/customer confirmed arrival.
-- ===========================================================================
drop function if exists public.fms_sampling_record_confirm(uuid, jsonb);
create or replace function public.fms_sampling_record_confirm(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_confirm' then
    raise exception 'This request is not awaiting receipt confirmation (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('confirm_receipt', p_req, v_uid) then
    raise exception 'Not authorized to confirm receipt';
  end if;

  update public.fms_sampling_requests set
    party_received_date = coalesce(nullif(p->>'party_received_date','')::date, current_date),
    confirmed_at = coalesce(confirmed_at, now()),
    confirmed_by = coalesce(confirmed_by, v_uid),
    status = 'awaiting_testing', current_step = 'testing'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'confirmed',
    'Receipt confirmed for ' || coalesce(v_no,'a request') || ' — ready for testing.',
    public.fms_sampling_step_owner_ids('testing'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_confirm(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — testing (both). Records testing completion + internal ref + tentative date.
-- ===========================================================================
drop function if exists public.fms_sampling_record_testing(uuid, jsonb);
create or replace function public.fms_sampling_record_testing(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_testing' then
    raise exception 'This request is not awaiting testing (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('testing', p_req, v_uid) then
    raise exception 'Not authorized to record testing';
  end if;

  update public.fms_sampling_requests set
    testing_completed_date = coalesce(nullif(p->>'testing_completed_date','')::date, current_date),
    internal_ref           = nullif(trim(p->>'internal_ref'), ''),
    tentative_result_date  = nullif(p->>'tentative_result_date','')::date,
    tested_at = coalesce(tested_at, now()),
    tested_by = coalesce(tested_by, v_uid),
    status = 'awaiting_result', current_step = 'result'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'tested',
    'Testing completed for ' || coalesce(v_no,'a request') || ' — awaiting result.',
    public.fms_sampling_step_owner_ids('result'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_testing(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — result (both). Records the result + owner + attachment; closes the request.
-- ===========================================================================
drop function if exists public.fms_sampling_record_result(uuid, jsonb);
create or replace function public.fms_sampling_record_result(p_req uuid, p jsonb)
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
  if v_status <> 'awaiting_result' then
    raise exception 'This request is not awaiting a result (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('result', p_req, v_uid) then
    raise exception 'Not authorized to record the result';
  end if;
  if coalesce(trim(p->>'result_comment'), '') = '' then
    raise exception 'A result comment is required to close the request';
  end if;

  update public.fms_sampling_requests set
    result_comment  = trim(p->>'result_comment'),
    result_owner    = nullif(trim(p->>'result_owner'), ''),
    attachment_path = nullif(p->>'attachment_path', ''),
    attachment_name = nullif(p->>'attachment_name', ''),
    resulted_at = coalesce(resulted_at, now()),
    resulted_by = coalesce(resulted_by, v_uid),
    closed_at   = coalesce(closed_at, now()),
    status = 'closed', current_step = 'result'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'result_recorded',
    'Result recorded for ' || coalesce(v_no,'a request') || ' — request closed.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_result(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — park / un-park. `on_hold` is a STATUS: it leaves every queue.
-- Admin / coordinator only.
-- ===========================================================================
drop function if exists public.fms_sampling_hold_request(uuid, boolean, text);
create or replace function public.fms_sampling_hold_request(p_req uuid, p_hold boolean, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_uid uuid := auth.uid();
begin
  select status into v_status from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not (public.is_admin(v_uid) or public.fms_sampling_is_coordinator(v_uid)) then
    raise exception 'Only an admin or a process coordinator can hold a request';
  end if;

  if p_hold then
    if v_status in ('closed','cancelled','on_hold') then
      raise exception 'A % request cannot be put on hold', v_status;
    end if;
    if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to hold'; end if;
    update public.fms_sampling_requests
       set status = 'on_hold', hold_at = now(), hold_reason = trim(p_reason)
     where id = p_req;
  else
    if v_status <> 'on_hold' then raise exception 'This request is not on hold'; end if;
    update public.fms_sampling_requests
       set status = public.fms_sampling_resume_status(p_req), hold_at = null, hold_reason = null
     where id = p_req;
  end if;
end $$;
grant execute on function public.fms_sampling_hold_request(uuid, boolean, text) to authenticated;

-- ===========================================================================
-- RPC — cancel. The raiser, an admin or a coordinator, before it closes.
-- ===========================================================================
drop function if exists public.fms_sampling_cancel_request(uuid, text);
create or replace function public.fms_sampling_cancel_request(p_req uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_status text; v_raiser uuid; v_uid uuid := auth.uid();
begin
  select status, raised_by into v_status, v_raiser from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status in ('closed','cancelled') then
    raise exception 'This request is already %', v_status;
  end if;
  if not (v_raiser = v_uid or public.is_admin(v_uid) or public.fms_sampling_is_coordinator(v_uid)) then
    raise exception 'Only the requester, an admin or a coordinator can cancel this request';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to cancel'; end if;

  update public.fms_sampling_requests set
    status = 'cancelled', cancelled_at = now(), cancel_reason = trim(p_reason)
  where id = p_req;
end $$;
grant execute on function public.fms_sampling_cancel_request(uuid, text) to authenticated;
