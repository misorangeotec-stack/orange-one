-- ===========================================================================
-- PRODUCTION ENTRY FMS — PEEK the next Lot/Batch (Issue Slip) number.
--
-- The batch number is generated atomically at save (fms_production_next_batch_seq
-- increments the counter). For the intake form we want to SHOW the number that
-- will be issued next WITHOUT consuming it. This read-only helper computes the
-- same value the generator would return next — greatest(last+1, configured start)
-- formatted as YYMM-#### — but does NOT touch the counter.
--
-- SECURITY DEFINER so any authenticated user can preview it (the counters table is
-- admin-select-only under RLS). Purely additive.
-- ===========================================================================

create or replace function public.fms_production_peek_batch_no()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start integer;
  v_last  integer;
  v_next  integer;
begin
  select greatest(coalesce((value->>'start')::integer, 1), 1)
    into v_start
  from public.fms_production_config
  where key = 'batch_seq_start';
  v_start := coalesce(v_start, 1);

  select last_value into v_last from public.fms_production_counters where scope = 'BATCH';

  v_next := greatest(coalesce(v_last, 0) + 1, v_start);
  return to_char(current_date, 'YY') || to_char(current_date, 'MM') || '-' || lpad(v_next::text, 4, '0');
end $$;
grant execute on function public.fms_production_peek_batch_no() to authenticated;
