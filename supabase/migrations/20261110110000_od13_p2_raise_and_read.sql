-- OD-13 · P2 — a customer may raise an order without becoming a step owner.
--
-- Every rule below is a WIDENING that matches nobody until a customer org is configured on
-- the Setup screen, and there are no orgs yet. Staff behaviour is byte-identical: each change
-- adds a disjunct to an existing predicate and removes none.
--
-- THE PROBLEM THIS SOLVES, AND WHY IT IS TWO PROBLEMS
-- ---------------------------------------------------
-- The obvious way to let a customer raise an order is to name them on the `sales_order` step.
-- That would be wrong twice over: `fms_dispatch_can_see_order` grants a step owner sight of
-- EVERY order at their location, so the customer would read everybody else's; and
-- `fms_dispatch_can_raise__ungated` would then also be satisfied for anyone else named there.
-- So the customer branch is expressed through their own org membership instead, and they never
-- appear in `fms_dispatch_step_owners` at all.
--
-- 🔴 AND THE ORDER IS INVISIBLE TO THE PEOPLE WHO MUST ACT ON IT. Measured on the live
--    database before this migration:
--
--      fms_dispatch_can_see_order(LALIT,    null, <raiser>) = false
--      fms_dispatch_can_see_order(Jayshree, null, <raiser>) = false
--      fms_dispatch_can_see_order(LALIT,    NOIDA,<raiser>) = true
--
--    A customer order has no location until credit check fills it in (P3/P4), and the
--    step-owner arm reads `o.location_id is null or o.location_id = p_location`. With a null
--    location the second half is NULL, so only the all-locations FALLBACK owner-set can match
--    -- and the live `credit_check` fallback row holds ZERO people. Neither credit-check owner
--    is an admin, and `fms_dispatch_config.process_coordinators` does not exist, so there are
--    no coordinators either.
--
--    The order would therefore be raised, saved, and sit in the register visible to nobody who
--    could act on it. Not an error -- an absence. `fms_dispatch_announce` already narrows its
--    recipient list through this very function, so the notification would be dropped too, in
--    silence.
--
--    The fix is a LOCATION-FREE read arm keyed on the customer's named recipients. Decision Q8
--    ("who is notified is a per-customer setting") is what makes it possible to write: the
--    people we name are, by construction, the people who may see it.
--
-- WHAT A CUSTOMER STILL CANNOT DO
-- -------------------------------
-- `fms_dispatch_can_act__ungated` gains the RECIPIENT arm only, never the same-org arm. A
-- customer is not an admin, not a coordinator, never a step assignee and never a natural step
-- owner, so it still returns false for them -- they may raise and read their own orders and
-- nothing else.
--
-- ⚠ AND THE REVERSE, WHICH IS THE PART THAT LEAKS. Twelve `fms_dispatch_announce` call sites
--   write to `array[v_raiser]`, and on a customer order the raiser IS the customer.
--   `fms_dispatch_record_credit_check` posts
--
--       'Credit hold on ' || v_no || ': ' || v_remarks   ->  array_remove(array[v_raiser], null)
--
--   -- our internal credit-hold reason, verbatim, into a row the customer's own
--   `fms_dispatch_notifications_select_own` policy lets them read. That is precisely what
--   decision Q6 exists to prevent. `fms_dispatch_hold_order` and `fms_dispatch_cancel_order` do
--   the same. The filter is applied INSIDE announce, at the single point it builds
--   `v_recipients`, rather than at twelve call sites -- which is what stops the THIRTEENTH from
--   leaking on the day somebody adds it.
--
--   It also closes a second thing quietly: `announce` enqueues `email_outbox` rows for the same
--   recipients. With the allowlist empty, turning the module's email switch on can never post
--   an internal step alert to a customer's inbox.

begin;

-- ---------------------------------------------------------------------------
-- 1 · Two questions, asked in one place each.
-- ---------------------------------------------------------------------------
-- ⚠ DELIBERATELY IGNORES `active`, and that is the whole reason it is separate from
--   fms_dispatch_customer_org_of(). This one answers "whose order is this?" about a raiser,
--   which must keep working after a customer is switched off -- otherwise deactivating a
--   customer would make their entire order history vanish from the staff register.
create or replace function public.fms_dispatch_customer_org_of_login(p_uid uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select l.org_id from public.fms_dispatch_customer_logins l
   where l.profile_id = p_uid
   limit 1;
$fn$;

-- Is p_uid one of the staff we named to hear about this customer's orders?
create or replace function public.fms_dispatch_is_customer_recipient(p_uid uuid, p_raised_by uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1
      from public.fms_dispatch_customer_orgs g
     where g.id = public.fms_dispatch_customer_org_of_login(p_raised_by)
       and p_uid = any (g.notify_user_ids)
  );
$fn$;

-- May p_uid see an order raised by p_raised_by, on customer grounds alone?
-- Returns FALSE for every staff-raised order, so it is a pure widening.
create or replace function public.fms_dispatch_customer_order_visible_to(p_uid uuid, p_raised_by uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select public.fms_dispatch_is_customer_recipient(p_uid, p_raised_by)
      -- ...or another login of the SAME customer. Today that is nobody -- one login per
      -- customer (Q3) -- and `raised_by = auth.uid()` already does the work. This clause is
      -- what means a second person at Bishen sees the same history rather than starting an
      -- empty one, on the day they are given a login.
      or (
        public.fms_dispatch_customer_org_of(p_uid) is not null
        and public.fms_dispatch_customer_org_of(p_uid)
            = public.fms_dispatch_customer_org_of_login(p_raised_by)
      );
$fn$;

-- ---------------------------------------------------------------------------
-- 2 · Raising.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_can_raise(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select case
    when public.fms_dispatch_customer_org_of(p_uid) is not null
      -- A customer holds `customer-orders` and nothing else. They are never asked whether
      -- they are a `sales_order` step owner, because they must never be one.
      then public.module_can_edit(p_uid, 'customer-orders')
    else
      public.module_can_edit(p_uid, 'order-to-dispatch')
      and public.fms_dispatch_can_raise__ungated(p_uid)
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3 · Reading — the function and the policy, kept in step by construction.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_can_see_order(p_uid uuid, p_location uuid, p_raised_by uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select p_uid is not null and (
       public.is_admin(p_uid)
    or public.fms_dispatch_is_coordinator(p_uid)
    or p_raised_by = p_uid
    or public.module_is_viewer(p_uid, 'order-to-dispatch')
    or exists (
         select 1 from public.fms_dispatch_step_owners o
          where p_uid = any(o.employee_ids)
            and (o.location_id is null or o.location_id = p_location)
       )
    -- NEW, and location-free on purpose: see the header. Without this the named
    -- recipient is told about an order they cannot open.
    or public.fms_dispatch_customer_order_visible_to(p_uid, p_raised_by)
  );
$fn$;

-- The policy carries one arm the function does not (the per-order step assignee), so it is
-- rewritten rather than replaced by a call. Everything before the last disjunct is the
-- existing text, unchanged.
--
-- ⚠ THE LAST ARM IS SPELLED OUT RATHER THAN CALLING THE FUNCTION ABOVE, AND ON PURPOSE.
--
--   `fms_dispatch_customer_order_visible_to(auth.uid(), raised_by)` takes `raised_by`, which
--   VARIES PER ROW, so it cannot be hoisted into an InitPlan -- it would run two nested
--   SECURITY DEFINER calls for every one of the ~4,000 orders on every read. This repo has
--   already paid for that lesson once: 20260730130000_speed_up_task_rls.sql records the inline
--   form costing 472 ms on a 3,691-row table against 10 ms for the wrapped one.
--
--   Written as an EXISTS, the planner gets a semi-join over two tiny tables, and the only
--   caller-side lookup is wrapped in `(select …)` so it is evaluated ONCE per query. The two
--   spellings are the same rule -- the function is used where there is a single row to judge
--   (can_see_order, can_act, announce), the EXISTS where there are thousands.
alter policy fms_dispatch_orders_select on public.fms_dispatch_orders
  to authenticated
  using (
    (auth.uid() is not null) and (
         is_admin(auth.uid())
      or fms_dispatch_is_coordinator(auth.uid())
      or (raised_by = auth.uid())
      or module_is_viewer(auth.uid(), 'order-to-dispatch')
      or exists (
           select 1 from fms_dispatch_step_owners o
            where (auth.uid() = any (o.employee_ids))
              and ((o.location_id is null) or (o.location_id = fms_dispatch_orders.location_id))
         )
      or exists (
           select 1 from fms_dispatch_step_assignees a
            where a.order_id = fms_dispatch_orders.id and a.assigned_to = auth.uid()
         )
      or exists (
           select 1
             from public.fms_dispatch_customer_logins l
             join public.fms_dispatch_customer_orgs g on g.id = l.org_id
            where l.profile_id = fms_dispatch_orders.raised_by
              and (
                   (select auth.uid()) = any (g.notify_user_ids)
                or g.id = (select public.fms_dispatch_customer_org_of((select auth.uid())))
              )
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 4 · Acting — the recipient arm, placed BEFORE the assignee check.
-- ---------------------------------------------------------------------------
-- The placement is load-bearing. `fms_dispatch_step_assignees` has `unique (order_id,
-- step_key)`, so once ONE person is assigned the assignee branch returns early and every other
-- named recipient is refused. Putting the recipient arm after it would quietly re-create
-- exactly the single-point-of-failure that decision Q8 (a LIST of recipients) exists to avoid.
create or replace function public.fms_dispatch_can_act__ungated(p_step_key text, p_order uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_assignee uuid;
  v_raiser   uuid;
begin
  if public.is_admin(p_uid) or public.fms_dispatch_is_coordinator(p_uid) then
    return true;
  end if;

  -- NEW. Any of the staff named against this customer may act, not merely whoever was
  -- assigned first. Note it grants nothing to the CUSTOMER: is_customer_recipient asks
  -- whether p_uid is on the org's notify list, and a customer never is.
  if p_order is not null then
    select o.raised_by into v_raiser from public.fms_dispatch_orders o where o.id = p_order;
    if v_raiser is not null and public.fms_dispatch_is_customer_recipient(p_uid, v_raiser) then
      return true;
    end if;
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
end $fn$;

-- ---------------------------------------------------------------------------
-- 5 · What the customer is NOT told.
-- ---------------------------------------------------------------------------
create or replace function public.fms_dispatch_announce(
  p_entity_type text, p_entity_id uuid, p_type text, p_text text,
  p_user_ids uuid[] default '{}'::uuid[], p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
  -- ⚠ EMPTY, AND THAT IS THE DECISION, not an oversight.
  --
  --   Release 1 gives the customer no bell and no mail: they read their order's plain status
  --   on their own screen, which is the designed channel and the only one whose wording we
  --   control (decision Q6). Every one of the twelve announcement types is written for US --
  --   "Credit hold on SO-xxxx: <reason>", "held", "resumed", "cancelled" -- and each carries
  --   internal language, internal names, or an internal reason.
  --
  --   Adding a type here is therefore a deliberate act with a customer-facing consequence,
  --   and it should read like one. It also means the module's EMAIL switch can be turned on
  --   by anybody, at any time, without a single internal step alert reaching a customer's
  --   inbox -- which is otherwise a trap nobody would think to check.
  v_customer_safe constant text[] := '{}';
begin
  insert into public.fms_dispatch_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_entity_type = 'order' then
    select o.location_id, o.raised_by into v_location, v_raiser
      from public.fms_dispatch_orders o where o.id = p_entity_id;
    select coalesce(array_agg(x), '{}'::uuid[]) into v_recipients
      from unnest(v_recipients) x
     where public.fms_dispatch_can_see_order(x, v_location, v_raiser);

    -- Drop every EXTERNAL recipient from an announcement type not on the allowlist. Applied
    -- to the recipient rather than to the raiser specifically, so a second login at the same
    -- customer is covered by the same line.
    if not (p_type = any (v_customer_safe)) then
      select coalesce(array_agg(x), '{}'::uuid[]) into v_recipients
        from unnest(v_recipients) x
       where not exists (
         select 1 from public.profiles p where p.id = x and coalesce(p.is_external, false)
       );
    end if;
  end if;

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
end $fn$;

revoke execute on function public.fms_dispatch_customer_org_of_login(uuid)          from public, anon;
revoke execute on function public.fms_dispatch_is_customer_recipient(uuid, uuid)    from public, anon;
revoke execute on function public.fms_dispatch_customer_order_visible_to(uuid,uuid) from public, anon;
grant  execute on function public.fms_dispatch_customer_org_of_login(uuid)          to authenticated, service_role;
grant  execute on function public.fms_dispatch_is_customer_recipient(uuid, uuid)    to authenticated, service_role;
grant  execute on function public.fms_dispatch_customer_order_visible_to(uuid,uuid) to authenticated, service_role;

commit;
