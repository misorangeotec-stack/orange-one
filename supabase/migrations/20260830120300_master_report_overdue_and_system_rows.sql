-- ===========================================================================
-- MASTER REPORT — two corrections found by reading the first real snapshot.
--
-- 1. "AGEING" WAS BEING READ AS "OVERDUE", AND IT IS NOT.
--    It counts open items whose CREATION date is over 7 days old. For Task
--    Management that read 1,823 — while the number of genuinely late tasks
--    (past due_date) was 2,028. So the column was conceptually wrong AND
--    understated the real backlog by 205.
--
--    `tasks` and `fms_asset_jobs` both store a real due date, so those two now
--    report TRUE overdue. The nine FMS modules genuinely cannot: their due
--    dates are derived per step in TypeScript (lib/sla.ts + fms_*_config) and
--    never stored, so they keep the ageing proxy — but it is now labelled
--    "Open >7d" so nobody reads it as lateness.
--
-- 2. "NEW TODAY" WAS COUNTING THE ROBOT.
--    Task Management showed 66 new today. 65 of those were generated at 06:00
--    by generate_recurring_tasks(); exactly ONE was typed by a person. Over
--    seven days it is 435 generated against 107 human. A director reading
--    "66 new" reasonably assumes 66 people did something, so the two are now
--    counted separately and only the human figure leads.
--
-- Both are driven by new CONFIG COLUMNS, not by hard-coded module names, so a
-- future module declares its own due date / system-row rule in one INSERT.
--
-- Reversal:
--   alter table public.master_report_modules
--     drop column if exists due_column, drop column if exists system_filter;
--   (then re-apply the previous master_report_snapshot definition)
-- ===========================================================================

alter table public.master_report_modules
  add column if not exists due_column    text,
  add column if not exists system_filter text;

comment on column public.master_report_modules.due_column is
  'Stored due date on the head table. Set ONLY where a real one exists — the FMS modules derive theirs in TypeScript, so leaving this null is correct and yields the ageing proxy instead.';
comment on column public.master_report_modules.system_filter is
  'SQL predicate matching rows created by machinery rather than by a person (e.g. recurring task generation). Those are reported separately so adoption is not flattered by a cron job.';

update public.master_report_modules
   set due_column = 'due_date',
       system_filter = 'recurring_task_id is not null'
 where app_id = 'task-management';

update public.master_report_modules
   set due_column = 'due_date'
 where app_id = 'asset-maintenance';

-- ---------------------------------------------------------------------------
-- The snapshot, reissued with `overdue`, the human/system split, and the two
-- capability flags the UI needs to print an em dash instead of a false zero.
-- ---------------------------------------------------------------------------
create or replace function public.master_report_snapshot(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_allowed  boolean;
  v_dormant  int;
  v_include  text[];
  v_days     int := greatest(1, least(coalesce(p_days, 30), 365));
  m          record;
  v_sql      text;
  v_head     jsonb;
  v_act      jsonb;
  v_open     text;
  v_overdue  text;
  v_system   text;
  v_created  text;
  v_tbl      text;
  v_filter   text;
  v_last     timestamptz;
  v_state    text;
  v_rows     jsonb := '[]'::jsonb;
begin
  if v_uid is not null then
    select public.is_admin(v_uid)
        or exists (select 1 from public.app_access a
                    where a.user_id = v_uid and a.app_id = 'master-report')
      into v_allowed;
    if not coalesce(v_allowed, false) then
      raise exception 'you do not have access to the Master Report';
    end if;
  end if;

  select coalesce(s.dormant_after_days, 7), s.include_modules
    into v_dormant, v_include
    from public.master_report_settings s
   where s.id;
  v_dormant := coalesce(v_dormant, 7);

  for m in
    select * from public.master_report_modules
     where enabled
       and (v_include is null or app_id = any(v_include))
     order by sort_order, app_id
  loop
    v_created := quote_ident(m.created_column);
    v_tbl     := quote_ident(m.head_table);
    v_filter  := coalesce(nullif(btrim(coalesce(m.extra_filter, '')), ''), 'true');

    v_open := case
      when m.status_column is null then 'false'
      else format('coalesce(%I::text, '''') <> all (%L::text[])',
                  m.status_column, m.closed_statuses)
    end;

    -- Compared against the IST calendar day, like every other boundary here.
    v_overdue := case
      when m.due_column is null then 'false'
      else format('%I is not null and %I < (now() at time zone ''Asia/Kolkata'')::date',
                  m.due_column, m.due_column)
    end;

    -- `not (false)` is true, so a module with no rule counts everything as human.
    v_system := coalesce(nullif(btrim(coalesce(m.system_filter, '')), ''), 'false');

    begin
      v_sql := format(
        'select jsonb_build_object('
        ||   '''total'', count(*),'
        ||   '''open'', count(*) filter (where %2$s),'
        ||   '''overdue'', count(*) filter (where %2$s and %6$s),'
        ||   '''new_today'', count(*) filter (where (%1$s at time zone ''Asia/Kolkata'')::date'
        ||                   ' = (now() at time zone ''Asia/Kolkata'')::date and not (%7$s)),'
        ||   '''new_today_system'', count(*) filter (where (%1$s at time zone ''Asia/Kolkata'')::date'
        ||                   ' = (now() at time zone ''Asia/Kolkata'')::date and (%7$s)),'
        ||   '''new_7d'', count(*) filter (where %1$s >= now() - interval ''7 days'' and not (%7$s)),'
        ||   '''new_7d_system'', count(*) filter (where %1$s >= now() - interval ''7 days'' and (%7$s)),'
        ||   '''new_window'', count(*) filter (where %1$s >= now() - make_interval(days => %5$s)),'
        ||   '''ageing_open_gt_7d'', count(*) filter (where %2$s and %1$s < now() - interval ''7 days''),'
        ||   '''oldest_open_days'', coalesce(max(case when %2$s'
        ||                   ' then (extract(epoch from (now() - %1$s)) / 86400)::int end), 0)'
        || ') from public.%3$s where %4$s',
        v_created, v_open, v_tbl, v_filter, v_days, v_overdue, v_system);
      execute v_sql into v_head;

      if m.activity_table is not null then
        v_sql := format(
          'select jsonb_build_object('
          ||   '''last_activity_at'', max(created_at),'
          ||   '''active_users_7d'', count(distinct actor_id)'
          ||                   ' filter (where created_at >= now() - interval ''7 days'')'
          || ') from public.%1$s',
          quote_ident(m.activity_table));
      else
        v_sql := format(
          'select jsonb_build_object('
          ||   '''last_activity_at'', max(%1$s),'
          ||   '''active_users_7d'', %2$s'
          || ') from public.%3$s where %4$s',
          v_created,
          case when m.actor_column is null then '0'
               else format('count(distinct %I) filter (where %s >= now() - interval ''7 days'')',
                           m.actor_column, v_created)
          end,
          v_tbl, v_filter);
      end if;
      execute v_sql into v_act;

      v_last := nullif(v_act ->> 'last_activity_at', '')::timestamptz;

      -- Adoption state still counts EVERY new row, generated or not: a module
      -- whose cron is filling it is not dormant, it is simply not being typed
      -- into. The human/system split is reported in the columns, not here.
      v_state := case
        when coalesce((v_head ->> 'total')::bigint, 0) = 0 then 'dormant'
        when v_last is null or v_last < now() - make_interval(days => v_dormant) then 'dormant'
        when coalesce((v_head ->> 'new_window')::bigint, 0) = 0 then 'quiet'
        else 'active'
      end;

      v_rows := v_rows || jsonb_build_array(
        jsonb_build_object(
          'app_id',        m.app_id,
          'label',         m.label,
          'detail_path',   m.detail_path,
          'state',         v_state,
          'tracks_status', m.status_column is not null,
          -- Lets the UI print a true overdue where one exists and an em dash
          -- where the module simply cannot produce it.
          'tracks_due',    m.due_column is not null,
          'has_system',    nullif(btrim(coalesce(m.system_filter, '')), '') is not null
        ) || v_head || v_act);

    exception when others then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'app_id',      m.app_id,
        'label',       m.label,
        'detail_path', m.detail_path,
        'state',       'error',
        'error',       sqlerrm));
    end;
  end loop;

  return jsonb_build_object(
    'generated_at',       now(),
    'window_days',        v_days,
    'dormant_after_days', v_dormant,
    'modules',            v_rows);
end $$;
