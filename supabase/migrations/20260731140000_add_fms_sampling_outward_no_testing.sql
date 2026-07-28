-- ===========================================================================
-- SAMPLING FMS — OUTWARD DROPS THE TESTING STEP + PER-SOURCE RECEIPT CONFIRMERS.
--
-- 1. OUTWARD NO LONGER RUNS `testing`. The path becomes:
--      request → send_sample → confirm_receipt → result → result_handover
--    Confirming receipt now advances straight to `result`.
--
--    `testing` is NOT dropped — it stays wired for LEGACY INWARD rows (those
--    raised before the lab gate, which entered at receive_sample and still run
--    receive_sample → testing → result → result_handover; 3 such rows are open).
--    It simply stops being reachable from the outward path.
--
--    One outward row was sitting in awaiting_testing when this ran; it is moved
--    forward to awaiting_result / result, because a request must never be parked
--    on a step its own branch no longer contains.
--
-- 2. RECEIPT CONFIRMERS ARE NOW MAPPED PER SOURCE. Who may confirm receipt of an
--    outward sample depends on whether it went Domestic or Export, so a new
--    curated master carries that split:
--      fms_sampling_confirmers — name + portal user + source ('domestic'|'export')
--    An active confirmer whose source matches the request may action (and is
--    notified about) confirm_receipt, ON TOP of the step's global owners in
--    Setup → Step Owners, which keep working untouched.
--
--    SOURCE MATCHING: 'export' → 'export'; ANYTHING ELSE → 'domestic'. That last
--    part matters — outward rows raised before Export existed carry 'import', and
--    they are domestic dispatches in every practical sense.
--
-- Purely ADDITIVE apart from the single stranded-row status fix. The status CHECK
-- is untouched (awaiting_result already exists).
-- Clone lineage: 20260731130000 (senders master + can_act).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A1. The receipt-confirmer master (clone of fms_sampling_senders + a source).
-- ---------------------------------------------------------------------------
create table if not exists public.fms_sampling_confirmers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  user_id     uuid not null references auth.users on delete cascade,
  source      text not null check (source in ('domestic','export')),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_sampling_confirmers is
  'Curated "who may confirm receipt" master, SPLIT BY SOURCE. A row grants its user the right to action confirm_receipt on outward requests of that source (domestic / export), and gets them notified when the sample is dispatched. Additive to the global step owners.';
comment on column public.fms_sampling_confirmers.source is
  'Which outward dispatches this person covers. A request matches on: export → export, anything else (incl. legacy ''import'' rows) → domestic.';

create index if not exists fms_sampling_confirmers_user_source_idx
  on public.fms_sampling_confirmers (user_id, source) where active;

drop trigger if exists trg_fms_sampling_confirmers_updated on public.fms_sampling_confirmers;
create trigger trg_fms_sampling_confirmers_updated
  before update on public.fms_sampling_confirmers
  for each row execute function public.set_updated_at();

-- Widen the master-governance CHECK to cover the new ownable master type.
alter table public.fms_sampling_master_managers drop constraint if exists fms_sampling_master_managers_master_type_check;
alter table public.fms_sampling_master_managers add  constraint fms_sampling_master_managers_master_type_check
  check (master_type in ('company','collector','recipient','sender','confirmer'));

alter table public.fms_sampling_confirmers enable row level security;
drop policy if exists fms_sampling_confirmers_select on public.fms_sampling_confirmers;
create policy fms_sampling_confirmers_select on public.fms_sampling_confirmers
  for select to authenticated using (true);
drop policy if exists fms_sampling_confirmers_write on public.fms_sampling_confirmers;
create policy fms_sampling_confirmers_write on public.fms_sampling_confirmers
  for all to authenticated
  using (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('confirmer', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('confirmer', auth.uid()));

-- ---------------------------------------------------------------------------
-- A2. THE source-matching rule, in ONE place. Every confirmer lookup — the authz
-- check and the dispatch notification — goes through this, so they cannot drift.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_confirmer_source(p_receive_via text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_receive_via = 'export' then 'export' else 'domestic' end;
$$;
grant execute on function public.fms_sampling_confirmer_source(text) to authenticated;

/** Every user who may confirm receipt of this request, from the confirmer master. */
create or replace function public.fms_sampling_confirmer_ids(p_req uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct c.user_id), '{}'::uuid[])
    from public.fms_sampling_requests r
    join public.fms_sampling_confirmers c
      on c.active
     and c.source = public.fms_sampling_confirmer_source(r.receive_via)
   where r.id = p_req;
$$;
grant execute on function public.fms_sampling_confirmer_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A3. Authorization — a matching confirmer may action confirm_receipt. Every
-- prior rule is preserved verbatim (re-issued from 20260731130000).
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
                      where r.id = p_req and r.sender_id = p_uid))
      -- Per-source: a Domestic confirmer cannot confirm an Export dispatch.
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
-- A4. Dispatch — also notify the confirmers who cover this request's source.
-- ---------------------------------------------------------------------------
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
    public.fms_sampling_step_owner_ids('confirm_receipt') || public.fms_sampling_confirmer_ids(p_req),
    jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_send(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A5. Confirm receipt — outward now advances to `result`, NOT `testing`.
-- ---------------------------------------------------------------------------
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
    -- Outward skips testing entirely now.
    status = 'awaiting_result', current_step = 'result'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'confirmed',
    'Receipt confirmed for ' || coalesce(v_no,'a request') || ' — ready for the result.',
    public.fms_sampling_step_owner_ids('result'), jsonb_build_object('req_no', v_no));
end $$;
grant execute on function public.fms_sampling_record_confirm(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A6. resume_status — a held OUTWARD request that had confirmed receipt now
-- resumes at the result, not at testing. NEWEST STATE FIRST; the inward arms and
-- the tested_at arm are preserved so a legacy inward row still resumes right.
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
      -- CHANGED: outward no longer runs testing, so a confirmed outward request
      -- resumes at the result. Everything else here is unchanged.
      case when r.confirmed_at is not null then 'awaiting_result'
           when r.sent_at      is not null then 'awaiting_confirm'
           else 'awaiting_send' end
  end
  from public.fms_sampling_requests r where r.id = p_req;
$$;
grant execute on function public.fms_sampling_resume_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A7. Move any OUTWARD request stranded on the now-removed testing step forward
-- to the result. Inward rows in awaiting_testing are LEFT ALONE — testing is
-- still their step.
-- ---------------------------------------------------------------------------
update public.fms_sampling_requests
   set status = 'awaiting_result', current_step = 'result'
 where direction = 'outward' and status = 'awaiting_testing';
