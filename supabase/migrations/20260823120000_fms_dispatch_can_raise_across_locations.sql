-- ===========================================================================
-- WHO MAY RAISE AN ORDER, once ownership is kept per location.
--
-- WHY
--   `fms_dispatch_can_raise` read the origin step's owner-set with a SCALAR
--   subquery — `(select cardinality(o.employee_ids) = 0 or p_uid = any(...)
--   from fms_dispatch_step_owners o where o.step_key = 'sales_order')` — written
--   when a step had exactly ONE owner row for the whole business.
--
--   Location-scoped ownership (20260820120000) made step_key repeat by design:
--   one fallback row plus one row per location. From the second row onwards that
--   subquery had more than one answer, so Postgres aborted it with
--
--       more than one row returned by a subquery used as an expression
--
--   and because can_raise is the FIRST thing fms_dispatch_submit_order does,
--   every "Raise order" died on that message under the form. Not a permission
--   refusal — a crash. Nobody could raise an order at any location.
--
-- WHAT IT NOW MEANS. Any owner-set on the origin step, at ANY location, may
-- raise. That is deliberate and unchanged in intent: the site is chosen ON the
-- form, so there is nothing to scope against until the order exists, and
-- fms_dispatch_submit_order then validates that site against the billing
-- company. It is also exactly what the UI already computes (the union of every
-- sales_order row's employees, store.tsx), so the button and the server agree
-- again instead of the button offering work the server cannot accept.
--
-- ⚠ "NO OWNERS CONFIGURED" STILL MEANS OPEN TO EVERY GRANTED USER. The old
--   scalar form fell through to `true` when no row existed, and a row carrying
--   an empty employee list said the same thing. Both readings survive: only a
--   step that names at least one employee somewhere restricts anyone.
-- ===========================================================================

create or replace function public.fms_dispatch_can_raise(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select public.fms_dispatch_is_coordinator(p_uid)
     -- Nobody named on the origin step at any location: unconfigured, so open.
     or not exists (
       select 1 from public.fms_dispatch_step_owners o
        where o.step_key = 'sales_order'
          and cardinality(o.employee_ids) > 0
     )
     -- Otherwise: named on any one of the origin step's owner-sets.
     or exists (
       select 1 from public.fms_dispatch_step_owners o
        where o.step_key = 'sales_order'
          and p_uid = any(o.employee_ids)
     );
$function$;

comment on function public.fms_dispatch_can_raise(uuid) is
  'May this user raise a sales order? Reads EVERY sales_order owner-set, not one '
  'row: ownership is per location and the step legitimately has several. '
  'Location-agnostic on purpose - the dispatch site is chosen on the form.';

-- ---------------------------------------------------------------- asserts --
do $check$
declare v_uid uuid; v_rows integer; v_configured boolean;
begin
  select count(*) into v_rows
    from public.fms_dispatch_step_owners where step_key = 'sales_order';

  select exists (
    select 1 from public.fms_dispatch_step_owners
     where step_key = 'sales_order' and cardinality(employee_ids) > 0
  ) into v_configured;

  -- THE BUG ITSELF: the call must survive a step that owns rows at several
  -- locations. Before this migration these two lines raised 21000.
  if public.fms_dispatch_can_raise('00000000-0000-0000-0000-000000000000'::uuid) is null then
    raise exception 'can_raise returned null';
  end if;
  if v_configured
     and public.fms_dispatch_can_raise('00000000-0000-0000-0000-000000000000'::uuid) then
    raise exception 'can_raise let an unnamed user through while origin owners are configured';
  end if;

  -- ...and a configured owner must still be let in, at whichever location their
  -- row happens to sit.
  select o.employee_ids[1] into v_uid
    from public.fms_dispatch_step_owners o
   where o.step_key = 'sales_order' and cardinality(o.employee_ids) > 0
   order by o.location_id nulls last
   limit 1;
  if v_uid is not null and not public.fms_dispatch_can_raise(v_uid) then
    raise exception 'a configured origin-step owner can no longer raise an order';
  end if;

  raise notice 'can_raise now reads all % sales_order owner-set(s)', v_rows;
end $check$;
