-- ===========================================================================
-- Complaint (RM/FG) FMS — MASTER GOVERNANCE (Phase 4).
--
--   fms_complaint_master_managers   — who owns each of the two masters
--   fms_complaint_is_master_manager — the predicate
--   fms_complaint_master_requests   — "please add a value I cannot find"
--   fms_complaint_request_master    — raise one
--   fms_complaint_resolve_master_request — approve (creating the row) or reject
--
-- Then widens both masters' write policies from admin-only to admin-or-owner.
--
-- ⚠ ONLY THIS MODULE'S OWN TWO MASTERS ARE GOVERNED HERE. The central masters
--   (party, item, company, unit) are deliberately NOT requestable from a
--   complaint. A complaint is the worst possible moment to invent a customer:
--   the person raising it is describing a failure, not curating a master, and a
--   half-typed ledger name approved in a hurry lands in the credit note and then
--   in Tally. When the party or the item genuinely is not there, the raise form
--   takes the TYPED NAME with a null FK — `party_name` and `item_name` are
--   nullable-FK-plus-frozen-text for exactly this reason (phase 5).
--
-- ⚠ pc_is_coordinator IS IN THE AUTHORIZATION LINE FROM DAY ONE. The assertion
--   at the foot of 20261012120100_widen_resolve_master_requests_for_pc.sql
--   sweeps every function named `fms_%_resolve_master_request` and RAISES if one
--   lacks it — so omitting it here would fail that migration on the next replay,
--   not merely leave the Process Coordinator unable to approve.
--
-- ⚠ THE PAYLOAD KEYS ARE A WIRE CONTRACT. `proposed_payload` is authored in
--   frontend/src/apps/complaint/lib/masterFields.ts and read VERBATIM below. A
--   key added there without being added here is SILENTLY DROPPED on approval —
--   no error, just a master row missing a field somebody filled in.
--
-- Additive. Reversal:
--   drop function if exists public.fms_complaint_resolve_master_request(uuid,boolean,jsonb,text);
--   drop function if exists public.fms_complaint_request_master(text,jsonb);
--   drop function if exists public.fms_complaint_is_master_manager(text,uuid);
--   drop table if exists public.fms_complaint_master_requests, public.fms_complaint_master_managers;
--   -- and restore the admin-only write policies from 20261110120200.
-- ===========================================================================

begin;

-- ===========================================================================
-- WHO OWNS EACH MASTER
-- ===========================================================================
create table if not exists public.fms_complaint_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in ('nature', 'root_cause')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);

comment on table public.fms_complaint_master_managers is
  'Who may add and edit each Complaint master. A master with no owner falls back to admins.';

drop trigger if exists trg_fms_complaint_master_managers_updated on public.fms_complaint_master_managers;
create trigger trg_fms_complaint_master_managers_updated
  before update on public.fms_complaint_master_managers
  for each row execute function public.set_updated_at();

alter table public.fms_complaint_master_managers enable row level security;

drop policy if exists fms_complaint_master_managers_select on public.fms_complaint_master_managers;
create policy fms_complaint_master_managers_select on public.fms_complaint_master_managers
  for select to authenticated using (true);

drop policy if exists fms_complaint_master_managers_write on public.fms_complaint_master_managers;
create policy fms_complaint_master_managers_write on public.fms_complaint_master_managers
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

-- ⚠ NOT gated on module_can_edit, matching every other module: this answers
--   "is this person the owner of that list", and the edit ceiling is applied by
--   the caller (the store ANDs canEdit into canManage).
create or replace function public.fms_complaint_is_master_manager(p_master_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_complaint_master_managers m
    where m.master_type = p_master_type
      and m.manager_user_id = p_uid
  );
$$;
grant execute on function public.fms_complaint_is_master_manager(text, uuid) to authenticated;


-- ===========================================================================
-- MASTER REQUESTS
-- ===========================================================================
create table if not exists public.fms_complaint_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in ('nature', 'root_cause')),
  proposed_payload   jsonb not null default '{}'::jsonb,
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  requested_by       uuid references auth.users on delete set null,
  reviewed_by        uuid references auth.users on delete set null,
  review_note        text,
  resolved_master_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.fms_complaint_master_requests is
  'Requests to add a value to a Complaint master. proposed_payload keys are read verbatim by fms_complaint_resolve_master_request — see lib/masterFields.ts.';

-- One PENDING request per name per type. Two people hitting the same gap on the
-- same day should not produce two rows for one reviewer to reconcile.
create unique index if not exists fms_complaint_master_requests_pending_key
  on public.fms_complaint_master_requests (master_type, lower(proposed_payload->>'name'))
  where status = 'pending';

create index if not exists fms_complaint_master_requests_status_idx
  on public.fms_complaint_master_requests (status, created_at);

drop trigger if exists trg_fms_complaint_master_requests_updated on public.fms_complaint_master_requests;
create trigger trg_fms_complaint_master_requests_updated
  before update on public.fms_complaint_master_requests
  for each row execute function public.set_updated_at();

alter table public.fms_complaint_master_requests enable row level security;

drop policy if exists fms_complaint_master_requests_select on public.fms_complaint_master_requests;
create policy fms_complaint_master_requests_select on public.fms_complaint_master_requests
  for select to authenticated using (true);

-- Insert your OWN request, and only with an edit grant. Resolution is by RPC.
drop policy if exists fms_complaint_master_requests_insert on public.fms_complaint_master_requests;
create policy fms_complaint_master_requests_insert on public.fms_complaint_master_requests
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and (select public.module_can_edit(auth.uid(), 'complaint'))
  );

create or replace function public.fms_complaint_request_master(
  p_master_type text,
  p_payload     jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_name text := nullif(trim(p_payload->>'name'), '');
begin
  if not public.module_can_edit(auth.uid(), 'complaint') then
    raise exception 'Not authorized to request a Complaint master';
  end if;
  if p_master_type not in ('nature', 'root_cause') then
    raise exception 'Unknown Complaint master type: %', p_master_type;
  end if;
  if v_name is null then
    raise exception 'A name is required to request a master';
  end if;

  insert into public.fms_complaint_master_requests (master_type, proposed_payload, requested_by)
  values (p_master_type, coalesce(p_payload, '{}'::jsonb), auth.uid())
  returning id into v_id;

  perform public.fms_complaint_announce(
    'master_request', v_id, 'master_requested',
    format('%s requested a new %s: %s',
           coalesce((select name from public.profiles where id = auth.uid()), 'Someone'),
           replace(p_master_type, '_', ' '), v_name),
    (select coalesce(array_agg(manager_user_id), '{}'::uuid[])
       from public.fms_complaint_master_managers where master_type = p_master_type),
    jsonb_build_object('master_type', p_master_type, 'name', v_name)
  );

  return v_id;
end $$;

comment on function public.fms_complaint_request_master(text, jsonb) is
  'Raise a request for a missing Complaint master value, and notify that master''s owners.';
grant execute on function public.fms_complaint_request_master(text, jsonb) to authenticated;


-- ===========================================================================
-- RESOLVE — approve (creating the real row) or reject.
--
-- The reviewer may CORRECT the payload before approving: `p_payload` overrides
-- what was proposed, which is how a typo or a missing band gets fixed at the
-- moment somebody who knows is already looking at it.
-- ===========================================================================
create or replace function public.fms_complaint_resolve_master_request(
  p_request_id uuid,
  p_approve    boolean,
  p_payload    jsonb default null,
  p_note       text  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_new_id  uuid;
  v_name    text;
  v_group   text;
begin
  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
  from public.fms_complaint_master_requests
  where id = p_request_id
  for update;

  if v_type is null then raise exception 'Master request % not found', p_request_id; end if;
  if v_status <> 'pending' then raise exception 'Master request % is already %', p_request_id, v_status; end if;

  -- ⚠ pc_is_coordinator is required here — see the header.
  if not (
    public.is_admin(auth.uid())
    or public.fms_complaint_is_master_manager(v_type, auth.uid())
    or public.pc_is_coordinator(auth.uid())
  ) then
    raise exception 'Not authorized to resolve % master requests', v_type;
  end if;

  v_payload := coalesce(p_payload, v_payload);
  v_name    := nullif(trim(v_payload->>'name'), '');

  if p_approve then
    if v_name is null then raise exception 'A name is required to approve a master request'; end if;

    if v_type = 'nature' then
      insert into public.fms_complaint_natures (name, created_by)
      values (v_name, auth.uid())
      returning id into v_new_id;

    elsif v_type = 'root_cause' then
      -- Defaulted rather than refused: a requester describing a failure should
      -- not be blocked on choosing a reporting band, and the reviewer can set it.
      v_group := coalesce(nullif(trim(v_payload->>'cause_group'), ''), 'process');
      if v_group not in ('material','process','handling','storage','transport','party_side') then
        raise exception 'Unknown cause group: %', v_group;
      end if;
      insert into public.fms_complaint_root_causes (name, cause_group, created_by)
      values (v_name, v_group, auth.uid())
      returning id into v_new_id;

    else
      raise exception 'Unknown Complaint master type: %', v_type;
    end if;
  end if;

  update public.fms_complaint_master_requests
     set status             = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by        = auth.uid(),
         review_note        = nullif(trim(coalesce(p_note, '')), ''),
         resolved_master_id = v_new_id,
         proposed_payload   = v_payload
   where id = p_request_id;

  perform public.fms_complaint_announce(
    'master_request', p_request_id,
    case when p_approve then 'master_approved' else 'master_rejected' end,
    format('Your request for the %s "%s" was %s',
           replace(v_type, '_', ' '), coalesce(v_name, '?'),
           case when p_approve then 'approved' else 'rejected' end),
    (select coalesce(array_agg(requested_by), '{}'::uuid[])
       from public.fms_complaint_master_requests
      where id = p_request_id and requested_by is not null),
    jsonb_build_object('master_type', v_type, 'approved', p_approve)
  );

  return v_new_id;
end $$;

comment on function public.fms_complaint_resolve_master_request(uuid, boolean, jsonb, text) is
  'Approve (creating the real master row) or reject a Complaint master request. Admin, the master type''s owner, or the process coordinator.';
grant execute on function public.fms_complaint_resolve_master_request(uuid, boolean, jsonb, text) to authenticated;


-- ===========================================================================
-- WIDEN the master write policies: admin -> admin OR that master's owner.
-- ===========================================================================
drop policy if exists fms_complaint_natures_write on public.fms_complaint_natures;
create policy fms_complaint_natures_write on public.fms_complaint_natures
  for all to authenticated
  using ((select public.is_admin(auth.uid()))
      or (select public.fms_complaint_is_master_manager('nature', auth.uid())))
  with check ((select public.is_admin(auth.uid()))
      or (select public.fms_complaint_is_master_manager('nature', auth.uid())));

drop policy if exists fms_complaint_root_causes_write on public.fms_complaint_root_causes;
create policy fms_complaint_root_causes_write on public.fms_complaint_root_causes
  for all to authenticated
  using ((select public.is_admin(auth.uid()))
      or (select public.fms_complaint_is_master_manager('root_cause', auth.uid())))
  with check ((select public.is_admin(auth.uid()))
      or (select public.fms_complaint_is_master_manager('root_cause', auth.uid())));


do $mig$
begin
  -- The sweep in 20261012120100 will fail the whole migration set if this is missing.
  if position('pc_is_coordinator' in pg_get_functiondef(
       'public.fms_complaint_resolve_master_request(uuid,boolean,jsonb,text)'::regprocedure)) = 0 then
    raise exception 'Complaint: resolve_master_request must accept pc_is_coordinator';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('fms_complaint_master_managers', 'fms_complaint_master_requests')
       and roles::text like '%public%'
  ) then
    raise exception 'Complaint: a governance policy is scoped to {public}';
  end if;
end $mig$;

commit;
