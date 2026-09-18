-- ROLLBACK for 20261127120000_cc1_fms_ranking.sql (CC-1 · the monthly ranking).
--
-- Removes only what that migration added. No existing table, column or row is touched.
-- ⚠ It DELETES every ranking computed so far, frozen months included — the employees
--   of the month go with it. Take a copy of fms_rank_scores / fms_rank_steps first if
--   the history matters. If the nightly schedule was armed, unschedule it FIRST
--   (…_cc1_fms_ranking_nightly_rollback.sql), or the job will fail every night.
--
-- DROP fires no row or statement trigger, so the frozen-month guards do not stop it.

drop function if exists public.fms_rank_kick();
drop function if exists private.fms_ranking_url();

drop function if exists public.fms_rank_set_module(text, boolean);
drop function if exists public.fms_rank_include(uuid);
drop function if exists public.fms_rank_exclude(uuid, text);
drop function if exists public.fms_rank_rescore_current();
drop function if exists public.fms_rank_my_steps(date, uuid);
drop function if exists public.fms_rank_wall();
drop function if exists public.fms_rank_board(date);
drop function if exists public.fms_rank_can_view(uuid);
drop function if exists public.fms_rank_finish(date, boolean, uuid, text[]);
drop function if exists public.fms_rank_rescore(date);
drop function if exists public.fms_rank_put_module(date, text, jsonb, jsonb, uuid);

drop table if exists public.fms_rank_history;
drop table if exists public.fms_rank_scores;
drop table if exists public.fms_rank_steps;
drop table if exists public.fms_rank_months;
drop table if exists public.fms_rank_exclusions;
drop table if exists public.fms_rank_modules;

drop function if exists public.fms_rank_truncate_guard();
drop function if exists public.fms_rank_month_guard();
drop function if exists public.fms_rank_frozen_guard();
