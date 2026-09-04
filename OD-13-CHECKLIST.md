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

## P1 — The identity, built for N customers  ·  DB + screen done

- [x] Migration: `fms_dispatch_customer_orgs` (display_name, party_ids, primary_party_id, customer_location,
      notify_user_ids, default_location_id, default_dispatch_type, active) — `active` defaults **false**
- [x] Migration: `fms_dispatch_customer_logins` (profile_id PK, org_id, active)
- [x] `fms_dispatch_customer_org_of(uid)` helper — requires the login **and** the org to be active
- [x] `fms_dispatch_save_customer_org(p jsonb)` — validates: ≥1 ledger, all `is_customer` + active,
      `primary_party_id ∈ party_ids`, **≥1 notify user** with edit access, and readiness before activating
- [x] ⚠ **AND ONE NOBODY WOULD THINK TO ADD**: at most **one ticked ledger per billing company**.
      Two make "which Bishen?" ambiguous at credit check and P4's re-point a coin toss. A ledger with
      **no** company is refused too — it could never be chosen, so ticking it is a trap
- [x] RLS on both tables: admins + dispatch coordinators only
- [x] Setup → **Customer Logins** section: grid (sort + filter every column), add/edit
- [x] **"Add a customer"** single action: org → auth user (`is_external`, real password) →
      grant `customer-orders` **only** → login row. Org first, so a failure never orphans an auth account
- [x] Readiness check: refuses to activate with no ledgers / no main ledger / no recipient / **no mapped items**,
      and **names** what is missing rather than counting it
- [x] `admin-users` Edge Function: `isExternal` + explicit `password` on create — staff path byte-identical.
      Deployed (v13). ⚠ First deploy used `--no-verify-jwt` and flipped `verify_jwt` off against
      `config.toml`; caught and redeployed. **Deploy without the flag — the CLI reads config.toml.**
- [x] Verify: 10 refusals proved in a rolled-back transaction; readiness `item_count = 62` for Bishen's
      five ledgers, matching the audit's predicted distinct-item count exactly
- [ ] 🔴 Verify: add a third, fictional customer end-to-end through the screen alone
      — **needs the user's go-ahead: it creates a real auth account** (ground rule)

## P2 — Raise without joining step owners  ·  DONE

- [x] `fms_dispatch_can_raise` branches on `customer_org_of`
- [x] `fms_dispatch_orders_select` + `fms_dispatch_can_see_order`: recipient arm **and** same-org arm
- [x] ⚠ The policy spells the arm out as an `EXISTS` instead of calling the helper: the helper takes
      `raised_by`, which varies per row, so it cannot be an InitPlan and would run two nested
      SECURITY DEFINER calls per order across ~4,000 rows — the 472 ms lesson in `20260730130000`
- [x] `fms_dispatch_can_act__ungated`: recipient arm, **before** the assignee check
- [x] Client recipient arm — **in `canActOn`, not `isStepOwner`** (Correction 6). `isStepOwner` also
      answers "do I own this step anywhere" for the nav; widening it would give a recipient a nav entry
      for every step of a module they own no step in. Fed by `fms_dispatch_customer_order_actors()`,
      which returns two columns and keeps the ticked-ledger list on the server
- [x] `fms_dispatch_announce`: external recipients dropped from every type not on a **customer-safe
      allowlist**, which is `{}` for release 1 — so turning the module's email switch on can never
      post an internal step alert to a customer's inbox
- [x] Verify: `can_raise` agrees with the ORIGINAL expression for all 64 profiles (0 disagreements);
      the new read arm is false for every (profile × existing raiser) pair, so P2 is provably a no-op today
- [x] Verify with a **non-admin, non-coordinator, non-step-owner** recipient (Bushra), so the `true`s
      can only come from the new arm: Correction 3 reproduced (`false` before) then fixed (`true` after);
      Jayshree, not named, still `false`; the customer can act on **nothing**; the credit-hold reason
      produced **0** notification rows for the customer and **1** for the recipient

> ⚠ **Found while testing, NOT introduced, and deliberately not changed.**
> `fms_dispatch_is_step_owner__ungated` reads `p_location is null or o.location_id is null or …`, so a
> null location means **any** location — while `fms_dispatch_can_see_order` treats the same null as
> "the fallback grant only". The comment on `fms_dispatch_is_natural_step_owner` says "covered by the
> fallback grant only", which its own callee contradicts. Effect on a customer order: every credit-check
> owner at every site may *act* on it but cannot *see* it, so it is inert today — visibility is the
> binding constraint. Changing it would move the staff flow, which this task must not do.

## P3 — The order shape  ·  DONE

- [x] Migration: `intake_source`, `intake_completed_at`; `dispatch_type drop not null`
      *(the existing CHECK already passes on NULL, so no constraint edited and no row rewritten)*
- [x] `fms_dispatch_submit_customer_order(p jsonb)` — a **sibling** of `submit_order`, never a branch
- [x] `fms_dispatch_customer_window_open(p_order)` — **including the rounds test** (Correction 5)
- [x] `fms_dispatch_update_customer_order` + `fms_dispatch_cancel_customer_order` (window, then hand off)
- [x] 🔴 **`fms_dispatch_replace_customer_lines` — the plan said reuse `replace_lines` unchanged, and
      that is wrong.** It validates against the order's single `customer_id` (the provisional primary
      ledger), so **26 of the 62 items the picker offers Bishen would be refused** — in our internal
      words, "Add the pair in Central Masters". The sibling validates against the union of ticked ledgers
- [x] `fms_dispatch_announce` also **adds** the org's named recipients: on a customer order the twelve
      call sites' own choices resolve to nobody, so a customer cancellation would have reached no one
- [x] `fms_dispatch_my_customer_profile()` / `_my_items()` / `_my_orders()` — the customer reads **no
      table directly**. `my_items()` de-duplicates by name (62 for Bishen, matching the audit)
- [x] `DispatchType | null` — the audit said 9 sites in 6 files; it is **17 `tsc` positions across the
      same 6 files** (`StageQueue`'s union inference multiplies them). One helper, `dispatchTypeText()`
- [x] "Not yet decided", not a bare `—` — delivered here, where the sites were being touched anyway
- [x] `SalesOrderFormState.dispatchType` widened to `DispatchType | ""`; a new staff order still starts
      at "local", and `toInput` **throws** rather than casting, so a caller that skips `validate()` fails loudly
- [x] Correct the two now-false comments (`stepConfig.ts` "no step legitimately does not know them",
      `OrderRefPanel.tsx` "settled the moment the order is raised") — plus the `DispatchType` doc comment
- [x] Verify: submit → notify (recipient 1, customer 0) → `my_orders` reads *placed*, `can_change` true →
      edit inside the window → credit check → window shut, edit **and** cancel refused →
      **part-delivered loop-back: the obvious rule reopens (`t`), ours stays shut (`f`), the customer
      reads *part_dispatched* not *placed*, and the cancel is refused by the SERVER**
- [x] Verify: an item mapped only to a NON-primary book is accepted (`NOVACRON YELLOW XKS HD 1000`)
- [x] `npm run build` green; SO counter unchanged (1131) — the counter is a table, so tests roll back

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
- [x] 🔴 `work-snapshot` sender — skips `is_external` (Correction 8). **Done early, before any account
      exists, because it fires on account CREATION rather than on anything the customer does.**
      Filtered inside `loadPeople()`, the one function that answers "who exists", so the eleventh
      customer is safe for the same reason the first is — no exclusion list to maintain.
      Proved on the live deployment: `wouldSend = 64`, unchanged, so it narrows nothing for staff.
      Confirmed the risk was real: **all 64 profiles received today's digest** at 09:00 IST
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
