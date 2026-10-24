-- Rollback for 20270105120000: user_module_usage exactly as it was live on 05-10-2026.
--

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
      select cc.table_name, cc.column_name,
             left(cc.column_name, length(cc.column_name) - 3) || '_at' as at_col
        from information_schema.columns cc
        join information_schema.tables tt
          on tt.table_schema = cc.table_schema and tt.table_name = cc.table_name
         and tt.table_type = 'BASE TABLE'
       where cc.table_schema = 'public'
         and cc.data_type = 'uuid'
         and cc.column_name like '%\_by'
         and exists (select 1 from information_schema.columns c2
                      where c2.table_schema = 'public' and c2.table_name = cc.table_name
                        and c2.column_name = left(cc.column_name, length(cc.column_name) - 3) || '_at'
                        and c2.data_type like 'timestamp%')
         and exists (select 1 from unnest(r.prefixes) p where cc.table_name like p || '%')
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
