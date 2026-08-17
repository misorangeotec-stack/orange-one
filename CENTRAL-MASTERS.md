# Central Masters — operation log

**One master list per concept, shared by every module, fed from Tally.**

This file is the memory of the operation. It survives sessions: open it, read
*Where we are*, and carry on. Update it at the end of any working session — a
phase is not finished until this file says so.

- **Status:** Phase 0 complete. Phase 1 not started, awaiting go-ahead.
- **Last updated:** 2026-08-14
- Plan of record: `C:\Users\Admin\.claude\plans\now-the-thing-is-greedy-orbit.md`

---

## Where we are

| Phase | What it is | Status |
|---|---|---|
| **0** | Build the central store, sync it from Tally, admin screens | ✅ **Done** |
| **1** | Cut **Order to Dispatch** over to it | ⏸ Not started — needs a ~10 min freeze |
| **2** | Purchase → Import → Production → Assets → Office Supplies, plus `mst_lists` for module-specific masters | ⏸ Not started |
| **3** | Collapse the 9 duplicated master-request/approval systems into one | ⏸ Not started |

**Immediately outstanding**

1. ⚠ **Rotate the `service_role` key.** It was pasted into a chat transcript on
   2026-08-14 and must be treated as exposed. Roll it in Dashboard → Project
   Settings → API, then re-run the `private.masters_sync_config` insert with the
   new value. Edge Functions pick the new key up automatically; only that one row
   needs changing.
2. User's manual testing of `/admin/masters` and `/admin/masters/reconcile`.
3. Reconcile decisions: 326 Dispatch customers + 246 items are all undecided.
   Phase 1 reads those decisions, so this is its real prerequisite.

---

## The decisions, and why

Settled with the user; do not silently revisit.

| Decision | Why |
|---|---|
| Tally source is the **ConnectWave mirror** (`ieeefdnyhzgrroifiqbb`), not the legacy receivables project | It is the live Tally mirror; the other is described as legacy in its own client file |
| Masters are **copied into Orange One**, not read live from Tally | An order must carry a foreign key to a customer, and a FK cannot cross databases. Also: nowhere to put portal-only fields, and Tally becomes a hard dependency for rendering old orders |
| Sync is **live — no approval queue** | User's call: a review queue would create a second version of the truth |
| **One row per Tally company**, not per firm | Mirrors Tally, and matches how Dispatch already ties every customer to a billing company. "APEX IMPEX" is genuinely 3 ledgers with 3 credit limits |
| First sync brings **everything, ticked into nothing** | Full searchable library without disturbing any module |
| Rollout **one FMS at a time, Dispatch first** | User's call |
| Backend deploys **before** frontend, always | Vercel auto-deploys on `master`; a frontend reading absent tables errors for every user |
| Phase 1 merges onto the **Dispatch row's id**, not Tally's | 12 FKs point at those ids. Keeping them makes the cutover a constraint repoint against already-valid data instead of an UPDATE across 200 live orders |

---

## What exists now (all live in production)

### Database — `icutjkrqkbzwvmnfbzpr`

| Table | Holds | Rows |
|---|---|---|
| `mst_companies` | Our entities. `name` = Tally's book name, `alias` = what FMS show | 5 |
| `mst_parties` | Customers **and** vendors (a Tally ledger is both concepts). `location` = where the customer takes delivery, seeded from Dispatch | 7,812 (1,838 cust / 3,293 vend; 604 rows carry a location) |
| `mst_items` | Every stock item. `company_id` — items are managed per company; `item_type` — Ink / Spare Parts / Heads / Machine / Others | ~14,200 (O-tec Surat 8,328 / O-tec Noida 2,121 / Ent Noida 2,089 / Ent Surat 1,436 / Colorix 254) |
| `mst_item_groups` | Stock groups, **per company** — 103 group names are shared across companies | ~570 |
| `mst_units` | Units. **Global on purpose** — KGS is KGS in every company | 13 |
| `mst_locations` | Our own sites, per company | 0 |
| `mst_party_items` | Customer-item catalogue, **derived from the sales register** — 20,121 sale lines → pairs, carrying `last_sold_on` and `sale_count`. Shows the item's `item_type` through the join — not a copy | 5,972 |
| `mst_master_managers` | Who may CRUD which master type | 0 |
| `mst_sync_runs` | One row per sync; `source_watermark` is the watcher's memory | — |
| `mst_reconcile_links` | One human decision per legacy master row | 0 |

Migrations `20260902120000` → `20260902120700`, all additive, each with a
`-- Reversal:` block and self-asserting `do $check$` blocks.

Every grid on these screens sorts on every column and filters under every column
— the project-wide rule now recorded in `CLAUDE.md`. `MasterCrud` derives both
from the text each cell renders, so all 11 masters screens across every FMS
gained it at once and a new tab needs no per-column wiring.

### Tally mirror — `ieeefdnyhzgrroifiqbb` (read-only to us)

`supabase/connectwave/masters_views.sql` — adds `v_master_stock_item`. Applied by
hand. Needed because `v_clevel_stock_item` is a *report* view and omits `guid`,
without which item renames would fork into duplicates.

### Edge Function

`masters-sync` (v3). Reads the mirror, upserts here. ~25s for a full pull, ~1.5s
when it skips.

### Schedule

- `masters-sync-watch` — every 15 min, watermark-gated
- `masters-sync-daily-force` — 05:30 UTC / 11:00 IST, unconditional

Both call `public.masters_sync_tick(boolean)` → `pg_net` → the function, reading
the URL and key from `private.masters_sync_config`.

### Frontend

- `core/platform/liveMasters.ts` — lazy per-master reads, all paged
- `core/platform/masterWrites.ts` — writes, and the Tally-owned field guard
- `core/platform/reconcile.ts` — match suggestions + decision writes
- `core/admin/Masters.tsx` — `/admin/masters`, 7 tabs on `MasterCrud`
- `core/admin/MastersReconcile.tsx` — `/admin/masters/reconcile`

---

## Things that bit us — do not rediscover these

1. **The watermark is a naive IST string** (`"2026-08-14T10:17"`). Parsing it to a
   timestamp shifts it +5:30 and every comparison mismatches. Compared as **text**.
2. **The watermark does not move for every change.** Three pulls at an identical
   watermark returned 13,397 / 13,397 / 13,893 items — the connector writes
   continuously while `tally_sync_run.finished_at` only moves when a run closes.
   That is why the daily forced pull exists.
3. **`v_company` has 7 rows for 5 companies** — Tally opens a new file per
   financial year. Deduped by `company_guid`.
4. **Company names carry the financial year** and are re-minted each April. Hence
   `alias`, which no sync touches, is what every FMS renders.
5. **Ledger role comes from `group_chain`, not `sub_group`.** A creditor's
   sub_group is its own bucket ("CREDITOR FOR OTHER").
6. **The same guid appears under `tenant` and `tenant~YYYYMMDD`.** Deduped,
   preferring the base tenant.
7. **`mst_parties` has no UNIQUE on name, deliberately.** A name clash would turn
   a routine sync into a hard failure, and Phase 2 merges duplicates on purpose.
8. **Supabase grants `anon` EXECUTE explicitly** — `revoke ... from public` does
   not remove it. `anon` must be named.
9. **Do not identify the scheduler by string-matching the service key.** It
   returned 401 on every scheduled run: the key stored for pg_net and the key
   injected into the function are not the same string. Read the verified `role`
   claim instead — safe only while `verify_jwt = true`.
10. **PostgREST silently caps at 1000 rows.** Every read of these tables pages.
11. **Companies, parties, items and item GROUPS are all per-company; units are
    not.** 103 group names are used by more than one company, so a global group
    list merged several companies' stock groups into one row. Units are a measure
    — splitting 13 of them five ways would gain nothing.
12. **`rpt_sales_register` is keyed by NAME, not guid** — it is a report, so
    `party` and `particulars` are plain strings. The catalogue sync resolves each
    line by (company + lower(name)) and counts-and-skips what it cannot resolve
    (currently 25 parties / 20 items out of 20,121 — 99.8% matched). Those counts
    are in `mst_sync_runs.counts`; a rising number means naming has drifted.
13. **Rows the sync no longer sees are never deleted.** They are surfaced instead:
    the "In Tally" column flags anything whose `tally_synced_at` predates the last
    successful run as *Not in last sync*, and it filters like any other column.
14. **Delivery location is ours, not Tally's.** Tally has no such concept; the
    Dispatch team typed it over years (291 of their 326 customers, 34 places).
    Migration `…121000` seeded `mst_parties.location` from
    `fms_dispatch_customers.location` by punctuation-insensitive name — 272 firms
    → 604 rows, since a firm is a ledger per company and takes delivery in the
    same place whichever of our books invoices it. **19 were deliberately left
    empty**: real spelling drift ("A N CREATION" vs "A.N. CREATIONS") plus two of
    our own companies trading with each other. Those are reconcile's job; Phase 1
    carries their location across on the id. The Masters grid shows *Not set* as a
    filterable value so the gaps can be found.
15. **Item type is a GUESS, and the obvious keyword is usually a trap.**
    `mst_guess_item_type()` (migrations `…121100` / `…121200`) reads the item name
    first and its Tally group second, in a fixed order, because: "SUBLIMATION
    PAPER" is not ink, "SUBLIMATION DIGITAL PRINTER" is not ink, "KYOCERA PIGMENT
    INK RED" *is* ink (Kyocera is a head brand reused on ink), and "HEAD
    CONNECTION DATA CABLE" is a cable. A **bare** "HEAD" yields to a spare-parts
    group; the strong markers (PRINTHEAD, KYOCERA, nnn DPI, KJ4B, MS2C) do not,
    because real heads do sit in groups named "SPARE PART UNDER WARRANTY".
    Keys match receivables-hub's `SaleType` so item and revenue can be joined.
    **396 items are left NULL on purpose** — no signal in either name — because
    "Others" here means genuinely other. A `before insert` trigger classifies new
    Tally items; it only ever fills NULL, so a human correction is permanent.
16. **`PART` matches inside `PARTY`.** The group test used a bare substring, so
    `INK-THIRD PARTY`, `PRINTHEAD -THIRD PARTY`, `MACHINERY-THIRD PARTY` were all
    read as spare-parts groups. Now `\yPARTS?\y`. Same class of trap as `INK`
    inside `INKJET` — in this data the word-boundary matters constantly.
17. **"INK" is usually a MODIFIER, not the product.** `MAIN INK TANK`,
    `INK BOTTLE (12L)`, `INK OUTLET PIPES`, `INK MISTING UNIT` are all hardware.
    The word INK now yields to a spare-parts group exactly as a bare `HEAD` does;
    ink filed under an INK group is untouched. Ink fell 2,206 → 2,102 — a printer
    business holds far more ink *plumbing* than ink.
18. **A MasterCrud cell that renders a COMPONENT loses its sort and filter.**
    `nodeText` walks the returned node for text, and `<TallyBadge />` is an
    element whose children are undefined until React renders it — so the column
    silently yields "" and the filter row shows nothing under it. Fixed for
    Source / Modules / Type by declaring `sortValue` + `filter.get` explicitly
    (`sourceCol()`, `modulesCol()`, `itemTypeCol` in `Masters.tsx`). Any new
    column whose cell is a component must do the same.
17. **`mst_item_groups` uniqueness is an EXPRESSION index**
    (`coalesce(company_id::text,''), lower(name)`), which PostgREST's `onConflict`
    cannot address. The sync therefore reads what exists and inserts the
    difference, rather than upserting.

---

## Phase 1 — the plan when we resume

Prerequisite: reconcile decisions recorded for all 326 customers and 246 items.

1. Write and test the rollback migration **first**
2. Export Dispatch Customers + Items to Excel — the before/after check
3. Warn whoever manages masters: ~10 minutes without saving
4. Freeze writes on the five `fms_dispatch_*` master tables only
5. Copy them into `mst_*` **keeping their ids**; apply `mst_reconcile_links`
   (copy `tally_guid` onto the surviving row, drop the redundant Tally twin)
6. Repoint the 12 FKs, `lock_timeout = '3s'` so it fails fast rather than stalling
7. Deploy the frontend: `dispatchFetch.ts` reads, `dispatchWrites.ts` `MASTER_TABLE`,
   `masterFields.ts`. Pages untouched — `store.tsx` keeps its API
8. Unfreeze; remove Masters from the Dispatch sidebar
9. Old tables stay populated and unread as the rollback

⚠ `fms_dispatch_resolve_master_request` reads field names **verbatim** from
`masterFields.ts`. Repoint it in the same migration or approving a master request
silently writes nothing.

---

## How to verify at any point

```bash
cd frontend && npm run build     # the only gate; there is no test runner
```

Data integrity, before and after anything:

```sql
select 'dispatch customers' t, count(*) from fms_dispatch_customers
union all select 'dispatch orders', count(*) from fms_dispatch_orders
union all select 'visible in any module', count(*) from mst_parties where cardinality(modules) > 0;
```

Sync health: `select trigger, status, counts, error from mst_sync_runs order by started_at desc limit 5;`
