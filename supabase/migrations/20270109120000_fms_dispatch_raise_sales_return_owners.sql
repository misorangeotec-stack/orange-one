-- ===========================================================================
-- Order to Dispatch · "Raise Sales Return" step owners.
--
-- The sales-return cycle is two steps:
--   7. Raise Sales Return            (owner key 'sales_return_request')
--   8. Generate Sales Return (Tally) (owner key 'sales_return', unchanged)
--
-- Step 7 is owner-only: Setup names who may raise, and the request goes straight
-- to the Tally queue. fms_dispatch_step_owners.step_key is plain text with no
-- CHECK, and fms_dispatch_can_see_order already lets any step's owners read the
-- orders at their location, so the ONLY server change is letting those owners
-- through the permission check in fms_dispatch_request_round_return.
--
-- ⚠ ADDITIVE. The order's raiser, coordinators, admins and the Tally owners keep
--   the right to raise; naming people on step 7 only adds to them (user's
--   decision, 2026-10-05).
--
-- ⚠ PATCHED BY ANCHOR, not restated: reads the live body, replaces the one
--   permission line and the refusal text, and re-creates it. Fails loudly if
--   either anchor is gone rather than silently doing nothing.
--
-- Rollback: 20270109120000_fms_dispatch_raise_sales_return_owners_rollback.sql
-- ===========================================================================
begin;

do $patch$
declare
  src  text := pg_get_functiondef('public.fms_dispatch_request_round_return(uuid,integer,jsonb)'::regprocedure);
  a1   text := $a$               or public.fms_dispatch_can_act('sales_return', p_order, v_uid))) then$a$;
  b1   text := $b$               or public.fms_dispatch_can_act('sales_return_request', p_order, v_uid)
               or public.fms_dispatch_can_act('sales_return', p_order, v_uid))) then$b$;
  a2   text := $a$'Only the person who raised this order, a Sales Return owner, a coordinator or an admin can raise a sales return'$a$;
  b2   text := $b$'Only the person who raised this order, a Raise Sales Return or Sales Return owner, a coordinator or an admin can raise a sales return'$b$;
begin
  if position('sales_return_request' in src) > 0 then
    raise notice 'fms_dispatch_request_round_return already lets Raise Sales Return owners in - nothing to do';
    return;
  end if;
  if position(a1 in src) = 0 or position(a2 in src) = 0 then
    raise exception 'fms_dispatch_request_round_return has changed shape - the permission anchor is gone; patch it by hand';
  end if;
  execute replace(replace(src, a1, b1), a2, b2);
end
$patch$;

-- create or replace keeps the existing grants; restated so the file stands alone.
revoke all on function public.fms_dispatch_request_round_return(uuid, integer, jsonb) from public, anon;
grant execute on function public.fms_dispatch_request_round_return(uuid, integer, jsonb) to authenticated;

commit;
