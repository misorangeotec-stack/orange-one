-- ===========================================================================
-- Travel Desk FMS — MASTER GOVERNANCE (Phase 2).
--
-- Two problems, one shape, copied from every other FMS in this portal:
--
--   1. WHO MAY EDIT A LIST. Until now every master here is admin-only, which
--      means the person who actually knows which hotels are usable in Coimbatore
--      cannot add one without being made an administrator of the whole portal.
--      A master MANAGER owns one list and nothing else.
--
--   2. WHAT SOMEBODY DOES WHEN THE VALUE THEY NEED IS MISSING. Without an
--      answer, they type the nearest thing that fits — which is how one hotel
--      ends up in the data as four different strings, and how a city with no
--      tier ends up priced at whatever the fallback happens to be.
--
-- ⚠ A REQUEST BLOCKS HERE, UNLIKE IN OCPI. OCPI lets three of its four masters
--   through free-text-plus-a-request, because those values are stored on the
--   deal as TEXT and a salesperson mid-negotiation should not wait for a
--   vocabulary entry. Travel Desk cannot do that for CITIES: a city carries a
--   TIER, and the tier is what prices the hotel cap, the daily allowance and the
--   conveyance cap. A free-text city is an unpriceable trip. So a city must be
--   approved before it can be used — exactly as an item request works in
--   General Purchase.
--
--   Airlines, hotels and bus operators are only PREFERENCES on the request, so
--   those could be relaxed later if anyone asks. Cities and expense categories
--   cannot.
--
-- Also WIDENS the write policies on the six master tables from "admin only" to
-- "admin or the manager of this list".
--
-- Additive. Reversal (reverse order):
--   -- restore the admin-only write policies on the six master tables
--   drop function if exists public.fms_travel_resolve_master_request(uuid,text,text,jsonb);
--   drop function if exists public.fms_travel_is_master_manager(text,uuid);
--   drop table if exists public.fms_travel_master_requests;
--   drop table if exists public.fms_travel_master_managers;
-- ===========================================================================

begin;

create table if not exists public.fms_travel_master_managers (
  id              uuid primary key default gen_random_uuid(),
  master_type     text not null check (master_type in (
                    'city', 'purpose', 'expense_category',
                    'airline', 'hotel', 'bus_operator', 'rate_card')),
  manager_user_id uuid not null references auth.users on delete cascade,
  created_at      timestamptz not null default now(),
  unique (master_type, manager_user_id)
);

comment on table public.fms_travel_master_managers is
  'Who owns each Travel Desk list. A manager edits that list and resolves requests against it, and nothing else - ownership is per list, not per module.';

alter table public.fms_travel_master_managers enable row level security;

drop policy if exists fms_travel_master_managers_select on public.fms_travel_master_managers;
create policy fms_travel_master_managers_select on public.fms_travel_master_managers
  for select to authenticated using (true);

drop policy if exists fms_travel_master_managers_write on public.fms_travel_master_managers;
create policy fms_travel_master_managers_write on public.fms_travel_master_managers
  for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

-- ⚠ NOT GATED on module_can_edit, deliberately. Master ownership is granted
--   separately from the workflow and is about the reference data, not about
--   raising or approving a trip. Someone may curate the hotel list without ever
--   travelling. Same reasoning as OCPI's canManageMaster.
create or replace function public.fms_travel_is_master_manager(p_type text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
     or exists (
       select 1 from public.fms_travel_master_managers m
        where m.master_type = p_type and m.manager_user_id = p_uid
     );
$$;

comment on function public.fms_travel_is_master_manager(text, uuid) is
  'May this user edit this Travel Desk list? Admins always can. Not gated on module_can_edit - curating a list is not the workflow.';
grant execute on function public.fms_travel_is_master_manager(text, uuid) to authenticated;


create table if not exists public.fms_travel_master_requests (
  id                 uuid primary key default gen_random_uuid(),
  master_type        text not null check (master_type in (
                       'city', 'purpose', 'expense_category',
                       'airline', 'hotel', 'bus_operator')),
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

comment on table public.fms_travel_master_requests is
  'Ask for a value that is not on a list yet. A city request BLOCKS the trip that needs it - a city with no tier cannot be priced.';

-- One pending request per name per list, so ten people asking for the same
-- hotel produce one thing to review rather than ten.
create unique index if not exists fms_travel_master_requests_pending_uniq
  on public.fms_travel_master_requests (
    master_type, lower(coalesce(proposed_payload->>'name', ''))
  ) where status = 'pending';

create index if not exists fms_travel_master_requests_status_idx
  on public.fms_travel_master_requests (status, created_at);

drop trigger if exists trg_fms_travel_master_requests_updated on public.fms_travel_master_requests;
create trigger trg_fms_travel_master_requests_updated
  before update on public.fms_travel_master_requests
  for each row execute function public.set_updated_at();

alter table public.fms_travel_master_requests enable row level security;

drop policy if exists fms_travel_master_requests_select on public.fms_travel_master_requests;
create policy fms_travel_master_requests_select on public.fms_travel_master_requests
  for select to authenticated using (true);

-- Anyone who may act in the module may ASK. Resolving goes through the RPC.
drop policy if exists fms_travel_master_requests_insert on public.fms_travel_master_requests;
create policy fms_travel_master_requests_insert on public.fms_travel_master_requests
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and (select public.module_can_edit(auth.uid(), 'travel-desk'))
  );


-- ===========================================================================
-- RESOLVE A REQUEST.
--
-- ⚠ THE REVIEWER MAY CORRECT THE PAYLOAD BEFORE APPROVING IT. Somebody asks for
--   "kolkatta" at no tier; the reviewer approves it as "Kolkata", Tier 1. The
--   corrected value is what the master row gets — not what was typed. Approving
--   a misspelling because it was easier than editing it is how a master list
--   rots.
-- ===========================================================================
create or replace function public.fms_travel_resolve_master_request(
  p_request  uuid,
  p_decision text,
  p_note     text  default null,
  p_payload  jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_type    text;
  v_status  text;
  v_payload jsonb;
  v_name    text;
  v_new     uuid;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'A request is either approved or rejected';
  end if;

  select master_type, status, proposed_payload
    into v_type, v_status, v_payload
    from public.fms_travel_master_requests where id = p_request for update;

  if v_type is null then raise exception 'Request not found'; end if;
  if v_status <> 'pending' then
    raise exception 'This request has already been %', v_status;
  end if;
  if not public.fms_travel_is_master_manager(v_type, v_uid) then
    raise exception 'You do not own this list, so you cannot decide requests against it';
  end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say why, so the person who asked knows what to do instead';
  end if;

  -- The reviewer's corrections win over what was typed.
  v_payload := coalesce(p_payload, v_payload);
  v_name := nullif(btrim(coalesce(v_payload->>'name', '')), '');

  if p_decision = 'approved' then
    if v_name is null then
      raise exception 'This request has no name to add';
    end if;

    case v_type
      when 'city' then
        insert into public.fms_travel_cities (name, state, tier, created_by)
        values (v_name, nullif(btrim(coalesce(v_payload->>'state','')), ''),
                coalesce((v_payload->>'tier')::smallint, 3), v_uid)
        on conflict (name) do update set active = true
        returning id into v_new;
      when 'purpose' then
        insert into public.fms_travel_purposes (name, requires_remarks, created_by)
        values (v_name, coalesce((v_payload->>'requires_remarks')::boolean, false), v_uid)
        on conflict (name) do update set active = true
        returning id into v_new;
      when 'expense_category' then
        insert into public.fms_travel_expense_categories (name, kind, reimbursable, created_by)
        values (v_name, coalesce(nullif(btrim(coalesce(v_payload->>'kind','')), ''), 'misc'),
                coalesce((v_payload->>'reimbursable')::boolean, true), v_uid)
        on conflict (name) do update set active = true
        returning id into v_new;
      when 'airline' then
        insert into public.fms_travel_airlines (name, created_by) values (v_name, v_uid)
        on conflict (name) do update set active = true returning id into v_new;
      when 'hotel' then
        insert into public.fms_travel_hotels (name, city_id, created_by)
        values (v_name, nullif(btrim(coalesce(v_payload->>'city_id','')), '')::uuid, v_uid)
        on conflict (name) do update set active = true returning id into v_new;
      when 'bus_operator' then
        insert into public.fms_travel_bus_operators (name, created_by) values (v_name, v_uid)
        on conflict (name) do update set active = true returning id into v_new;
      else
        raise exception 'Unknown master type %', v_type;
    end case;
  end if;

  update public.fms_travel_master_requests
     set status = p_decision, reviewed_by = v_uid, review_note = p_note,
         proposed_payload = v_payload, resolved_master_id = v_new
   where id = p_request;

  perform public.fms_travel_announce(
    'master_request', p_request, 'master_request_' || p_decision,
    coalesce(v_name, 'Request') || ' — ' || p_decision,
    case when (select requested_by from public.fms_travel_master_requests where id = p_request) is not null
         then array[(select requested_by from public.fms_travel_master_requests where id = p_request)]
         else '{}'::uuid[] end,
    jsonb_build_object('master_type', v_type, 'name', v_name));

  return v_new;
end $$;

comment on function public.fms_travel_resolve_master_request(uuid, text, text, jsonb) is
  'Approve or reject a request for a missing master value. The reviewer may correct the payload first, and the correction is what the master row gets.';
grant execute on function public.fms_travel_resolve_master_request(uuid, text, text, jsonb) to authenticated;


-- ===========================================================================
-- WIDEN THE MASTER WRITE POLICIES from "admin" to "admin or this list's owner".
-- ===========================================================================
do $mig$
declare
  v_map text[][] := array[
    ['fms_travel_cities', 'city'],
    ['fms_travel_purposes', 'purpose'],
    ['fms_travel_expense_categories', 'expense_category'],
    ['fms_travel_airlines', 'airline'],
    ['fms_travel_hotels', 'hotel'],
    ['fms_travel_bus_operators', 'bus_operator']
  ];
  i int;
begin
  for i in 1 .. array_length(v_map, 1) loop
    execute format('drop policy if exists %1$s_write on public.%1$I', v_map[i][1]);
    execute format(
      'create policy %1$s_write on public.%1$I for all to authenticated '
      'using ((select public.fms_travel_is_master_manager(%2$L, auth.uid()))) '
      'with check ((select public.fms_travel_is_master_manager(%2$L, auth.uid())))',
      v_map[i][1], v_map[i][2]);
  end loop;
end $mig$;


-- ===========================================================================
-- ASSERTIONS
-- ===========================================================================
do $mig$
declare v_public int;
begin
  select count(*) into v_public
    from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_travel_master_managers', 'fms_travel_master_requests')
     and roles::text like '%public%';
  if v_public > 0 then
    raise exception 'Travel Desk governance: % policy/policies scoped to {public}', v_public;
  end if;

  -- Ownership is per list, not per module: a hotel owner is not a city owner.
  -- Proved with a real non-admin, then cleaned up.
  declare
    v_victim uuid;
  begin
    select p.id into v_victim
      from public.profiles p
     where not public.is_admin(p.id) and p.email is not null
     order by p.name limit 1;

    if v_victim is not null then
      insert into public.fms_travel_master_managers (master_type, manager_user_id)
      values ('hotel', v_victim) on conflict do nothing;

      if not public.fms_travel_is_master_manager('hotel', v_victim) then
        raise exception 'Travel Desk: a named hotel manager was not recognised';
      end if;
      if public.fms_travel_is_master_manager('city', v_victim) then
        raise exception 'Travel Desk: master ownership leaked across lists - a hotel owner must not own cities';
      end if;

      delete from public.fms_travel_master_managers
       where master_type = 'hotel' and manager_user_id = v_victim;
    end if;
  end;

  -- The six master tables now consult the ownership predicate, not is_admin.
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename like 'fms_travel_%'
         and policyname like '%_write'
         and qual like '%is_master_manager%') <> 6 then
    raise exception 'Travel Desk: expected all six master write policies to consult fms_travel_is_master_manager';
  end if;
end $mig$;

commit;
