# ConnectWave — the masters read, measured: nothing needs changing there

*First written 11-09-2026. **Corrected 14-09-2026 after checking the live database.** The first
version of this note recommended two new indexes on ConnectWave. **They already exist.** Do not
create them — they would be exact duplicates of the primary keys, adding write cost to every rebuild
and buying nothing. Nothing in ConnectWave has been changed, and nothing needs to be.*

---

## What was happening

Three scheduled `masters-sync` pulls failed between 09-09 and 11-09, all with SQLSTATE 57014,
statement timeout, reading the ConnectWave mirror about 18 seconds in and writing nothing.

Measured across all 91 runs in `mst_sync_runs`:

| Our run started, after the mirror watermark moved | Runs | Failures |
|---|---|---|
| Under 3 minutes | 15 | **3** |
| 3 to 6 minutes | 13 | 0 |
| 6 to 15 minutes | 24 | 0 |
| Over 15 minutes | 39 | 0 |

**The cause was a clock collision, not a missing index.** ConnectWave runs four rebuild jobs on a
five-minute cron that wake the moment the Tally connector writes and rebuild whole financial years
with DELETE + INSERT. Orange One's cron fired at minutes 0, 15, 30 and 45 — every one a multiple of
five — so it started in the same minute as those rebuilds on every tick.

## What was done, all on the Orange One side

- Schedule moved to minutes 3, 8, 13 … 58, and from every 15 minutes to every 5.
- Retry on 57014 only, bounded by a clock.
- The two big views read per Tally book and by seek.

**Result, three days later (11-09 evening to 14-09): 13 scheduled syncs, 0 failures, 0 stuck, and
the retry was never needed once.** The schedule change alone removed the collisions.

---

## ⚠ The correction: what the live database actually holds

The first version of this note was written from the two repos, and **neither repo contains the DDL for
`rpt_sales_register` or `rpt_purchase_item`** — both are live-only tables. "No `create index` in the
repo" was read as "no index". That was wrong. Checked live on 14-09-2026 (`pg_indexes`):

| Table | Index | Columns |
|---|---|---|
| `rpt_sales_register` | `rpt_sales_register_pkey` (unique) | `tenant_id, voucher_guid, line_no` |
| `rpt_sales_register` | `rpt_sales_register_tenant_date` | `tenant_id, vch_date` |
| `rpt_sales_register` | `rpt_sales_register_date` | `vch_date` |
| `rpt_purchase_item` | `rpt_purchase_item_pkey` (unique) | `tenant_id, voucher_guid, line_no` |
| `rpt_purchase_item` | `rpt_purchase_item_tenant_date_idx` | `tenant_id, vch_date` |

The primary key on each table is **exactly** the sort `masters-sync` pages by, and `EXPLAIN ANALYZE`
confirms the planner already walks it (`Index Scan using rpt_sales_register_pkey`).

## And the reads are already cheap

`EXPLAIN ANALYZE` on the live mirror, 14-09-2026, the DEEPEST page of each read — the worst case,
since every earlier page skips fewer rows:

| Read | Cold cache | Warm cache |
|---|---|---|
| `rpt_sales_register`, page 26 of 27 (26,300 rows) | 2,186 ms | **39 ms** |
| `rpt_purchase_item`, page 9 of 10 (9,404 rows) | 775 ms | — |
| `v_ledger_detail`, one page, largest book | 1,604 ms | **734 ms** |

Warm, the whole sales register read is on the order of half a second of database time across all its
pages. The only slow case is a **cold cache**, and the cache goes cold precisely when ConnectWave's
rebuild jobs have just rewritten those tables with DELETE + INSERT — which is the collision window the
schedule change now avoids.

**So there is no index to add and no ConnectWave change to make.** The fix was the clock.

## If it ever needs revisiting

Only worth reopening if `mst_sync_runs` starts showing failures or non-zero `read_retries` again.
Two things to check first, in this order:

1. **Whether the schedule has drifted back onto a multiple of five** —
   `select jobname, schedule from cron.job where jobname like 'masters-sync%'`.
2. **Whether ConnectWave's own cron has moved** onto our minutes (3, 8, 13 …). Read its `cron.job`
   through the management API before assuming anything about its timing.

Only then look at query cost, and **check `pg_indexes` on the live project before proposing an index**
— the repos do not hold the DDL for most of the `rpt_*` tables.
