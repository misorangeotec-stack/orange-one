# Central Masters — operation log

**One master list per concept, shared by every module, fed from Tally.**

This file is the memory of the operation. It survives sessions: open it, read
*Where we are*, and carry on. Update it at the end of any working session — a
phase is not finished until this file says so.

- **Status:** Phase 0 and Phase 1 complete and live. Company + dispatch location
  moved across and the sales order form narrows on them — live 2026-08-18.
- **Last updated:** 2026-08-18
- Plan of record: `C:\Users\Admin\.claude\plans\now-the-thing-is-greedy-orbit.md`

---

## Where we are

| Phase | What it is | Status |
|---|---|---|
| **0** | Build the central store, sync it from Tally, admin screens | ✅ **Done** |
| **1** | Cut **Order to Dispatch** over to it | ✅ **Done — 2026-08-17, ~16:45 IST** |
| **2** | Purchase → Import → Production → Assets → Office Supplies, plus `mst_lists` for module-specific masters | ⏸ Not started |
| **3** | Collapse the 9 duplicated master-request/approval systems into one | ⏸ Not started |

**Immediately outstanding**

1. ✅ **`work-snapshot` redeployed — v13 → v14, 2026-08-18.** The rebuilt bundle
   (`supabase/functions/_shared/workSnapshot.bundle.js`) is live; the deployed
   copy no longer reads the retired master tables. Verified by signing in and
   running a real snapshot through the function, not just by the version number.
   Fires daily at 03:30 UTC via `user-snapshot-daily`.

   ⚠ **`npx supabase …` fails in PowerShell here** — the execution policy blocks
   `npx.ps1` with `UnauthorizedAccess`. Use **`npx.cmd`**, which bypasses the
   `.ps1` wrapper entirely. `npx.cmd supabase login`, then
   `npx.cmd supabase functions deploy work-snapshot --project-ref icutjkrqkbzwvmnfbzpr --no-verify-jwt`.
   The "Docker is not running" warning is noise; the deploy does not need it.
2. ⚠ **The `service_role` key was pasted into a chat transcript on 2026-08-14.**
   The user has explicitly decided not to rotate it. Do not raise this again
   unless asked.
3. 15 Dispatch customers have no Tally ledger and carried over as portal-only.
   Two are waiting on a ledger being created in Tally — **ARA DIGITAL PRINTS**
   and **AJANTA DIGITAL INDUSTRIES**. Not blocking anything.
4. **Six reconcile decisions still open** — AVADH FAB TEX, JINDAL TEXOFAB,
   N S ENTERPRISES, A N CREATION, TEX INDIA ENTERPRISES, GARTEX. Until they are
   settled these sit in no company book, which now means they are offered under
   *every* company on the sales order form. Not wrong, just wider than it needs
   to be.
5. **Enterprise — Noida can take no order yet**: it has no customer↔item
   mappings. Colorix has no dispatch site. Both are filled in on the Central
   Masters screens, not by a migration.

---

## Phase 1 — what actually happened

Run on 2026-08-17 with the user present, in this order. Nothing was skipped.

| Step | Result |
|---|---|
| Paused `masters-sync-watch` + `masters-sync-daily-force` | no run in flight |
| Re-baselined | counts had drifted twice during the window — orders 277 → 284 → 287 |
| Dry run (whole cutover, aborting) | all assertions passed |
| **Rehearsal: cutover → rollback → abort** | counts returned to baseline **exactly**; guids back on twins; 6/6 function bodies restored |
| Cutover for real | one statement, `lock_timeout = 3s`, committed |
| Frontend | cutover files only, pushed to `master` as `b0f26d6` |
| Smoke tests (aborting) | `replace_lines` 4 lines / 0 null units; master-request approve → customer, item and mapping all land visible |
| One forced Tally sync | counts **unchanged** — every absorbed row matched by guid |
| Cron re-enabled | both jobs active |

**Final state:** parties 7,815 → **7,830** (+15 = exactly the customers with no
Tally match), items 14,239 → **14,239** (every one absorbed a twin), catalogue
6,030 → **8,553**. Orders 287, lines 1,100, round items 609 — untouched. Zero
orphans. Legacy tables intact at 327 / 234 / 3,169 as the rollback.

**The rollback is real and rehearsed.** `private.phase1_cutover()` and
`private.phase1_rollback()` are installed procedures; `supabase/phase1/*.sql` is
their source. Backups live in `private.dispatch_cutover_{parties,items,
party_items,functions}`. Keep all of it, and the old tables, until after a full
month-end close — the email, gate-pass and receiver-copy paths only exercise on
a completed round.

**Standing checks, first week**

```sql
select count(*) from mst_parties where modules @> '{order-to-dispatch}' and not is_customer;  -- 0
select count(*) from fms_dispatch_order_items where unit is null;                              -- 0
select count(*) from fms_dispatch_round_items where item_name = 'Item' or unit_name is null;   -- 0
select count(*) from fms_dispatch_customer_items;                                              -- stays 3169
```

A drop in that last one means something is eating the rollback snapshot.

---

## Company & dispatch location — what actually happened

Run on **2026-08-17 / 18**. Phase 1 moved customers and items; this moved the two
masters it left behind, and then made the order form narrow on them. Called
"Phase 2" in `supabase/phase2/*.sql` and in the plan file — **not** the Phase 2
in the table above, which is the other modules.

**The database (2026-08-17).** `private.phase2_cutover()` / `phase2_rollback()`,
installed as procedures so the dry run, the rehearsal and the real run were
byte-identical; the files were verified against the DB by md5 of the
comment-stripped text. Rehearsed cutover → rollback → abort on live data before
committing, because Phase 1 taught that a rollback which is only *read* does not
work (see the list below).

| | |
|---|---|
| Dispatch's private 2-row company list | → `mst_companies`, all 5 Tally books |
| 6 location rows (3 sites × 2 companies) | → 3 sites in `mst_locations` + `mst_company_locations` |
| Orders / rounds / step owners | repointed; 303 orders, 1,148 lines, 165 rounds **unchanged**, 0 orphans |
| Step owners | merged 28 → 14 pairs; identical owners asserted first (compare `array_agg(x order by x)`, not the raw array) |
| 5 functions | repointed by string substitution with asserted hit counts |
| Gate pass | prints the **alias**, never `mst_companies.name` — that is Tally's FY-suffixed book name, re-minted every April, and it reaches a driver at the gate |

Legacy tables left populated and unread as the rollback.

**The order form (2026-08-18, `550bd72`).** The `modules` tick no longer scopes
Dispatch. The company does:

- company → its own dispatch sites (`mst_company_locations`)
- company → its own customers (`mst_parties.company_id` — Tally keeps a separate
  ledger per book, so this IS the mapping; nothing is maintained by hand)
- customer → the items that customer buys (`mst_party_items`)

Measured before it was written, because the tick existed to keep the payload
small: **1,850** customer ledgers, and — since the item picker can only offer
what a pair names — **1,656** distinct items, not 14,239. All 121 items on the
303 orders are inside that set. So it still loads up front; `mst_items` is
fetched **by id from the pairs** instead of by a tick.

⚠ **Items are NOT filtered by the item's own Tally book.** 1,326 of the 8,531
mappings deliberately cross books (Tally files one stock item under one company
while both firms sell it). Filtering on `mst_items.company_id` would offer an
Enterprise order 21 items instead of ~230 and invalidate 589 of its 619 existing
lines. The customer row is already company-specific; that is what makes the
mapping the right authority.

⚠ **71 of the 303 existing orders are billed by a company that is not the one on
their customer's ledger** — the old picker offered one flat list whatever company
was chosen. They are history. The form always keeps the customer it is showing,
and `fms_dispatch_update_order` tests the pair **only when the customer is being
changed**. Never make that check unconditional.

⚠ **A customer with no company book appears under EVERY company.** Nine rows
today (the open reconcile decisions, two internal Noida entities), plus every
customer approved through a master request — those are created in the portal and
reach Tally only after the first invoice. Hiding them would make a newly
approved customer unorderable at the exact moment somebody needs it.

**Retired without being dropped.** `mst_party_companies` / `mst_item_companies`
and `mst_refresh_party_companies()` / `mst_refresh_item_companies()` (cron
`mst-refresh-company-links`, jobid 30) are still installed and populated but
**nothing reads them**. They were built as lists to maintain by hand; the user
was right that this defeated the point, since Tally already holds the answer.
Kept as the documented fallback — deriving from sibling ledgers took
Enterprise — Surat from 76 items to 168 and Enterprise — Noida from 0 to 79, so
the "gap" that would have been filled by hand was never a gap.

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
19. **A rollback nobody has run is not a rollback.** The first `00_rollback.sql`
    could not execute at all: it deleted the copied rows `where source='portal'`,
    but the cutover sets `source='tally'` on every row that absorbed a twin — so
    it skipped 312 of 327 parties and *all* 234 items, then collided with the
    UNIQUE `tally_guid` those survivors now held. `on conflict (id)` does not
    catch a conflict on a *different* index. It was found by rehearsing, not by
    reading. Rehearse cutover → rollback → abort against live data, and assert
    the counts return **exactly**, before committing anything.
20. **Do not spell a retired table's name in a comment.** The standing check
    greps every function body for `fms_dispatch_(customers|items|customer_items)`
    to prove nothing still reads the frozen masters — and `pg_get_functiondef`
    returns comments too. A comment in `fms_dispatch_replace_lines` explaining
    what it *used* to read tripped the detector and made the guard useless. The
    function carries a note saying so.
21. **`pg_net` times out at 5 s; `masters_sync_tick` does not fail.** A forced
    sync logs `Timeout of 5000 ms reached` in `net._http_response` while the Edge
    Function runs on for ~35 s and writes its own row into `mst_sync_runs`. Judge
    a sync by that table, never by the HTTP response.
22. **The freeze does not stop orders.** Counts drifted twice inside the Phase 1
    window (orders 277 → 284 → 287, lines 1,058 → 1,089 → 1,100) because only
    *master writes* were frozen. Never reuse a baseline taken before the window.
17. **`mst_item_groups` uniqueness is an EXPRESSION index**
    (`coalesce(company_id::text,''), lower(name)`), which PostgREST's `onConflict`
    cannot address. The sync therefore reads what exists and inserts the
    difference, rather than upserting.

---

## Phase 1 — the plan as it was written (kept; it is the template for Phase 2)

> ✅ Executed 2026-08-17. See *Phase 1 — what actually happened* above for the
> outcome. Left here because Phase 2 repeats this shape module by module.


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
