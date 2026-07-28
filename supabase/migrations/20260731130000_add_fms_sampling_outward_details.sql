-- ===========================================================================
-- SAMPLING FMS — DIRECTION-DRIVEN SAMPLE SOURCE + FULL OUTWARD PARTY DETAILS.
--
-- Two changes to the intake, both OUTWARD-facing:
--
-- 1. The sample source now follows the direction. "Import" is meaningless when
--    WE send a sample out, so the source options split:
--      inward  → Import / Domestic   (unchanged)
--      outward → Export / Domestic   ('export' is NEW)
--    The receive_via CHECK is only WIDENED — every existing row, including old
--    outward rows stamped 'import', stays valid and keeps displaying as raised.
--
-- 2. An outward request captures the party IN FULL — company name (the existing
--    `party_name`, reused, so no duplicate column and no backfill), address,
--    contact person, contact mobile — plus WHO WILL SEND IT, picked from a new
--    curated master:
--      fms_sampling_senders — clone of fms_sampling_collectors; each row maps to
--      an app user, so the chosen sender is notified on submit, sees the request
--      in their pending queue, and can action send_sample (exactly how the
--      collector master already works on the inward path).
--
-- Re-issued: fms_sampling_can_act (adds the sender's send_sample rule) and
-- fms_sampling_submit_request (validates + stores the new fields, notifies the
-- sender). No other RPC touches intake fields — Sampling has stage-edit RPCs
-- only, and fms_sampling_update_send already gates on can_act('send_sample').
--
-- DEPLOY-WINDOW SAFETY. This migration lands BEFORE the frontend that sends the
-- new fields, so the new "outward requires ..." checks switch on only when the
-- payload actually carries the `sender_id` key — which only the new client sends.
-- The currently-deployed frontend keeps raising outward requests through the gap.
-- Same convention as the lab_testing_required default (20260727120000) and the
-- `p ? 'lab_doc_path'` key-presence test (20260728120000).
--
-- Purely ADDITIVE (new nullable columns; both CHECKs only WIDENED).
-- Clone lineage: 20260727120000 (masters + can_act) + 20260728120000 (submit).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A1. New columns + widened receive_via CHECK
-- ---------------------------------------------------------------------------
alter table public.fms_sampling_requests
  add column if not exists party_address        text,
  add column if not exists party_contact_name   text,
  add column if not exists party_contact_mobile text,
  add column if not exists sender_id            uuid references auth.users on delete set null,
  add column if not exists sender_name          text;

comment on column public.fms_sampling_requests.party_name is
  'The other side of the sample. INWARD: the supplier / customer it came from. OUTWARD: the company we are sending it to (its full details live in party_address / party_contact_name / party_contact_mobile).';
comment on column public.fms_sampling_requests.party_address is
  'Outward only: where the sample is being sent. NULL on inward.';
comment on column public.fms_sampling_requests.party_contact_name is
  'Outward only: the contact person at the receiving company. NULL on inward.';
comment on column public.fms_sampling_requests.party_contact_mobile is
  'Outward only: that contact person''s mobile number. NULL on inward.';
comment on column public.fms_sampling_requests.sender_id is
  'Outward only: the chosen sender (an app user) — notified on submit and authorized on send_sample. NULL on inward, and NULL on outward rows raised before this migration (those fall to the step owners).';

-- Widened only: 'export' joins the set. Old outward rows stamped 'import' remain valid.
alter table public.fms_sampling_requests drop constraint if exists fms_sampling_requests_receive_via_check;
alter table public.fms_sampling_requests add  constraint fms_sampling_requests_receive_via_check
  check (receive_via in ('import','domestic','export'));

-- ---------------------------------------------------------------------------
-- A2. The sender master (clone of fms_sampling_collectors).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_sampling_senders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  user_id     uuid not null references auth.users on delete cascade,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_sampling_senders is
  'Curated "who will send the sample" master (outward). Each row maps to an app user so the chosen sender can act on send_sample and sees it in their pending queue.';

drop trigger if exists trg_fms_sampling_senders_updated on public.fms_sampling_senders;
create trigger trg_fms_sampling_senders_updated
  before update on public.fms_sampling_senders
  for each row execute function public.set_updated_at();

-- Widen the master-governance CHECK to cover the new ownable master type.
alter table public.fms_sampling_master_managers drop constraint if exists fms_sampling_master_managers_master_type_check;
alter table public.fms_sampling_master_managers add  constraint fms_sampling_master_managers_master_type_check
  check (master_type in ('company','collector','recipient','sender'));

-- RLS: select open (dropdown fodder); write = admin OR that master's owner.
alter table public.fms_sampling_senders enable row level security;
drop policy if exists fms_sampling_senders_select on public.fms_sampling_senders;
create policy fms_sampling_senders_select on public.fms_sampling_senders
  for select to authenticated using (true);
drop policy if exists fms_sampling_senders_write on public.fms_sampling_senders;
create policy fms_sampling_senders_write on public.fms_sampling_senders
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('sender', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('sender', auth.uid()));

-- ---------------------------------------------------------------------------
-- A3. Authorization — the chosen sender owns send_sample, mirroring the way the
-- chosen collector owns sample_collect. Every prior rule is preserved verbatim
-- (re-issued from 20260728120000); this adds one clause.
--
-- The step owners keep their rights, so an outward row raised before this
-- migration (sender_id NULL) is unaffected. fms_sampling_update_send inherits
-- the new rule for free — it already gates on can_act('send_sample', ...).
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
                      where r.id = p_req and r.lab_result_to_id = p_uid))
      or (p_step_key = 'send_sample'
          and exists (select 1 from public.fms_sampling_requests r
                      where r.id = p_req and r.sender_id = p_uid));
$$;
grant execute on function public.fms_sampling_can_act(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A4. Submit — validate the direction/source pairing, require the full party
-- block + a sender on outward, store them, and notify the chosen sender.
-- Re-issued from 20260728120000; routing and the inward path are UNCHANGED.
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
    party_name, party_address, party_contact_name, party_contact_mobile,
    product_desc, colour_qty, sample_items,
    collector_id, collector_name, handover_name,
    lab_testing_required, handover_recipient_id, handover_recipient_name,
    sender_id, sender_name,
    transport_borne, desired_result, additional_info,
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
    v_status, v_step, now()
  )
  returning id into v_id;

  -- The first step's owners, plus the per-request actor: the chosen collector on
  -- an inward raise, the chosen sender on an outward one.
  v_recips := public.fms_sampling_step_owner_ids(v_step);
  if v_dir = 'inward' and v_collector is not null then
    v_recips := v_recips || v_collector;
  elsif v_dir = 'outward' and v_sender is not null then
    v_recips := v_recips || v_sender;
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
