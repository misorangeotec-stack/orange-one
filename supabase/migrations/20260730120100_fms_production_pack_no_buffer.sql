-- ===========================================================================
-- PRODUCTION ENTRY FMS — packaging lines: drop the automatic +7% buffer.
--
-- Previously the log-book packaging line total added a 7% wastage buffer on the
-- extra: extra_buffered = round(extra*1.07, 3), total = round(qty + extra*1.07, 3)
-- (see 20260729120300). The floor now enters the Extra manually for most items,
-- and for CAP items the client auto-fills Extra = round(7% of qty). So the server
-- must NOT add 7% again — the line total is simply qty + extra.
--
-- extra_buffered is kept in the stored shape (now = extra, rounded) so the
-- PackingBomLine type and any existing rows stay valid.
--
-- Purely ADDITIVE (CREATE OR REPLACE). Reversal: restore the body from
-- 20260729120300_fms_production_logbook_rework.sql.
-- ===========================================================================

create or replace function public.fms_production_pack_lines(p_lines jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'packaging_item_id', l->>'packaging_item_id',
    'unit_id',           nullif(l->>'unit_id',''),
    'qty',               nullif(trim(l->>'qty'), ''),
    'extra',             nullif(trim(l->>'extra'), ''),
    'extra_buffered',    round(coalesce(nullif(trim(l->>'extra'), '')::numeric, 0), 3),
    'total',             round(coalesce(nullif(trim(l->>'qty'), '')::numeric, 0)
                             + coalesce(nullif(trim(l->>'extra'), '')::numeric, 0), 3)
  )), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  where coalesce(trim(l->>'packaging_item_id'), '') <> '';
$$;
grant execute on function public.fms_production_pack_lines(jsonb) to authenticated;
