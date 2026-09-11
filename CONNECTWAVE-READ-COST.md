# ConnectWave — why the masters read is slow, and the two changes that would fix it at source

*Written 11-09-2026, after fixing the Orange One side of the problem. **Nothing in ConnectWave has
been changed.** This is a proposal for Ritesh Bhai to approve or reject, because that database feeds
more than Orange One.*

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

Every failure is inside one narrow window, and 76 later-starting runs are clean.

**The collision.** ConnectWave runs four rebuild jobs on a five-minute cron
(`rpt-sales-register-after-sync`, `rpt-voucher-dispatch-after-sync`, `rpt-batch-refresh-after-sync`,
`rpt-stock-summary-after-sync`). They no-op while Tally is quiet, but the moment the connector writes
they all wake and rebuild whole financial years with DELETE + INSERT, carrying
`statement_timeout = '30min'`. One rebuilds `rpt_sales_register`, which we read. `clevel_refresh_all`
at :25 past the hour re-runs `v_ledger_detail` in full, which we page.

Orange One's own cron fired at minutes 0, 15, 30 and 45 — every one a multiple of five — so it started
in the same minute as those rebuilds on every tick.

## What we already did on our side

Deployed and live, no ConnectWave change involved:

- **Moved our clock to minutes 3, 8, 13 … 58**, so we never start on a multiple of five. Also took the
  checking interval from 15 minutes to 5.
- **Read the two big views per Tally book and by seek**, instead of unfiltered with `LIMIT/OFFSET`.
- **Retry once on 57014**, copying the connector's own backoff curve.

Result: a full pull went from **40.5s to 26.1s** (three runs before, three after, identical row
counts). That is a 35% cut from our side alone.

---

## What is still slow, and why it is yours not ours

### 1. `rpt_sales_register` and `rpt_purchase_item` have no index behind the sort we use

We page both ordered by `(tenant_id, voucher_guid, line_no)`. Neither table appears to carry an index
on those columns — no `create index` for either exists in the ConnectWave repo or the Orange One repo,
and no `create table` either, so they are live-only objects. Without one, **every page is a full scan
plus a full sort**, and the sales register is already 25,943 lines and grows monotonically.

Worth confirming live with `\d rpt_sales_register` before acting. If there is genuinely no index:

```sql
create index concurrently if not exists rpt_sales_register_seek_idx
  on public.rpt_sales_register (tenant_id, voucher_guid, line_no);

create index concurrently if not exists rpt_purchase_item_seek_idx
  on public.rpt_purchase_item (tenant_id, voucher_guid, line_no);
```

`concurrently` so the rebuild jobs are not blocked while it builds. This would also let us switch
those two reads from counting-pages to seek-pages, which is the change that stops the cost growing.

⚠ The frontend reads the same table on a **different** sort — `(vch_date, tenant_id, voucher_no,
line_no)` in `salesRegister.ts`. Two sorts, one table; if only one index is added, ours is the one
that runs unattended five times a day.

### 2. `v_ledger_detail` cannot use an index for its join, by construction

It joins to the recursive group walk on a value pulled out of JSON:

```sql
left join public.v_group_chain gc
  on gc.tenant_id = l.tenant_id
 and gc.grp = (l.raw_payload->'PARENT'->>'#text')
```

An expression like that cannot be indexed as written, so the recursive CTE over **every Group row in
every tenant** is re-walked on each page. The function's own comment already measures a page at ~4
seconds ordered, ~17 unordered.

Two options, in increasing order of effort:

- **An expression index** on the join key, which is cheap and non-breaking:
  ```sql
  create index concurrently if not exists tally_object_ledger_parent_idx
    on public.tally_object ((raw_payload->'PARENT'->>'#text'))
    where object_type = 'Ledger' and not is_deleted;
  ```
- **Materialise the group chain.** `mv_clevel_ledger` already materialises this view's output and is
  refreshed `concurrently` hourly. If a similar matview served the masters read, the recursive walk
  would happen once an hour instead of once per page per pull.

### 3. A smaller, free one: stagger the rebuild jobs

All four rebuild pollers fire on the same `*/5`, so they pile onto the instance together. Spreading
them across different minutes would reduce the peak without changing what any of them does.

---

## What I am NOT proposing

- **Touching the connector.** Its retry and binary-split behaviour on 57014 is the pattern I copied,
  not something to change.
- **Date-limiting the register reads from our side.** It is the obvious saving, but one of them feeds
  a lifetime sale count per customer-item pair, so narrowing the window changes what the number means.
  That needs a decision, not an optimisation.
- **Raising `statement_timeout`** for the reading role. It would convert a fast failure into a slow
  one and hide the problem rather than fix it.

## The honest summary

Our side is fixed and measured. The failures should now be prevented by the schedule offset and
survived by the retry, and both will be confirmed by watching the run log over the coming days. The
ConnectWave changes above would make the reads genuinely cheap rather than merely well-timed — but
none of them is urgent, and none should be made without someone who owns that database agreeing.
