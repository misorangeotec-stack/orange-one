-- ===========================================================================
-- ROLLBACK of 20270217120000_fund_flow.sql
--
-- DESTROYS EVERY FUND FLOW LINE, APPROVAL AND THE CHANGE LOG. The budget figures were
-- typed by the accounts team and approved by the CFO; they exist nowhere else once the
-- Excel cashflow is retired. Export before running:
--
--   copy (select * from public.v_fund_flow_line order by month, head, sort_order) to stdout with csv header;
--   copy (select * from public.fund_flow_log order by at) to stdout with csv header;
--
-- profiles.fund_flow_role is left in place (additive-only rule): it is a nullable column
-- that nothing reads once the functions are gone. Drop it by hand if wanted.
-- ===========================================================================

drop trigger if exists fund_flow_line_propagate on public.fund_flow_line;

-- Reminders and change alerts. The 'fund_flow' notification_type label cannot be dropped (an enum
-- label never can); unused, it is harmless. notifications.message / .link are dropped only once no
-- row uses them, so another module's notices are never lost.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j) from unnest(array['fund-flow-housekeep', 'fund-flow-morning',
      'fund-flow-digest-4pm', 'fund-flow-digest-7pm']) j
     where exists (select 1 from cron.job where jobname = j);
  end if;
end $cron$;
delete from public.notifications where type::text = 'fund_flow';
do $cols$
begin
  if not exists (select 1 from public.notifications where message is not null or link is not null) then
    alter table public.notifications drop column if exists message, drop column if exists link;
  end if;
end $cols$;
drop function if exists public.ff_notify_run(text, timestamptz);
drop function if exists public.ff_log_line(public.fund_flow_log);
drop function if exists public.ff_amt(text);
drop function if exists public.ff_bank_check(date, date);
drop trigger if exists fund_flow_log_by_name on public.fund_flow_log;
drop function if exists public.ff_log_by_name();
drop function if exists public.ff_notify_once(text, uuid[], text, text[]);
drop function if exists public.ff_month_points(date);
drop function if exists public.ff_notify(uuid[], text, text[], uuid);
drop function if exists public.ff_prev_working_day(date);
drop function if exists public.ff_editor_names();
drop function if exists public.ff_users(text);
drop function if exists public.ff_final_approve(date, text);
drop table if exists public.fund_flow_notice_sent;

drop function if exists public.ff_bank_position(date);
drop function if exists public.ff_set_month(date, numeric, numeric, text);
drop function if exists public.ff_approve_plan(date);
drop function if exists public.ff_approve(date, jsonb);
drop function if exists public.ff_save_lines(date, jsonb);
drop function if exists public.ff_housekeep();
drop function if exists public.ff_reopen_month(date, text);
drop function if exists public.ff_close_month(date, text);
drop function if exists public.ff_open_month(date);
drop function if exists public.ff_line_propagate();
drop function if exists public.ff_sync_child(uuid);
drop function if exists public.ff_is_carry_head(text);
drop function if exists public.ff_assert_can_edit(date, uuid);

drop view if exists public.v_fund_flow_line;
drop function if exists public.ff_line_values(public.fund_flow_line, numeric, boolean);

drop table if exists public.fund_flow_log;
drop table if exists public.fund_flow_line;
drop table if exists public.fund_flow_month;

drop function if exists public.ff_today();
drop function if exists public.ff_month_window(date);
drop function if exists public.ff_role(uuid);

do $check$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name like 'fund_flow%') then
    raise exception 'FF-1 rollback: a fund_flow table survived the drop';
  end if;
end $check$;
