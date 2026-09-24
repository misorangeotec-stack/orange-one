-- ===========================================================================
-- ROLLBACK for 20261125130000_add_fms_sampling_machine_testing.sql
--
-- ⚠ RUN THIS BEFORE 20261125120000's rollback, never after: it restores
--   update_request / request_editable to their 20261125120000 versions, which
--   that rollback then drops.
-- ⚠ APPLYING: send the body WITHOUT the begin; / commit; lines.
--
-- GUARD FIRST. A request sitting in machine testing — or ON HOLD with machine
-- progress it would resume into — has nowhere to go once the branch is removed:
-- its status would fail the narrowed CHECK, or un-holding it would silently drop
-- the machine step. The guard counts both and stops. Decide what happens to
-- them, then re-run.
--
-- Restores, BYTE-IDENTICAL to live pg_proc.prosrc as of 14-09-2026 (generated from
-- pg_get_functiondef, never retyped; the check block at the bottom proves it by
-- md5): can_act__ungated (no machine_result arm), submit_request (no machine
-- gate, so nothing can be routed into a machine status after this),
-- record_collect, collect_editable, record_result_received,
-- result_received_editable and resume_status. update_request and
-- request_editable go back to their 20261125120000 bodies, also md5-checked. The
-- status CHECK loses its two machine values; the nine machine RPCs are dropped.
--
-- fms_sampling_can_act — the view-only gate — is NOT touched, because the forward
-- migration never touched it either. The check block asserts that too.
--
-- Rows that already FINISHED machine testing are fine: they are closed. Their
-- machine_* columns (and the columns themselves) stay: additive-only, and dropping
-- data is not reversible.
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $guard$
declare v_stuck int; v_held int;
begin
  select count(*) into v_stuck from public.fms_sampling_requests
   where status in ('awaiting_machine_process','awaiting_machine_result');
  select count(*) into v_held from public.fms_sampling_requests
   where status = 'on_hold'
     and public.fms_sampling_resume_status(id) in ('awaiting_machine_process','awaiting_machine_result');
  if v_stuck + v_held > 0 then
    raise exception 'Cannot roll back: % request(s) are in machine testing and % on hold would resume into it. Move them out first.', v_stuck, v_held;
  end if;
end $guard$;

drop function if exists public.fms_sampling_update_machine_result_received(uuid, jsonb);
drop function if exists public.fms_sampling_record_machine_result_received(uuid, jsonb);
drop function if exists public.fms_sampling_machine_result_received_editable(uuid);
drop function if exists public.fms_sampling_update_machine_complete(uuid, jsonb);
drop function if exists public.fms_sampling_record_machine_complete(uuid, jsonb);
drop function if exists public.fms_sampling_machine_complete_editable(uuid);
drop function if exists public.fms_sampling_update_machine_start(uuid, jsonb);
drop function if exists public.fms_sampling_record_machine_start(uuid, jsonb);
drop function if exists public.fms_sampling_machine_start_editable(uuid);

alter table public.fms_sampling_requests drop constraint if exists fms_sampling_requests_status_check;
alter table public.fms_sampling_requests add  constraint fms_sampling_requests_status_check
  check (status in ('awaiting_receipt','awaiting_send','awaiting_confirm',
                    'awaiting_testing','awaiting_result','awaiting_handover',
                    'awaiting_collect','awaiting_sample_received',
                    'awaiting_sample_to_lab','awaiting_lab_process','awaiting_result_received',
                    'closed','on_hold','cancelled'));

-- ---- live bodies of 14-09-2026, verbatim ---------------------------------------
CREATE OR REPLACE FUNCTION public.fms_sampling_can_act__ungated(p_step_key text, p_req uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fms_sampling_submit_request(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_status    text;
  v_step      text;
  v_recips    uuid[];
  -- (new) TRUE when an inward request is raised with no collector, so the
  -- collect step is skipped. Never true on outward, which has no collect step.
  v_skip      boolean := false;
  -- The new client ALWAYS sends this key (even empty). Its absence means an older
  -- deployed frontend, which cannot know about the outward party block — so the
  -- new requirements below stay off for it.
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
  else
    v_req := null;
    v_lab := null;   -- outward carries no lab-testing decision
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

  -- (changed) Both inward branches USED to start at collect unconditionally. They
  -- still do whenever a collector was named; with none, collect has no actor and
  -- nothing to record, so the request enters at the step that follows it.
  --
  -- `v_lab is true`, NOT `v_lab = true` — this MUST match the test in
  -- fms_sampling_record_collect (20260808120000:66-70), or a NULL lab flag would
  -- route one way here and the other way there.
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

  v_seq := public.fms_sampling_next_seq('SMP-' || v_fy);
  v_no  := 'SMP-' || v_fy || '-' || lpad(v_seq::text, 4, '0');

  insert into public.fms_sampling_requests (
    req_no, company_id, receive_via, direction, requirement_type,
    raised_by, requester_name,
    party_name, party_address, party_contact_name, party_contact_mobile,
    product_desc, colour_qty, sample_items,
    collector_id, collector_name, handover_name,
    lab_testing_required, handover_recipient_id, handover_recipient_name,
    sender_id, sender_name,
    transport_borne, desired_result, additional_info,
    collect_skipped,
    status, current_step, submitted_at
  ) values (
    v_no, (p->>'company_id')::uuid, v_via, v_dir, v_req,
    v_uid, v_name,
    nullif(trim(p->>'party_name'), ''),
    -- The party block and the sender are OUTWARD-only: keep inward rows clean
    -- even if a caller sends them.
    case when v_dir = 'outward' then nullif(trim(p->>'party_address'), '') end,
    case when v_dir = 'outward' then nullif(trim(p->>'party_contact_name'), '') end,
    case when v_dir = 'outward' then nullif(trim(p->>'party_contact_mobile'), '') end,
    trim(p->>'product_desc'),
    nullif(trim(p->>'colour_qty'), ''),
    coalesce(p->'sample_items', '[]'::jsonb),
    v_collector,
    nullif(trim(p->>'collector_name'), ''),
    nullif(trim(p->>'handover_name'), ''),
    v_lab, v_recipient,
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

  -- The first step's owners, plus the per-request actor: the chosen collector on
  -- an inward raise, the chosen sender on an outward one.
  -- _for(), not the flat lookup: on outward v_step is send_sample, whose owners
  -- are split Domestic / Export.
  --
  -- (changed) When collect is SKIPPED there is no collector to add, and the first
  -- step is now sample_received / sample_to_lab — both owned per request by the
  -- HAND-OVER RECIPIENT. Add them, or a skipped raise would announce only to that
  -- step's flat owners, which may be nobody at all.
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
      (case when v_dir = 'outward' then 'sample-sent step.'
            when v_skip           then 'sample-received step.'
            else 'sample-collect step.' end),
    v_recips,
    jsonb_build_object(
      'req_no', v_no, 'direction', v_dir,
      -- The copy follows the step the request actually LANDS on, so a skipped
      -- raise never tells anyone to go and collect something.
      'eyebrow', (case when v_dir = 'outward' then 'Sample to send'
                       when v_skip           then 'Sample to receive'
                       else 'Sample to collect' end),
      'headline', (case when v_dir = 'outward' then 'A sample is ready to be sent'
                        when v_skip           then 'A sample is ready to be received'
                        else 'A sample is ready to be collected' end),
      'action', (case when v_dir = 'outward' then 'raised a sample to send'
                      when v_skip           then 'raised a sample for you to receive'
                      else 'raised a sample for you to collect' end),
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || v_id::text,
      'ctaLabel', 'Open in Sampling'
    )
  );

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.fms_sampling_record_collect(p_req uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.fms_sampling_collect_editable(p_req uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req
       and r.collected_at is not null
       and r.status in ('awaiting_sample_received','awaiting_sample_to_lab')
  );
$function$;

CREATE OR REPLACE FUNCTION public.fms_sampling_record_result_received(p_req uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.fms_sampling_result_received_editable(p_req uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.fms_sampling_requests r
     where r.id = p_req and r.result_received_at is not null and r.status = 'closed'
  );
$function$;

CREATE OR REPLACE FUNCTION public.fms_sampling_resume_status(p_req uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- RETIRED 08-08-2026: the `awaiting_receipt` arm is gone with the step. A
      -- legacy row that already passed receipt still resumes at testing; anything
      -- else inward resumes at collect, which is where every inward request now
      -- begins whichever branch it is on.
      --
      -- (new) …unless collect was SKIPPED at raise, in which case it resumes at
      -- the step that follows collect — the same pair the collected_at arm above
      -- hands off to.
      case when r.received_at is not null then 'awaiting_testing'
           when r.collect_skipped then
             case when r.lab_testing_required is true then 'awaiting_sample_to_lab'
                  else 'awaiting_sample_received' end
           else 'awaiting_collect' end
    else
      -- outward no longer runs testing, so a confirmed outward request resumes at
      -- the result.
      case when r.confirmed_at is not null then 'awaiting_result'
           when r.sent_at      is not null then 'awaiting_confirm'
           else 'awaiting_send' end
  end
  from public.fms_sampling_requests r where r.id = p_req;
$function$;

-- ---- the 20261125120000 bodies, verbatim ----------------------------------------
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
  -- View-only is a real boundary (20260923120000): being the requester is not
  -- enough to write, the module grant must be 'edit' too. Admins pass (module_level
  -- returns 'edit' for them).
  if not public.module_can_edit(v_uid, 'sampling') then
    raise exception 'You have view-only access to Sampling and cannot edit this request';
  end if;
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

do $check$
declare
  v_expect constant jsonb := jsonb_build_object(
    'public.fms_sampling_can_act__ungated(text,uuid,uuid)', '94421540ec4f781ae6a75447054b4998',
    'public.fms_sampling_submit_request(jsonb)', '5016f9d5002ae32248b64d3f29216c97',
    'public.fms_sampling_resume_status(uuid)', '64465a0712c4c65753f63bf5b922a27e',
    'public.fms_sampling_record_collect(uuid,jsonb)', '16192ccd8ec7cd560d06b6324bb2162a',
    'public.fms_sampling_collect_editable(uuid)', '044856a69b12326d25a4fad77c87472c',
    'public.fms_sampling_record_result_received(uuid,jsonb)', '645e9834da7d69350e32d4e166ee56e0',
    'public.fms_sampling_result_received_editable(uuid)', '87686d3b70839f7c8d7496ccec82a7c8',
    'public.fms_sampling_update_request(uuid,jsonb)', '9d53e4791a9b9e88376d5be818773ace',
    'public.fms_sampling_request_editable(uuid)', '15e22ecfe1ddb4335d77b188b0e2cc2d',
    'public.fms_sampling_can_act(text,uuid,uuid)', '94e760ed1a017a73ba58cd6d305b3241');
  k text;
begin
  for k in select jsonb_object_keys(v_expect) loop
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure(k)) is distinct from v_expect->>k then
      raise exception 'ABORT: % was not restored byte-identically', k;
    end if;
  end loop;
  if to_regprocedure('public.fms_sampling_record_machine_start(uuid,jsonb)') is not null then
    raise exception 'ABORT: the machine RPCs are still there';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fms_sampling_requests_status_check') like '%machine%' then
    raise exception 'ABORT: the status CHECK still carries machine statuses';
  end if;
end $check$;

commit;
