-- user_module_usage: find the actor/timestamp column pairs in pg_catalog, not information_schema.
--
-- WHY: ~2.2 s of the ~2.35 s this function took per person was the discovery
--   query walking information_schema, once per module per person. The 09:00
--   work-snapshot mail calls it (via user_snapshot) for every recipient, and from
--   04-10-2026 the run was cut off at its 150 s limit: 52 / 55 mails queued against
--   63-70. Only that one query changes; it returns the same 233 pairs (checked
--   pair for pair against live on 05-10-2026). Everything else is the LIVE body,
--   read off pg_get_functiondef, not restated from an older migration.
--
-- Rollback: 20270105120000_user_module_usage_pg_catalog_rollback.sql

CREATE OR REPLACE FUNCTION public.user_module_usage(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid  uuid := auth.uid();
  v_out  jsonb := '{}'::jsonb;
  v_work timestamptz;
  v_seen timestamptz;
  v_x    timestamptz;
  v_last timestamptz;
  v_src  text;
  r      record;
  c      record;
begin
  if v_uid is not null and v_uid <> p_user_id and not public.is_admin(v_uid) then
    raise exception 'you may only read your own usage';
  end if;

  for r in
    select m.app_id, m.activity_table, m.head_table, m.created_column,
           m.actor_column, coalesce(m.table_prefixes, '{}') as prefixes
      from public.master_report_modules m
     where m.enabled
  loop
    v_work := null;

    -- 1. Every STEP this person has performed anywhere in the module.
    --    The whole codebase pairs an actor column with its own timestamp —
    --    `collected_by`/`collected_at`, `cc_by`/`cc_at`, `sb_by`/`sb_at` — 209
    --    such pairs across 114 tables. That pairing is the precise answer to
    --    "when did they last do something here", and it is the signal the
    --    activity log alone was missing.
    for c in
      --    ⚠ READ OFF pg_catalog, NOT information_schema (20270105120000). The
      --      answer is the same 233 pairs (checked pair for pair), but
      --      information_schema.columns is a privilege-checking view, and walking
      --      it for every module for every person cost ~2.2 s of the ~2.35 s this
      --      function took. The 09:00 work-snapshot calls it once per person, and
      --      from 04-10-2026 that added up past its 150 s limit and the mail was
      --      cut off. relkind r/p is information_schema's BASE TABLE. The alias is
      --      "cls", not "c": c is this loop's own record variable.
      select cls.relname::text as table_name, a.attname::text as column_name,
             left(a.attname, length(a.attname) - 3) || '_at' as at_col
        from pg_catalog.pg_class cls
        join pg_catalog.pg_namespace n on n.oid = cls.relnamespace and n.nspname = 'public'
        join pg_catalog.pg_attribute a
          on a.attrelid = cls.oid and a.attnum > 0 and not a.attisdropped
         and a.atttypid = 'uuid'::regtype
       where cls.relkind in ('r', 'p')
         and a.attname like '%\_by'
         and exists (select 1 from pg_catalog.pg_attribute a2
                      where a2.attrelid = cls.oid and a2.attnum > 0 and not a2.attisdropped
                        and a2.attname = left(a.attname, length(a.attname) - 3) || '_at'
                        and a2.atttypid in ('timestamptz'::regtype, 'timestamp'::regtype))
         and exists (select 1 from unnest(r.prefixes) p where cls.relname like p || '%')
    loop
      begin
        execute format('select max(%I) from public.%I where %I = $1',
                       c.at_col, c.table_name, c.column_name)
          into v_x using p_user_id;
        v_work := greatest(v_work, v_x);
      exception when others then null;   -- a shape we did not expect must not stop the report
      end;
    end loop;

    -- 2. The module's activity log.
    if r.activity_table is not null
       and to_regclass('public.' || quote_ident(r.activity_table)) is not null
       and exists (select 1 from information_schema.columns c2
                    where c2.table_schema = 'public' and c2.table_name = r.activity_table
                      and c2.column_name = 'actor_id')
    then
      begin
        execute format('select max(created_at) from public.%I where actor_id = $1', r.activity_table)
          into v_x using p_user_id;
        v_work := greatest(v_work, v_x);
      exception when others then null;
      end;
    end if;

    -- 3. The head table's author column — the Master Report's own measure, and
    --    the only one for modules with no activity log (Leads, Outstanding).
    if r.head_table is not null and r.actor_column is not null and r.created_column is not null
       and to_regclass('public.' || quote_ident(r.head_table)) is not null
       and exists (select 1 from information_schema.columns c2
                    where c2.table_schema = 'public' and c2.table_name = r.head_table
                      and c2.column_name = r.actor_column)
       and exists (select 1 from information_schema.columns c2
                    where c2.table_schema = 'public' and c2.table_name = r.head_table
                      and c2.column_name = r.created_column)
    then
      begin
        execute format('select max(%I) from public.%I where %I = $1',
                       r.created_column, r.head_table, r.actor_column)
          into v_x using p_user_id;
        v_work := greatest(v_work, v_x);
      exception when others then null;
      end;
    end if;

    -- 4. Page opens. Empty until the portal shell ships the ping; it can only
    --    ever move the answer forward, never back.
    select max(mv.last_at) into v_seen
      from public.module_visits mv
     where mv.user_id = p_user_id and mv.app_id = r.app_id;

    v_last := greatest(v_work, v_seen);

    if v_last is not null then
      v_src := case when v_seen is not null and (v_work is null or v_seen >= v_work)
                    then 'visit' else 'work' end;
      v_out := v_out || jsonb_build_object(
        r.app_id, jsonb_build_object('last_at', v_last, 'source', v_src));
    end if;
  end loop;

  return v_out;
end $function$;
