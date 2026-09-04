# OD-13 — execution checklist

Working checklist for the approved plan (`~/.claude/plans/task-od-13-eventual-rose.md`).
Ticked as each step is **done and verified**, not when it is written.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified · `[!]` blocked / needs a decision

---

## P0 — Close the four security holes  ·  ships as its own commit, before anything else

### P0-0 · Safety net (do this first, always)
- [x] `_rls_baseline_20260904` — snapshot every `public` policy (name, cmd, roles, qual, with_check) before touching one
- [x] `_storage_policy_baseline_20260904` — same for `storage.objects`
- [x] Write `ROLLBACK-P0.sql` that regenerates every policy from those two tables
- [x] **Rehearse the rollback on live**: apply → verify → roll back → verify the counts match the baseline → re-apply
      *(a rollback that has only been read is not a rollback)*

### P0-1 · The identity primitive
- [x] Migration: `profiles.is_external boolean not null default false`
- [x] Migration: `public.is_staff(uid)` — `uid is not null and not exists (… is_external)`, STABLE SECURITY DEFINER
- [x] Verify: `is_staff()` returns true for every existing profile row (count must equal total)

### P0-2 · The 207 table policies
- [x] `DO` block over `pg_policies` (`public`, `cmd='SELECT'`, `qual='true'`) → `TO authenticated USING (is_staff(auth.uid()))`
- [x] Narrow `fms_dispatch_activity_select` (+ `and is_staff(...)`) — stops the customer reading credit-hold reasons
- [x] Narrow `fms_dispatch_step_assignees_select` (+ `and is_staff(...)`)
- [x] Verify: zero remaining `qual='true'` SELECT policies in `public`
- [x] Verify: zero remaining `{public}`-role SELECT policies on those tables

### P0-3 · The six storage buckets
- [x] `fms-import-docs` · `fms-purchase-docs` · `fms-production-docs` · `fms-sampling-docs` · `fms-asset-docs`
      → add `AND is_staff(auth.uid())` to SELECT, INSERT, UPDATE **and DELETE**
- [x] Verify: no `storage.objects` policy remains that is a bare `bucket_id = '…'`

### P0-4 · The RLS-disabled backup table
- [x] `alter table pc_resolve_rpc_backup_20261012 enable row level security` (no policy = deny)
- [x] Verify: `anon` and `authenticated` can no longer select from it

### P0-5 · The SECURITY DEFINER functions  ← the biggest single piece of P0
- [x] Produce the classification list: 205 unguarded functions → `helper` / `delegating` / `needs-guard`
- [x] Verify each `delegating` one actually checks in its inner function (do not assume)
- [x] Guard every `needs-guard` function with `if not is_staff(auth.uid()) then raise …`
- [x] `list_org_people()` + `list_org_people_detail()` — exclude `is_external` rows AND refuse external callers
- [x] Master Report access-matrix RPC — same exclusion
- [x] Verify: re-run the classification query — 46 guarded + 4 rewritten; **~160 low-risk helpers deferred to P3**
      *(⚠ the classifier is a regex on the body and misses a guard that lives in a `WHERE` clause — it wrongly
      flagged `fms_ocpi_last_contact_for` and `fms_hr_module_user_ids`, both of which are correctly gated)*
- [!] 🔴 **611 SECURITY DEFINER functions are still executable by `anon`** (default PUBLIC grant, bypasses RLS).
      Bigger than OD-13 and needs its own pass — see WORKLIST. **Not a blocker for the customer login** (they are
      `authenticated`, and the guarded ones now refuse them), but it is a live hole for anyone with the anon key.

### P0-e · The holes P0a stepped over  ·  found by P0-7, not by re-running P0a's own check
- [x] `app_lead_masters_global_select` — SELECT, role `{public}`, `auth.uid() IS NOT NULL` → `is_staff`
- [x] `fms_travel_step_assignees_select` — the twin of the policy P0a narrowed **by hand** in dispatch, and missed here
- [x] `task_remark_mentions` INSERT `WITH CHECK (true)` — P0a only ever looked at `cmd='SELECT'`
- [x] 7 × `*_master_requests_insert` — any signed-in account could file a master request in seven modules
- [x] Verify: **zero** permissive policies in `public`/`storage` on **any** command still admit a bare signed-in account

### P0-6 · Frontend, minimum for P0
- [x] `liveDirectory.ts:28` — add `is_external` to the explicit column list (or it never reaches the browser)
- [x] `types.ts` `Profile.isExternal`; `session.tsx` `isExternal`
- [x] `database.types.ts` + the local row cast in `liveDirectory.ts` + the 8 seed profiles in `data.ts`
- [x] `npm run build` green

### P0-7 · Prove it
**Method, and a deviation worth knowing.** No throwaway auth account was created. A real `profiles`
row was *shaped* like a customer login inside a transaction that was then forced to roll back —
`is_external = true`, role employee, no department, no HOD, no app grant, and its tasks/notifications
removed — with `request.jwt.claims` and `role` set exactly as PostgREST sets them per request. This
is faithful (it is the same RLS path an HTTP call takes) and it is **stronger than a DevTools sweep,
because it enumerates all 295 tables instead of a sample**. It also avoids creating a `profiles` row
that the live `work-snapshot` job would auto-enrol and email at 09:00 IST — Correction 8, unfixed
until P6. Data was verified intact afterwards (6,455 tasks, 400 notifications, 219 app grants, 0 external).

- [x] ~~Create a throwaway account~~ → modelled in a rolled-back transaction instead (above)
- [x] Every table: **2 of 295 return a row** — `profiles` and `user_roles`, both own-row. Correct.
- [x] Storage: **0 of 3,124 objects** visible; delete refused
- [x] Guarded RPCs: `mst_refresh_party_companies`, `mst_refresh_item_companies`, `fms_asset_next_seq`,
      `fms_purchase_next_seq`, `generate_recurring_tasks` → all *Not authorized*;
      `list_org_people` / `_detail` → **0 rows** (empty by design, so pickers do not error)
- [x] Writes: `task_remark_mentions` insert → refused by RLS
- [x] **Positive control** — the same row as ordinary staff: **195 of 295 tables**, **235 storage objects**,
      and the five formerly-bare buckets still read (import 29, production 107, purchase 89, sampling 10)
- [x] `npm run build` green
- [ ] As ordinary staff in the browser: walk Order to Dispatch, Procurement, Import, HR, Travel, Production
      *(the SQL positive control proves the policies; this proves the screens)*
- [ ] Commit P0 on its own · update WORKLIST.md OD-13

> ⚠ **The trap this phase caught, and it is the reason P0-7 exists.** P0a verified itself with its own
> predicate — "0 policies still read `USING (true)`" — which proves only that the sweep swept what it
> looked for. Sitting in the seat found four more holes it could never have reported. The first run of
> the sweep also reported **219 of 295 open**, which was the *test* being wrong, not the lock: it
> borrowed the founding admin's row, and every `*_write` policy is `FOR ALL` (so it covers SELECT) and
> permissive (so `is_admin` ORs straight past `is_staff`). **`is_external` says "not staff"; it does not
> take a role away.** Model the account, don't just flip the flag.

---

## P1 — The identity, built for N customers

- [ ] Migration: `fms_dispatch_customer_orgs` (display_name, party_ids, primary_party_id, customer_location,
      notify_user_ids, default_location_id, default_dispatch_type, active)
- [ ] Migration: `fms_dispatch_customer_logins` (profile_id PK, org_id, active)
- [ ] `fms_dispatch_customer_org_of(uid)` helper
- [ ] `fms_dispatch_save_customer_org(p jsonb)` — validates: ≥1 ledger, all `is_customer`,
      `primary_party_id ∈ party_ids`, **≥1 notify user**, and every notify user can *see* the order
- [ ] RLS on both tables: admins + dispatch coordinators only
- [ ] Setup → **Customer Logins** section: grid (sort + filter every column), add/edit
- [ ] **"Add a customer"** single action: create auth user → `is_external` → grant `customer-orders` only → org + login rows
- [ ] Readiness check: refuses to activate with no ledgers / no recipient / **no mapped items**
- [ ] Verify: add a third, fictional customer end-to-end through the screen alone — no SQL, no deploy

## P2 — Raise without joining step owners

- [ ] `fms_dispatch_can_raise` branches on `customer_org_of`
- [ ] `fms_dispatch_orders_select` + `fms_dispatch_can_see_order`: recipient arm **and** same-org arm
- [ ] `fms_dispatch_can_act__ungated`: recipient arm, **before** the assignee check
- [ ] Client `isStepOwner` (`store.tsx:599`): matching recipient arm — Correction 6
- [ ] `fms_dispatch_announce`: drop the customer from internal announcement types — Correction 4
- [ ] Verify: staff permissions provably unchanged (spot-check each arm against a staff uid)

## P3 — The order shape

- [ ] Migration: `intake_source`, `intake_completed_at`; `dispatch_type drop not null`
- [ ] `fms_dispatch_submit_customer_order(p jsonb)`
- [ ] `fms_dispatch_customer_window_open(p_order)` — **including the rounds test** (Correction 5)
- [ ] `fms_dispatch_update_customer_order`; narrow `fms_dispatch_cancel_order` for external raisers
- [ ] `DispatchType | null` — fix the 9 `tsc` sites in 6 files
- [ ] Correct the two now-false comments (`types.ts:339`, `stepConfig.ts:150` / `OrderRefPanel.tsx:73`)

## P4 — Credit check completes the order

- [ ] `fms_dispatch_complete_customer_intake` — company → location → type, ledger-limited,
      re-points `customer_id`, **re-points item lines to the billing book**, stamps completion
- [ ] `fms_dispatch_record_credit_check` refuses while incomplete
- [ ] `StepModal` completion section (only for incomplete customer intakes), pre-filled from org defaults
- [ ] `DispatchStepper` orphan fallback names the real recipients — Correction 6
- [ ] "Not yet decided" wording; blank-filter fix on company/location columns

## P5 — The Orange Order Desk

- [ ] `apps/customer-orders/` + `appInfo.ts` entry + `registry.tsx` registration
- [ ] Own minimal shell (company name, sign out) — **not** `AppShell`, **not** `UserMenu`
- [ ] Place an order · My orders · One order · Change password
- [ ] `lib/customerLabels.ts` — the single status map (rounds tested first) **and** the item-type labels
- [ ] Item picker de-duplicates by name across books
- [ ] `HomeLayout.tsx:22` redirect for external accounts (not `Login.tsx` — session not loaded there)
- [ ] Wording sweep: no "Order to Dispatch", "FMS", "Orange One Hub", "dispatch", "credit check", no step names

## P6 — Passwords and the staff-assumption fixes

- [ ] `store.tsx:343` — skip the re-pin for external accounts
- [ ] `admin-users/index.ts:94` — drop `user_metadata.phone = password`
- [ ] `admin-users` create — explicit password for external, never derived from phone
- [ ] `UserForm.tsx` — External toggle; hide staff fields; drop the mobile-as-password rule;
      **start `moduleLevels` empty** (Correction 9)
- [ ] 🔴 `work-snapshot` sender — skip `is_external` (Correction 8) · **outward-facing, before P8**
- [ ] `Hierarchy.tsx:14`, `Users.tsx`, `ModuleAccess.tsx`, `exportUsers.ts` — External signal

## P7 — Verify the whole thing

- [ ] `npm run build` green
- [ ] Full flow on a real login (place → notify → complete → status → edit refusal → cancel)
- [ ] **Part-delivered case**: partial credit → ship → confirm → reads *Partly dispatched*, edit+cancel refused by the server
- [ ] **Credit-hold case**: our reason is absent from the customer's notification rows
- [ ] Staff flow unmoved, in every module P0 touched
- [ ] A third customer added through Setup alone

## P8 — Issue the two logins  ·  only on explicit go-ahead

- [ ] Confirm with the user before creating real accounts
- [ ] Bishen Dyeing · Ganga Fashions
- [ ] Cherry-pick to `oo-master`; do not merge this shared branch
- [ ] WORKLIST.md OD-13 closed with date + commit
