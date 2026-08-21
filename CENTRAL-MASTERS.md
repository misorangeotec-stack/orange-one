# Central Masters — operation log

**One master list per concept, shared by every module, fed from Tally.**

This file is the memory of the operation. It survives sessions: open it, read
*Where we are*, and carry on. Update it at the end of any working session — a
phase is not finished until this file says so.

- **Status:** Phase 0 and Phase 1 complete and live. Company + dispatch location
  moved across and the sales order form narrows on them — live 2026-08-18.
- **Last updated:** 2026-08-20
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

## One product, one record — the item swap (2026-08-18)

The narrowing shipped and the intake form *still* offered `EPN SUBLIMATION INK
BLACK` twice for NIRVANA FAB ART, under a company already chosen. Not a fault in
the narrowing: the customer's own mapping list held both books' copies of the
same ink. The company decides which customer you get; it cannot clean what is
already hanging off them.

**Where they came from.** Tally files a separate stock item in every company book
that stocks it. When Dispatch's hand-typed customer↔item list moved into Central
Masters, 1,582 of its pairs landed with the customer matched to one book's ledger
and the item matched to a *different* book's twin. Tally's own 6,064 pairs never
cross books — every one of these came from the old list, and not one had ever
been sold against.

**What was retired, and what was not.**

| | |
|---|---|
| 1,582 | cross-book pairs, every one `source = 'portal'`, none with a single sale |
| **684** | true duplicates — the customer already had the product through its own book's item. **Retired** |
| **898** | no twin exists. **Kept, and must stay.** They are the only route by which that customer can order that product |

That second row is the whole reason this was not a one-line DELETE. Most of the
catalogue is filed under one company's book while both firms sell it — which is
also why the order form does not filter items by the item's own book.

**Run 2026-08-18.** Installed as `private.itemswap_run()` /
`private.itemswap_rollback()`; source in `supabase/itemswap/00_itemswap.sql`.
Dry run first, then a full rehearsal — run → undo → abort — on the live data:
every count came back exactly, with `lines_not_restored` and `pairs_not_restored`
both 0.

Result: **684 mappings retired, 575 order lines repointed across 159 orders.**
Orders 334, lines 1,260, rounds 201, round lines 748 and total quantity
74,040.400 all unchanged; 0 lines lost a unit; `mst_items` untouched at 14,242;
and **no customer anywhere still sees one product name twice** (was 684 such
names across 107 customers).

⚠ **THIS IS THE ONLY OPERATION IN CENTRAL MASTERS THAT HAS CHANGED EXISTING
ROWS.** Everything else has been additive. It was safe only because the swap was
proved one-to-one *first*, on live data: exactly one target each, zero differing
on name, unit or HSN, zero with any sales, and no order carrying both twins.
Authorised explicitly by the user. **Do not treat it as a precedent** — re-prove
all four before any repeat.

⚠ `fms_dispatch_round_items` was deliberately NOT rewritten. It is the archive of
what physically went out and carries its own frozen `item_name` / `unit_name`;
its `item_id` resolves to an item with an identical name and unit, so nothing
renders differently. Rewriting it would be editing a photograph.

⚠ **The frontend dedupe stays** (`itemsForCustomer` in the Dispatch store, commit
`1f9b599`). The data is clean today, but nothing stops a new hand-typed
cross-book pair recreating the duplicate tomorrow, and the intake picker should
never be the place that discovers it.

⚠ **4 order lines were already unsaveable before this ran, and still are.** The
customer has no active mapping to the item, so `fms_dispatch_replace_lines`
refuses them. Pre-existing and unrelated; the swap asserts the number does not
*rise*. Worth chasing separately.

**Undo, while it lasts.** `private.itemswap_pairs_before` (684 rows) and
`private.itemswap_lines_before` (575 rows) hold the snapshot;
`select private.itemswap_rollback();` puts both back and asserts it did. Keep
until after a full month-end close, like the Phase 1 backups.

---

## Every item gets its real type — the item sheet (2026-08-21)

`item_type` had been on `mst_items` since `20260902121100`, and **every value in
it was a guess**. `mst_guess_item_type()` read the item name and its Tally group
through a pile of regexes, and that migration's own header calls itself *"a
BEST-EFFORT SEED, not a source of truth"*.

The source of truth arrived as `Misc/Bushra Reports/Inventory Mapping Sales
Register.xlsx` — 11,431 items, each given a TYPE, a CATEGORY and, for inks, an
INK-TYPE, by someone who knows the product. **2,536 of the guesses were wrong**,
including 926 papers filed as "other" and 219 raw materials filed as "ink".

**The vocabulary widened from 5 to 13.** The sheet does not speak in five
buckets, and collapsing PAPER (950 rows) and RAW MATERIAL (328) into "other"
would throw away the answer we had just been given.

⚠ **The five existing keys keep their exact spelling.** `ink`, `spare_parts`,
`head`, `machine`, `other` are the strings receivables-hub uses for `SaleType`;
eight were added alongside. The 13 → 5 map lives in **one** place — a `saleType`
field on `ITEM_TYPES` in `core/platform/liveMasters.ts` — so a sales order can
say PAPER while the ledger still reports `other`. Receivables itself is
untouched: its sale type is resolved in the ConnectWave project off the bill-name
prefix, never from this column.

**Two new columns**, `category` and `ink_type`, both nullable, both portal-owned,
neither with a CHECK — 96 and 85 values today and a revised sheet will bring
more. ⚠ **Category is not the Tally stock group**, however much it reads like
one: only 858 of 13k rows agree with their own group, and just 40 of the 96
category names are group names at all.

**The join collapses runs of whitespace, and nothing else.** Every
non-whitespace character, case included, must still match. It is there because
**15 names in the sheet carry a line break inside the cell** (Excel wrapped them)
and one carries a doubled space; on a character-exact join those 16 read as "the
sheet does not know this item" when the truth was "the cell is wrapped".
Deliberately **not** the punctuation-insensitive match that would also equate
`LRS-600-36-MEANWELL` with `LRS-600-36,MEANWELL` — nobody confirms this join, so
it stays conservative. 33 keys reach master rows spelled two ways (`222-095
BENTONE  RI8 CONTROLLER` / `222-095 BENTONE RI8 CONTROLLER`) — the same product
with a stray space in one book, and both get the same type, which is the point.

**Run 2026-08-21.** Migrations `20260921120000` (columns, widened CHECK, staging
table, `mst_apply_item_sheet()`) and `20260921120100` (the reconcile merge now
carries both new columns, or they are lost on every merge). Loader:
`supabase/itemsheet/load-item-sheet.mjs`.

| | |
|---|---|
| Sheet rows | 11,431 |
| Item rows matched | **13,651** — one name reaches every company book's copy |
| Rows whose type changed | **2,536** |
| Category filled | 13,220 · Ink type filled 1,673 |
| Sheet names with no item | **2** (`444-011 INK TUBE(6*3.2)`, `444-030 RESISTANCE ADJUSTED SOLID VOLTAGE REGULATOR`) |
| Items the sheet does not name | **616 rows / 608 names** — listed in `supabase/itemsheet/unmatched.txt` |
| `mst_items` row count | 14,267, **unchanged** |

**Rehearsed: load → rollback → load again, on live data.**
`restore-snapshot.mjs --apply` put all 13,242 rows back to exactly the pre-load
counts (spare_parts 8,663 · ink 2,110 · other 1,460 · machine 980 · head 649 ·
405 unset) with both new columns cleared; the reload then landed on identical
numbers. Re-running the loader unchanged reports **`changed_rows 0`** and does
not move a single `updated_at` — that is what the `is distinct from` guard in the
apply is for, and it is the proof the load is re-runnable against a revised sheet.

⚠ **This changed existing rows** — the second operation here to do so, after the
item swap. It was safe because it only fills three columns, asserts the row count
is unchanged, and has a rehearsed undo. The item list itself was never touched.

⚠ **No re-seed, ever again.** `20260902121300` re-seeded every row and warned
that this was "ONLY SAFE TODAY" because nobody had hand-corrected a type yet.
That is now false: the column holds hand-typed answers. `mst_guess_item_type()`
and its INSERT-only trigger are left alone — they still return five of the
thirteen, all valid, so a new Tally item classifies itself and the next sheet
load refines it. Any classifier change must be scoped by predicate.

⚠ **Every Masters Excel export taken before 2026-08-21 is stale for the Type
column.** The importer matches a dropdown *by label*, so re-uploading an old
sheet would silently push all 926 papers back to "Others". Export fresh before
editing.

**Still open:** the workbook's second sheet, "ink-item mapping" — 505 rows of
PARTICULARS NAME → ITEM MAPPING plus a COLOR column, 180 of which rename the
particular to a different item name. That is an ink naming-alias problem, not a
classification one, and is out of scope here (**MS-1** in the work list).

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
| `mst_parties` | Customers **and** vendors (a Tally ledger is both concepts). `location` = where the customer takes delivery, seeded from Dispatch | 7,842 (1,885 cust / 3,300 vend) |
| `mst_items` | Every stock item. `company_id` — items are managed per company; `item_type` — Ink / Spare Parts / Heads / Machine / Others | ~14,200 (O-tec Surat 8,328 / O-tec Noida 2,121 / Ent Noida 2,089 / Ent Surat 1,436 / Colorix 254) |
| `mst_item_groups` | Stock groups, **per company** — 103 group names are shared across companies | ~570 |
| `mst_units` | Units. **Global on purpose** — KGS is KGS in every company | 13 |
| `mst_locations` | Our own sites, per company | 3 |
| `mst_company_locations` | Which site each book dispatches from | 6 |
| `mst_party_companies` | In which books a ledger of the same NAME exists — how you find a firm's **sibling row**. ⚠ NOT a billing permission; see below | 758 (329 parties) |
| `mst_item_companies` | The same for items | 630 |
| `mst_party_items` | Customer-item catalogue, **derived from the sales register** — 21,144 item sale lines → pairs, carrying `last_sold_on` and `sale_count`. Shows the item's `item_type` through the join — not a copy | 5,963 |
| `mst_master_managers` | Who may CRUD which master type | 0 |
| `mst_sync_runs` | One row per sync; `source_watermark` is the watcher's memory | — |
| `mst_reconcile_links` | One human decision per legacy master row | 0 |

Migrations `20260902120000` → `20260902120700`, all additive, each with a
`-- Reversal:` block and self-asserting `do $check$` blocks.

Every grid on these screens sorts on every column and filters under every column
— the project-wide rule now recorded in `CLAUDE.md`. `MasterCrud` derives both
from the text each cell renders, so all 11 masters screens across every FMS
gained it at once and a new tab needs no per-column wiring.

### ⚠ mst_party_companies is NOT a billing permission

Do not point the Dispatch billing gate at it. That was tried on 2026-08-20 and
reverted within the hour — migrations `20260921120000` (wrong) and
`20260921130000` (the revert) carry the whole story.

`mst_refresh_party_companies()` matches a party against every Tally ledger of the
same **name** or GSTIN across all five books, four times an hour via cron
`mst-refresh-company-links`. So it answers *"in which books does a ledger of this
name exist"* — how you find a firm's **sibling row**. It does not answer *"which
books may bill this row"*.

That second question already has one answer, and it is `company_id`: one party
row per Tally book (the decision recorded above), so a firm billed from two books
is two rows, each with its own guid and its own credit limit. Book B does not
bill book A's ledger; it bills its own.

The measurement that settles it: accepting a mapping row newly legalised 46
pairs, and for **44 of them a ledger of the same firm was already sitting in the
billing book**. That would have been 44 mis-bookings — and a wrong ledger does
not stop at the order, it flows into the sales bill and the Tally posting.

⚠ **Check which branch is deployed before diagnosing a screen/database
disagreement.** The premise for that change — "the picker offers a flat list of
every customer whatever company is chosen" — was read off `daily-reports`. On
**`master`**, commit `550bd72` already narrowed the picker via
`customersForCompany()` on `company_id`, matching the gate exactly. Screen and
database already agreed. `master` is checked out at the **`oo-master`** worktree,
not in this one — read it before concluding something is unbuilt.

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
23. **A ledger's Tally GROUP is an accounting label, not a statement of trade.**
    `is_customer` / `is_vendor` used to be derived from `group_chain` alone, and
    that hid real customers two ways. A ledger under **`Branch / Divisions`** is
    neither a debtor nor a creditor, so BOTH flags came out false and the row
    appeared on no tab and in no picker — present in the master, unreachable in
    the UI. Our own branches sat there trading every week: ORANGE O TEC PVT.
    LTD.(SURAT BRANCH) with 130 sale lines and 1,836 purchase lines in the Noida
    book. `Branch / Divisions` is one of Tally's **reserved PRIMARY groups** —
    its parent is empty, so the chain never reaches Sundry Debtors however deep
    the walk goes; `v_group_root` returns it as its own root. The second way is
    the GARTEX case already noted in `reconcile.ts`: a creditor group with
    eleven sales against it. The sync now ORs the trade registers onto the group
    test (`rpt_sales_register` → customer, `rpt_purchase_item` → vendor), so the
    flags only ever widen. That flipped 22 customers and 5 vendors.
24. **⚠ LIMIT/OFFSET WITH NO `ORDER BY` SILENTLY LOSES ROWS, AND NOTHING ERRORS.**
    `fetchAll` paged every mirror and local read with `.range()` and no sort.
    Postgres does not define row order without `ORDER BY`, so pages overlap and
    skip, differently on every run. `v_ledger_detail` holds **9,384** rows; one
    run wrote **6,193** distinct guids; `mst_parties` had accumulated **7,832** —
    the union of many runs each dropping a different ~1,600. It is invisible
    because the sync never deletes: a missed row just keeps its old
    `tally_synced_at` and the "In Tally" column then reports it as *Not in last
    sync*, **blaming Tally for our pager**. Found because ORANGE O TEC PRIVATE
    LIMITED(NOIDA) would not flip to customer while the mirror plainly still
    returned its guid. `fetchAll` now REQUIRES an `orderBy` and every call names
    a unique key — `tenant_id + guid`, not `guid` alone, since the same guid
    appears under a base tenant and its `~YYYYMMDD` twin and a tied sort key
    reshuffles just the same. Ordering is also ~4× FASTER on the big views.
    If you add a paged read anywhere, give it a unique sort key.
25. **A FUNCTION THE CUTOVER MISSED WROTE "Item" ONTO EVERY DISPATCH FOR THREE
    DAYS, AND NOTHING ERRORED.** `fms_dispatch_archive_round` freezes each
    shipped line into `fms_dispatch_round_items`, copying the product NAME so a
    completed round still reads correctly if the master is later renamed. It
    looked that name up in **`fms_dispatch_items`** — the legacy master, frozen
    at the Phase 1 cutover, 234 rows — while live items had moved to
    `mst_items`, 14,261 rows. The join matched nothing and
    `coalesce(it.name, 'Item')` wrote the placeholder. **293 rows, and 0 of them
    would have resolved against the legacy table** — every dispatch closed since
    the cutover, not an intermittent failure. The gate pass hid it, because
    `gatePass.ts` falls back to `meta.itemName(i.itemId)`; the Order Register
    export reads the frozen copy directly and showed "Item".
    Fixed in `20260921140000`, which also repaired all 293 from the intact
    `item_id` (undo data in `private.round_item_name_backfill`).
    **The standing check below existed precisely to catch this and was not
    re-run after the cutover.** Run it after any cutover, and after any change
    to a `fms_dispatch_*` function:

    ```sql
    -- Nothing may still READ a frozen master. mst_apply_reconcile_link is the
    -- only legitimate hit: merging a legacy row onto its Tally twin is its job.
    -- ⚠ prosrc includes COMMENTS, so a function merely NAMING a retired table in
    --   a note trips this. Read the hit before believing it (see item 20).
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc ~ 'fms_dispatch_(items|customers|customer_items)\y';

    -- And every id on a live order must resolve against the LIVE masters.
    select count(*) from fms_dispatch_round_items ri
     where ri.item_id is not null
       and not exists (select 1 from mst_items i where i.id = ri.item_id);  -- 0
    ```

    Audited on 2026-08-20 after the fix: no `fms_dispatch_*` function names a
    legacy master any more; `fms_dispatch_email_payload` and
    `fms_dispatch_apply_ship_lines` use the same
    `coalesce(it.name, …)` shape but read `mst_items` correctly; and all nine
    id-resolution checks across orders, lines, rounds and round items return
    zero. The deployed frontend reads no legacy master either.

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
