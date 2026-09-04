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
- [x] ✅ **Verify: a third customer added end-to-end through the Setup screen alone** — done in the
      browser on 04-09-2026 with the user's go-ahead, as **ZZ TEST Kalahansh** (3 ticked ledgers,
      80 items, Bushra as recipient). No SQL, no migration, no deploy. The account is REAL and kept
      on purpose: P5 needs something to build the Order Desk against. Delete on request.
- [x] The picker told the three Kalahansh ledgers apart by book (`· Colorix — Surat`, `· Enterprise`,
      `· O-tec`) and listed the two `-MACHINE` ledgers separately, so they were visibly not ticked
- [x] The main-ledger picker offered **only the three ticked**, and the recipient list only people
      with edit access to Order to Dispatch
- [x] The created account: `is_external true`, `is_staff FALSE`, **exactly one grant**
      (`customer-orders:edit` — no `task-management` default, Correction 9 avoided), `phone null`,
      linked to its org, `can_raise true` via the customer branch. **The login works.**

#### 🔴 Two defects the browser found that review had not

- [x] **Chrome autofilled the ADMIN'S OWN email and password into the new-customer login fields.**
      The password manager sees an email box beside a password box, decides it is a sign-in form, and
      fills in the signed-in admin's credentials — in plain text once the eye is clicked, in a field
      about to be handed to an outside firm. Worst case the admin changes only the email and gives a
      customer a login whose password is the admin's own. Fixed with `autoComplete="new-password"` on
      all three login fields; `"off"` is NOT enough, Chrome ignores it on inputs it has decided are a
      login. **Verified gone: the fields came back empty on the next load.**
- [x] **The dialog was too narrow** (`lg`). Now `3xl` with a genuine two-column layout — widening
      alone would only have added whitespace beside the same single file of fields. ⚠ The first
      attempt put three controls in a row and `FieldLabel` lays its hint on the SAME LINE as the
      label: at a third of the dialog the hint wrapped to five lines and pushed its input a row below
      the other two. Two columns, short hints, and the long explanation moved to a sentence beneath.
      **Both are invisible in the markup and only appear on screen.**
- [x] `reload()` is now **awaited before the dialog closes**, on both save paths. I saw a stale
      "0 customers" once right after creating and could NOT reproduce it — the identical reload
      demonstrably refreshes on the edit path, so it was most likely my screenshot racing the
      refetch. Awaiting it costs nothing and removes the question; on the FIRST customer that
      window would read "0 customers" under a full empty state, and the obvious response to that
      is to press Add again and make a second account for the same firm.

#### ✅ P0-7 re-run properly — a LIVE external account, over HTTP, not a SQL simulation

- [x] 22 tables read through PostgREST as the customer: every master and every FMS table **0 rows**;
      `profiles` and `app_access` **1 row each** (their own); `fms_dispatch_customer_orgs` /
      `_logins` **0** — the ticked-ledger list never reaches them (Q11 honoured by never sending it)
- [x] All **11 storage buckets: 0 objects**; a delete against `fms-purchase-docs` removed nothing
- [x] `mst_refresh_party_companies`, `generate_recurring_tasks` → **Not authorized**;
      `list_org_people` / `_detail` → 0 rows; the two admin RPCs → 0 rows
- [x] And the three that ARE theirs work: profile **1**, items **80**, orders **0**
- [x] 🔴 **Correction 8 proved, not asserted.** With **65 profiles — 64 staff + 1 real external
      account** — the work-snapshot dry run returns **`wouldSend: 64`**. Before the fix it would have
      been 65, and the customer would have received our internal work digest at 09:00 IST.

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

## P4 — Credit check completes the order  ·  DONE

- [x] `fms_dispatch_complete_customer_intake` — company → location → type, ledger-limited,
      re-points `customer_id`, **re-points item lines to the billing book**, stamps completion
- [x] `fms_dispatch_record_credit_check` refuses while incomplete — patched by substitution
      (Mechanic A), anchored on the `can_act` line, aborting rather than writing an unanchored body
- [x] `fms_dispatch_customer_intake_options(order)` — the picker offers only what the server accepts
- [x] `StepModal` completion section (only for an incomplete customer intake, only on `credit_check`),
      seeded from the org defaults. Saved **before** the verdict, as its own call: the verdict RPC
      refuses while incomplete, so the order of the two is load-bearing, and a verdict that then fails
      for its own reasons leaves the details already saved rather than three fields to re-type
- [x] `DispatchStepper` orphan fallback names the real recipients — Correction 6.
      ⚠ **Scoped to the orphan case only.** My first version named the recipients on *every* step of a
      customer order; once credit check fills in the site, the ordinary per-site owners are right again
      for every step after it. The recipients own the order's ARRIVAL, not the whole flow
- [x] "Not yet decided" wording (delivered in P3); company/location filters routed through
      `blankFilter.ts` so they read "(Blank)" like every other grid instead of an em-dash that sorts
      among the company names — blank on **every** customer order until credit check, so no longer rare
- [x] Verify: 7 checks in a rolled-back transaction — verdict refused while incomplete, off-list company
      refused, completion re-points the ledger and stamps, lines 1-of-3 → 2-of-3 in the billing book,
      verdict then accepted, second completion refused, customer window shut

> ⚠ **A known edge, measured and deliberately NOT fixed.** After completion, an ADMIN saving the order
> through the ordinary staff Edit form hits `fms_dispatch_replace_lines`, which needs an
> `mst_party_items` row for the pair — present for only **36 of 62** possible lines on the primary
> company and **0 of 62** on two of the books. It is pre-existing (true today of any staff order whose
> lines cross books; 219 of 4,009 live lines already do) and OD-13 makes it likelier, not new. The
> alternatives are worse: restricting the picker to items in every book cuts Bishen from 62 items to a
> handful; re-pointing only where the mapping exists drops the primary case from 59 lines to 36, trading
> invoice-book correctness — which is what decision 3 asks for — for an admin-only editing convenience;
> and creating the missing rows is a silent write to a governed central master. An ordinary clerk never
> reaches this path at all, because `canEditOrder` requires raiser/admin/coordinator.

## P5 — The Orange Order Desk  ·  DONE, and walked end to end in the browser

- [x] `apps/customer-orders/` + `appInfo.ts` entry + `registry.tsx` registration. Registered like
      any other module ON PURPOSE even though no member of staff will use it: registering is what
      puts it in the Module Access matrix and the User form, which is the only way an admin can
      SEE who holds a customer login. An unregistered id still works as an `app_access` grant —
      it is simply a grant nobody can find, which is the failure this module was audited for.
- [x] Own minimal shell (`OrderDeskShell`) — **not** `AppShell`, **not** `UserMenu`. No sidebar,
      no breadcrumb, no bell, no Home link, and the logo does NOT link (every other logo in the
      portal points at `/`, the marketing landing page — a dead end with a "Sign in" button on
      it for somebody already signed in).
- [x] Place an order · My orders · One order · Change password
- [x] `lib/customerLabels.ts` — every sentence that is not the customer's own data. The status
      map only RENDERS: `fms_dispatch_my_orders` collapses the state server-side, so the browser
      never holds a step name to re-derive one from.
- [x] Item picker de-duplicates by name across books. **Proved on screen: 80 options, 80
      distinct, zero duplicates**, grouped "Heads / Ink / Spare Parts" — not `spare_parts`.
- [x] `HomeLayout` redirect for external accounts (not `Login.tsx` — the directory carrying
      `isExternal` has not loaded when it navigates). Placed AFTER the hooks, or the hook count
      changes between renders when the directory arrives.
- [x] `/account` too — `RequireModule` cannot cover it, because it is portal furniture rather
      than an app. A customer typing the path would land on "My Account" with a department, a
      designation and a Home link into the staff launcher. Sent to their own password screen.
- [x] Wording sweep. Nowhere in the app: "Order to Dispatch", "FMS", "Orange One Hub",
      "dispatch", "credit check", or any step name.
- [x] The browser TAB. Nothing else in the portal sets `document.title`, so the customer's tab,
      history and bookmark all read "Orange One — One Platform. Every Workflow." — our internal
      name and our marketing line. Set to "Orange Order Desk", and RESTORED on unmount so an
      admin who looks and leaves does not keep it over the Control Center.

#### 🔴 Three defects found while building and testing, none visible in review

- [x] **`fms_dispatch_my_orders` returned the item NAME and not the item ID, which made
      "Change this order" DESTRUCTIVE.** Everything needed to display an order; nothing needed
      to re-open one. The edit form pre-selects each line in a picker keyed on the id, so it
      would have opened with every quantity filled and every item blank — and
      `replace_customer_lines` DELETES before it inserts, so saving would have emptied the
      order rather than failing loudly. On a one-line order it happens to raise "Add at least
      one item"; on a two-line order where one item resolved, the save succeeds and the order
      silently loses a line. ⚠ The tempting fix — match the line back by NAME — is a trap this
      codebase has already written down (`scopeParties.ts`: join by id, never by name), and it
      would have appeared to work until the first item renamed in Tally.
      Migration `20261110140000`.
- [x] **The closed-window sentence contradicted the status eight lines above it.** On screen,
      in one glance: *"Placed · We have your order and are checking it now"* over *"This order
      is now being PREPARED and can no longer be changed."* The window shuts on ANY recorded
      credit decision and a HOLD is one — `cc_decided_at` stamped, buttons gone, status
      deliberately still "Placed" because Q6 forbids saying a hold happened. So the two were
      guaranteed to disagree on every held order, and the sentence asserted something FALSE:
      a held order is sitting still, not being prepared. Now: "This order has gone past the
      point where it can be changed." It makes no claim about our state, so it contradicts no
      pill. **The server's two refusals changed with it** (migration `20261110150000`) — they
      are near-identical on purpose, so a stale tab racing a decision shows the customer the
      same sentence twice rather than two different explanations.
- [x] **An item ON an order can have left the customer's list since**, and a `Combobox` handed
      a value with no matching option renders EMPTY — the customer would have seen a quantity
      against a blank item, assumed it was still loading, and saved an order one line shorter.
      Now it keeps its name in a "No longer on your list" group and says what is wrong.

#### ✅ Walked end to end on the live database, as the real customer login

- [x] Placed **SO-2627-1132** through the screen: `intake_source='customer'`, company, site and
      dispatch type all NULL, provisional ledger KALAHANSH FASHIONS LLP, requester the display
      name. The duplicate-item guard fired and disabled the button before it went.
- [x] 🔴 **Corrections 3 and 6 proved on a real null-location order**: the named recipient
      Bushra reads `see=true`, `act=true`, and was the only person told. Not a simulation.
- [x] Changed it (25 → 40 KGS) — item and note preserved, which is the `item_id` fix working.
- [x] **The server refuses, not just the buttons.** On a REAL staff order (a nil UUID never
      reaches the ownership check and proves nothing): read → `[]`, customer update/cancel →
      "That is not your order", and even the staff cancel RPC → "Only the person who raised
      this order, a coordinator or an admin can cancel it".
- [x] **P4's completion panel, in a browser for the first time.** The company picker offered
      exactly the three ticked companies — not all thirty. Choosing one turned Dispatch
      location from optional into required and filled it with O-tec's two real sites.
- [x] **`record_credit_check` refuses an incomplete intake even for an ADMIN calling it
      directly**: "Fill in the billing company, dispatch location and dispatch type for this
      customer order first."
- [x] 🔴 **Correction 4 proved on live data, not asserted.** Credit hold recorded with a
      deliberately internal reason. All four notifications went to Bushra; `is_the_customer`
      is FALSE on every one. As the customer: notification rows readable **0**, activity rows
      readable **0**, the word "INTERNAL" nowhere on their screen.
- [x] Window shut on `cc_decided_at`: buttons gone, and the RPCs refuse a hand-made call with
      the same wording the screen shows.
- [x] Change password: both validations, a real change, and a change back — then signed in
      again to prove it. `user_metadata` holds only `email_verified` and `name` — **no phone,
      no password**. The self-service path never touches the admin re-pin machinery.
- [x] Routing, as the customer: `/home` → `/order-desk`, `/account` → `/order-desk/password`,
      `/order-to-dispatch` → `RequireModule` → `/home` → `/order-desk`. The two guards compose;
      nobody is trapped in a loop.
- [x] As an ADMIN: the app explains itself instead of failing, and points at Setup.
- [x] Test order **cancelled and cleaned up** — the fake hold reason named a real colleague and
      Bushra was holding a notification about it. The customer's screen now reads "Cancelled",
      which verified that mapping on the way out.

## P6 — Passwords and the staff-assumption fixes  ·  DONE

- [x] **The password re-pin is refused for external accounts** (`store.tsx`). Without it, ANY later
      admin save of a customer's record — a corrected spelling of their name — silently reset the
      password they were using, with nothing on screen saying so. Proved by saving ZZ TEST
      Kalahansh's record **twice** through the form and signing in afterwards with the unchanged
      password.
- [x] **`set-password` no longer writes the password into `user_metadata`** (Edge Function v14).
      It stored `{ phone: password }` for EVERY account — a second, permanent copy of a live
      credential in a field the client SDK hands back on every `getUser()`. For staff the value
      happened to equal their own mobile so it read as harmless; the moment a password stops being
      a phone number it is simply a stored password. Nothing in the codebase reads `user_metadata`
      (grepped), so dropping the write is inert.
- [x] 🔴 **And `set-password` no longer mirrors into `profiles.phone` for an external account.**
      That line is right for staff — the phone IS the password, so showing the number shows both —
      and on a customer it would have written their real password, in plain text, into a column
      every admin can read, the user export includes, and the Users list prints beside their name.
      Verified after two saves: `phone` is still **null**.
- [x] **`UserForm` gains an External toggle**, settable only when CREATING; on an existing account
      it is a read-only badge. Flipping it later is far-reaching in both directions (on → the
      account leaves `list_org_people` and `is_staff` starts refusing it across ~200 policies;
      off → a customer is handed the staff portal), and not something an admin correcting a
      spelling should do by accident.
- [x] Ticking it **clears the module grants**. A new user is seeded `{ task-management: edit }` —
      right for a colleague, and on a customer a grant to an internal app that nobody chose and
      everybody forgets. It cannot be fixed in the `useState` initialiser: the form always opens as
      staff, so the seed is already in state by the time the box is ticked.
- [x] It also **drops the mobile-required rule**, which was the only hard blocker besides the name.
      Requiring it would make a customer literally unsaveable, and the way past it is to invent a
      number — which then becomes their password.
- [x] Org fields hidden, not merely optional: employee code, gender, DOB, department,
      sub-department, designation, band, role, reporting HODs. All already nullable, so nothing had
      to be relaxed — but leaving them on screen invites an admin to fill them in, and a customer
      filed under somebody's HOD is worse than a shorter form.
- [x] `Hierarchy.tsx` — every customer carried `role: "employee"` and no HOD, so each one landed in
      the amber **"Unmapped employees — assign a HOD"** card PERMANENTLY: an action item that can
      never be actioned, growing by one per customer, in the card whose whole job is to say
      somebody still has to do something.
- [x] `Users.tsx` — an **External** badge (a customer read as "Employee" with an unfinished
      record), a Staff/Customers filter, an "N external" count, and a subtitle that says
      "Customer login · ✉ …" instead of "— · No dept".
- [x] `ModuleAccess.tsx` — the same badge, in the one screen where ticking a box by mistake hands
      an outside firm an internal app.
- [x] `exportUsers.ts` — a **Staff / External** column before Role, and Role reads "—" for a
      customer. The sheet is what somebody opens to audit access; five blank org columns and the
      word "Employee" made a customer indistinguishable from a new joiner.
- [x] `list_org_people` / `_detail` and the Master Report access matrix already excluded externals
      — shipped in P0c (`od13_p0c1`, `od13_p0c4`).

#### 🔴 One more defect found in the browser, and one PRE-EXISTING bug tripped over

- [x] **`ShareLoginModal` has TWO call sites and I wired only one.** The Users list passed
      `isExternal`; the User form's own post-save panel did not — so the panel that opens
      *immediately after saving*, when the admin is actually about to send the message, still
      offered a customer the staff script: "usually their mobile number", "use Reset password to
      re-pin it to their mobile number" (an instruction that now does nothing at all), and "change
      your password from **My Account → Change password**" — a screen external logins are
      redirected away from. This text is COPIED AND SENT, so a wrong sentence is delivered to
      another company over our name. Same shape as the `[[if …]]` marker that printed raw on a live
      contract: one reader updated, the other not.
- [x] 🔴 **PRE-EXISTING, NOT OD-13, AND SERIOUS: an admin who saved their own user record
      permanently demoted themselves.** Hit it by accident on the live workspace while testing that
      staff behaviour was unchanged, and restored the row by hand.

      `directoryWrites.setUserRole` DELETED then INSERTED, as two separate PostgREST requests, and
      `user_roles_admin_write` checks `is_admin(auth.uid())` — which reads `user_roles`. So the
      delete COMMITS, and the insert is then evaluated against a workspace where the caller is no
      longer an admin:

          DELETE → allowed (still an admin)   → their only role row is gone
          INSERT → REFUSED (no longer admin)  → the account is left with NO role at all

      `useSession` then reads them as an ordinary employee and `RequireRole` bounces them out of
      `/admin` — the only screen that could put the row back. **In a workspace whose last admin
      does this, nobody reaches /admin again without going into the database.**

      Fixed by inverting the order: insert first (evaluated while the old row still exists, so the
      caller is still an admin), then delete the others (evaluated with both rows present, so it
      passes too). A genuine self-demotion still works and still ends with exactly one row. ⚠ Not
      an `upsert` on its own — the unique constraint is `(user_id, role)`, not `user_id`, so an
      upsert would leave the old role sitting beside the new one. Plus `store.tsx` now skips the
      role write entirely when the role has not changed, which is the case that caused this.
      **Re-ran the exact sequence afterwards: saved, one role row, still admin.**

- [x] **Staff behaviour proved unmoved**, not assumed: saving a staff record still re-pins, the
      `profiles.phone` mirror is still written, sign-in with the mobile still works, and the panel
      still says "their login password is their mobile number".
- [ ] ⚠ **Residue, flagged not fixed:** every staff account saved before v14 still carries a copy
      of its password in `auth.users.user_metadata.phone`. For staff that value equals their mobile,
      which is already in `profiles.phone`, so it discloses nothing new — and nothing reads it. It
      simply stops being updated from now on. Clearing the 64 existing copies is a decision, not a
      side effect of this task.

## P6 — original checklist

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
