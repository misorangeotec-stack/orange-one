-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_batch_line — Tally batch/LOT allocations, one row per (voucher, inventory line, batch).
--
-- WHY THIS EXISTS
--   The lot number has been syncing into ConnectWave since FY2025-26 and was never exposed:
--   it sits three levels deep inside tally_object.raw_payload and has no column anywhere
--   (information_schema returned 0 columns matching batch|lot|godown|mfd|expiry|warehouse).
--   On top of that tally_object is RLS-on with NO policies, so the anon key the portal uses
--   reads it as [] — which is why OD-12 recorded the data as "PROVEN ABSENT (0 rows)".
--   It was hidden, not missing. This table makes it readable.
--
-- GRAIN
--   One row per batch allocation. This is a LOSSLESS REFINEMENT of rpt_sales_item: batch
--   quantities tie to their parent line's quantity on 8,607/8,607 measured lines, so
--   rpt_sales_item and rpt_stock_summary_move are both `group by` rollups of this table.
--   Neither is replaced or touched.
--
-- SOURCE
--   tally_object.raw_payload -> 'ALLINVENTORYENTRIES.LIST' -> 'BATCHALLOCATIONS.LIST'
--
-- ⚠ TWO TRAPS, both of which produced wrong answers during the audit
--
--   1. ConnectWave pulls vouchers by TWO routes that serialise JSON DIFFERENTLY:
--        closed FYs  -> VoucherRegisterRequest, a REPORT export with no <FETCH>  -> 51 batch
--                       sub-keys, scalars stored as BARE STRINGS
--        current FY  -> TYPE=Voucher COLLECTION with an explicit <FETCH>         -> 10 batch
--                       sub-keys, scalars wrapped as {"#text": .., "@TYPE": ..}
--      Reading ->>'#text' therefore returns NULL for every closed-FY row. Doing that reported
--      "no lot numbers before Apr-2026" — wrong by 68,420 rows. ALWAYS use public.jtext(),
--      which handles both shapes.
--
--   2. Any .LIST is an OBJECT when it holds one entry and an ARRAY when it holds many.
--      Both cases must be normalised before jsonb_array_elements, or single-line vouchers
--      vanish silently.
--
-- ⚠ ALLINVENTORYENTRIES ONLY. Stock Journals also carry INVENTORYENTRIESIN.LIST and
--   INVENTORYENTRIESOUT.LIST — the SAME lines split by direction. Reading those too would
--   double-count every stock transfer. rpt_stock_summary_rebuild takes the same care.
--
-- GODOWN
--   godown_name populates immediately for ~93,314 rows (FY2025-26 and earlier, via the report
--   path). It is NULL for all of FY2026-27 because the current-period collection FETCH does not
--   name GODOWNNAME and Tally returns only a node's DEFAULT columns. That is a one-line connector
--   fix (entities.go VoucherFetchFull) plus a full re-pull, tracked separately. The column is
--   nullable so it back-fills with NO schema change and no consumer edit.
--
-- BATCH DATE
--   MFDON and EXPIRYPERIOD already arrive on the report path and are EMPTY on every row —
--   nobody has typed into them yet. Orange will use Tally's NATIVE batch date fields (settled
--   07-09-2026), so once the connector fetch lands these columns fill on their own.
--
-- ADDITIVE ONLY: new table, new functions, new policies. Nothing existing is altered or dropped.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.rpt_batch_line (
  tenant_id        text    not null,
  company_guid     text    not null,
  fy               text,
  vch_date         text,                    -- 'YYYYMMDD', the house convention

  voucher_guid     text    not null,
  line_no          integer not null,        -- ordinality within ALLINVENTORYENTRIES.LIST
  batch_no         integer not null,        -- ordinality within BATCHALLOCATIONS.LIST

  voucher_type     text,
  voucher_no       text,
  party            text,

  -- Taxonomy deliberately matches fms_complaint_lot_index.direction so that table becomes
  -- reproducible from here rather than depended upon.
  direction        text    not null default 'other'
                     check (direction in ('sales','purchase','other')),
  -- From the PARENT inventory line's ISDEEMEDPOSITIVE ('Yes' = stock came in).
  movement         text    not null check (movement in ('in','out')),
  -- Orders and proformas move no stock. Precomputed so no consumer has to re-derive it,
  -- matching the exclusion rpt_stock_summary_rebuild applies.
  affects_stock    boolean not null default true,

  stock_item       text,
  stock_group      text,

  batch_name       text,                    -- THE LOT. 'Primary Batch' is kept, never nulled.
  is_real_lot      boolean,                 -- false for Primary Batch / blank — ~40% of rows
  godown_name      text,                    -- NULL for FY2026-27 until the connector fetch lands
  destination_godown text,                  -- differs from godown_name only on stock transfers

  qty              numeric,                 -- unsigned magnitude, as Tally reports it
  qty_text         text,                    -- raw ACTUALQTY, e.g. '20.0000 KGS'
  uom              text,
  billed_qty       numeric,
  rate             numeric,
  amount           numeric,

  order_no         text,
  tracking_number  text,

  batch_mfd        date,                    -- native MFDON, once entry begins
  batch_expiry     date,                    -- native EXPIRYPERIOD when it parses as a date
  batch_expiry_raw text,                    -- EXPIRYPERIOD verbatim (Tally may store a PERIOD)
  batch_date       date,                    -- resolved date, whatever its origin
  batch_date_src   text check (batch_date_src in ('mfdon','expiry','lotname')),
  batch_udf        jsonb,                   -- any UDF-named sub-key; forward slot, tiny today

  built_at         timestamptz not null default now(),

  primary key (tenant_id, voucher_guid, line_no, batch_no)
);

create index if not exists rpt_batch_line_tenant_date_idx
  on public.rpt_batch_line (tenant_id, vch_date);
create index if not exists rpt_batch_line_lot_idx
  on public.rpt_batch_line (tenant_id, batch_name, stock_item);
create index if not exists rpt_batch_line_item_idx
  on public.rpt_batch_line (tenant_id, stock_item, vch_date);
-- Partial: ~40% of rows are 'Primary Batch' and every traceability query excludes them.
create index if not exists rpt_batch_line_real_lot_idx
  on public.rpt_batch_line (tenant_id, batch_name)
  where is_real_lot;
-- Costs nothing until the connector fetch lands.
create index if not exists rpt_batch_line_godown_idx
  on public.rpt_batch_line (tenant_id, godown_name, stock_item)
  where godown_name is not null;

create table if not exists public.rpt_batch_refresh_log (
  ran_at      timestamptz not null default now(),
  tenant_id   text,
  fy_from     text,
  fy_to       text,
  rows        integer,
  lots        integer,
  godown_rows integer,   -- the connector-landing tripwire: watch this go 0 -> non-zero for FY26-27
  seconds     numeric,
  source      text,      -- 'cron' | 'sync' | 'manual' | 'backfill'
  error       text
);

create index if not exists rpt_batch_refresh_log_ran_idx
  on public.rpt_batch_refresh_log (tenant_id, ran_at desc);
