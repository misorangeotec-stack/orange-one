-- ===========================================================================
-- ROLLBACK for 20261224120000_hd10_help_desk_mis.sql
--
-- Four functions, all read-only. Nothing depends on them and no data changes.
--
-- ⚠ fms_help_add_working_days IS NOT DROPPED HERE — it belongs to HD-5, which
--   auto-close also needs. Dropping it from this file would silently break the
--   nightly job.
-- ===========================================================================

begin;

drop function if exists public.fms_help_confidential_register(date, date);
drop function if exists public.fms_help_mis(date, date);
drop function if exists public.fms_help_met_tat(timestamptz, timestamptz, integer);
drop function if exists public.fms_help_may_read_confidential(uuid);
drop function if exists public.fms_help_may_read_mis(uuid);

do $rb$
begin
  if to_regprocedure('public.fms_help_mis(date,date)') is not null
     or to_regprocedure('public.fms_help_confidential_register(date,date)') is not null
     or to_regprocedure('public.fms_help_met_tat(timestamptz,timestamptz,integer)') is not null
     or to_regprocedure('public.fms_help_may_read_mis(uuid)') is not null
     or to_regprocedure('public.fms_help_may_read_confidential(uuid)') is not null then
    raise exception 'rollback left an HD-10 function standing';
  end if;
  -- HD-5's, and auto-close needs it.
  if to_regprocedure('public.fms_help_add_working_days(date,integer)') is null then
    raise exception 'rollback dropped HD-5''s working-day helper — auto-close depends on it';
  end if;
end $rb$;

commit;
