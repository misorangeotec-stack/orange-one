-- ===========================================================================
-- CENTRAL MASTERS — the sync watermark is TEXT, not timestamptz.
--
-- WHY
--   The 15-minute watcher decides whether to pull by asking the Tally mirror one
--   cheap question — its receivables_last_sync() RPC — and comparing the answer
--   with the newest successful run recorded here. That comparison is the entire
--   mechanism, so the value has to round-trip EXACTLY.
--
--   It does not round-trip through timestamptz. The RPC returns a bare IST clock
--   string with no offset and no seconds:
--
--       "2026-08-14T10:17"
--
--   Cast into timestamptz that is read as UTC and silently becomes 15:47 IST —
--   five and a half hours in the future. Every comparison would then mismatch,
--   the watcher would pull on every single tick, and the "skip when nothing
--   changed" design would quietly do the opposite of what it says.
--
--   So the watermark is stored and compared verbatim, as text. source_last_sync_at
--   (added in 20260902120000) stays for the cases where a real timestamp is
--   available, but it is NOT what the watcher keys on.
--
-- Additive only: one nullable column on a table that is still EMPTY.
--
-- Reversal:
--   alter table public.mst_sync_runs drop column if exists source_watermark;
-- ===========================================================================

alter table public.mst_sync_runs
  add column if not exists source_watermark text;

comment on column public.mst_sync_runs.source_watermark is
  'THE WATCHER KEYS ON THIS. The Tally mirror''s receivables_last_sync() answer, stored VERBATIM as text because it is a naive IST clock string ("2026-08-14T10:17") with no offset - casting it to timestamptz reads it as UTC and shifts it 5.5 hours, which would make every comparison mismatch and defeat the skip-when-unchanged design.';

-- The watcher's read: newest successful run. Keep it a single index hit.
create index if not exists mst_sync_runs_success_idx
  on public.mst_sync_runs (started_at desc) where status = 'success';


do $check$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='mst_sync_runs'
                    and column_name='source_watermark' and data_type='text') then
    raise exception 'central masters: mst_sync_runs.source_watermark is missing or not text';
  end if;
end $check$;
