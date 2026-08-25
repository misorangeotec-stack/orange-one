-- ===========================================================================
-- OCPI · the order-confirmation series becomes a setting, like the quotation
-- series already is.
--
-- WHY THIS EXISTS. The OC number has always been a SEPARATE series from the
-- quotation — `OTPL/OC/<fy>/nnnn`, minted at the Directors' approval — but
-- there was no way to see where it stood or to move it, so it silently started
-- at 0001 on a company that has been issuing order confirmations on paper for
-- years. The first OC raised here would then re-issue a number a customer
-- already holds, on the one document in this module that is a CONTRACT. Exactly
-- the failure `fms_ocpi_set_quotation_series` was written to prevent, on the
-- more expensive of the two numbers.
--
-- ⚠ THE OC COUNTER IS PER FINANCIAL YEAR, and the quotation counter is not.
--   `fms_ocpi_counters.scope` is 'quotation' for the one, and 'oc:2627' for the
--   other, because the number carries the FY in it and restarts each April. So
--   this function takes the year it is setting, defaults it to today's, and the
--   forward-only rule applies WITHIN that year — 2728 legitimately starts again
--   at 0001 while 2627 stands at 8.
--
-- ⚠ FORWARD-ONLY, ENFORCED HERE AND NOT IN THE FORM. Raising the number skips
--   values, which costs nothing. Lowering it duplicates a number on a signed
--   contract, and nothing after the fact takes that back.
--
-- Additive only: one new function, one new config key. No table is altered.
--
-- Reversal (reverse order):
--   delete from public.fms_ocpi_config where key = 'oc_series';
--   drop function if exists public.fms_ocpi_set_oc_series(integer, text);
--   -- ⚠ The counter rows themselves are NOT reversed. `fms_ocpi_counters` is
--   --   pre-existing and holds live numbers; dropping a row there would restart
--   --   a series that has already been issued to customers.
-- ===========================================================================

create or replace function public.fms_ocpi_set_oc_series(
  p_last_used integer,
  p_fy        text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_fy      text := coalesce(nullif(btrim(p_fy), ''), public.fms_ocpi_fy_code(current_date));
  v_scope   text;
  v_current integer;
begin
  if not (select public.is_admin(v_uid)) then
    raise exception 'Only an administrator can set the order-confirmation series';
  end if;

  if p_last_used is null or p_last_used < 0 or p_last_used > 9999 then
    -- Four digits, because the number is printed as lpad(...,4,'0').
    raise exception 'The last order-confirmation number used must be between 0 and 9999';
  end if;

  if v_fy !~ '^[0-9]{4}$' then
    raise exception 'The financial year must be four digits, e.g. 2627';
  end if;

  v_scope := 'oc:' || v_fy;

  -- Lock the row so two admins confirming at once cannot interleave with each
  -- other or with a live mint at the approval gate.
  select last_value into v_current
    from public.fms_ocpi_counters
   where scope = v_scope
     for update;

  if v_current is not null and p_last_used < v_current then
    raise exception
      'The order-confirmation series for % is already at %, and it can only move forward. Set % or higher.',
      v_fy, v_current, v_current;
  end if;

  insert into public.fms_ocpi_counters (scope, last_value)
  values (v_scope, p_last_used)
  on conflict (scope) do update
    set last_value = excluded.last_value,
        updated_at = now();

  -- Confirmation is recorded PER YEAR: confirming 2627 says nothing about the
  -- year that starts next April, and the warning must come back when it does.
  insert into public.fms_ocpi_config (key, value)
  values ('oc_series', jsonb_build_object(
    v_fy, jsonb_build_object(
      'confirmed',          true,
      'confirmed_at_value', p_last_used,
      'confirmed_by',       v_uid,
      'confirmed_at',       now()
    )
  ))
  on conflict (key) do update
    set value = public.fms_ocpi_config.value || excluded.value,
        updated_at = now();

  return p_last_used;
end $function$;

grant execute on function public.fms_ocpi_set_oc_series(integer, text) to authenticated;
