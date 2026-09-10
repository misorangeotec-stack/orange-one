-- R6 · The paper numbers carry the month, and the counter restarts each month.
--
--       OTPL/OC/2627/SEP/0001      order confirmation
--       OTPL/QT/2627/SEP/0001      quotation
--
-- WHAT THIS REPLACES
--   OC        OTPL/OC/22/26-27      serial first, unpadded, year last
--   Quotation QT-M0067              minted INLINE, with no helper of its own
--
-- ⚠ THIS MOVES AWAY FROM BUSHRA'S PAPER REGISTER, AND THAT WAS PUT TO THE CLIENT.
--   OCPI-36 changed the OC format specifically TO MATCH the paper book, where all
--   27 folders in 2026.27 are headed `OTPL/OC/<n>/26-27` (verified by reading
--   folder 109's invoice: "Performa No. OTPL/OC/109/26-27"). Ritesh Bhai was shown
--   that and chose the new format anyway on 07-09-2026. Recorded as a deliberate
--   divergence, not an oversight.
--
-- 🟢 THE CUTOVER IS FREE. No real customer has ever received an order confirmation
--    from this system: all 8 frozen OC papers belong to ZZ TEST deals, and the 11
--    numbers carrying real customer names are the re-typed audit deals, all drafts
--    with no frozen paper. Nothing already issued needs preserving, and old numbers
--    are left exactly as they are.
--
-- 🔴 THE MONTH IS DERIVED IN IST, NEVER IN UTC, AND THIS IS NOT THEORETICAL.
--    Proved on this database before writing:
--
--        2026-09-30 22:30 UTC  ->  month SEP in UTC
--                              ->  month OCT in Asia/Kolkata
--
--    A quotation raised at 04:00 IST on 1 October is 30 September in UTC. A
--    UTC-derived month would stamp it SEP, put an October paper in September's
--    series at counter 0001, and collide with a real September number. The same
--    applies to the FINANCIAL YEAR every 1 April. `fms_ocpi_ist_date()` exists so
--    no caller can get this wrong by reaching for `current_date`.
--
-- THE MONTHLY RESET FALLS OUT OF THE SCOPE STRING
--   `fms_ocpi_next_seq` starts a NEW SCOPE AT 1 with no seeding (see its own note).
--   The scope becomes `oc:2627/SEP` / `qt:2627/SEP`, so October begins at 0001 by
--   construction rather than by a reset job. The old `quotation` and `oc:2627`
--   counters are left in place, unread — deleting them would destroy the record of
--   what was issued under the old format.
--
-- THREE MINT SITES, NOT ONE
--   `fms_ocpi_generate_quotation`  both numbers, the live path
--   `fms_ocpi_decide_quotation`    the OC fallback for pre-OCPI-36 deals
--   `fms_ocpi_submit_oc`           a STALE mint in the pre-OCPI-36 format, on the
--                                  retired `awaiting_order_confirmation` step. It
--                                  has no route, but it is installed and grant-
--                                  executed and burns from the same counter. Left
--                                  alone it would put a THIRD shape on record.
--
-- ⚠ THE BODIES ARE TRANSFORMED FROM `pg_get_functiondef`, NEVER RETYPED. The files
--   in this folder have diverged from what is installed — 20261102120000 records
--   the same caution. Each replacement asserts it actually changed something, so a
--   body that has moved on since this was written fails loudly instead of being
--   silently rewritten from a stale copy.

begin;

-- ---------------------------------------------------------------------------
-- 1 · The two things every caller needs, so none of them can improvise.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_ist_date()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

comment on function public.fms_ocpi_ist_date() is
  'Today in Asia/Kolkata. Every paper number derives its month and financial year from this, never from current_date - see 20261114120004.';

create or replace function public.fms_ocpi_period_code(p_d date)
returns text language sql immutable as $$
  select public.fms_ocpi_fy_code(p_d) || '/' || upper(to_char(p_d, 'MON'));
$$;

comment on function public.fms_ocpi_period_code(date) is
  'The financial year and month a paper number belongs to, e.g. 2627/SEP. Also the counter scope suffix, which is what makes the counter restart monthly.';

-- ---------------------------------------------------------------------------
-- 2 · The shape helpers. `fms_ocpi_oc_no` KEEPS ITS SIGNATURE (integer, text) so
--     no overload is created — PGRST203 is the failure that avoids — but its
--     second argument is now the PERIOD rather than the financial year.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ocpi_oc_no(p_seq integer, p_period text)
returns text language sql immutable as $$
  select 'OTPL/OC/' || p_period || '/' || lpad(p_seq::text, 4, '0');
$$;

create or replace function public.fms_ocpi_qt_no(p_seq integer, p_period text)
returns text language sql immutable as $$
  select 'OTPL/QT/' || p_period || '/' || lpad(p_seq::text, 4, '0');
$$;

grant execute on function public.fms_ocpi_period_code(date) to authenticated;
grant execute on function public.fms_ocpi_ist_date() to authenticated;
grant execute on function public.fms_ocpi_qt_no(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3 · The three mint sites, transformed rather than retyped.
-- ---------------------------------------------------------------------------
do $rewrite$
declare
  v_src  text;
  v_new  text;
  v_hits int;
begin
  ------------------------------------------------------------------ quotation
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_generate_quotation';

  -- The quotation mint runs BEFORE v_fy is assigned, so it derives its own period.
  v_new := replace(v_src,
    'v_no := ''QT-M'' || lpad(public.fms_ocpi_next_seq(''quotation'')::text, 4, ''0'');',
    'v_no := public.fms_ocpi_qt_no('
    || 'public.fms_ocpi_next_seq(''qt:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date())), '
    || 'public.fms_ocpi_period_code(public.fms_ocpi_ist_date()));');
  if v_new = v_src then
    raise exception 'R6: the quotation mint in fms_ocpi_generate_quotation did not match - re-read the installed body';
  end if;

  -- v_fy now carries the PERIOD, so the existing OC mint line needs no edit.
  v_src := v_new;
  v_new := replace(v_src,
    'v_fy := public.fms_ocpi_fy_code(current_date);',
    'v_fy := public.fms_ocpi_period_code(public.fms_ocpi_ist_date());');
  if v_new = v_src then
    raise exception 'R6: the financial-year assignment in fms_ocpi_generate_quotation did not match';
  end if;
  execute v_new;

  ----------------------------------------------------------- decide_quotation
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_decide_quotation';
  v_new := replace(v_src,
    'v_fy := public.fms_ocpi_fy_code(current_date);',
    'v_fy := public.fms_ocpi_period_code(public.fms_ocpi_ist_date());');
  if v_new = v_src then
    raise exception 'R6: the financial-year assignment in fms_ocpi_decide_quotation did not match';
  end if;
  execute v_new;

  ------------------------------------------------------------------ submit_oc
  -- The stale pre-OCPI-36 mint. Replaced with the helper so it cannot put a third
  -- shape on record if the retired step is ever reached.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_submit_oc';
  v_new := regexp_replace(v_src,
    'v_oc := ''OTPL/OC/'' \|\| public\.fms_ocpi_fy_code\(current_date\) \|\| ''/'' \|\|\s*lpad\(public\.fms_ocpi_next_seq\(''oc:'' \|\| public\.fms_ocpi_fy_code\(current_date\)\)::text, 4, ''0''\);',
    'v_oc := public.fms_ocpi_oc_no(public.fms_ocpi_next_seq(''oc:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date())), public.fms_ocpi_period_code(public.fms_ocpi_ist_date()));');
  if v_new = v_src then
    raise exception 'R6: the stale mint in fms_ocpi_submit_oc did not match';
  end if;
  execute v_new;
end $rewrite$;

-- ---------------------------------------------------------------------------
-- 4 · The series setters must target the scope the mint now reads, or they write
--     to a counter nothing consumes — an orphan by construction.
--
--     ⚠ A monthly counter makes "set the series forward" largely historical: the
--       reason it existed was that the paper book ran ahead of ours, and a month
--       that starts at 0001 cannot run behind. The functions stay because the
--       settings screens call them and the confirmation flag still drives the
--       "series has not been confirmed" warning.
-- ---------------------------------------------------------------------------
do $setters$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_set_oc_series';
  v_new := replace(v_src, 'v_scope := ''oc:'' || v_fy;',
                          'v_scope := ''oc:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date());');
  -- its default financial year came from UTC current_date too, and 1 April is the
  -- same trap as the month boundary.
  v_new := replace(v_new, 'public.fms_ocpi_fy_code(current_date)',
                          'public.fms_ocpi_fy_code(public.fms_ocpi_ist_date())');
  if v_new = v_src then raise exception 'R6: fms_ocpi_set_oc_series scope line did not match'; end if;
  execute v_new;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_set_quotation_series';
  v_new := replace(v_src, 'where scope = ''quotation''',
                          'where scope = ''qt:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date())');
  v_new := replace(v_new, 'values (''quotation'', p_last_used)',
                          'values (''qt:'' || public.fms_ocpi_period_code(public.fms_ocpi_ist_date()), p_last_used)');
  if v_new = v_src then raise exception 'R6: fms_ocpi_set_quotation_series scope lines did not match'; end if;
  execute v_new;
end $setters$;

-- ---------------------------------------------------------------------------
-- Post-flight
-- ---------------------------------------------------------------------------
do $post$
declare
  v_period text := public.fms_ocpi_period_code(public.fms_ocpi_ist_date());
  v_oc     text;
  v_qt     text;
  v_n      int;
begin
  if v_period !~ '^[0-9]{4}/[A-Z]{3}$' then
    raise exception 'R6 post 1: the period code is malformed: %', v_period;
  end if;

  v_oc := public.fms_ocpi_oc_no(1, v_period);
  v_qt := public.fms_ocpi_qt_no(1, v_period);
  if v_oc !~ '^OTPL/OC/[0-9]{4}/[A-Z]{3}/[0-9]{4}$' then
    raise exception 'R6 post 2: the OC shape is wrong: %', v_oc;
  end if;
  if v_qt !~ '^OTPL/QT/[0-9]{4}/[A-Z]{3}/[0-9]{4}$' then
    raise exception 'R6 post 3: the quotation shape is wrong: %', v_qt;
  end if;

  -- No mint site still carries the old shapes.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not in ('fms_ocpi_oc_no', 'fms_ocpi_qt_no')   -- the shape helpers own the literal
     and (p.prosrc like '%''QT-M''%' or p.prosrc like '%''OTPL/OC/''%');
  if v_n <> 0 then
    raise exception 'R6 post 4: % function(s) outside the shape helpers still build a number by hand', v_n;
  end if;

  -- Every mint now goes through the IST helper.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_ocpi_generate_quotation','fms_ocpi_decide_quotation','fms_ocpi_submit_oc')
     and p.prosrc like '%fms_ocpi_period_code(public.fms_ocpi_ist_date())%';
  if v_n <> 3 then
    raise exception 'R6 post 5: expected all 3 mint sites on the IST period helper, found %', v_n;
  end if;

  -- Nothing reaches for current_date in a mint any more.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_ocpi_generate_quotation','fms_ocpi_decide_quotation','fms_ocpi_submit_oc',
                       'fms_ocpi_set_oc_series','fms_ocpi_set_quotation_series')
     and p.prosrc like '%fms_ocpi_fy_code(current_date)%';
  if v_n <> 0 then
    raise exception 'R6 post 6: % function(s) still derive the year from UTC current_date', v_n;
  end if;
end $post$;

commit;
