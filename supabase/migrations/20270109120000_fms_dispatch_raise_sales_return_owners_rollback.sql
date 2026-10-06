-- Rollback of 20270109120000_fms_dispatch_raise_sales_return_owners.sql
--
-- Takes the 'sales_return_request' arm back out of
-- fms_dispatch_request_round_return. Any owner rows saved in Setup for that key
-- are left in fms_dispatch_step_owners (harmless: nothing reads them once the
-- frontend is rolled back too); delete them by hand if wanted:
--   delete from public.fms_dispatch_step_owners where step_key = 'sales_return_request';
begin;

do $patch$
declare
  src  text := pg_get_functiondef('public.fms_dispatch_request_round_return(uuid,integer,jsonb)'::regprocedure);
  a1   text := $a$               or public.fms_dispatch_can_act('sales_return_request', p_order, v_uid)
               or public.fms_dispatch_can_act('sales_return', p_order, v_uid))) then$a$;
  b1   text := $b$               or public.fms_dispatch_can_act('sales_return', p_order, v_uid))) then$b$;
  a2   text := $a$'Only the person who raised this order, a Raise Sales Return or Sales Return owner, a coordinator or an admin can raise a sales return'$a$;
  b2   text := $b$'Only the person who raised this order, a Sales Return owner, a coordinator or an admin can raise a sales return'$b$;
begin
  if position(a1 in src) = 0 then
    raise notice 'fms_dispatch_request_round_return has no Raise Sales Return arm - nothing to roll back';
    return;
  end if;
  execute replace(replace(src, a1, b1), a2, b2);
end
$patch$;

commit;
