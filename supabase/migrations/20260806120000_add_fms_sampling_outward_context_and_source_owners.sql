-- ===========================================================================
-- SAMPLING FMS — OUTWARD CONTEXT, GATE PASS, RESULT-HANDOVER MASTER,
--                PER-SOURCE STEP OWNERS.
--
-- Five changes, all on the OUTWARD path
--   (request → send_sample → confirm_receipt → result → result_handover):
--
-- 1. GATE PASS ON DISPATCH. send_sample gains an attachment (send_doc_path /
--    send_doc_name, bucket subfolder <req>/send/). On a NEW dispatch both the
--    gate outward entry no. AND the attachment are REQUIRED.
--
-- 2. THE PARTY'S EXPECTED TESTING DATE. confirm_receipt gains
--    party_testing_date — optional, and deliberately NOT capped at today: it is
--    a forecast, exactly like tentative_result_date and lab_tentative_date.
--    NAMING: it pairs with party_received_date, written by the same step. It is
--    deliberately NOT called tentative_testing_date — this table already carries
--    two "tentative" dates and a third would be indistinguishable.
--
-- 3. "RESULT HANDOVER TO" REPLACES THE FREE-TEXT "RESULT OWNER". A new curated
--    master (fms_sampling_result_recipients) feeds a dropdown at the `result`
--    step; the person picked is stored on the request, AUTHORIZED on
--    result_handover and NOTIFIED when the result is recorded — the outward twin
--    of lab_result_to_id → result_received.
--    result_owner is NOT dropped and NOT rewritten: record_result /
--    update_result simply stop naming the column, so old text survives and the
--    UI falls back to it for rows recorded before this.
--
-- 4. STEP OWNERS SPLIT BY SOURCE for the three outward steps whose
--    responsibility genuinely differs between a Domestic and an Export dispatch:
--      send_sample · confirm_receipt · result
--    A NEW table, fms_sampling_step_source_owners, keyed (step_key, source).
--    result_handover is deliberately NOT split — its actor is already chosen per
--    request (see 3).
--
--    NO HIDDEN OWNERS. For those three keys the legacy readers
--    fms_sampling_is_step_owner / fms_sampling_step_owner_ids are re-issued to
--    return false / '{}'. The rows already in fms_sampling_step_owners are left
--    exactly where they are (additive-only) but can never grant rights that
--    Setup → Step Owners no longer displays. It also FORCES every announce call
--    site to move to the _for() variants or visibly notify nobody.
--
--    fms_sampling_confirmers is untouched and stays ADDITIVE: a matching active
--    confirmer may still action confirm_receipt on top of the source owners.
--
-- 5. OUTWARD EMAILS GET THEIR DEEP LINKS BACK. record_send / record_confirm /
--    record_result / record_handover / record_testing passed only {req_no}, so
--    send-email fell back to eyebrow="Sampling", headline=the raw sentence and
--    ctaPath="/sampling" — the module root, not the request. They now pass the
--    same meta keys submit_request and the lab-branch RPCs already pass.
--
-- ---------------------------------------------------------------------------
-- DEPLOY-WINDOW SAFETY. This lands BEFORE the frontend that sends the new keys,
-- so every new REQUIREMENT switches on only when the payload proves it came
-- from the new client:
--   send   → p->>'client_v' >= 2   (the new sendPayload always sends it)
--   result → p ? 'result_handover_to_id'
-- Same convention as `v_full_form boolean := p ? 'sender_id'` (20260731130000)
-- and the `p ? 'lab_doc_path'` key-presence test (20260728120000).
--
-- The owner change needs no gate: the seed below copies each step's current
-- owners into BOTH source rows, so the old frontend (which reads
-- fms_sampling_step_owners directly) and the new server agree throughout.
--
-- ⚠ fms_sampling_announce is NOT re-issued here. Its live body is in
--   20260726150000_fms_notify_self_on_own_steps.sql — a file whose name contains
--   no "sampling". Re-issuing it from 20260726120100 would restore the
--   actor-self-skip. Only its CALL SITES change.
--
-- Purely ADDITIVE: new nullable columns, two new tables, one WIDENED CHECK.
-- No table, column, constraint or row is dropped or rewritten.
--
-- Clone lineage: 20260731130000 (senders master) + 20260731140000 (confirmers,
-- per-source rule) + 20260728120000 (attachment contract).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A1. New columns on fms_sampling_requests.
-- ---------------------------------------------------------------------------
alter table public.fms_sampling_requests
  add column if not exists send_doc_path           text,
  add column if not exists send_doc_name           text,
  add column if not exists party_testing_date      date,
  add column if not exists result_handover_to_id   uuid references auth.users on delete set null,
  add column if not exists result_handover_to_name text;

comment on column public.fms_sampling_requests.send_doc_path is
  'Outward: the gate pass / dispatch document, in the fms-sampling-docs bucket under <request>/send/. REQUIRED by record_send from the new client; rows dispatched before this migration carry NULL and are NOT forced to backfill on edit.';
comment on column public.fms_sampling_requests.send_doc_name is
  'Display filename for send_doc_path.';
comment on column public.fms_sampling_requests.party_testing_date is
  'Outward: when the receiving party expects to TEST the sample, captured at confirm_receipt. A FORECAST, so it is deliberately NOT capped at today — the third such column, with tentative_result_date (legacy testing) and lab_tentative_date (lab pass 1). Optional: the party may not have committed to a date when they acknowledge receipt. NOT wired into the SLA.';
comment on column public.fms_sampling_requests.result_handover_to_id is
  'Outward: whom the result is to be handed over to (an app user, from fms_sampling_result_recipients). Authorized on result_handover and notified by record_result — the outward twin of lab_result_to_id.';
comment on column public.fms_sampling_requests.result_handover_to_name is
  'Denormalised display name for result_handover_to_id, so the request still reads correctly if the user is later removed. Twin of sender_name / lab_result_to_name.';
comment on column public.fms_sampling_requests.result_owner is
  'LEGACY free text ("Result owner"), captured before the Result-handover-to master existed. NEVER WRITTEN AGAIN — record_result / update_result no longer name this column, so old values survive untouched and the UI still displays them when result_handover_to_id is NULL.';

-- ---------------------------------------------------------------------------
-- A2. The "Result handover to" master (clone of fms_sampling_senders).
--
-- NAMED result_recipients, not handover_recipients: fms_sampling_handover_
-- recipients already exists and means "whom to hand the SAMPLE to" on inward.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_sampling_result_recipients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  user_id     uuid not null references auth.users on delete cascade,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.fms_sampling_result_recipients is
  'Curated "Result handover to" master (outward). Each row maps to an app user, so the person picked at the `result` step is authorized on result_handover and notified when the result is recorded. Replaces the free-text result_owner.';

drop trigger if exists trg_fms_sampling_result_recipients_updated on public.fms_sampling_result_recipients;
create trigger trg_fms_sampling_result_recipients_updated
  before update on public.fms_sampling_result_recipients
  for each row execute function public.set_updated_at();

-- Widen the master-governance CHECK. Drop-and-re-add, always RE-STATING the full
-- list (lineage: 20260724120000 → 20260727120000 → 20260731130000 → 20260731140000).
alter table public.fms_sampling_master_managers drop constraint if exists fms_sampling_master_managers_master_type_check;
alter table public.fms_sampling_master_managers add  constraint fms_sampling_master_managers_master_type_check
  check (master_type in ('company','collector','recipient','sender','confirmer','result_recipient'));

alter table public.fms_sampling_result_recipients enable row level security;
drop policy if exists fms_sampling_result_recipients_select on public.fms_sampling_result_recipients;
create policy fms_sampling_result_recipients_select on public.fms_sampling_result_recipients
  for select to authenticated using (true);
drop policy if exists fms_sampling_result_recipients_write on public.fms_sampling_result_recipients;
create policy fms_sampling_result_recipients_write on public.fms_sampling_result_recipients
  for all to authenticated
  using      (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('result_recipient', auth.uid()))
  with check (public.is_admin(auth.uid()) or public.fms_sampling_is_master_manager('result_recipient', auth.uid()));

-- ---------------------------------------------------------------------------
-- A3. THE source rules, each in ONE place.
-- ---------------------------------------------------------------------------

/**
 * Which steps have their owners split by source. THE definition — every resolver
 * below calls this, so the list is written once in SQL.
 * Mirrored in TS by SOURCE_SCOPED_STEPS (apps/sampling/lib/steps.ts) and, of
 * necessity, by the literal CHECK on fms_sampling_step_source_owners (a CHECK
 * cannot safely depend on a function: a pg_restore may create it first).
 */
create or replace function public.fms_sampling_step_is_source_scoped(p_step_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_step_key in ('send_sample','confirm_receipt','result');
$$;
grant execute on function public.fms_sampling_step_is_source_scoped(text) to authenticated;

/**
 * Which source bucket a request falls in: 'export' → export, ANYTHING ELSE →
 * domestic. That default is deliberate — outward rows raised before Export
 * existed carry 'import' and are domestic dispatches in practice.
 * Mirrored in TS by outwardSourceOf (apps/sampling/lib/format.ts).
 */
create or replace function public.fms_sampling_outward_source(p_receive_via text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_receive_via = 'export' then 'export' else 'domestic' end;
$$;
grant execute on function public.fms_sampling_outward_source(text) to authenticated;

-- Re-issued as a thin delegate so the rule has exactly ONE body. Kept (rather
-- than dropped) because can_act joins on it and 20260731140000 named it.
create or replace function public.fms_sampling_confirmer_source(p_receive_via text)
returns text
language sql
immutable
set search_path = public
as $$
  select public.fms_sampling_outward_source(p_receive_via);
$$;
grant execute on function public.fms_sampling_confirmer_source(text) to authenticated;

-- ---------------------------------------------------------------------------
-- A4. Per-source step owners.
--
-- A NEW TABLE, not a nullable `source` column on fms_sampling_step_owners:
-- that would need the existing unique(step_key) DROPPED — a mutation — and would
-- instantly break the deployed frontend's
--   .upsert(..., { onConflict: "step_key" })
-- for the whole deploy window, taking Setup → Step Owners down for admins.
-- ---------------------------------------------------------------------------
create table if not exists public.fms_sampling_step_source_owners (
  id             uuid primary key default gen_random_uuid(),
  step_key       text not null,
  source         text not null check (source in ('domestic','export')),
  department_ids uuid[] not null default '{}',
  designation_id uuid references public.designations on delete set null,
  employee_ids   uuid[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Literal, NOT a call to fms_sampling_step_is_source_scoped: a CHECK that
  -- depends on a function can fail a restore if the constraint is created first.
  -- Keep the two in step.
  constraint fms_sampling_step_source_owners_step_check
    check (step_key in ('send_sample','confirm_receipt','result')),
  unique (step_key, source)
);
comment on table public.fms_sampling_step_source_owners is
  'Step owners for the three outward steps whose responsibility SPLITS BY SOURCE (Domestic vs Export). For these step_keys this table is the ONLY authority: fms_sampling_is_step_owner and fms_sampling_step_owner_ids are re-issued below to return false / {} for them, so a row left behind in fms_sampling_step_owners can never grant rights Setup no longer shows.';
comment on column public.fms_sampling_step_source_owners.department_ids is
  'UI FILTER ONLY — authorization comes solely from employee_ids. Same contract as fms_sampling_step_owners.';

drop trigger if exists trg_fms_sampling_step_source_owners_updated on public.fms_sampling_step_source_owners;
create trigger trg_fms_sampling_step_source_owners_updated
  before update on public.fms_sampling_step_source_owners
  for each row execute function public.set_updated_at();

alter table public.fms_sampling_step_source_owners enable row level security;
drop policy if exists fms_sampling_step_source_owners_select on public.fms_sampling_step_source_owners;
create policy fms_sampling_step_source_owners_select on public.fms_sampling_step_source_owners
  for select to authenticated using (true);
drop policy if exists fms_sampling_step_source_owners_write on public.fms_sampling_step_source_owners;
create policy fms_sampling_step_source_owners_write on public.fms_sampling_step_source_owners
  for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- SEED — carry each outward step's CURRENT owners into BOTH source rows, so
-- nothing changes for anybody the moment this runs. The admin then splits them.
-- The source rows in fms_sampling_step_owners are left in place, untouched.
insert into public.fms_sampling_step_source_owners
  (step_key, source, department_ids, designation_id, employee_ids)
select o.step_key, src.source, o.department_ids, o.designation_id, o.employee_ids
  from public.fms_sampling_step_owners o
  cross join (values ('domestic'),('export')) as src(source)
 where o.step_key in ('send_sample','confirm_receipt','result')
on conflict (step_key, source) do nothing;

-- ---------------------------------------------------------------------------
-- A5. Owner resolvers.
--
-- The two LEGACY readers are guarded first: for a source-scoped step they answer
-- empty, full stop. That is the "no hidden owners" guarantee, and it is what
-- makes a forgotten announce call site notify visibly nobody rather than
-- silently notify the wrong people.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_is_step_owner(p_step_key text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.fms_sampling_step_is_source_scoped(p_step_key) then false
    else exists (
      select 1 from public.fms_sampling_step_owners o
       where o.step_key = p_step_key
         and p_uid = any(o.employee_ids))
  end;
$$;
grant execute on function public.fms_sampling_is_step_owner(text, uuid) to authenticated;

create or replace function public.fms_sampling_step_owner_ids(p_step_key text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.fms_sampling_step_is_source_scoped(p_step_key) then '{}'::uuid[]
    else coalesce(
      (select o.employee_ids from public.fms_sampling_step_owners o where o.step_key = p_step_key),
      '{}'::uuid[])
  end;
$$;
grant execute on function public.fms_sampling_step_owner_ids(text) to authenticated;

/**
 * The source a given step resolves for a given request. NULL for a step that is
 * not source-scoped.
 *
 * NOTE: `result` also carries a handful of LEGACY INWARD rows, whose receive_via
 * is 'import' or 'domestic' — both map to 'domestic'. That is deliberate and
 * correct (they are, by definition, not exports); falling back to the legacy
 * owner table for them would reintroduce exactly the hidden owners this design
 * removes. Setup says so in its hint.
 */
create or replace function public.fms_sampling_step_source(p_step_key text, p_req uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.fms_sampling_step_is_source_scoped(p_step_key) then
    (select public.fms_sampling_outward_source(r.receive_via)
       from public.fms_sampling_requests r where r.id = p_req)
  end;
$$;
grant execute on function public.fms_sampling_step_source(text, uuid) to authenticated;

/** Is this user an owner of this step FOR THIS REQUEST? The only owner check authorization may use. */
create or replace function public.fms_sampling_is_step_owner_for(p_step_key text, p_req uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.fms_sampling_step_is_source_scoped(p_step_key) then exists (
      select 1 from public.fms_sampling_step_source_owners o
       where o.step_key = p_step_key
         and o.source = public.fms_sampling_step_source(p_step_key, p_req)
         and p_uid = any(o.employee_ids))
    else public.fms_sampling_is_step_owner(p_step_key, p_uid)
  end;
$$;
grant execute on function public.fms_sampling_is_step_owner_for(text, uuid, uuid) to authenticated;

/** The owners to notify for this step ON THIS REQUEST. */
create or replace function public.fms_sampling_step_owner_ids_for(p_step_key text, p_req uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.fms_sampling_step_is_source_scoped(p_step_key) then coalesce(
      (select o.employee_ids from public.fms_sampling_step_source_owners o
        where o.step_key = p_step_key
          and o.source = public.fms_sampling_step_source(p_step_key, p_req)),
      '{}'::uuid[])
    else public.fms_sampling_step_owner_ids(p_step_key)
  end;
$$;
grant execute on function public.fms_sampling_step_owner_ids_for(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A6. Authorization.
--
-- Re-issued IN FULL from 20260731140000:111 — this function has been re-issued
-- five times and every version re-states all prior clauses; copying an earlier
-- one silently drops the collector / recipient / lab-result / sender / confirmer
-- rules. Two changes only:
--   · is_step_owner(step, uid) → is_step_owner_for(step, req, uid)
--   · a new arm: the chosen result_handover_to person owns result_handover
--
-- ⚠ The owner line is load-bearing. `result` has NO per-request clause of its
--   own, so leaving it on the (now guarded) is_step_owner would collapse Result
--   Received to admin + coordinator and deadlock the whole outward tail.
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
$$;
grant execute on function public.fms_sampling_can_act(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A7. submit_request — re-issued IN FULL from 20260731130000:147.
-- ONE change: the first step's owners now resolve per source.
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
  -- _for(), not the flat lookup: on outward v_step is send_sample, whose owners
  -- are split Domestic / Export.
  v_recips := public.fms_sampling_step_owner_ids_for(v_step, v_id);
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

-- ---------------------------------------------------------------------------
-- A8. send_sample — gate pass + mandatory gate entry no.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_record_send(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_gate text := nullif(trim(p->>'gate_entry_no'), '');
  v_doc  text := nullif(p->>'send_doc_path', '');
  -- Only the new client stamps this. Its absence means the previously deployed
  -- frontend, which cannot upload a gate pass — so the new requirements stay off
  -- for it. See the DEPLOY-WINDOW note at the top.
  v_new  boolean := coalesce((p->>'client_v')::int, 1) >= 2;
begin
  select status, req_no into v_status, v_no from public.fms_sampling_requests where id = p_req for update;
  if v_status is null then raise exception 'Request not found'; end if;
  if v_status <> 'awaiting_send' then
    raise exception 'This request is not awaiting sample dispatch (status %)', v_status;
  end if;
  if not public.fms_sampling_can_act('send_sample', p_req, v_uid) then
    raise exception 'Not authorized to record sample dispatch';
  end if;
  if v_new then
    if v_gate is null then raise exception 'The gate outward entry no. is required'; end if;
    if v_doc  is null then raise exception 'A gate-pass attachment is required to record the dispatch'; end if;
  end if;

  update public.fms_sampling_requests set
    sent_date     = coalesce(nullif(p->>'sent_date','')::date, current_date),
    gate_entry_no = v_gate,
    sent_qty      = nullif(trim(p->>'sent_qty'), ''),
    send_doc_path = v_doc,
    send_doc_name = nullif(p->>'send_doc_name', ''),
    sent_at       = coalesce(sent_at, now()),
    sent_by       = coalesce(sent_by, v_uid),
    status = 'awaiting_confirm', current_step = 'confirm_receipt'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'sent',
    'Sample sent for ' || coalesce(v_no,'a request') || ' — awaiting receipt confirmation.',
    public.fms_sampling_step_owner_ids_for('confirm_receipt', p_req) || public.fms_sampling_confirmer_ids(p_req),
    jsonb_build_object(
      'req_no', v_no,
      'eyebrow', 'Sample dispatched',
      'headline', 'A sample has been sent — please confirm the party received it',
      'action', 'sent a sample out',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'));
end $$;
grant execute on function public.fms_sampling_record_send(uuid, jsonb) to authenticated;

-- Edit-until-confirm. Two fixes on top of 20260726120000:246:
--   · the doc follows the key-present-⇒-replace contract (an omitted key KEEPS
--     the stored file; a present-but-empty one keeps it too — the gate pass is
--     mandatory, so an edit must not be able to delete it). Twin of
--     update_lab_complete (20260728120000:665), NOT of update_send's own
--     unconditional writes.
--   · gate_entry_no / sent_qty are now key-guarded as well. They were written
--     unconditionally, so any client that omitted them silently BLANKED them.
-- The ATTACHMENT is deliberately NOT required here: a dispatch recorded before
-- this migration has none, and an update_* RPC's job is to correct a date, not
-- to retro-enforce policy. Same asymmetry as record_lab_complete (requires the
-- report) vs update_lab_complete (does not).
create or replace function public.fms_sampling_update_send(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_gate text := nullif(trim(p->>'gate_entry_no'), '');
  v_new  boolean := coalesce((p->>'client_v')::int, 1) >= 2;
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
  if v_new and v_gate is null then
    raise exception 'The gate outward entry no. is required';
  end if;

  update public.fms_sampling_requests set
    sent_date     = coalesce(nullif(p->>'sent_date','')::date, sent_date),
    gate_entry_no = case when p ? 'gate_entry_no' then v_gate else gate_entry_no end,
    sent_qty      = case when p ? 'sent_qty' then nullif(trim(p->>'sent_qty'), '') else sent_qty end,
    send_doc_path = case when p ? 'send_doc_path' then coalesce(nullif(p->>'send_doc_path',''), send_doc_path) else send_doc_path end,
    send_doc_name = case when p ? 'send_doc_path' then coalesce(nullif(p->>'send_doc_name',''), send_doc_name) else send_doc_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'send_edited',
    format('Sample dispatch on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_send(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A9. confirm_receipt — the party's expected testing date.
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
    -- Optional, and a FORECAST: no current_date fallback and no cap.
    party_testing_date  = case when p ? 'party_testing_date'
                               then nullif(p->>'party_testing_date','')::date
                               else party_testing_date end,
    confirmed_at = coalesce(confirmed_at, now()),
    confirmed_by = coalesce(confirmed_by, v_uid),
    -- Outward skips testing entirely now.
    status = 'awaiting_result', current_step = 'result'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'confirmed',
    'Receipt confirmed for ' || coalesce(v_no,'a request') || ' — ready for the result.',
    public.fms_sampling_step_owner_ids_for('result', p_req),
    jsonb_build_object(
      'req_no', v_no,
      'eyebrow', 'Receipt confirmed',
      'headline', 'The party has received the sample — the result is now due',
      'action', 'confirmed the party received the sample',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'));
end $$;
grant execute on function public.fms_sampling_record_confirm(uuid, jsonb) to authenticated;

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
    raise exception 'The receipt confirmation can no longer be edited: the result has already been recorded (status %).', v_status;
  end if;

  update public.fms_sampling_requests set
    party_received_date = coalesce(nullif(p->>'party_received_date','')::date, party_received_date),
    -- Key-guarded, so an older client that doesn't know the field cannot blank it.
    -- Present-but-empty DOES clear it: the date is optional and must be erasable.
    party_testing_date  = case when p ? 'party_testing_date'
                               then nullif(p->>'party_testing_date','')::date
                               else party_testing_date end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'confirm_edited',
    format('Receipt confirmation on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_confirm(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A10. testing (LEGACY INWARD ONLY) — announce + email meta.
--
-- Nothing routes into this step any more, but a few pre-lab-gate inward rows
-- still run receive_sample → testing → result. It fans out to the `result`
-- owners, which are now source-scoped — without the _for() call those rows would
-- complete testing and notify NOBODY. Everything else is verbatim from
-- 20260724120100:371.
-- ---------------------------------------------------------------------------
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
    public.fms_sampling_step_owner_ids_for('result', p_req),
    jsonb_build_object(
      'req_no', v_no,
      'eyebrow', 'Testing completed',
      'headline', 'Testing is done — the result is now due',
      'action', 'completed testing',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'));
end $$;
grant execute on function public.fms_sampling_record_testing(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A11. result — "Result handover to" replaces the free-text owner.
--
-- result_owner is NOT in either SET list. Dropping the column from the write is
-- what preserves the legacy text: old rows keep it and the UI falls back to it.
-- Do NOT "tidy up" by nulling it — that is a data mutation.
--
-- result_handover is NOT source-scoped, so its fan-out keeps the flat lookup;
-- the chosen person is appended (||), never substituted — the configured
-- result_handover owners must keep receiving it.
-- ---------------------------------------------------------------------------
create or replace function public.fms_sampling_record_result(p_req uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_to      uuid := nullif(p->>'result_handover_to_id','')::uuid;
  v_to_name text := nullif(trim(p->>'result_handover_to_name'), '');
  -- Only the new client sends this key; the previously deployed frontend still
  -- posts result_owner and must keep working through the deploy window.
  v_new     boolean := p ? 'result_handover_to_id';
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
  if v_new and v_to is null then
    raise exception 'Please choose whom the result is handed over to';
  end if;

  update public.fms_sampling_requests set
    result_comment          = trim(p->>'result_comment'),
    result_handover_to_id   = case when p ? 'result_handover_to_id' then v_to      else result_handover_to_id   end,
    result_handover_to_name = case when p ? 'result_handover_to_id' then v_to_name else result_handover_to_name end,
    attachment_path = nullif(p->>'attachment_path', ''),
    attachment_name = nullif(p->>'attachment_name', ''),
    resulted_at = coalesce(resulted_at, now()),
    resulted_by = coalesce(resulted_by, v_uid),
    status = 'awaiting_handover', current_step = 'result_handover'
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'resulted',
    'Result recorded for ' || coalesce(v_no,'a request') || ' — ready for handover.',
    public.fms_sampling_step_owner_ids('result_handover')
      || (case when v_to is not null then array[v_to] else '{}'::uuid[] end),
    jsonb_build_object(
      'req_no', v_no,
      'eyebrow', 'Result received',
      'headline', 'A result has come back — it is ready to be handed over',
      'action', 'recorded the result',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'));
end $$;
grant execute on function public.fms_sampling_record_result(uuid, jsonb) to authenticated;

create or replace function public.fms_sampling_update_result(p_req uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_no text; v_uid uuid := auth.uid();
  v_to      uuid := nullif(p->>'result_handover_to_id','')::uuid;
  v_to_name text := nullif(trim(p->>'result_handover_to_name'), '');
  v_new     boolean := p ? 'result_handover_to_id';
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
  if v_new and v_to is null then
    raise exception 'Please choose whom the result is handed over to';
  end if;

  update public.fms_sampling_requests set
    result_comment          = trim(p->>'result_comment'),
    result_handover_to_id   = case when p ? 'result_handover_to_id' then v_to      else result_handover_to_id   end,
    result_handover_to_name = case when p ? 'result_handover_to_id' then v_to_name else result_handover_to_name end,
    attachment_path = case when p ? 'attachment_path' then nullif(p->>'attachment_path','') else attachment_path end,
    attachment_name = case when p ? 'attachment_name' then nullif(p->>'attachment_name','') else attachment_name end,
    edited_at = now(), edited_by = v_uid
  where id = p_req;

  perform public.fms_sampling_announce('request', p_req, 'result_edited',
    format('Result on %s edited', coalesce(v_no,'the request')), '{}'::uuid[], '{}'::jsonb);
end $$;
grant execute on function public.fms_sampling_update_result(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A12. result_handover — email meta only. Recipients and behaviour unchanged
-- (the raiser is told their request closed); re-issued from 20260726120000:320.
-- ---------------------------------------------------------------------------
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
    jsonb_build_object(
      'req_no', v_no,
      'eyebrow', 'Request closed',
      'headline', 'The result has been handed over and the request is closed',
      'action', 'handed the result over',
      'docLabel', v_no,
      'ctaPath', '/sampling/requests/' || p_req::text,
      'ctaLabel', 'Open in Sampling'));
end $$;
grant execute on function public.fms_sampling_record_handover(uuid, jsonb) to authenticated;

-- ===========================================================================
-- REVERSAL (if ever needed — nothing here is destructive, so this is a rollback
-- of the NEW objects only; the legacy step-owner rows were never touched):
--   drop table public.fms_sampling_step_source_owners;
--   drop table public.fms_sampling_result_recipients;
--   alter table public.fms_sampling_requests
--     drop column send_doc_path, drop column send_doc_name,
--     drop column party_testing_date,
--     drop column result_handover_to_id, drop column result_handover_to_name;
--   then re-run 20260731140000 (can_act, record_send, record_confirm),
--        20260731130000 (submit_request), 20260726120000 (update_send,
--        record_result, update_result, record_handover), 20260801120000
--        (update_confirm), 20260724120100 (record_testing) and 20260724120000
--        (is_step_owner, step_owner_ids) to restore the prior bodies.
-- ===========================================================================
