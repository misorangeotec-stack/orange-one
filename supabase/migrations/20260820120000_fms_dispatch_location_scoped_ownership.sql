-- ===========================================================================
-- LOCATION-SCOPED OWNERSHIP — who may SEE an order, enforced by Postgres.
--
-- WHY
--   Step ownership was global: one owner-set per step for the whole business,
--   and `fms_dispatch_orders` was readable by every signed-in user
--   (`using (true)`). A gate-out owner in Ahmedabad saw Vapi's orders, and the
--   queue pages could only ever have hidden them cosmetically — the rows were
--   already in the browser.
--
-- THE BOUNDARY, PRECISELY. Two dimensions, enforced at different layers, and
-- the difference is deliberate:
--
--   LOCATION is the hard boundary. Postgres withholds an order — and its lines,
--   its rounds, its round items and its activity — from anyone who does not own
--   SOME step at that order's location. Not a filter: the rows never leave the
--   database.
--
--   STEP stays a permission concern. Visibility is per LOCATION, not per
--   (location × step). Were it per current-step, an order would vanish from
--   your own Completed tab the moment it advanced, and every history surface —
--   the order page, the register, the round archive — would go dark on work you
--   did yourself. So a Vapi gate-out owner sees Vapi orders throughout their
--   life and Ahmedabad's not at all, and still cannot ACT on any step but gate
--   out, which fms_dispatch_can_act already enforces.
--
-- ⚠ EXISTING OWNER ROWS BECOME "ALL LOCATIONS" GRANTS. location_id is nullable
--   and null means every location, so nothing changes behaviourally on apply.
--   The boundary only starts biting when an admin adds a location-specific row.
--
-- ⚠ NOT COVERED: invoice and receiver-copy attachments live in Supabase
--   Storage and are reached by path, which no policy here touches. Storage
--   policies are a separate, tracked piece of work — do not read this migration
--   as having closed that.
-- ===========================================================================

-- ------------------------------------------------- owners, now per location --

alter table public.fms_dispatch_step_owners
  add column if not exists location_id uuid
    references public.fms_dispatch_company_locations on delete cascade;

comment on column public.fms_dispatch_step_owners.location_id is
  'Which site this owner-set covers. NULL = every location, and every order whose own location is unset - the fallback grant. One owner-set per (step, location), plus at most one fallback per step.';

-- One owner-set per step gives way to one per (step, location).
alter table public.fms_dispatch_step_owners
  drop constraint if exists fms_dispatch_step_owners_step_key_key;

-- ⚠ TWO INDEXES, NOT ONE, AND BOTH ARE NEEDED. Postgres treats NULLs as
--   distinct in a unique constraint, so `unique (step_key, location_id)` alone
--   would happily accept five fallback rows for the same step — five different
--   answers to "who owns this everywhere".
create unique index if not exists fms_dispatch_step_owners_step_location_uk
  on public.fms_dispatch_step_owners (step_key, location_id)
  where location_id is not null;

create unique index if not exists fms_dispatch_step_owners_step_fallback_uk
  on public.fms_dispatch_step_owners (step_key)
  where location_id is null;

-- The visibility predicate below runs per row and scans this array.
create index if not exists fms_dispatch_step_owners_employees_idx
  on public.fms_dispatch_step_owners using gin (employee_ids);

-- ------------------------------------------------------------- the helpers --

-- Owner check for one workflow step, optionally at one location.
--
-- ⚠ THE THIRD ARGUMENT IS DEFAULTED so every existing call site keeps compiling
--   and keeps meaning what it meant: "owns this step anywhere". Passing a
--   location narrows it to the sets that cover that location — its own, plus
--   the fallback.
create or replace function public.fms_dispatch_is_step_owner(
  p_step_key text, p_uid uuid, p_location uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.fms_dispatch_step_owners o
    where o.step_key = p_step_key
      and p_uid = any(o.employee_ids)
      and (p_location is null or o.location_id is null or o.location_id = p_location)
  );
$$;
grant execute on function public.fms_dispatch_is_step_owner(text, uuid, uuid) to authenticated;

-- Owners of one step, as an array — the notification fan-out.
--
-- ⚠ MUST AGGREGATE NOW. It used to be a scalar subquery over a table with one
--   row per step; with several it would fail outright with "more than one row
--   returned by a subquery". The union across every location is the right
--   answer here regardless, because fms_dispatch_announce is what narrows the
--   list to people who may actually see the order.
create or replace function public.fms_dispatch_step_owner_ids(p_step_key text)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce((
    select array_agg(distinct e)
      from public.fms_dispatch_step_owners o,
           unnest(o.employee_ids) e
     where o.step_key = p_step_key
  ), '{}'::uuid[]);
$$;
grant execute on function public.fms_dispatch_step_owner_ids(text) to authenticated;

-- MAY THIS PERSON SEE THIS ORDER AT ALL?
--
-- Admins and coordinators see everything, because someone has to. The raiser
-- always keeps sight of their own order — otherwise raising one at a site you
-- do not own would make it disappear the instant you saved it. Everyone else
-- needs an owner-set covering that order's location, on any step.
create or replace function public.fms_dispatch_can_see_order(
  p_uid uuid, p_location uuid, p_raised_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
       public.is_admin(p_uid)
    or public.fms_dispatch_is_coordinator(p_uid)
    or p_raised_by = p_uid
    or exists (
         select 1 from public.fms_dispatch_step_owners o
          where p_uid = any(o.employee_ids)
            and (o.location_id is null or o.location_id = p_location)
       )
  );
$$;
grant execute on function public.fms_dispatch_can_see_order(uuid, uuid, uuid) to authenticated;

-- MAY THIS PERSON ACT ON THIS STEP OF THIS ORDER?
--
-- ⚠ THE SIGNATURE IS UNCHANGED and p_order stops being ignored. It has taken an
--   order id since the beginning — the arm that used it (a driver confirming
--   their own delivery) went with the Drivers master — so no call site moves.
create or replace function public.fms_dispatch_can_act(p_step_key text, p_order uuid, p_uid uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_location uuid;
begin
  if public.is_admin(p_uid) or public.fms_dispatch_is_coordinator(p_uid) then
    return true;
  end if;
  select o.location_id into v_location from public.fms_dispatch_orders o where o.id = p_order;
  -- A null location (a legacy order, or a company with no sites) is covered by
  -- the fallback grant only — which is what an all-locations owner-set is.
  return public.fms_dispatch_is_step_owner(p_step_key, p_uid, v_location);
end $$;
grant execute on function public.fms_dispatch_can_act(text, uuid, uuid) to authenticated;

-- ------------------------------------------------------- the fan-out filter --
--
-- Carried from 20260801120400 with ONE addition: recipients who cannot see the
-- order are dropped before anything is written.
--
-- ⚠ THIS IS DELIBERATELY HERE AND NOT AT THE CALL SITES. There are nine places
--   that announce something about an order, each passing a step's owners; a
--   rule applied at each of them is a rule that gets forgotten at the tenth.
--   Filtering centrally also covers the EMAIL, whose body carries the customer,
--   the quantities and the invoice number — sending that to another location's
--   owner would leak past the boundary the policies below draw.
create or replace function public.fms_dispatch_announce(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_user_ids    uuid[] default '{}',
  p_meta        jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
  v_email_on boolean := false;
  v_payload jsonb;
  v_email text;
  v_recipients uuid[] := coalesce(p_user_ids, '{}'::uuid[]);
  v_location uuid;
  v_raiser uuid;
begin
  insert into public.fms_dispatch_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Narrow the list to people this order is actually visible to. Master-request
  -- announcements are untouched: they are about governance, not consignments.
  if p_entity_type = 'order' then
    select o.location_id, o.raised_by into v_location, v_raiser
      from public.fms_dispatch_orders o where o.id = p_entity_id;
    select coalesce(array_agg(x), '{}'::uuid[]) into v_recipients
      from unnest(v_recipients) x
     where public.fms_dispatch_can_see_order(x, v_location, v_raiser);
  end if;

  -- Corrections are bell-only; they carry no new work for anyone.
  begin
    v_email_on := public.email_module_enabled('order-to-dispatch') and p_type not like '%edited';
  exception when others then v_email_on := false;
  end;

  if v_email_on then
    begin
      v_payload := public.fms_dispatch_email_payload(p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
    exception when others then v_payload := null;
    end;
  end if;

  if v_recipients is not null then
    foreach u in array v_recipients loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_dispatch_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- Email the same recipient, only when this module's email gate is on.
      -- Isolated so a mail problem can never roll back the work.
      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('order-to-dispatch_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;
grant execute on function public.fms_dispatch_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;

-- ===========================================================================
-- ROW-LEVEL SECURITY — the boundary itself.
--
-- ⚠ ALL FIVE TABLES IN ONE MIGRATION, NOT ONE AT A TIME. data/dispatchFetch.ts
--   pulls orders, lines, rounds, round items and activity as SEPARATE paginated
--   passes and joins them in memory. A policy on `orders` alone would leave the
--   client holding lines and rounds belonging to orders it cannot see — worse
--   than no policy, because the joins would then be silently partial.
--
-- ⚠ auth.uid() IS WRAPPED IN (select …) EVERYWHERE. Unwrapped, Postgres treats
--   it as row-dependent and re-evaluates it per row; wrapped, it is hoisted
--   into a one-shot InitPlan. Same reason as the customer-item policy.
--
-- Writes are unchanged: every real write goes through a SECURITY DEFINER RPC,
-- which bypasses these policies and does its own authorization via can_act.
-- ===========================================================================

create index if not exists fms_dispatch_order_items_order_idx
  on public.fms_dispatch_order_items (order_id);

drop policy if exists fms_dispatch_orders_select on public.fms_dispatch_orders;
create policy fms_dispatch_orders_select on public.fms_dispatch_orders
  for select to authenticated
  using (public.fms_dispatch_can_see_order((select auth.uid()), location_id, raised_by));

drop policy if exists fms_dispatch_order_items_select on public.fms_dispatch_order_items;
create policy fms_dispatch_order_items_select on public.fms_dispatch_order_items
  for select to authenticated
  using (exists (
    select 1 from public.fms_dispatch_orders o
     where o.id = fms_dispatch_order_items.order_id
       and public.fms_dispatch_can_see_order((select auth.uid()), o.location_id, o.raised_by)
  ));

drop policy if exists fms_dispatch_rounds_select on public.fms_dispatch_rounds;
create policy fms_dispatch_rounds_select on public.fms_dispatch_rounds
  for select to authenticated
  using (exists (
    select 1 from public.fms_dispatch_orders o
     where o.id = fms_dispatch_rounds.order_id
       and public.fms_dispatch_can_see_order((select auth.uid()), o.location_id, o.raised_by)
  ));

drop policy if exists fms_dispatch_round_items_select on public.fms_dispatch_round_items;
create policy fms_dispatch_round_items_select on public.fms_dispatch_round_items
  for select to authenticated
  using (exists (
    select 1 from public.fms_dispatch_rounds r
     join public.fms_dispatch_orders o on o.id = r.order_id
    where r.id = fms_dispatch_round_items.round_id
      and public.fms_dispatch_can_see_order((select auth.uid()), o.location_id, o.raised_by)
  ));

-- The activity trail carries the same facts as the order it describes, so it
-- inherits the same rule. Master-request activity is governance and stays open.
drop policy if exists fms_dispatch_activity_select on public.fms_dispatch_activity;
create policy fms_dispatch_activity_select on public.fms_dispatch_activity
  for select to authenticated
  using (
    entity_type <> 'order'
    or exists (
      select 1 from public.fms_dispatch_orders o
       where o.id = fms_dispatch_activity.entity_id
         and public.fms_dispatch_can_see_order((select auth.uid()), o.location_id, o.raised_by)
    )
  );

-- ---------------------------------------------------------------- asserts --
do $check$
declare v_def text; v_n integer;
begin
  -- The fallback index must exist, or "who owns this everywhere" stops having
  -- exactly one answer.
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'fms_dispatch_step_owners_step_fallback_uk';
  if v_n <> 1 then raise exception 'the fallback owner-set index is missing'; end if;

  select count(*) into v_n from pg_constraint
   where conrelid = 'public.fms_dispatch_step_owners'::regclass and contype = 'u';
  if v_n <> 0 then raise exception 'step_key is still uniquely constrained on its own'; end if;

  -- Every one of the five tables must be closed. A single `using (true)` left
  -- behind hands out the rows the other four are withholding.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('fms_dispatch_orders','fms_dispatch_order_items','fms_dispatch_rounds',
                       'fms_dispatch_round_items','fms_dispatch_activity')
     and cmd = 'SELECT'
     and qual like '%fms_dispatch_can_see_order%';
  if v_n <> 5 then raise exception 'expected 5 location-scoped select policies, found %', v_n; end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_can_act';
  if v_def not like '%location_id into v_location%' then
    raise exception 'can_act still ignores the order it is given';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_announce';
  if v_def not like '%fms_dispatch_can_see_order(x, v_location, v_raiser)%' then
    raise exception 'announce does not filter its recipients by visibility';
  end if;
  if v_def not like '%email_outbox%' then
    raise exception 'announce regressed to the pre-email body';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_dispatch_step_owner_ids';
  if v_def not like '%array_agg(distinct e)%' then
    raise exception 'step_owner_ids is still a scalar subquery and will fail on a second owner-set';
  end if;
end $check$;
