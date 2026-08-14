-- ===========================================================================
-- SAMPLING — the collector becomes OPTIONAL, and a request raised without one
-- SKIPS the sample_collect step.
--
-- Until now every inward request was routed into `awaiting_collect`
-- unconditionally (20260806120000:483-488) and the "who will collect" field was
-- required — but that requirement lived ONLY in the client
-- (useSampleRequestForm.ts). Sometimes nobody has to go and fetch anything: the
-- sample is already in hand. That forced a dummy collector and a pointless
-- "Record collection" step.
--
-- From here: inward + no collector → the request enters at the step that
-- FOLLOWS collect, chosen by the lab gate exactly as record_collect chooses it:
--   lab_testing_required is true  → awaiting_sample_to_lab   / sample_to_lab
--   otherwise                     → awaiting_sample_received / sample_received
--
-- WHY AN EXPLICIT COLUMN rather than inferring "skipped" from a null
-- collector_id. Two reasons, and only the second is about today's data:
--   1. The UI must SAY "Not required" on the stepper and the request detail.
--      Inferring it means reasoning about how far past collect the status has
--      travelled — fragile, and it cannot tell "skipped" from "not done yet".
--   2. `collector_id is null` is not a reliable marker. It happens to be
--      unambiguous right now (no inward row carries a null collector), but any
--      later import or data fix that leaves it null would silently start
--      meaning "collection was skipped". A dedicated flag can never drift.
--
-- DEFAULT false IS THE TRUE VALUE, not a placeholder: every row that exists
-- today genuinely does run the collect step. That is also the deploy-window
-- guarantee — an older client keeps producing exactly today's route.
--
-- NO `client_v` BUMP AND NO KEY-PRESENCE GATE, deliberately. The gating
-- convention at 20260806120000:52-58 exists for new REQUIREMENTS; this REMOVES
-- one. The currently deployed frontend validates the collector client-side, so
-- it can never send a null collector_id on inward — the new arm is unreachable
-- from it, and the old client's behaviour is bit-for-bit unchanged.
--
-- Purely ADDITIVE: one new column with a default, two functions re-issued.
-- No table, column, constraint or row is dropped or rewritten. No new status
-- value, so the `status` CHECK needs no widening; `current_step` has no CHECK.
--
-- Clone lineage: 20260808120000 (collect note) + 20260808120200 (resume arms).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------
alter table public.fms_sampling_requests
  add column if not exists collect_skipped boolean not null default false;

comment on column public.fms_sampling_requests.collect_skipped is
  'INWARD only. TRUE = the request was raised with no collector, so sample_collect never ran and the request entered at the following step (sample_to_lab when lab_testing_required is true, else sample_received). FALSE = the collect step applies — the value for every row that existed before 20260903120000, and for every outward row. Read by resume_status to send a resumed request forward instead of back to collect, and by the UI to render the collect step as "Not required" rather than as an unfinished step.';

-- ---------------------------------------------------------------------------
-- 2. submit_request — re-issued IN FULL from 20260806120000:412.
--
-- ⚠ This function has been re-issued SIX times and every version re-states all
--   prior rules; copying an earlier one silently drops the outward party block,
--   the sender requirement or the per-source owner resolution. The live body was
--   verified against 20260806120000 before this was written.
--
-- THREE changes only:
--   · the inward entry block now skips collect when no collector was chosen
--   · collect_skipped is written on the insert
--   · the first-step notification falls back to the hand-over recipient when
--     there is no collector — `sample_collect` has no step owners seeded
--     (20260808120200:98), and a skipped request's first step is not collect
--     anyway, so without this a skipped raise could notify nobody at all
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
  v_status    text;
  v_step      text;
  v_recips    uuid[];
  -- (new) TRUE when an inward request is raised with no collector, so the
  -- collect step is skipped. Never true on outward, which has no collect step.
  v_skip      boolean := false;
  -- The new client ALWAYS sends this key (even empty). Its absence means an older
  -- deployed frontend, which cannot know about the outward party block — so the
  -- new requirements below stay off for it. See the DEPLOY-WINDOW note at the top.
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
  -- HAND-OVER RECIPIENT (fms_sampling_can_act, 20260806120000:376-384). Add them,
  -- or a skipped raise would announce only to that step's flat owners, which may
  -- be nobody at all.
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
end $$;
grant execute on function public.fms_sampling_submit_request(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. resume_status — re-issued IN FULL from the LIVE body (pg_get_functiondef),
-- which was verified identical to 20260808120200:34 before this was written.
--
-- ONE change: a held request whose collect step was SKIPPED must resume at the
-- step it was actually sitting on, not be thrown back into a collect step it was
-- never meant to run. The new arm sits INSIDE the inward case, after the
-- received_at arm (a legacy row that passed receipt still resumes at testing)
-- and before the `else 'awaiting_collect'` fallback.
--
-- It mirrors the collected_at arm above it exactly — same lab-gate test, same
-- two destinations — because "collect is done" and "collect never applied" hand
-- off to the same place.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_resume_status(p_req uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
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

commit;
