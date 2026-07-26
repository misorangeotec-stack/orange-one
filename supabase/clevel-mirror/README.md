# C-Level Dashboard — Tally-mirror DB objects

These objects power the **C-Level Dashboard** report (`frontend/src/apps/receivables-hub/pages/CLevelDashboard.tsx`).

**They live in the ConnectWave / Tally-mirror Supabase project** (`ieeefdnyhzgrroifiqbb`) — the *same* database the
existing Balance Sheet / P&L reports read via the `VITE_CONNECTWAVE_*` client. They are **NOT** part of the primary
Orange One auth project, and they are **NOT** the "Orange One Supabase Connect" reporting project's `rpt_*` objects —
this dashboard deliberately uses its own `clevel_` / `v_clevel_` / `mv_clevel_` naming so there is no coupling.

Applied via the Supabase MCP / SQL editor (service role) against project `ieeefdnyhzgrroifiqbb`. Additive-only; every
object is owned by `postgres` (so it bypasses the RLS on `tally_object` / `tally_voucher_line`) and granted to `anon`.

## Objects (see `objects.sql`)
- `clevel_entry_lines(jsonb)` — voucher accounting-line extractor. Unlike the connector's `entry_lines()`, for older
  invoice vouchers stored without a consolidated `ALLLEDGERENTRIES.LIST` it also pulls the revenue line from
  `ALLINVENTORYENTRIES.LIST -> ACCOUNTINGALLOCATIONS.LIST` (else-branch only, so no double count). *(Reference only —
  the live pipeline below reads the fast `tally_voucher_line` table; this fn documents the exact reconstruction and is
  used for verification.)*
- `mv_clevel_ledger` (matview) — one row per ledger: grouping, sub_group, group_chain, closing, dr/cr. The dashboard's
  own ledger lookup + balance source (bank/cash/loans/AR/AP/top parties/duties). Refreshed CONCURRENTLY.
- `clevel_pl_monthly` (table) + `clevel_refresh_pl_monthly()` — monthly Sales / Purchase / Income / Expense per
  company-month, **both financial years**. Built from `tally_voucher_line` (fast), classified by ledger group, with
  short-form invoice vouchers' missing revenue recovered via the balancing identity and bucketed by the PARTY ledger's
  group (Sundry Debtors → sales, Sundry Creditors → purchase). Drives the trend charts; headline totals use the app's
  exact `buildPnl`. (Helper fns `clevel_fill_pl_monthly` / `_fy` / `_range` populate a single company/FY/month-range.)
- `v_clevel_gst_summary` (view) — Duties & Taxes ledgers split into receivable (Dr) vs payable (Cr).
- `v_clevel_stock_group_summary` (view) — qty + closing value per stock group (value sign-flipped to match `v_fs_stock`).
- `v_clevel_stock_item` (view) — item-level closing/opening qty + value + `movement_qty` (opening−closing) for
  Fast/Slow/Non-moving rankings.
- `clevel_refresh_all()` + pg_cron job `clevel_refresh_all` (`25 * * * *`) — refreshes `mv_clevel_ledger` then
  `clevel_pl_monthly` hourly.

## Known data note (connector)
FY2025-26 invoice vouchers were backfilled via Tally's Voucher Register report route, which returns them without the
consolidated `ALLLEDGERENTRIES.LIST` (revenue sits under inventory `ACCOUNTINGALLOCATIONS`). The connector's flattener
(`tally_voucher_line`) does not read inventory allocations, so that table is short for those vouchers. The raw
`tally_object` is complete. This pipeline works around it (party-group balancing identity). The durable connector fix
is in `Tally CoPilot/connector/internal/vlines/vlines.go` (`primaryListKey`) + the SQL `entry_lines()`, plus a re-run
of `backfill_voucher_lines` — tracked separately.

## Accuracy
Current-FY monthly totals reconcile to the exact `v_fs_line` P&L within ~0–1% for full-form books (COLORIX exact),
up to ~5% for books heavy with legacy short-form vouchers. Headline KPIs in the app use `buildPnl` (exact); this table
drives trend-chart shape only.
