-- HD-14 · No fms_help_* function writes an em dash into anything a person reads.
--
-- Run it against the live database at any time. It reads the catalogue and
-- writes nothing, so it needs no transaction and no test data.
--
-- What counts as "a person reads it": a notification title (the bell, and the
-- mail subject once the email gate is opened), an error message raised to a
-- toast, and an activity line. What does not: a comment inside the function,
-- which is why both comment forms are excluded below.
--
-- ⚠ THE NEGATIVE CONTROL THAT MAKES THIS WORTH RUNNING. Before the migration
--   landed, this same query counted 20. If it ever reports 0 for a module that
--   has no functions at all, the LIKE pattern is wrong and the pass is vacuous,
--   so the second block asserts the functions are actually there.

do $hd14$
declare
  v_fns  integer;
  v_bad  text;
  v_n    integer;
begin
  select count(*) into v_fns
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'fms\_help\_%' and p.prokind = 'f';

  if v_fns < 10 then
    raise exception 'HD-14: only % fms_help_* functions found. The pattern is wrong and a pass here would mean nothing', v_fns;
  end if;

  select count(*), string_agg(proname || ': ' || btrim(ln), E'\n')
    into v_n, v_bad
    from (
      select p.proname, l.ln
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       cross join lateral unnest(string_to_array(p.prosrc, E'\n')) as l(ln)
       where n.nspname = 'public'
         and p.proname like 'fms\_help\_%'
         and p.prokind = 'f'
    ) z
   where ln like '%' || U&'\2014' || '%'
     and btrim(ln) not like '--%'
     and btrim(ln) not like '*%'
     and btrim(ln) not like '/*%';

  if v_n > 0 then
    raise exception 'HD-14 FAILED: % reader-visible em dash(es):%', v_n, E'\n' || v_bad;
  end if;

  raise notice 'HD-14 PASSED: % functions scanned, 0 reader-visible em dashes', v_fns;
end
$hd14$;
