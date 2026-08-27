-- ===========================================================================
-- Order to Dispatch — a step owner may HAND A STEP to someone else.
--
-- The seventh and last module in this sweep. It follows HR Recruitment's
-- (entity, step) TABLE shape; what is specific to Dispatch is that ownership is
-- LOCATION-SCOPED, and that its read rule — like Travel's — is an inline RLS
-- policy rather than a helper function.
--
-- ⚠ DIFFERENCE 1 — OWNERSHIP IS PER (STEP, LOCATION).
-- fms_dispatch_step_owners carries a location_id, and
-- fms_dispatch_is_step_owner__ungated matches a row when
--   p_location is null OR o.location_id is null OR o.location_id = p_location
-- i.e. a row with a NULL location is an ALL-LOCATIONS grant. So "who owns this
-- step" has no answer without the ORDER, which is why
-- fms_dispatch_can_act__ungated looks the order's location up first. The
-- assignee table keys on the order for the same reason: an assignee is a person
-- put on ONE order's step, and location does not enter into it.
--
-- ⚠ DIFFERENCE 2 — THE CHEAPEST FIX HERE NEEDS NO CODE, AND THIS IS NOT IT.
-- credit_check is configured as three location rows holding ONE person each,
-- plus an all-locations fallback row holding ZERO. sales_bill and sales_return
-- are the same shape. Naming a second person per location — or simply filling
-- that empty fallback row — would remove the single point of failure without any
-- of this. Reassignment is the answer to "the one person is away today", not to
-- "only one person is configured"; both are worth doing and they are different
-- problems. The empty fallback rows are filed under PF-14 in WORKLIST.md.
--
-- ⚠ DIFFERENCE 3 — NOBODY IS A COORDINATOR HERE.
-- fms_dispatch_config holds only step_sla: there is no process_coordinators row,
-- so fms_dispatch_is_coordinator grants nobody anything and the admin arm is the
-- only blanket authority in the module.
--
-- ⚠ THE READ POLICY, AND THE MISTAKE NOT TO REPEAT.
-- fms_dispatch_orders' select rule is an inline policy, so admitting an assignee
-- means ALTER POLICY. When the same thing was done for Travel Desk earlier today,
-- the assignee table was ALSO given a policy that read the orders table — and the
-- two policies then referenced each other, so Postgres refused BOTH with
-- "infinite recursion detected in policy for relation ...". The whole module went
-- dark. This table's policy therefore does NOT consult fms_dispatch_orders: it
-- holds only (order, step, user) triples, and the orders policy still governs
-- which ORDERS anyone can see.
--
-- ⚠ AND NOTE WHAT WOULD NOT HAVE CAUGHT THAT. The authorisation suites in this
-- sweep connect as `postgres`, for whom RLS is not enforced at all. A passing
-- authz suite says nothing about policy recursion; only opening the screen does.
--
-- ADDITIVE: one new table, three new functions, one create-or-replace keeping its
-- EXACT argument list, one ALTER POLICY that only ADDS an arm.
--
-- NO SERVER-SIDE ANNOUNCE. The store raises it client-side.
--
-- VERIFIED ON LIVE DATA 2026-08-27 inside rolled-back transactions:
--   * 14 authorisation cases, 14 passed, on SO-2627-0781. The one specific to
--     this module: after reassigning credit_check on that order, its location's
--     owner KEEPS every other order at the same site — the reassignment is a
--     stand-in for one order, not a change to the roster.
--   * The reversal rehearsed, 7 of 7, including reverting the POLICY and
--     confirming pg_policies no longer mentions the assignee table.
--   * ⚠ AND THE CHECK THE TRAVEL RECURSION SLIPPED PAST: every table added in
--     this sweep was read back with `set local role authenticated`, so the
--     policies actually run. All four assignee tables and both orders/trips
--     tables returned rows, as an admin and as a non-admin. Running the same
--     read as `postgres` proves nothing, because RLS is not enforced for it.
--
-- REVERSAL:
--   1. re-run the fms_dispatch_can_act__ungated body from its previous defining
--      migration FIRST — the new body calls fms_dispatch_is_natural_step_owner,
--      so dropping that helper first breaks every RPC that gates on can_act.
--   2. alter policy fms_dispatch_orders_select ... — drop the assignee arm; the
--      previous expression is section 5's minus that one exists() clause.
--   3. drop function public.fms_dispatch_reassign_step(uuid, text, uuid, text);
--      drop function public.fms_dispatch_is_natural_step_owner(text, uuid, uuid);
--      drop function public.fms_dispatch_can_receive_reassignment(uuid);
--   4. delete from public.fms_dispatch_config where key = 'reassign_pool';
--   5. drop table public.fms_dispatch_step_assignees;
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Who holds which step of which order.
-- ---------------------------------------------------------------------------
-- ⚠ IT NEEDS AN `id`, AND THE COMPOSITE KEY IS A UNIQUE CONSTRAINT INSTEAD.
--   The first draft used `primary key (order_id, step_key)` and no id column —
--   the same shape as the HR, Exit and Travel assignee tables, which is fine for
--   them. It is NOT fine here: THIS module's `fetchAll` adds a secondary sort on
--   `id` for stable paging (dispatchFetch.ts, `if (orderBy !== "key") q =
--   q.order("id")`), so PostgREST answered 400, the store's Promise.all rejected,
--   and EVERY Dispatch queue rendered empty — not just this feature's.
--   `on conflict (order_id, step_key)` still works against the unique constraint.
create table if not exists public.fms_dispatch_step_assignees (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.fms_dispatch_orders(id) on delete cascade,
  step_key    text not null,
  assigned_to uuid not null references auth.users on delete cascade,
  assigned_by uuid references auth.users on delete set null,
  assigned_at timestamptz not null default now(),
  note        text,
  unique (order_id, step_key)
);

comment on table public.fms_dispatch_step_assignees is
  'Who is currently holding one STEP of one order. Keyed on (order_id, step_key): ownership in this module is per (step, location) and has no answer without the order, so the order is the natural key. A row here REPLACES the location-scoped owner for that step; it is deleted, not nulled, on a hand-back.';

alter table public.fms_dispatch_step_assignees enable row level security;

-- ⚠ DOES NOT CONSULT fms_dispatch_orders. Section 5 adds an arm to the ORDERS
--   policy that reads THIS table, and two policies that read each other make
--   Postgres refuse both — that is exactly how Travel Desk went dark earlier
--   today. This table holds only (order, step, user) triples, and the orders
--   policy still governs which orders anyone can see.
create policy fms_dispatch_step_assignees_select on public.fms_dispatch_step_assignees
  for select using (auth.uid() is not null);

create policy fms_dispatch_step_assignees_write on public.fms_dispatch_step_assignees
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.fms_dispatch_step_assignees to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Who may RECEIVE a reassignment.
--
-- ⚠ AUTHORIZATION COMES SOLELY FROM user_ids. department_ids is a Setup picker
--   filter and grants nothing.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_can_receive_reassignment(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.fms_dispatch_config c
     where c.key = 'reassign_pool'
       and p_uid::text in (
         select jsonb_array_elements_text(coalesce(c.value->'user_ids','[]'::jsonb))
       )
  );
$$;

comment on function public.fms_dispatch_can_receive_reassignment(uuid) is
  'Is this user on the configured list of people who may be handed an Order to Dispatch step? Reads ONLY fms_dispatch_config.reassign_pool -> user_ids; department_ids in that same row is a Setup picker filter and grants nothing.';

grant execute on function public.fms_dispatch_can_receive_reassignment(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Who owns a step of this order when nobody is holding it.
--
-- The pre-existing rule lifted out of fms_dispatch_can_act__ungated verbatim,
-- with the admin/coordinator arm left behind — that is authority, not ownership,
-- and the reassign RPC needs ownership specifically so the location's owner can
-- take a step back after passing it on.
--
-- It keeps calling the GATED fms_dispatch_is_step_owner, exactly as the original
-- body did, so behaviour is unchanged: can_act already applies module_can_edit
-- above this, and a person with no edit grant could not act either way.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_is_natural_step_owner(p_step_key text, p_order uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_location uuid;
begin
  select o.location_id into v_location from public.fms_dispatch_orders o where o.id = p_order;
  -- A null location (a legacy order, or a company with no sites) is covered by
  -- the fallback grant only - which is what an all-locations owner-set is.
  return public.fms_dispatch_is_step_owner(p_step_key, p_uid, v_location);
end $$;

comment on function public.fms_dispatch_is_natural_step_owner(text, uuid, uuid) is
  'Who owns this step of this order when nobody has been assigned it - the step owners configured for the order''s LOCATION, plus any all-locations row. Excludes the admin/coordinator arm: that is authority, not ownership.';

grant execute on function public.fms_dispatch_is_natural_step_owner(text, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. can_act__ungated — the assignee rule.
--
--    ONE delta: an assignee check after the admin/coordinator arm, with the rest
--    delegated to the helper above.
--
--    ⚠ The assignee REPLACES the location-scoped owner rather than joining them.
--      An OR would be a SHARE: the step would stay in that location owner's queue
--      too and nothing would have moved.
--
--    Signature unchanged. fms_dispatch_can_act is NOT touched and still opens
--    with module_can_edit(p_uid,'order-to-dispatch'), so a receiver without an
--    edit grant is refused by the DATABASE. Setup warns about that.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_can_act__ungated(p_step_key text, p_order uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_assignee uuid;
begin
  if public.is_admin(p_uid) or public.fms_dispatch_is_coordinator(p_uid) then
    return true;
  end if;

  if p_order is not null then
    select assigned_to into v_assignee
      from public.fms_dispatch_step_assignees
     where order_id = p_order and step_key = p_step_key;
    if v_assignee is not null then
      return v_assignee = p_uid;
    end if;
  end if;

  return public.fms_dispatch_is_natural_step_owner(p_step_key, p_order, p_uid);
end $$;


-- ---------------------------------------------------------------------------
-- 5. The orders read policy — admit the assignee.
--
--    ⚠ WITHOUT THIS THE FEATURE IS A DEAD END, for the reason it was in every
--      other module: the module arm is module_is_viewer, i.e.
--      `module_level(...) = 'view'` EXACTLY, so a receiver holding an *edit*
--      grant who owns no step at the order's location matches nothing and the
--      order does not load.
--
--    ONE arm added; the previous expression is this minus the
--    fms_dispatch_step_assignees exists() clause.
-- ---------------------------------------------------------------------------
alter policy fms_dispatch_orders_select on public.fms_dispatch_orders
  using (
    auth.uid() is not null
    and (
      public.is_admin(auth.uid())
      or public.fms_dispatch_is_coordinator(auth.uid())
      or raised_by = auth.uid()
      or public.module_is_viewer(auth.uid(), 'order-to-dispatch')
      or exists (
        select 1 from public.fms_dispatch_step_owners o
         where auth.uid() = any(o.employee_ids)
           and (o.location_id is null or o.location_id = fms_dispatch_orders.location_id)
      )
      or exists (
        select 1 from public.fms_dispatch_step_assignees a
         where a.order_id = fms_dispatch_orders.id and a.assigned_to = auth.uid()
      )
    )
  );


-- ---------------------------------------------------------------------------
-- 6. Reassign a step (or take it back).
--
-- p_assignee NULL = return it to the step's location-scoped owners.
--
-- WHO MAY CALL IT is broader than who may act: the location's owner keeps the
-- right to pull a step back after passing it on. The module gate is applied to
-- the caller here too, as fms_dispatch_can_act does, so this is not a way round it.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_reassign_step(
  p_order    uuid,
  p_step_key text,
  p_assignee uuid default null,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_exists   boolean;
  v_assignee uuid;
begin
  if not public.module_can_edit(v_uid, 'order-to-dispatch') then
    raise exception 'Not authorized to reassign this step';
  end if;

  select true into v_exists from public.fms_dispatch_orders where id = p_order for update;
  if not coalesce(v_exists, false) then raise exception 'Order not found'; end if;

  select assigned_to into v_assignee from public.fms_dispatch_step_assignees
   where order_id = p_order and step_key = p_step_key;

  if not (public.is_admin(v_uid)
          or public.fms_dispatch_is_coordinator(v_uid)
          or (v_assignee is not null and v_assignee = v_uid)
          or public.fms_dispatch_is_natural_step_owner(p_step_key, p_order, v_uid)) then
    raise exception 'Not authorized to reassign this step';
  end if;

  if p_assignee is null then
    delete from public.fms_dispatch_step_assignees
     where order_id = p_order and step_key = p_step_key;
    return;
  end if;

  if p_assignee = v_uid then
    raise exception 'Pick someone else — a step cannot be reassigned to yourself';
  end if;

  if not (public.fms_dispatch_can_receive_reassignment(p_assignee)
          or public.fms_dispatch_is_natural_step_owner(p_step_key, p_order, p_assignee)) then
    raise exception 'That person may not receive a step. Add them in Setup, under Reassignment, first.';
  end if;

  insert into public.fms_dispatch_step_assignees (order_id, step_key, assigned_to, assigned_by, note)
  values (p_order, p_step_key, p_assignee, v_uid, nullif(btrim(p_note), ''))
  on conflict (order_id, step_key) do update
    set assigned_to = excluded.assigned_to,
        assigned_by = excluded.assigned_by,
        assigned_at = now(),
        note        = excluded.note;
end $$;

comment on function public.fms_dispatch_reassign_step(uuid, text, uuid, text) is
  'Reassign ONE step of ONE order to another person, or pass NULL to return it to the step''s location-scoped owners. Callable by an admin, a coordinator, one of those owners, or the current assignee, and only by someone with order-to-dispatch edit access. Does not announce - the store raises the notification client-side.';

grant execute on function public.fms_dispatch_reassign_step(uuid, text, uuid, text) to authenticated;

commit;
