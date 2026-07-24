-- ===========================================================================
-- SAMPLING FMS — the REAL inward "lab testing = Yes" flow.
--
-- The lab-testing gate (20260727120000) shipped with only the NO branch designed:
-- request → sample_collect → sample_received (close). The YES branch was left on
-- the original rails (receive_sample → testing → result → result_handover), which
-- was never the actual process. This replaces it:
--
--   inward + lab_testing_required = FALSE:   (UNCHANGED)
--     request → sample_collect → sample_received (close)
--   inward + lab_testing_required = TRUE:    (NEW)
--     request → sample_collect → sample_to_lab → lab_process → result_received
--   outward: (UNCHANGED — it gets its own rework later)
--     request → send_sample → confirm_receipt → testing → result → result_handover
--
-- BOTH inward branches now start at sample_collect: who collects and whom they
-- hand to is the same question either way. They diverge at the handover receipt —
-- the NO branch closes there, the YES branch sends the sample on to the lab.
--
-- New step keys (code-defined, see frontend/src/apps/sampling/lib/steps.ts):
--   sample_to_lab    — the recipient confirms receipt, records the INTERNAL
--                      REFERENCE NUMBER (required) and sends it to the lab
--   lab_process      — ONE step, TWO passes. It merges what used to be testing +
--                      result + result_handover:
--                        pass 1 → the tentative result date from the lab. Saving it
--                                 IS the signal that the lab has the sample; the
--                                 step stays open and the request does not move.
--                        pass 2 → testing done: comments (REQUIRED) + lab report
--                                 (REQUIRED) + whom the result is handed to.
--   result_received  — that person confirms → CLOSES the request.
--
-- The two passes share ONE status (awaiting_lab_process) because they are one
-- step; `lab_started_at` distinguishes them. Do NOT give pass 1 its own status —
-- the queue reads `status`, and a second status would split one step across two
-- queues.
--
-- Purely ADDITIVE: new nullable columns; the status CHECK is only WIDENED;
-- `current_step` has no CHECK, so new step keys need no DDL. NOTHING is dropped —
-- receive_sample / testing / result / result_handover all keep working (outward
-- still uses the last three).
--
-- ⚠ DELIBERATELY NOT TOUCHED: public.fms_sampling_announce. The live database
--   carries an out-of-band fix to it (the self-skip was removed on 2026-07-22 so an
--   actor is notified on their own steps) that exists in NO migration file.
--   Re-issuing it here would silently revert that. This migration only CALLS it.
--   Email needs no work either: send-email dispatches on the 'sampling_' PREFIX and
--   announce builds kind = 'sampling_' || p_type, so the new types render through
--   the shared template as long as the meta keys below are passed.
--
-- Apply BEFORE the frontend that reads these.
-- Clone lineage: 20260727120000 (lab gate) + 20260726120000 (enhancements).
--
-- Reversal: create-or-replace the four replaced functions from their previous
-- migrations, drop the new functions, drop the new columns, narrow the CHECK.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A1. New columns + widened status CHECK
-- ---------------------------------------------------------------------------
alter table public.fms_sampling_requests
  -- sample_to_lab (the hand-over recipient acts) --------------------------
  add column if not exists lab_sent_date        date,
  add column if not exists lab_sent_at          timestamptz,
  add column if not exists lab_sent_by          uuid references auth.users on delete set null,
  -- lab_process, pass 1 ---------------------------------------------------
  add column if not exists lab_tentative_date   date,
  add column if not exists lab_started_at       timestamptz,
  add column if not exists lab_started_by       uuid references auth.users on delete set null,
  -- lab_process, pass 2 ---------------------------------------------------
  add column if not exists lab_completed_date   date,
  add column if not exists lab_comment          text,
  add column if not exists lab_doc_path         text,
  add column if not exists lab_doc_name         text,
  add column if not exists lab_result_to_id     uuid references auth.users on delete set null,
  add column if not exists lab_result_to_name   text,
  add column if not exists lab_completed_at     timestamptz,
  add column if not exists lab_completed_by     uuid references auth.users on delete set null,
  -- result_received (closes) ----------------------------------------------
  add column if not exists result_received_date date,
  add column if not exists result_received_note text,
  add column if not exists result_received_at   timestamptz,
  add column if not exists result_received_by   uuid references auth.users on delete set null;

comment on column public.fms_sampling_requests.internal_ref is
  'REQUEST-level internal reference. Written at sample_to_lab on the inward lab branch, and at testing on the outward path — the two paths are disjoint, so they never both write it.';
comment on column public.fms_sampling_requests.lab_started_at is
  'Set by record_lab_start (pass 1). It is what separates the two passes of lab_process, which deliberately share one status.';
comment on column public.fms_sampling_requests.lab_tentative_date is
  'Tentative result date FROM the lab. Once set it becomes the lab_process due date (see samplingDueIso), replacing the SLA default.';
comment on column public.fms_sampling_requests.lab_result_to_id is
  'Whom the lab result is handed to (an app user), defaulted from the request''s handover_recipient_id. NULL when a free-text name was typed — then result_received falls to the step owners.';

alter table public.fms_sampling_requests drop constraint if exists fms_sampling_requests_status_check;
alter table public.fms_sampling_requests add  constraint fms_sampling_requests_status_check
  check (status in ('awaiting_receipt','awaiting_send','awaiting_confirm',
                    'awaiting_testing','awaiting_result','awaiting_handover',
                    'awaiting_collect','awaiting_sample_received',
                    'awaiting_sample_to_lab','awaiting_lab_process','awaiting_result_received',
                    'closed','on_hold','cancelled'));

-- ---------------------------------------------------------------------------
-- A2. Authorization — the per-request actor also owns their branch step.
--   sample_collect   → the chosen collector            (from 20260727120000)
--   sample_received  → the chosen hand-over recipient  (from 20260727120000)
--   sample_to_lab    → the SAME hand-over recipient — they received it, they send it on
--   result_received  → whoever lab_process handed the result to
--   lab_process      → step owners only (like testing / result before it)
-- Every prior branch is preserved verbatim.
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
                      where r.id = p_req and r.handover_recipient_id = p_uid))
      or (p_step_key = 'sample_to_lab'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.handover_recipient_id = p_uid))
      or (p_step_key = 'result_received'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.lab_result_to_id = p_uid));
$$;
grant execute on function public.fms_sampling_can_act(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A3. resume_status — NEWEST STATE FIRST.
--
-- This function decides where a HELD request resumes, and it is the one place a
-- wrong ordering shows up. It has now been re-issued three times and every time
-- the newer branches had to go on top: a lab request that has been completed also
-- has collected_at set, so an older branch listed first would swallow it.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
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
      -- The first two arms are for rows raised BEFORE the lab gate existed (they
      -- carry a NULL flag and start at receive_sample). Everything raised since
      -- starts at collect, whichever branch it is on.
      case when r.received_at is not null            then 'awaiting_testing'
           when r.lab_testing_required is null       then 'awaiting_receipt'
           else 'awaiting_collect' end
    else
      case when r.confirmed_at is not null then 'awaiting_testing'
           when r.sent_at      is not null then 'awaiting_confirm'
           else 'awaiting_send' end
  end
  from public.fms_sampling_requests r where r.id = p_req;
$$;
grant execute on function public.fms_sampling_resume_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A4. Submit — inward now ALWAYS starts at sample_collect, whatever the lab flag,
-- and stores the hand-over recipient for BOTH branches (previously the recipient
-- was only kept when lab testing was not required).
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
    -- An older client that doesn't send the flag defaults to lab testing REQUIRED.
    v_lab := coalesce(v_lab_raw, 'true') <> 'false';
  else
    v_req := null;
    v_lab := null;   -- outward carries no lab-testing decision
  end if;

  -- requester_name is NOT NULL — resolve the fallback BEFORE the insert.
  if v_name is null then
    v_name := coalesce((select name from public.profiles where id = v_uid), 'Requester');
  end if;

  -- BOTH inward branches start at collect; only the outcome of sample_collect differs.
  if v_dir = 'inward' then
    v_status := 'awaiting_collect'; v_step := 'sample_collect';
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
      (case when v_dir = 'outward' then 'sample-sent step.' else 'sample-collect step.' end),
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
-- A5. sample_collect — UNCHANGED except for where it hands off. The NO branch
-- still goes to sample_received; the YES branch now goes to sample_to_lab.
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

-- Edit-until-received: the collection stays correctable until the recipient acts,
-- on EITHER branch.
create or replace function public.fms_sampling_collect_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.collected_at is not null
       and r.status in ('awaiting_sample_received','awaiting_sample_to_lab')
  );
$$;
grant execute on function public.fms_sampling_collect_editable(uuid) to authenticated;

-- ===========================================================================
-- RPC — sample_to_lab. The hand-over recipient confirms they have the sample,
-- records the internal reference number and sends it on to the lab.
-- Advances to awaiting_lab_process.
-- ===========================================================================
drop function if exists public.fms_sampling_record_sample_to_lab(uuid, jsonb);
create or replace function public.fms_sampling_record_sample_to_lab(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_ref text := nullif(trim(p->>'internal_ref'), '');
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

  update public.fms_sampling_requests set
    internal_ref  = v_ref,
    lab_sent_date = coalesce(nullif(p->>'lab_sent_date','')::date, current_date),
    lab_sent_at   = coalesce(lab_sent_at, now()),
    lab_sent_by   = coalesce(lab_sent_by, v_uid),
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
end $$;
grant execute on function public.fms_sampling_record_sample_to_lab(uuid, jsonb) to authenticated;

-- Correctable until the lab finishes (the whole of lab_process is downstream of it).
create or replace function public.fms_sampling_sample_to_lab_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.lab_sent_at is not null
       and r.status = 'awaiting_lab_process'
       and r.lab_completed_at is null
  );
$$;
grant execute on function public.fms_sampling_sample_to_lab_editable(uuid) to authenticated;

drop function if exists public.fms_sampling_update_sample_to_lab(uuid, jsonb);
create or replace function public.fms_sampling_update_sample_to_lab(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_ref text := nullif(trim(p->>'internal_ref'), '');
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
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

  update public.fms_sampling_requests set
    internal_ref  = v_ref,
    lab_sent_date = coalesce(nullif(p->>'lab_sent_date','')::date, lab_sent_date),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'sent_to_lab_edited',
    format('Sample receipt on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_sample_to_lab(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — lab_process PASS 1. The lab records when it expects to have a result.
-- The request does NOT move: this is the same step, still open. Saving it is what
-- says "the lab has the sample".
-- ===========================================================================
drop function if exists public.fms_sampling_record_lab_start(uuid, jsonb);
create or replace function public.fms_sampling_record_lab_start(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
end $$;
grant execute on function public.fms_sampling_record_lab_start(uuid, jsonb) to authenticated;

-- Pass 1 stays correctable for as long as the step is open.
create or replace function public.fms_sampling_lab_start_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.lab_started_at is not null and r.status = 'awaiting_lab_process'
  );
$$;
grant execute on function public.fms_sampling_lab_start_editable(uuid) to authenticated;

drop function if exists public.fms_sampling_update_lab_start(uuid, jsonb);
create or replace function public.fms_sampling_update_lab_start(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
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
    lab_tentative_date = v_date, edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'lab_started_edited',
    format('Tentative result date on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_lab_start(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — lab_process PASS 2. Testing is done: comments and the lab report are
-- BOTH required (the UI blocks it too, but this is the gate), plus whom the
-- result goes to. Advances to awaiting_result_received.
-- ===========================================================================
drop function if exists public.fms_sampling_record_lab_complete(uuid, jsonb);
create or replace function public.fms_sampling_record_lab_complete(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
end $$;
grant execute on function public.fms_sampling_record_lab_complete(uuid, jsonb) to authenticated;

-- Correctable until the result is confirmed received.
create or replace function public.fms_sampling_lab_complete_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.lab_completed_at is not null and r.status = 'awaiting_result_received'
  );
$$;
grant execute on function public.fms_sampling_lab_complete_editable(uuid) to authenticated;

drop function if exists public.fms_sampling_update_lab_complete(uuid, jsonb);
create or replace function public.fms_sampling_update_lab_complete(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
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
    lab_tentative_date = coalesce(nullif(p->>'lab_tentative_date','')::date, lab_tentative_date),
    lab_doc_path       = case when p ? 'lab_doc_path' then coalesce(nullif(p->>'lab_doc_path',''), lab_doc_path) else lab_doc_path end,
    lab_doc_name       = case when p ? 'lab_doc_path' then coalesce(nullif(p->>'lab_doc_name',''), lab_doc_name) else lab_doc_name end,
    lab_result_to_id   = v_to,
    lab_result_to_name = v_to_name,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'lab_completed_edited',
    format('Lab process on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_lab_complete(uuid, jsonb) to authenticated;

-- ===========================================================================
-- RPC — result_received. Whoever the lab handed the result to confirms it.
-- CLOSES the request. LAST step of the branch → stays editable after close,
-- mirroring sample_received / result_handover.
-- ===========================================================================
drop function if exists public.fms_sampling_record_result_received(uuid, jsonb);
create or replace function public.fms_sampling_record_result_received(p_req uuid, p jsonb)
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
    closed_at            = coalesce(closed_at, now()),
    status = 'closed', current_step = 'result_received'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'result_received',
    'Lab result received for ' || coalesce(v_no,'a request') || ' — request closed.',
    (case when v_raiser is not null then array[v_raiser] else '{}'::uuid[] end),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_result_received(uuid, jsonb) to authenticated;

create or replace function public.fms_sampling_result_received_editable(p_req uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.result_received_at is not null and r.status = 'closed'
  );
$$;
grant execute on function public.fms_sampling_result_received_editable(uuid) to authenticated;

drop function if exists public.fms_sampling_update_result_received(uuid, jsonb);
create or replace function public.fms_sampling_update_result_received(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text; v_no text; v_uid uuid := auth.uid();
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if not public.fms_sampling_can_act('result_received', p_req, v_uid) then
    raise exception 'Not authorized to edit the result receipt';
  end if;
  if not public.fms_sampling_result_received_editable(p_req) then
    if v_status = 'on_hold' then
      raise exception 'This request is on hold — take it off hold before editing.';
    elsif v_status = 'cancelled' then
      raise exception 'This request is cancelled — its result receipt can no longer be edited.';
    end if;
    raise exception 'No result receipt has been recorded on this request yet — there is nothing to edit.';
  end if;

  update public.fms_sampling_requests set
    result_received_date = coalesce(nullif(p->>'result_received_date','')::date, result_received_date),
    result_received_note = nullif(trim(p->>'result_received_note'), ''),
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'result_received_edited',
    format('Result receipt on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_result_received(uuid, jsonb) to authenticated;
