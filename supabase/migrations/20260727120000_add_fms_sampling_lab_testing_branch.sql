-- ===========================================================================
-- SAMPLING FMS — LAB-TESTING GATE + SHORT "COLLECT → RECEIVED" BRANCH.
--
-- Adds a "lab testing required?" decision to INWARD requests (both requirement
-- types). When lab testing is NOT required, the request takes a SHORT new path
-- that skips receive/testing/result entirely:
--
--   inward + lab_testing_required = FALSE:
--     request → sample_collect → sample_received (close)
--   inward + lab_testing_required = TRUE:   (UNCHANGED — today's flow)
--     request → receive_sample → testing → result → result_handover
--   outward: (UNCHANGED)
--     request → send_sample → confirm_receipt → testing → result → result_handover
--
-- Skipping needs NO per-step flag — the queue reads `status`, so a step that is
-- never a request's current_step never appears (same mechanism as `direction`).
--
-- Two new curated people-masters drive the intake dropdowns (both map to an app
-- user so the work lands in that person's pending queue):
--   fms_sampling_collectors            — who will collect the sample
--   fms_sampling_handover_recipients   — whom to hand the sample to
--
-- New step keys (code-defined, see frontend/src/apps/sampling/lib/steps.ts):
--   sample_collect    — the collector collects and hands over
--   sample_received   — the recipient (or the step owners, for a free-text
--                       recipient) confirms receipt; closes the request
--
-- New RPCs (all SECURITY DEFINER; lock the row, validate status, re-check authz,
-- stamp the step's own timestamp, then advance status/current_step):
--   fms_sampling_record_collect / _update_collect / _collect_editable
--   fms_sampling_record_sample_received / _update_sample_received / _sample_received_editable
-- and create-or-replace of fms_sampling_can_act, _resume_status, _submit_request.
--
-- Purely ADDITIVE (new nullable columns; the status CHECK is only WIDENED; the
-- master_type CHECK is only WIDENED). Apply BEFORE the frontend that reads these.
-- Clone lineage: 20260724120100 (workflow) + 20260726120000 (enhancements).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A1. New columns + widened status CHECK
-- ---------------------------------------------------------------------------
alter table public.fms_sampling_requests
  add column if not exists lab_testing_required    boolean,
  -- sample_collect (collector acts) --------------------------------------
  add column if not exists handover_recipient_id    uuid references auth.users on delete set null,
  add column if not exists handover_recipient_name  text,
  add column if not exists collected_date           date,
  add column if not exists collected_at             timestamptz,
  add column if not exists collected_by             uuid references auth.users on delete set null,
  -- sample_received (recipient / step owners act) ------------------------
  add column if not exists sample_received_date     date,
  add column if not exists sample_received_note     text,
  add column if not exists sample_received_doc_path text,
  add column if not exists sample_received_doc_name text,
  add column if not exists sample_received_at       timestamptz,
  add column if not exists sample_received_by       uuid references auth.users on delete set null;

comment on column public.fms_sampling_requests.lab_testing_required is
  'Inward only. TRUE → today''s receive→testing→result→handover flow. FALSE → the short sample_collect→sample_received branch. NULL on outward.';
comment on column public.fms_sampling_requests.handover_recipient_id is
  'The chosen hand-over recipient (an app user). NULL when the collector typed a free-text name — then sample_received falls to the step owners.';

alter table public.fms_sampling_requests drop constraint if exists fms_sampling_requests_status_check;
alter table public.fms_sampling_requests add  constraint fms_sampling_requests_status_check
  check (status in ('awaiting_receipt','awaiting_send','awaiting_confirm',
                    'awaiting_testing','awaiting_result','awaiting_handover',
                    'awaiting_collect','awaiting_sample_received',
                    'closed','on_hold','cancelled'));

-- ---------------------------------------------------------------------------
-- A2. Two new curated people-masters (clone of fms_sampling_companies).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_sampling_collectors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  user_id     uuid not null references auth.users on delete cascade,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_sampling_collectors is
  'Curated "who will collect the sample" master. Each row maps to an app user so the chosen collector can act on sample_collect and sees it in their pending queue.';

create table if not exists public.fms_sampling_handover_recipients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  user_id     uuid not null references auth.users on delete cascade,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_sampling_handover_recipients is
  'Curated "whom to hand the sample to" master. Each row maps to an app user so the chosen recipient can act on sample_received and sees it in their pending queue. "Self" and free-text are handled in the UI.';

drop trigger if exists trg_fms_sampling_collectors_updated on public.fms_sampling_collectors;
create trigger trg_fms_sampling_collectors_updated
  before update on public.fms_sampling_collectors
  for each row execute function public.set_updated_at();

drop trigger if exists trg_fms_sampling_recipients_updated on public.fms_sampling_handover_recipients;
create trigger trg_fms_sampling_recipients_updated
  before update on public.fms_sampling_handover_recipients
  for each row execute function public.set_updated_at();

-- Widen the master-governance CHECK to cover the two new ownable master types.
alter table public.fms_sampling_master_managers drop constraint if exists fms_sampling_master_managers_master_type_check;
alter table public.fms_sampling_master_managers add  constraint fms_sampling_master_managers_master_type_check
  check (master_type in ('company','collector','recipient'));

-- RLS: select open (dropdown fodder); write = admin OR that master's owner.
alter table public.fms_sampling_collectors enable row level security;
drop policy if exists fms_sampling_collectors_select on public.fms_sampling_collectors;
create policy fms_sampling_collectors_select on public.fms_sampling_collectors
  for select to authenticated using (true);
drop policy if exists fms_sampling_collectors_write on public.fms_sampling_collectors;
create policy fms_sampling_collectors_write on public.fms_sampling_collectors
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('collector', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('collector', auth.uid()));

alter table public.fms_sampling_handover_recipients enable row level security;
drop policy if exists fms_sampling_recipients_select on public.fms_sampling_handover_recipients;
create policy fms_sampling_recipients_select on public.fms_sampling_handover_recipients
  for select to authenticated using (true);
drop policy if exists fms_sampling_recipients_write on public.fms_sampling_handover_recipients;
create policy fms_sampling_recipients_write on public.fms_sampling_handover_recipients
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('recipient', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('recipient', auth.uid()));

-- ---------------------------------------------------------------------------
-- A3. Authorization — the per-request actor also owns their branch step.
--   sample_collect  → the chosen collector (collector_id)
--   sample_received → the chosen recipient (handover_recipient_id); when that is
--                     null (free-text recipient), it falls to the step owners.
-- (receive_sample collector rule preserved from 20260726120000.)
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
                      where r.id = p_req and r.collector_id = p_uid))
      or (p_step_key = 'sample_collect'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.collector_id = p_uid))
      or (p_step_key = 'sample_received'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.handover_recipient_id = p_uid));
$$;
grant execute on function public.fms_sampling_can_act(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A4. resume_status — the not-required branch FIRST so a held request resumes
-- right. The branches are disjoint (a collect request never gets tested_at, a
-- lab request never gets collected_at), but order defensively regardless.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.handed_over_at     is not null then 'closed'
    when r.sample_received_at is not null then 'closed'
    when r.collected_at       is not null then 'awaiting_sample_received'
    when r.resulted_at        is not null then 'awaiting_handover'
    when r.tested_at          is not null then 'awaiting_result'
    when r.direction = 'inward' then
      case when r.lab_testing_required is false then 'awaiting_collect'
           when r.received_at is not null       then 'awaiting_testing'
           else 'awaiting_receipt' end
    else
      case when r.confirmed_at is not null then 'awaiting_testing'
           when r.sent_at      is not null then 'awaiting_confirm'
           else 'awaiting_send' end
  end
  from public.fms_sampling_requests r where r.id = p_req;
$$;
grant execute on function public.fms_sampling_resume_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A5. Submit — store lab_testing_required + the recipient, and route inward:
--   lab_testing_required = FALSE → awaiting_collect / sample_collect
--   lab_testing_required = TRUE  → awaiting_receipt / receive_sample (as before)
-- Notify the sample_collect owners + the chosen collector on the short branch.
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
  v_lab_raw   text := nullif(p->>'lab_testing_required','');
  v_lab       boolean;
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
    -- BACKWARD COMPATIBLE: an older client that doesn't send the flag defaults to
    -- lab testing REQUIRED (today's receive→testing→result flow), so applying this
    -- migration never breaks the currently-deployed frontend. The new UI enforces an
    -- explicit Yes/No client-side and always sends 'true' or 'false'.
    v_lab := coalesce(v_lab_raw, 'true') <> 'false';
  else
    v_req := null;
    v_lab := null;   -- outward carries no lab-testing decision
  end if;

  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  if v_dir = 'inward' then
    if v_lab is false then
      v_status := 'awaiting_collect'; v_step := 'sample_collect';
    else
      v_status := 'awaiting_receipt'; v_step := 'receive_sample';
    end if;
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
    lab_testing_required, handover_recipient_id, handover_recipient_name,
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
    v_lab, v_recipient,
    nullif(trim(p->>'handover_recipient_name'), ''),
    nullif(p->>'transport_borne', ''),
    nullif(trim(p->>'desired_result'), ''),
    nullif(trim(p->>'additional_info'), ''),
    v_status, v_step, now()
  )
  returning id into v_id;

  -- The first step's owners, plus the chosen collector on an inward raise.
  v_recips := public.fms_sampling_step_owner_ids(v_step);
  if v_dir = 'inward' and v_collector is not null then
    v_recips := v_recips || v_collector;
  end if;

  perform public.fms_sampling_announce(
    'request', v_id, 'raised',
    'Sampling request ' || v_no || ' is ready for the ' ||
      (case when v_dir = 'outward' then 'sample-sent step.'
            when v_lab is false    then 'sample-collect step.'
            else 'sample-received step.' end),
    v_recips,
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

-- ===========================================================================
-- RPC — sample_collect. The collector collects the sample and hands it over to
-- the chosen recipient (an app user) or a free-text name. Advances to
-- awaiting_sample_received.
-- ===========================================================================
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
  v_uid       uuid := auth.uid();
  v_recipient uuid := nullif(p->>'handover_recipient_id','')::uuid;
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_collect' then
    raise exception 'This request is not awaiting sample collection (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('sample_collect', p_req, v_uid) then
    raise exception 'Not authorized to record the sample collection';
  end if;

  update public.fms_sampling_requests set
    handover_recipient_id   = v_recipient,
    handover_recipient_name = nullif(trim(p->>'handover_recipient_name'), ''),
    collected_date          = coalesce(nullif(p->>'collected_date','')::date, current_date),
    collected_at            = coalesce(collected_at, now()),
    collected_by            = coalesce(collected_by, v_uid),
    status = 'awaiting_sample_received', current_step = 'sample_received'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'collected',
    'Sample collected for ' || coalesce(v_no,'a request') || ' — awaiting handover receipt.',
    (case when v_recipient is not null then array[v_recipient]
          else public.fms_sampling_step_owner_ids('sample_received') end),
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

-- Edit-until-received: correct the recipient / collected date until the recipient
-- confirms receipt.
create or replace function public.fms_sampling_collect_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.collected_at is not null and r.status = 'awaiting_sample_received'
  );
$$;
grant execute on function public.fms_sampling_collect_editable(uuid) to authenticated;

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
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'collect_edited',
    format('Sample collection on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_collect(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — sample_received. The recipient (or, for a free-text recipient, a
-- sample_received step owner) confirms receipt with an optional note/attachment.
-- Closes the request. LAST step of the branch → stays editable after close.
-- ===========================================================================
drop function if exists public.fms_sampling_record_sample_received(uuid, jsonb);
create or replace function public.fms_sampling_record_sample_received(p_req uuid, p jsonb)
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
  if v_status <> 'awaiting_sample_received' then
    raise exception 'This request is not awaiting sample receipt (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('sample_received', p_req, v_uid) then
    raise exception 'Not authorized to confirm sample receipt';
  end if;

  update public.fms_sampling_requests set
    sample_received_date     = coalesce(nullif(p->>'sample_received_date','')::date, current_date),
    sample_received_note     = nullif(trim(p->>'sample_received_note'), ''),
    sample_received_doc_path = nullif(p->>'sample_received_doc_path', ''),
    sample_received_doc_name = nullif(p->>'sample_received_doc_name', ''),
    sample_received_at = coalesce(sample_received_at, now()),
    sample_received_by = coalesce(sample_received_by, v_uid),
    closed_at          = coalesce(closed_at, now()),
    status = 'closed', current_step = 'sample_received'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'sample_received',
    'Sample received for ' || coalesce(v_no,'a request') || ' — request closed.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_sample_received(uuid, jsonb) to authenticated;

-- The received step is the LAST step of the branch, so it stays editable after
-- close (only hold / cancel lock), mirroring the result_handover rule.
create or replace function public.fms_sampling_sample_received_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.sample_received_at is not null and r.status = 'closed'
  );
$$;
grant execute on function public.fms_sampling_sample_received_editable(uuid) to authenticated;

drop function if exists public.fms_sampling_update_sample_received(uuid, jsonb);
create or replace function public.fms_sampling_update_sample_received(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('sample_received', p_req, v_uid) then
    raise exception 'Not authorized to edit the sample receipt';
  end if;
  if not public.fms_sampling_sample_received_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — its receipt can no longer be edited.';
    end if;
    raise exception 'No sample receipt has been recorded on this request yet — there is nothing to edit.';
  end if;

  update public.fms_sampling_requests set
    sample_received_date     = coalesce(nullif(p->>'sample_received_date','')::date, sample_received_date),
    sample_received_note     = nullif(trim(p->>'sample_received_note'), ''),
    sample_received_doc_path = case when p ? 'sample_received_doc_path' then nullif(p->>'sample_received_doc_path','') else sample_received_doc_path end,
    sample_received_doc_name = case when p ? 'sample_received_doc_name' then nullif(p->>'sample_received_doc_name','') else sample_received_doc_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'sample_received_edited',
    format('Sample receipt on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_sample_received(uuid, jsonb) to authenticated;
