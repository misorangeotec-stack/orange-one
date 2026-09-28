-- ROLLBACK for 20261114120004 - back to the OCPI-36 shapes.
--
--   OC        OTPL/OC/<seq>/<yy>-<yy>     serial first, unpadded
--   Quotation QT-M<seq padded to 4>       minted inline, no helper
--
-- ⚠ ROLL THE FRONTEND BACK WITH IT. lib/format.ts, ocpiFetch.ts and the two
--   Settings sections all speak in PERIODS after R6; against the restored SQL
--   they would name a counter scope (`oc:2627/SEP`) that nothing mints into, and
--   the Settings screens would report "none yet this month" forever.
--
-- ⚠ NUMBERS ALREADY MINTED UNDER R6 ARE NOT REWRITTEN, and must not be. A paper
--   keeps the number it was issued under - the same rule that left the
--   pre-OCPI-36 `OTPL/OC/2627/0001..0008` alone. Expect the register to show the
--   R6 shape on anything raised while it was live.
--
-- ⚠ THE MONTHLY COUNTER ROWS ARE LEFT IN PLACE (`oc:2627/SEP`, `qt:2627/SEP`).
--   Deleting them would destroy the record of what was issued that month, and
--   they cost nothing unread.
--
-- The bodies are transformed back from pg_get_functiondef, the same way they were
-- transformed forward, and each replacement asserts it changed something.

begin;

do $back$
declare v_src text; v_new text;
begin
  ----------------------------------------------------------- generate_quotation
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_generate_quotation';
  v_new := replace(v_src,
    'v_no := public.fms_ocpi_qt_no(public.fms_ocpi_next_seq(''qt:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date())), public.fms_ocpi_period_code(public.fms_ocpi_ist_date()));',
    'v_no := ''QT-M'' || lpad(public.fms_ocpi_next_seq(''quotation'')::text, 4, ''0'');');
  v_new := replace(v_new,
    'v_fy := public.fms_ocpi_period_code(public.fms_ocpi_ist_date());',
    'v_fy := public.fms_ocpi_fy_code(current_date);');
  if v_new = v_src then raise exception 'R6 rollback: generate_quotation did not match'; end if;
  execute v_new;

  ------------------------------------------------------------- decide_quotation
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_decide_quotation';
  v_new := replace(v_src,
    'v_fy := public.fms_ocpi_period_code(public.fms_ocpi_ist_date());',
    'v_fy := public.fms_ocpi_fy_code(current_date);');
  if v_new = v_src then raise exception 'R6 rollback: decide_quotation did not match'; end if;
  execute v_new;

  -------------------------------------------------------------------- submit_oc
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_submit_oc';
  v_new := replace(v_src,
    'v_oc := public.fms_ocpi_oc_no(public.fms_ocpi_next_seq(''oc:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date())), public.fms_ocpi_period_code(public.fms_ocpi_ist_date()));',
    'v_oc := ''OTPL/OC/'' || public.fms_ocpi_fy_code(current_date) || ''/'' || lpad(public.fms_ocpi_next_seq(''oc:'' || public.fms_ocpi_fy_code(current_date))::text, 4, ''0'');');
  if v_new = v_src then raise exception 'R6 rollback: submit_oc did not match'; end if;
  execute v_new;

  ---------------------------------------------------------------- the two setters
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_set_oc_series';
  v_new := replace(v_src,
    'v_scope := ''oc:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date());',
    'v_scope := ''oc:'' || v_fy;');
  v_new := replace(v_new, 'public.fms_ocpi_fy_code(public.fms_ocpi_ist_date())',
                          'public.fms_ocpi_fy_code(current_date)');
  if v_new = v_src then raise exception 'R6 rollback: set_oc_series did not match'; end if;
  execute v_new;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_set_quotation_series';
  v_new := replace(v_src,
    'where scope = ''qt:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date())',
    'where scope = ''quotation''');
  v_new := replace(v_new,
    'values (''qt:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date()), p_last_used)',
    'values (''quotation'', p_last_used)');
  if v_new = v_src then raise exception 'R6 rollback: set_quotation_series did not match'; end if;
  execute v_new;
end $back$;

-- The shape helper goes back to the OCPI-36 form. Dropped rather than replaced
-- for the same reason it was dropped going forward: the parameter is named again.
drop function if exists public.fms_ocpi_oc_no(integer, text);
create function public.fms_ocpi_oc_no(p_seq integer, p_fy text)
returns text language sql immutable as $fn$
  select 'OTPL/OC/' || p_seq::text || '/' || left(p_fy, 2) || '-' || right(p_fy, 2);
$fn$;
grant execute on function public.fms_ocpi_oc_no(integer, text) to authenticated;

drop function if exists public.fms_ocpi_qt_no(integer, text);

-- `fms_ocpi_ist_date` and `fms_ocpi_period_code` are LEFT IN PLACE. Nothing else
-- calls them, they are additive, and the IST rule they exist to enforce is
-- correct regardless of the number format.

do $post$
declare v_n int;
begin
  if public.fms_ocpi_oc_no(9, '2627') <> 'OTPL/OC/9/26-27' then
    raise exception 'R6 rollback: the OCPI-36 shape was not restored (got %)', public.fms_ocpi_oc_no(9, '2627');
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%fms_ocpi_qt_no%';
  if v_n <> 0 then raise exception 'R6 rollback: % function(s) still call fms_ocpi_qt_no', v_n; end if;
end $post$;

commit;
