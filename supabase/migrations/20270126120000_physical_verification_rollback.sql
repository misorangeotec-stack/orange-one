-- Reverses 20270126120000_physical_verification.sql. Drops every count taken — export the
-- history from the app first if it is needed.

begin;

drop function if exists public.pv_review(uuid[], text, text);
drop function if exists public.pv_save_counts(jsonb, boolean);
drop function if exists public.pv_unschedule(uuid[]);
drop function if exists public.pv_schedule(jsonb, date, uuid);
drop function if exists public.pv_can_schedule(uuid);

drop table if exists public.pv_activity;
drop table if exists public.pv_counts;
drop table if exists public.pv_settings;

commit;
