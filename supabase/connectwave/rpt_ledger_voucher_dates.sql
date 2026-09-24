-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_ledger_voucher_dates — the first and last Tally voucher date of every customer ledger (RC-19).
--
-- ⚠️ APPLY TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb), through the management API or the SQL
--    editor. Never `supabase db push`. Then rpt_ledger_voucher_dates_cron.sql, LAST.
--    Rollback: rpt_ledger_voucher_dates_rollback.sql.
--
-- ADDITIVE ONLY: one new table, one new log table, two new functions, one read policy each.
--
-- WHY IT EXISTS
--   The Credit Terms report (Outstanding Dashboard → Reports → credit-terms) needs two dates per
--   customer ledger that nothing else carries:
--
--   · LAST voucher, for "Last transaction". The report used to know only the last receipt and the
--     open bills, so a settled bill, a credit note or a journal was invisible to it.
--   · FIRST voucher, for "Customer since". Tally does not export a ledger creation date at all
--     (checked in both databases, 17-09-2026). Orange One's mst_parties.created_at is when the masters
--     sync first SAW a ledger — meaningful only after its bulk load of 14-08-2026 17:45 IST — and even
--     then 11 of the 42 customers first seen since had vouchers earlier. The earlier of the two dates
--     is the honest answer, so the report needs this one.
--
--   Measured live, 17-09-2026: the aggregate takes ~0.5 s over 1,882 customer ledgers. Too slow for
--   every page load through the anon role's 3 s budget, cheap enough to rebuild whole after each sync.
--
-- WHAT IT READS
--   tally_voucher_line (service-role only; the browser cannot read it), restricted to ledgers in
--   collection_customer_snapshot. Cancelled and optional vouchers are excluded, exactly as
--   collection_last_receipt_amount_and_range_facts.sql excludes them. A soft-deleted voucher's lines
--   are already gone from that table at ingest.
--
-- ⚠ POST-DATED VOUCHERS ARE LEFT OUT UNTIL THEIR DATE.
--   On 17-09-2026, 37 BANK RECEIPT lines on 24 customer ledgers were dated 18-Sep to 21-Oct-2026 —
--   post-dated cheques. A "last transaction" a month in the future is not a transaction yet. The cap
--   is today in IST at refresh time, which is why the nightly job runs just after IST midnight.
--
-- ⚠ ONE ROW PER LEDGER, NOT PER TENANT.
--   A company's archive books (tenant '…~20240401') carry the same vouchers under the same ledger GUID
--   as its current book: 247 customer ledgers span more than one tenant, and ZERO span two companies.
--   So lines are grouped by the base tenant ('~FY' stripped) and the ledger GUID together.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.rpt_ledger_voucher_dates (
  tenant_id      text        not null,  -- base book: 'acct_orange::<company_guid>', '~FY' stripped
  ledger_guid    text        not null,  -- Tally GUID = collection_customer_snapshot.ledger_id
  first_vch_date text        not null,  -- 'YYYYMMDD', the house convention
  last_vch_date  text        not null,  -- 'YYYYMMDD', never after the refresh day in IST
  last_vch_type  text,                  -- voucher type on that last date, e.g. 'CREDIT NOTE'
  refreshed_at   timestamptz not null default now(),
  primary key (tenant_id, ledger_guid)
);

create table if not exists public.rpt_ledger_voucher_dates_refresh_log (
  ran_at      timestamptz not null default now(),
  rows        integer,
  seconds     numeric,
  source      text        not null,     -- 'sync' | 'cron' | 'manual'
  snapshot_at timestamptz,              -- collection_meta.refreshed_at this run was built against
  error       text
);
create index if not exists rpt_ledger_voucher_dates_refresh_log_ran_idx
  on public.rpt_ledger_voucher_dates_refresh_log (ran_at desc);

-- ── The rebuild ────────────────────────────────────────────────────────────────────────────────
-- Whole-table: delete + insert in one transaction, so a reader sees the old rows until commit and
-- never a half-built table.
create or replace function public.rpt_ledger_voucher_dates_rebuild(
  p_source      text,
  p_snapshot_at timestamptz default null
) returns text
language plpgsql
as $fn$
declare
  n  integer;
  t0 timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtext('rpt_ledger_voucher_dates')) then
    return 'another rebuild is running; skipped';
  end if;

  begin
    delete from public.rpt_ledger_voucher_dates;

    insert into public.rpt_ledger_voucher_dates
      (tenant_id, ledger_guid, first_vch_date, last_vch_date, last_vch_type)
    select split_part(l.tenant_id, '~', 1),
           l.ledger_guid,
           min(l.vch_date),
           max(l.vch_date),
           (array_agg(l.voucher_type order by l.vch_date desc, l.voucher_type))[1]
      from public.tally_voucher_line l
     where l.ledger_guid in (select s.ledger_id from public.collection_customer_snapshot s)
       and not l.is_cancelled
       and not l.is_optional
       and l.vch_date ~ '^[0-9]{8}$'
       and l.vch_date <= to_char(now() at time zone 'Asia/Kolkata', 'YYYYMMDD')
     group by 1, 2;
    get diagnostics n = row_count;

    insert into public.rpt_ledger_voucher_dates_refresh_log (rows, seconds, source, snapshot_at)
    values (n, round(extract(epoch from (clock_timestamp() - t0))::numeric, 2), p_source, p_snapshot_at);
  exception when others then
    -- The log row still lands, carrying the snapshot it tried, so a failing rebuild cannot spin every
    -- five minutes; the nightly run tries again.
    insert into public.rpt_ledger_voucher_dates_refresh_log (seconds, source, snapshot_at, error)
    values (round(extract(epoch from (clock_timestamp() - t0))::numeric, 2), p_source, p_snapshot_at, sqlerrm);
    return 'failed: ' || sqlerrm;
  end;

  return format('rebuilt %s ledgers in %ss', n, round(extract(epoch from (clock_timestamp() - t0))::numeric, 2));
end $fn$;

-- ── The after-sync poller ──────────────────────────────────────────────────────────────────────
-- Chained off the CUSTOMER SNAPSHOT, not off tally_sync_state: the rebuild reads the snapshot's
-- ledger list, so a brand-new debtor is only coverable once collection_refresh has put it there.
-- collection_meta holds one row whose refreshed_at moves on every snapshot rebuild.
create or replace function public.rpt_ledger_voucher_dates_if_stale()
returns text
language plpgsql
as $fn$
declare
  v_snap timestamptz;
begin
  select m.refreshed_at into v_snap from public.collection_meta m where m.id = 1;
  if v_snap is null then
    return 'no snapshot yet; skipped';
  end if;
  -- Error rows count: they carry the snapshot they tried, so a failure is not retried every tick.
  if v_snap <= coalesce((select max(l.snapshot_at) from public.rpt_ledger_voucher_dates_refresh_log l),
                        '-infinity'::timestamptz) then
    return 'up to date; skipped';
  end if;
  return public.rpt_ledger_voucher_dates_rebuild('sync', v_snap);
end $fn$;

-- ── Access ─────────────────────────────────────────────────────────────────────────────────────
-- Read like rpt_batch_line: the hub reads it with the anon key. Nobody but the scheduler rebuilds it.
alter table public.rpt_ledger_voucher_dates             enable row level security;
alter table public.rpt_ledger_voucher_dates_refresh_log enable row level security;

drop policy if exists rpt_ledger_voucher_dates_read on public.rpt_ledger_voucher_dates;
create policy rpt_ledger_voucher_dates_read on public.rpt_ledger_voucher_dates
  for select to anon, authenticated using (true);

drop policy if exists rpt_ledger_voucher_dates_refresh_log_read on public.rpt_ledger_voucher_dates_refresh_log;
create policy rpt_ledger_voucher_dates_refresh_log_read on public.rpt_ledger_voucher_dates_refresh_log
  for select to anon, authenticated using (true);

grant select on public.rpt_ledger_voucher_dates, public.rpt_ledger_voucher_dates_refresh_log
  to anon, authenticated;

revoke execute on function public.rpt_ledger_voucher_dates_rebuild(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.rpt_ledger_voucher_dates_if_stale()                 from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- ── First build (run once after applying) ──────────────────────────────────────────────────────
--   select public.rpt_ledger_voucher_dates_rebuild('manual', (select refreshed_at from public.collection_meta where id = 1));
--
-- ── Verify ─────────────────────────────────────────────────────────────────────────────────────
--   select count(*),                                                        -- ~1,266 on 17-09-2026
--          max(last_vch_date) <= to_char(now() at time zone 'Asia/Kolkata','YYYYMMDD') as capped,  -- true
--          count(*) filter (where first_vch_date > last_vch_date)          as inverted            -- 0
--     from public.rpt_ledger_voucher_dates;
--   select * from public.rpt_ledger_voucher_dates_refresh_log order by ran_at desc limit 5;
