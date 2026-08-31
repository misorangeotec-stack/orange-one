# Travel Desk — build log & checklist

**Module:** Travel Desk · `apps/travel-desk` · id `travel-desk` · tables `fms_travel_*` · base path `/travel-desk`
**Plan of record:** `C:\Users\Admin\.claude\plans\now-we-want-to-flickering-metcalfe.md`
**Tracked in WORKLIST.md as:** TR-1
**Sources:** `Misc/Bushra Reports/Travel Desk/` — `Travel_Desk_FMS_PRD_v2.0_Professional.docx`,
`Travel_Desk_FMS_Developer_PRD_v3.0.docx`, `OOT_Domestic_Travel_Policy_V1.0_Final.docx`
**Started:** 23-Aug-2026

This file is the LIVE LOG. Tick items as they land; add a dated note under a phase when something
changes shape. Same role `OCPI.md` plays for OCPI and `CENTRAL-MASTERS.md` for the masters operation.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped

---

## Status at a glance

| Phase | What | State |
|---|---|---|
| 0 | Audit & plan | `[x]` done 23-Aug-2026 |
| 1 | Foundations — SQL backbone + module skeleton | `[x]` done & verified 23-Aug-2026 |
| 2 | Masters, governance & rate cards | `[x]` done & verified 23-Aug-2026 |
| 3 | Trip request & entitlement | `[x]` done & verified 23-Aug-2026 |
| 4 | Approval chain | `[x]` done & verified 23-Aug-2026 |
| 5 | Travel advance | `[x]` done & verified 23-Aug-2026 |
| 6 | Booking + AI ticket extraction | `[x]` done & verified 23-Aug-2026 |
| 7 | **The money engine (DA + caps, SQL)** | `[x]` done & verified 24-Aug-2026 |
| 8 | Expense claim + AI bill extraction | `[x]` done & verified 24-Aug-2026 |
| 9 | Finance review & settlement | `[x]` done & verified 24-Aug-2026 |
| 10 | Round-out — reports, email, thread, lifecycle, cross-module | `[x]` done & verified 24-Aug-2026 |

**Gate for every phase:** `cd frontend && npm run build` green (tsc strict; there is no test runner).

---

## Blocked on HR — what must be answered, and when it bites

| # | Item | Blocks | Needed by |
|---|---|---|---|
| H1 | **Band → travel category.** §2's two tables contradict each other: Band 8 is TC-A *and* TC-B; Band 3 is TC-D *and* TC-C. Live headcount: Band 3 = 17, Band 8 = 6 — **23 of 59 employees** | Confirming the rate card; every cap, DA rate and class rule | **Before go-live.** Build proceeds with both readings seeded on a draft card |
| H2 | **The half-DA rule.** §8.1 reads *"departs after 2 PM and returns before 2 PM **on the same calendar day**"* — impossible as written | **No longer blocking.** Phase 7 reads it as a trip spanning two calendar days (out after 14:00, back before 14:00 next day), which is the only reading under which the sentence does any work and does not collide with the NO-DA rule above it | Confirm before go-live. Every threshold is a row in `da_rules` and every DA day stores its own factor and reason, so a different answer is a settings change plus a recompute — never a migration |
| H3 | TC-D air threshold: **>4 hrs** (§2), **>16 hrs + Tier 1** (§4.1), **>18 hrs** (Annexure A) | Nothing — defaults to a documented reading, flagged in the UI | Before go-live |
| H4 | Retrospective approval window: **48 h from return** (§3.1) vs **24 h from departure** (§3.5) | Nothing — same | Before go-live |
| H5 | TC-A air class: bare *"Economy"* (§2) vs *"Business permitted, upgrade reimbursed"* (§4.1, Annexure A) | Nothing — same | Before go-live |
| H6 | **DA has no city dimension** in §8.2, though the section title and Annexure A both say city-wise; all four categories propose the same ₹1,000, contradicting §2's Highest/High/Mid/Base | Seeding real DA figures | Phase 2 seeds proposals; confirm before go-live |
| H7 | **Hotel caps are ranges**, not figures ("₹3000 to ₹5000"), and Tier 1 = Tier 2 in every row | Seeding real hotel caps | Phase 2 seeds proposals; confirm before go-live |
| H8 | **Company GSTIN** — `[⚠ CONFIRM with Finance]` in §7.1 and §11.3 | Hotel-folio guidance + the ITC register | Phase 8 |
| H9 | ~30 `[⚠ CONFIRM]` amounts (Annexure C: *"no rate is final until the Directors sign off"*) | Caps **enforcing** rather than advising | Before go-live |
| H10 | Does Band 6-8 need HOD **and** Director? §3.2's own `[⚠ CONFIRM]` | Nothing — it is a config key | Phase 4 |
| H11 | Two plain `employee`-role staff have **no reporting-manager row** at all | Nothing — degrades to the step-owner list | Phase 4 |

**The build is not blocked; go-live is.** That is exactly what the effective-dated, confirm-gated rate card is for.

---

## Standing rules — these apply to EVERY phase

- [ ] `module_can_edit(uid, 'travel-desk')` is **in the body** of every write predicate from day one — never retrofitted
- [ ] Every RLS policy scoped `to authenticated`, never `{public}` (`anon` holds table grants)
- [ ] Every helper call in a policy wrapped in a scalar sub-select — `using ((select public.is_admin(auth.uid())))`
- [ ] **No write policy on the head table** — every mutation goes through a `security definer` RPC
- [ ] Each migration carries a prose header, `⚠` notes for every non-obvious decision, a `-- Reversal (reverse order):` block, and a closing `do $$ … raise exception` assertion
- [ ] Migrations are additive-only and idempotent (`if not exists`, `or replace`, `drop policy if exists`, `on conflict do nothing`)
- [ ] Every grid uses `QueueTable` / `MasterCrud`: sort on every column, searchable cascading filter under every column, **flat — no `groupBy`**
- [ ] An empty *result* keeps the table standing with a Clear-filters row; `EmptyState` is keyed on unfiltered rows only
- [ ] Money is `numeric(12,2)` per line / `numeric(14,2)` totals; rendered by the module's own `money()` (en-IN, full figures) — **never** receivables' Lakh/Crore `fmtINRMoney`
- [ ] Reference numbers are `TRV-<fy>-0001`, minted on **submit**, never on draft save
- [ ] `stepCompletedIso` and `stepActorId` are edited together — a step in one and not the other is dated but unnamed
- [ ] Test data removed at the end of every phase; counters rolled back; email switch verified still OFF

---

## Phase 0 · Audit & plan `[x]`

- [x] Extract and read both PRDs and the Domestic Travel Policy
- [x] Map the FMS engine — steps, queues, SLA, `StepPipeline`, `PoStageRail`, `QueueTable`, `MasterCrud`
- [x] Map the SQL backbone — foundations, RLS, RPCs, storage, email, Master Report registration
- [x] Map the org masters — bands, departments, designations, `user_hods`, `app_access`
- [x] Probe live data — band occupancy, HOD coverage, existing "Travel Desk" references, deployed functions
- [x] Confirm the four scope decisions with the user (full lifecycle · one trip many legs · stops at Paid · rate card unconfirmed)
- [x] **Second audit round — 12 corrections + 8 policy contradictions found**
- [x] Write the plan
- [x] Write this checklist
- [ ] Raise H1 and H2 with HR **now** — they have the longest lead time

---

## Phase 1 · Foundations `[x]` done & verified 23-Aug-2026

### SQL — `20261005120000_add_fms_travel_foundations.sql`
- [x] `fms_travel_step_owners` (`step_key` unique, `department_ids`, `designation_id`, `employee_ids`)
- [x] `fms_travel_config` (jsonb key/value singletons)
- [x] `fms_travel_counters` + `fms_travel_next_seq(text)` + `fms_travel_fy_code(date)`
- [x] `fms_travel_activity` (append-only; also carries the comment thread in phase 10)
- [x] `fms_travel_notifications` (per-user bell feed)
- [x] `fms_travel_announce(...)` — the single fan-out; email arm added in phase 10
- [x] `fms_travel_employee_settings` (base city, seat/meal preference, frequent-flyer no)
- [x] Storage bucket `fms-travel-docs` + 4 placeholder policies, names `"fms travel docs read|insert|update|delete"`
- [x] Authz helpers: `is_step_owner` · `is_coordinator` · `step_owner_ids` — gate in-body. **`can_act` deferred to phase 3**: it must read the trip row for that trip own reporting managers, so it ships with `fms_travel_trips`, exactly as OCPI put `can_act` in its deals migration

### SQL — `20261005120100_register_travel_module.sql`
- [x] `email_module_settings` row, `enabled = false`
- [x] `master_report_modules` row — `head_table fms_travel_trips`, `closed_statuses {closed,cancelled,rejected}`, `detail_path /travel-desk/monitoring`, **`due_column` NULL** . Installed **disabled**: `master_report_snapshot()` builds dynamic SQL over `head_table` for every enabled row, and `fms_travel_trips` does not exist until phase 3 — an enabled row would break the director report for all eleven other modules. Phase 3 flips it on
- [x] **No `app_access` seed** — admins bypass; every other grant is a decision about a named person

### Frontend skeleton
- [x] `apps/appInfo.ts` — the `travel-desk` entry (name, basePath, category `hr`)
- [x] `apps/travel-desk/meta.tsx` — `AppManifest`, **order 30**, inline SVG icon
- [x] `apps/travel-desk/TravelDeskApp.tsx` — internal `<Routes>` + guards
- [x] `apps/registry.tsx` — import and register
- [x] `types/index.ts` (statuses + `STATUS_STEP`), `TravelDeskLayout.tsx`, `nav.tsx`, `store.tsx`, `components/Loaded.tsx`
- [x] `lib/steps.ts` — the 9-step chain + 4 `STAGES` (**array order is semantic**)
- [x] `lib/queues.ts` — `buildQueueEntries`, `stepCompletedIso`, `stepActorId`, **`ANCHOR_AT` map**
- [x] `lib/sla.ts` — `createStepSlaModel` + `OVERRIDES` + `TRIGGER_STEPS`
- [x] `lib/format.ts` — `money()` (copied from hr-exit), status labels
- [x] `data/travelFetch.ts` (`travelQueryKey(userId)`) + `data/travelWrites.ts`
- [x] `pages/Dashboard.tsx` + `pages/monitoring/ControlCenter.tsx` shells (real zero counts)
- [x] `apps/fms-control-center/adapters/travel-desk.ts` + register in `adapters/registry.ts`

### Verify
- [x] `npm run build` green — tsc strict + vite, **4,152 modules, 34.6s**, zero errors
- [x] Admin sees the launcher card under **HR**, after New Recruitment and Employee Exit; `/travel-desk` renders with all 8 queues at zero — **verified in the browser**: breadcrumb reads HR → Travel Desk; the launcher lists it third under HR after New Recruitment and Employee Exit; all 8 queues render in chain order; the Control Center shows the 4-stage rail all-clear; and the cross-FMS scoreboard carries a Travel Desk row (5th, after Employee Exit) with the other eleven modules unaffected. 0 console errors
- [x] `pg_policies`: RLS on every new table, **0** policies scoped `{public}`, every helper wrapped `(select …)` — verified: 6 tables, RLS on all 6, 11 policies, **0** scoped `{public}`, 6 functions, 4 storage policies
- [x] Permission boundary proved **in the database** with a temporary grant, then cleaned up: no grant → `none`, cannot raise; `view` → reads, cannot raise; `edit` → raises, cannot approve — **proved**: no grant → `none` + owner false *even while named on the step*; `view` → `view` + owner still false; `edit` → owner true, and false for a step they do not own. Grant and probe row deleted afterwards

---

## Phase 2 · Masters, governance & rate cards `[x]` done & verified 23-Aug-2026

### SQL — `20261005120200_add_fms_travel_masters.sql`
- [x] `fms_travel_cities` (name, state, **tier 1/2/3**) — seeded from §1.3. Note **Surat, the HQ, is Tier 2**
- [x] `fms_travel_purposes` — the PRD's 9, `requires_remarks` on *Others*
- [x] `fms_travel_expense_categories` — the 15 claim-form rows **plus §15's non-reimbursable list as rows with `reimbursable = false`**, so the category itself refuses alcohol, fines and personal entertainment
- [x] `fms_travel_airlines` · `fms_travel_hotels` · `fms_travel_bus_operators`

### SQL — `20261005120300_add_fms_travel_rate_cards.sql`
- [x] `fms_travel_rate_cards` (`label`, `effective_from`, `status` draft|confirmed|superseded, `confirmed_by/_at`)
- [x] `fms_travel_rates` (`rate_card_id`, `rate_type`, `travel_category`, `city_tier`, `key`, `amount`, `text_value`, `notes`)
- [x] `fms_travel_resolve_rate(...)` — the one lookup everything else calls
- [x] `fms_travel_confirm_rate_card(...)` — supersedes the previous card, forward-only

### SQL — `20261005120400_seed_fms_travel_rate_card.sql`
- [x] Seed a **draft** card from the policy's PROPOSED figures, every row marked unconfirmed
- [x] `rate_type = band_category` seeded with the **majority reading**, and bands 3 and 8 flagged `disputed = true` with the full contradiction in `notes` — plus **`fms_travel_confirm_rate_card()` REFUSES to sign off a card while any disputed row stands**, so H1 cannot be silently inherited. The TC-D air threshold (H3) is the third disputed row
- [x] Hotel caps recorded as the **midpoint of the stated range** with the range in `notes` (H7)
- [x] DA seeded per travel category with a **null city tier** until H6 is answered

### SQL — `20261005120500_add_fms_travel_master_governance.sql`
- [x] `fms_travel_master_managers` · `fms_travel_master_requests` (+ pending-unique index)
- [x] `fms_travel_is_master_manager` · `fms_travel_resolve_master_request`

### Frontend
- [x] `pages/masters/Masters.tsx` — tabbed `MasterCrud`, Excel round trip, deactivate-never-delete
- [x] `pages/rate-cards/RateCards.tsx` — **matrix editor**, one TC × Tier grid per `rate_type`, effective dating, confirm action
- [x] `pages/MasterRequests.tsx` + `components/RequestMasterModal.tsx` + `lib/masterFields.ts`
- [x] `pages/settings/MasterOwnersSection.tsx`

### Verify
- [x] `npm run build` green — tsc strict + vite, 44.1s, zero errors
- [x] Every masters tab sorts, filters (cascading) and survives an Excel round trip — verified in the browser: 6 tabs, sort arrows and a cascading filter on every column, Export/Import present, Edit/Deactivate per row, Surat correctly Tier 2
- [~] An unconfirmed card **warns and does not block**; confirming it makes caps enforce — **half proved.** The refusal half is verified: the seeded draft card reports **3 blockers**, and the Sign-off button is disabled reading "3 to resolve first". The *enforcement* half cannot be shown until there is a claim to check a cap against — **carried to phase 7**, where `fms_travel_card_enforces()` gets its first caller.
- [~] A superseded card still prices a trip that froze it — the mechanism is in place (`fms_travel_card_enforces` treats `superseded` as enforcing, and `resolve_rate` looks up by card id regardless of status), but it needs a trip carrying a frozen `snap_rate_card_id` to demonstrate. **Carried to phase 7**.
- [x] Master ownership is scoped: an owner of `city` answers true for cities and **false** for rate cards — **proved in the migration**: a real non-admin made owner of `hotel` answers true for hotels and **false** for cities; the probe was deleted afterwards. All six master write policies now consult `fms_travel_is_master_manager`, not `is_admin`
- [x] A request reaches Master Requests, is correctable before approval, and writes its activity row — the RPC lets the reviewer correct the payload before approving, and Reject stays disabled until a reason is typed

---

## Phase 3 · Trip request & entitlement `[x]` done & verified 23-Aug-2026

### Prerequisites — `20261005120600_add_profile_gender_dob.sql`
- [x] `profiles.gender` + `profiles.date_of_birth`, nullable, CHECK-constrained (airlines require both per passenger)
- [-] ~~Both added to `guard_profile_org_fields()` so nobody edits their own~~ — **deliberately NOT done, a change of mind from the plan, reasoned in the migration header.** That guard protects department / sub-department / designation / band / employee code, every one of which decides an ENTITLEMENT or a PERMISSION, which is why only an admin may set them. Gender and date of birth decide nothing: they are personal details whose only victim, if wrong, is the person who owns them and who is best placed to fix them. Locking them behind an admin would mean HR typing sixty dates of birth and every later correction becoming somebody else's ticket. So they are editable by the person themselves (Account) and by an admin (User form), exactly as `name` and `phone` already are
- [x] Added to `liveDirectory.ts`'s **explicit column list** — a column not listed there never reaches the browser, silently and with no error anywhere
- [x] `core/platform/types.ts` `Profile` + `core/admin/UserForm.tsx` + `core/account/Account.tsx` + `directoryWrites.ts` + `store.tsx`'s `updateUser` patch type + `database.types.ts` (`profiles` Row/Insert/Update) + the `data.ts` mock profiles

### SQL — `20261005120700_add_fms_travel_trips.sql`
- [x] `fms_travel_trips` — identity · **frozen snapshot** (`snap_band_no`, `snap_travel_category`, `snap_department_id`, `snap_designation_id`, `snap_base_city_id`, `snap_rate_card_id`, `approver_manager_ids uuid[]`, `approver_manager_note`) · journey · skip flags · advance · roll-up · per-step stamps · lifecycle · `edited_*` distinct from `updated_at`
- [x] Status CHECK (15 statuses) + `complete_when_submitted` conditional CHECK + `return_after_departure` + `actual_return_after_departure` + 6 indexes + `set_updated_at` trigger
- [x] `fms_travel_passengers` (max 5, configurable), cascading off the trip
- [x] `fms_travel_can_see_trip()` + the inlined SELECT policy (**two copies of the rule — they move together**). **No write policy on either table**: the RPC is the only door
- [x] `fms_travel_can_act` — deferred from phase 1 because it must read the trip. Its manager arm **falls through** to the step owners rather than early-returning
- [x] `master_report_modules` row switched **on**, now that its `head_table` exists

### SQL — `20261005120800_add_fms_travel_trip_rpcs.sql`
- [x] `fms_travel_default_approvers` — reads `user_hods`; an empty array is a NORMAL answer
- [x] `fms_travel_write_trip` (internal, **not granted**) · `fms_travel_save_draft` · `fms_travel_delete_draft`
- [x] `fms_travel_submit_trip` — freezes the snapshot, mints `TRV-<fy>-0001`, sets `director_approval_skipped = band <= 5`, and **re-stamps `submitted_at` on every submission** so a returned-and-resubmitted trip does not arrive already overdue (the lesson OCPI's `20260929121700` had to retrofit)

### SQL — `20261005120900_add_fms_travel_passenger_rpcs.sql` *(not in the plan — see the note below)*
- [x] `fms_travel_set_passengers(trip, jsonb)` — replaces the list **whole**, inside one transaction, so a passenger dropped from the form is dropped from the booking
- [x] **Editable after submit, unlike the request fields**, because a misspelt surname is found by the coordinator at booking time and must be fixable without cancelling an approved trip. It closes only when the trip does

### Frontend
- [x] `lib/entitlement.ts` — mirrors `fms_travel_resolve_rate`'s most-specific-first walk; band → TC, hotel cap, DA, conveyance, mileage, meals, and the air/train/road entitlements. **Reads figures; enforces nothing** — the caps live in SQL and only in SQL
- [x] `components/EntitlementPanel.tsx` — the live read-out, with the draft-card and disputed-figure banners
- [x] `components/TripForm.tsx` — **live entitlement read-out** and policy warnings before booking
- [x] §4.1's 7-day advance-booking rule **warns**; the PRD's 30-day window **blocks, in the RPC** — proved refused
- [x] `components/PassengerRows.tsx` — prefilled from the profile, never retyped; a blank profile does not wipe a hand-typed value
- [x] `pages/trips/` — `NewTrip` · `EditDraft` · `Drafts` · `MyTrips` · `TripsList` · `TripDetail`, plus `components/TripTable.tsx` (flat, sort + cascading filter on every column, column picker, Excel export)
- [x] `components/TripStepper.tsx` on `PoStageRail` — **first consumer of `skipped` in the codebase**. A skipped step renders greyed and captioned, never ticked green
- [x] `data/travelTripWrites.ts` + trips/passengers into `travelFetch` and the store (`passengersOf`, `myTrips`, `myDrafts`, `entitlementOn`)
- [x] Routes wired: `trips` · `mine` · `drafts` · `new` · `drafts/:id` · `trips/:id`

### Verify
- [x] `npm run build` green — tsc strict + vite, zero errors
- [x] **Every RPC proved as a real signed-in user**, not as postgres: `set local role authenticated` + a JWT claim, the whole run inside a transaction that ends in `rollback`, so it is a true dry run that cannot leave a row or burn a number
- [x] No grant ⇒ raising is refused by `fms_travel_save_draft` itself, not merely hidden by the UI
- [x] Full draft lifecycle: saved → passengers written → submitted → **deleted, and the counter never moves** (0 trips, 0 passengers, 0 counters, 0 grants afterwards)
- [x] Submitting mints `TRV-2627-0001` and freezes band, category, department, base city, rate card and managers. A **band 3** traveller → TC-C, `director_approval_skipped = true`; a **band 7** traveller → TC-B, `false`
- [x] A second submit is refused ("already awaiting manager approval"); a submitted trip cannot be saved as a draft, nor deleted
- [x] **The passenger list is still writable after submit** — the one thing that is, and deliberately
- [x] A traveller with **no reporting manager** submits fine: `approver_manager_ids` empty, the fallback note recorded, and the step falls through to the configured owners. This is not hypothetical — the band-7 test subject genuinely has no `user_hods` row, as 19 of 60 people do
- [x] Departure outside the 30-day window refused; a nameless passenger refused **by position** ("Passenger 2 has no name") with the existing list left intact rather than half-written; over the 5-passenger cap refused
- [x] A draft is private **at the database**: another employee holding an `edit` grant can neither edit it nor read it, and `fms_travel_save_draft` refuses with "This draft belongs to somebody else"
- [x] Email switch still **OFF**; `activity` and `notifications` both back to 0
- [x] **Browser pass, signed in as an admin, 0 console errors.** The entitlement panel is live as the form is filled: a **band 9** traveller shows TC-A, ₹4,000 Tier-1 hotel, no conveyance cap, "Economy — Business permitted"; switching the traveller to **band 3** re-resolves to TC-C, ₹1,750 and ₹800 **and raises the disputed-figure banner**. The 90%-of-estimate advance hint reads ₹16,200 against an ₹18,000 estimate; picking *Others* as the purpose makes the reason field appear and adds itself to the blocker list. A draft saved → landed on its detail page with the rail, the employee code and the frozen-at-submit card → reopened from Drafts with **every field restored** → thrown away. 0 trips, 0 passengers, **0 counters** afterwards
- [x] Two defects found by that pass and fixed, not deferred:
  - The hotel cap read **"Not set on this card"** before a destination was chosen, when the card in fact carries all twelve rows. "Nobody has filled this in", "the policy sets no cap" and "you have not told me the destination" are three different statements and now render as three
  - A **draft's** detail page showed no entitlement at all — it read `snap_band_no`, which submit has not written yet, so the panel said "choose who is travelling" on a screen that names the traveller in its own heading. A draft now prices off the traveller's **current** band and the card in force today, captioned as such; a submitted trip still reads only its own frozen card

**Note — a migration the plan did not name.** `fms_travel_passengers` shipped in phase 3's own `…120700` with a SELECT policy and, per the module's standing rule, no write policy at all. Nothing then granted a write door, so the passenger list would have been readable and unwritable. `…120900` is that door. Splitting it out rather than editing `…120700` keeps an applied migration immutable.

**Note — a view-only grant sees MORE trips than an edit grant, and that is intended.** `module_is_viewer` and `module_can_edit` are disjoint (`= 'view'` and `= 'edit'`), so a view-only user reads every trip while an edit user reads only their own, the ones they raised and the ones they approve. That asymmetry is the house pattern — `fms_ocpi_can_see_deal` is identical — and it is sharper here on purpose: a trip carries somebody's personal spending, so "All Trips" is effectively "my trips" for an ordinary employee, and the module-wide read is a deliberate grant.

---

## Phase 4 · Approval chain `[x]` done & verified 23-Aug-2026

### SQL — `20261005121000_add_fms_travel_approvals.sql`
- [x] `approval_matrix` config key — **routes on BAND NUMBER** (1–5 manager only; 6–9 manager + Director), defaulting per §3.2 and covering **H10**. `fms_travel_approval_matrix()` reads it; the fallback is BOTH signatures, never fewer
- [x] `can_act` manager arm reads `approver_manager_ids` and **falls through** to step owners — shipped in phase 3's `…120700` and proved here
- [x] **`fms_travel_next_stop` — THE ONE ROUTER.** submit, both decisions and resume all ask it. That is not tidiness: all three defects `20260905120000` documents share one root — separate code paths each deciding for themselves what comes next, and disagreeing about a step that was skipped
- [x] `fms_travel_decide` + `_manager` / `_director` wrappers — approve / reject / **return for clarification**
- [x] Self-approval guard. **Load-bearing, not belt-and-braces**: `can_act` returns *true* for a coordinator on every step, so without it the Travel Desk could raise a trip for themselves and wave it through
- [x] `director_approval_skipped` **and** `manager_approval_skipped` set at submit; `advance_skipped` too — phase 3 never set it, so the rail showed Advance as pending for ever on the majority of trips that draw none
- [x] §3.5 emergency retrospective rule with the **TC-D downgrade**, applied **at submit**, because that rule measures how late the REQUEST was and measuring it at approval would punish a traveller for a manager on leave. The original category is kept in `tc_downgraded_from` rather than overwritten
- [x] `fms_travel_save_draft` widened to a **returned** trip. Without it "send back for clarification" is a dead end: the approver asks for a change and the author's form refuses every edit
- [x] `fms_travel_hold_trip` / `_resume_trip` / `_cancel_trip` — **brought forward from phase 10**, because defect (F) is untestable without hold/resume and this phase is where the checklist demands that test

### SQL — `20261005121100_widen_fms_travel_hold_resume.sql` *(corrective, found by the verification)*
- [x] Hold and resume were coordinator-only while **cancel already accepted the traveller** — so the destructive action was the easy one and parking a slipped trip was the hard one. Both widened to the cancel list

### Frontend
- [x] `pages/queues/ApprovalQueue.tsx` — one screen for both gates. **No approve button on a row**: every figure the decision turns on lives on the trip screen, and approving from a list is approving without seeing any of it
- [x] `components/ApprovalPanel.tsx` + `ApprovalHistory` — reject and return both refuse without a reason; a skipped gate renders nothing at all; a skipped gate in the history says **"Not required"** rather than vanishing
- [x] `components/TripActions.tsx` — hold / resume / cancel, and the authorisation
- [x] `pages/settings/StepOwnersSection.tsx` · `CoordinatorsSection.tsx` · `ApprovalMatrixSection.tsx` (the last shows the live headcount each side of the threshold — a band number is an abstraction, "37 of 59 people" is the decision)
- [x] `lib/travelAuthorisationPdf.ts` — via `shared/lib/pdfBrand.ts`, **with the entitlement printed on it**. A slip saying "yes, go" is what the paper process produced and is exactly why every cap was discovered at claim time
- [x] Returned trips are editable from the UI, labelled "Edit and resubmit", with the reason on the form and **no** "throw away" (a numbered trip is cancelled, not deleted)

### Verify
- [x] `npm run build` green
- [x] A **Band-3** trip skips the Director step; a **Band-7** trip shows it — proved in SQL and in the browser
- [x] The skipped stage renders greyed and **"Not required"**, never ticked green
- [x] **The three `20260905120000` skip defects, each tested:**
  - **(E)** a Director calling `decide_director` on a band-3 trip is refused — *"Band 3 does not need Director approval (§3.2), so there is no decision here to make."* The panel does not render either
  - **(F)** held from `awaiting_booking` → resumed to `awaiting_booking`, **not** to the skipped Director step
  - **(G)** every `trip_submitted` / `trip_approved` recipient checked against `can_act` on the step the trip actually sits at: **0 bad**. It holds by construction — the recipients ARE that step's owners plus the trip's own approvers — but the sample was small (2 notifications), so the construction is the guarantee, not the count
- [x] A traveller with **no HOD row** degrades to the step-owner list rather than dead-ending (**H11**) — and the band-7 test subject genuinely has none, so this was not simulated
- [x] HR, as a step owner, acted **alongside** the named manager: the same trip was then approved by the Director, routing on to `awaiting_advance`
- [x] Approving produces the **Travel Authorisation PDF** with the entitlement printed on it — rendered and read back: one page, TRV-2627-0001, TC-C / Band 3, hotel ₹1,750, DA ₹1,000, conveyance ₹800, hire ₹2,000, Economy Saver, AC 3-tier, and *"Director — Not required — band 3 (§3.2)"*
- [x] Also proved: a reasonless reject and a reasonless return both refused · a returned trip keeps its number, clears `ma_at`, is edited and resubmitted to the **same** approver · a cancelled trip cannot then be held · a draft cannot be cancelled · the §3.5 downgrade fires 4 days late (TC-C → TC-D, stamped) and does **not** fire on an emergency raised in advance
- [x] Cleanup: 0 trips, 0 passengers, **0 counters**, 0 activity, 0 notifications, 0 step owners; email still **OFF**; the matrix left at §3.2's default

**Two defects the browser pass found, both fixed rather than deferred:**
- A skipped rail node printed **"Not required"** *and* **"Unassigned"** — which say opposite things. "Unassigned" is a PROBLEM (a stage the record will reach with nobody to action it); a bypassed stage is the opposite. Fixed in `PoStageRail` itself, inside the branch that only fires when `skipped` is set — so no other module's rail changes, since Travel Desk is still the only consumer of the prop
- **A returned trip had no way back into the form.** `fms_travel_save_draft` accepted it, but no screen offered the edit, so the author's only remaining move was to cancel a numbered, part-approved trip and start again — the exact outcome returning it was meant to avoid

**One shared-component addition:** `drawTable({ showHeader: false })`. A label/value fact list is a table with no column names to give, and the only previous way to hide the header was `headerSize: 0.01` — which still PAINTS the navy band and merely makes its text invisible, so the authorisation grew a solid blue bar that read as a rendering fault. Default is true; every existing caller is unchanged.

**Scope note — hold/resume/cancel moved from phase 10 to here.** The checklist demands defect (F) be tested in this phase, and it is untestable without them. An approval queue with no way to park a trip is also precisely where trips get stuck.

---

## Phase 5 · Travel advance `[x]` done & verified 23-Aug-2026

### SQL — `20261005121200_add_fms_travel_advance.sql`
- [x] `fms_travel_approve_advance` · `fms_travel_disburse_advance` (amount, date, mode, reference). **Two calls, not one** — §11.1 gives them different owners and different deadlines, and one button would mean an advance could only be agreed by somebody able to make a transfer
- [x] §11.1 cap — `fms_travel_advance_ceiling`, one function so submit, approve and disburse cannot disagree
- [x] §11.2 block — **no second advance while one is unreconciled**, in the RPC and not in a memo
- [x] `fms_travel_outstanding_advance(p_user, p_as_at)` **and `_by_code`** — the exit hand-off keys on `employee_code` with a nullable user id
- [x] `fms_travel_record_advance_recovery` — **not in the original checklist.** A cancelled trip's advance can never be netted against a claim, so without this §11.2 would bar that person from every future advance *for ever*, through no fault of theirs
- [x] `advance_skipped` set at submit — shipped in phase 4
- [x] `TRIGGER_STEPS` entry — due **before** departure, a negative offset via `addWorkingDaysSigned`

### SQL — `20261005121300_submit_checks_outstanding_advance.sql`
- [x] §11.2 checked at **submit as well**. The disbursement refusal is the real gate but arrives too late to be kind — by then the traveller has had the trip approved and planned around money that is not coming. It **refuses the submission** rather than silently dropping the advance, which would send the trip on with the traveller still expecting a transfer

### SQL — `20261005121400_freeze_employee_code_at_submit.sql` *(corrective, found by the verification)*
- [x] `fms_travel_write_trip` copies `traveller_employee_code` only if the caller sends it. The web form does — so this looked fine — but a coordinator or a script calling `save_draft` without it left the column NULL, and the by-code lookup then had only the profile to fall back on. That matters *precisely* when it is used: the Exit module looks a leaver up by code, and a leaver's profile is the record most likely to have been tidied by then

### Frontend
- [x] `lib/advance.ts` — mirrors the SQL; its header states plainly that for anyone but a coordinator it can **understate** the balance (the trips policy hands an ordinary employee only their own rows), so it may warn and must never be used to conclude an advance is allowed
- [x] `pages/queues/AdvanceQueue.tsx` — with an **"Already owes"** column, so Finance sees the §11.2 refusal coming instead of meeting it on the Save button
- [x] `components/AdvancePanel.tsx` + `AdvanceRecoveryPanel`
- [x] `pages/reports/OutstandingAdvances.tsx` — KPIs, a red card for money sitting on trips that will never reach a claim, ageing **from the day the money left** (§11's window runs from disbursement, and a trip whose departure keeps slipping would otherwise never appear to age)

### Verify
- [x] `npm run build` green
- [x] An advance above 90% of the estimate is refused **with a sentence**: *"Policy §11.1 caps the advance at 90% of the estimate, which is 18000.00 on this trip. Approve 18000.00 or less, or ask for the estimate to be corrected."* — not a constraint violation
- [x] A second trip requesting an advance while the first is unsettled is **refused at submit**, naming the amount and both ways out. The same trip **without** an advance then goes straight through
- [x] The advance step's due date is **before** the departure date — proved in the browser: departs 04-09-2026, due **03-09-2026**. Not clamped to zero
- [x] A trip with no advance skips the step **and `booking` is still dated from approval, not from trip creation** — proved by back-dating a trip's `created_at` by 40 days: created 14-Jul, approved 23-Aug, due **25-Aug** (two working days after approval). Anchored on the skipped step it would have been born ~40 days overdue
- [x] Also proved: a cancelled trip **keeps owing** · over-recovery refused · full recovery clears the balance and a fresh advance is allowed again · `outstanding_advance` agrees by id and by code, case-insensitively and whitespace-tolerantly · an as-at date before disbursement returns 0 · a different person returns 0
- [x] Cleanup: 0 trips, **0 counters**, 0 activity, 0 notifications, 0 step owners, 0 grants; email still **OFF**

**The defect the verification found.** `outstanding_advance` returned **18,000 by id and 0 by code** for the same person on the same trip. Not a bug in the lookup — the trip's frozen employee code was simply never set, because the test called `save_draft` the way a script would rather than the way the form does. The fix is in the right place: submit now freezes the code from the profile, so the snapshot is complete regardless of who filled the form.

---

## Phase 6 · Booking + AI ticket extraction `[x]` done & verified 23-Aug-2026

### SQL — `20261005121500_add_fms_travel_legs.sql`
- [x] `fms_travel_legs` — kind · direction · from/to city · dates+times · carrier/hotel · PNR · class · `ticket_cost` · `other_charges` · `refund_amount` · **`cancel_reason_kind`** (business/personal — §4.1 decides reimbursability) · doc path · `ai_extracted jsonb`
- [x] **`net_cost` is a GENERATED column**, not an RPC's arithmetic. ticket + other − refund is the definition of what a leg cost, and a definition living in three RPCs eventually disagrees with itself
- [x] **`booking_total` is maintained by a TRIGGER**, not by whichever RPC happened to touch a leg — the one that forgot would leave a figure quietly wrong for ever
- [x] `fms_travel_save_leg` · `remove_leg` · `fms_travel_complete_booking`. Legs stay **editable after the booking step closes**: a refund lands weeks later, and locking them is how refunds stop being recorded
- [x] `fms_travel_request_cancellation` · `fms_travel_process_cancellation` (records the refund, demands the §4.1 reason)
- [x] **A cancelled trip must still reach a claim** — the new status `cancelled_pending_claim`, which sits at the **claim** step. Routed by the MONEY, not by the request: fully refunded with no advance out ⇒ `cancelled`; anything left ⇒ the claim step
- [x] Three CHECKs: end ≥ start · no negative amounts · **a refund may not exceed what was paid** (which would make the trip's total negative)

### SQL — `20261005121600_fms_travel_doc_storage_policies.sql`
- [x] `fms_travel_doc_trip()` (`search_path = ''`, uuid-regex guarded) · `doc_slot()` · `can_see_doc()` · `can_add_doc()`
- [x] The four placeholder policies replaced; **write keyed on the SLOT**, not merely "may this person touch the trip" — the desk files tickets, hotel folios and cancellation evidence; the traveller files receipts and the mileage log
- [x] Path contract `<trip-id>/<slot>/<epoch>-<name>`, slots `ticket|hotel|receipt|approval|cancellation|mileage-log`. **It landed BEFORE the first document existed**, unlike the dispatch and OCPI equivalents which had to be retrofitted

### Edge function
- [x] `supabase/functions/extract-travel-doc/index.ts` — cloned from `extract-card`, with `parse-resume`'s document handling because a ticket is nearly always a PDF. Haiku 4.5 primary, Sonnet fallback on a weak read, strict JSON, `extractJson` salvage, modes `ticket` **and `bill`** (phase 8 needs the second and the prompts are deliberately separate — a single prompt covering both taught the model to guess at whichever half was absent)
- [x] `config.toml` `[functions.extract-travel-doc] verify_jwt = true` — a signed-in caller, `parse-resume`'s reasoning, not `extract-card`'s
- [x] Deployed to `icutjkrqkbzwvmnfbzpr`, **ACTIVE, version 1**

### Frontend
- [x] `pages/queues/BookingQueue.tsx`, one component in two modes — booking and cancellations. **Separate destinations on purpose**: unwinding a booking is the opposite job from making one and it is the urgent one, because a refund window closes
- [x] `components/LegRows.tsx` + `components/TicketCapture.tsx` (`FileCapture`, `compressImage`) + `components/BookingPanel.tsx`
- [x] `pages/reports/UpcomingTravel.tsx` + `CancelledTravel.tsx`

### Verify
- [x] `npm run build` green
- [x] One trip carries a **flight + a hotel + a train**, and its booking total is the sum: 4,880 + 6,195 + 1,040 = **12,115**
- [x] **Net cost = ticket + other − refund, per leg and rolled up.** A 1,500 refund on the flight took it to 3,380 and the trip to 10,615 — with no code recomputing anything, because the column is generated and the roll-up is a trigger
- [x] A refund larger than what was paid is refused by a CHECK; a trip cannot be marked booked with no legs on it
- [x] **A real ticket PDF and a JPG both extract**, through the actual UI with a real session. Both filled Kind=Flight, Surat → Ahmedabad (matched to the city masters, so the tier is real), 03-09-2026, 08:40/09:45, PNR 6E4KTQ, "Economy - Saver fare", 4,200 base and **680 of fees — the model correctly summed taxes 580 + convenience 100**, as the prompt asks. Confidence "high", model `claude-haiku-4-5`
- [x] **The extraction fills a form for a human to confirm and never writes a row.** The function takes no trip id, holds no service key and has no way to save; `ai_extracted` keeps the machine's unedited reading as EVIDENCE beside the human-typed fields
- [x] A business-reason cancellation is reimbursable and a personal one is not — both recorded on every leg, and the trip routed to `cancelled_pending_claim` in each case where money was left (4,420 business / 2,500 personal). Fully refunded with no advance ⇒ plain `cancelled`. A cancellation with **no reason kind is refused**
- [x] **Storage boundary holds**, proved predicate by predicate: the traveller may write their own `receipt` folder and **not** the `ticket` folder · the desk may write `ticket` · an unrelated employee is refused read **and** write on every slot · a malformed path, a traversal attempt, an unknown slot, an empty path and a non-existent trip all return **false — denied, never raised**, which is the whole reason the uuid regex is there (an exception inside a policy is a 500, not a denial)
- [x] End to end in the browser: the upload went through the newly hardened policy to `<trip-id>/ticket/<epoch>-ticket.jpeg`, the leg saved at net 4,880, and `booking_total` followed
- [x] Cleanup: 0 trips, 0 legs, **0 counters**, 0 files in the bucket, 0 step owners, 0 grants; email still **OFF**

**Two defects the browser pass found, both fixed:**
- **The carrier matcher only worked in one direction.** It tested `master.includes(extracted)`, so a ticket saying "INDIGO AIRLINES" failed to match the master's "IndiGo" — i.e. it failed exactly when the document is more verbose than the master, which is nearly always. Now matched both ways, **longest match winning**, so "Air India Express" cannot lose to "Air India" on a ticket that says both
- **An unmatched carrier had nowhere to be shown.** The extractor wrote the name into `carrier_other`, but the form rendered that box only for a cab or a train — so for a flight, hotel or bus the name was saved and *never displayed*, and nobody could correct it. The box now appears whenever no master row is picked

**Note — the status CHECK was widened, and that is the one thing in this module that cannot be cleanly reverted.** `cancelled_pending_claim` is additive, but narrowing the constraint again would orphan any row already carrying it. The reversal block in the migration says so rather than pretending otherwise.

---

## Phase 7 · The money engine `[x]` done & verified 24-Aug-2026

*The highest-risk piece in the module. Built and proved in SQL BEFORE any UI exists — and no UI was written in this phase.*

**H2 is resolved by READING, not by guessing, and the reading is config.** §8.1's half-DA sentence — *"departs after 2 PM and returns before 2 PM on the same calendar day"* — is unsatisfiable as written, and read literally it also collides with the NO-DA rule immediately above it. The only reading under which it does any work is a trip **spanning two calendar days**: out after 14:00, back before 14:00 the next day. That is what the engine implements. **Every threshold in it is a row in `da_rules`, not a number in a function**, and every day stores its own `factor` and `factor_reason`, so if HR answers differently the correction is a settings change plus a recompute, with a day-by-day diff to show what moved — never a migration. H2 stays open in the table above; it no longer blocks.

### SQL — `20261005121700_add_fms_travel_money_engine.sql`
- [x] `fms_travel_da_rules()` — the whole of §8/§13/§14 as **config**: `half_day_cutoff_hour` 14 · `full_return_hour` 18 · `short_overnight_factor` 0.5 · `partial_return_factor` 0.5 · `hosted_meals_factor` 0.5 · `hosted_both_factor` 0.25 · `conference_factor` 0.5 · `taper1_from_day` 8 / 0.75 · `taper2_from_day` 31 / 0.5 · `stop_after_day` 90 · `family_min_days` 15 / 0.75 · `family_exempt_from_band` 8
- [x] `fms_travel_city_on_day(p_trip, p_day)` — which city the traveller was in on a given date, read off the legs. This is what makes a multi-city trip price each day on **its own** tier rather than on the headline destination
- [x] `fms_travel_compute_da(p_trip)` — one row per calendar day, each carrying `factor` and the sentence explaining it. **Pure — it writes nothing**
- [x] `fms_travel_da_days` + `fms_travel_freeze_da(p_trip)` — the computed days written once at claim submit, Finance-overridable with a reason. A rule change may not rewrite a settled trip
- [x] `fms_travel_check_claim(p_trip, p jsonb)` — every cap in §7, §9, §10, §11.3, §15 and §16
- [x] `fms_travel_class_excess(p_trip)` — §16
- [x] `fms_travel_preview_claim(p_trip, p jsonb)` — lines + DA + §16 excess + totals in one round trip, **the same code the submit path runs**
- [x] Every disallowance carries a sentence naming the section and the figure, never a constraint name

**Deliberately no TypeScript copy.** OCPI accepts two copies of its branch rules; money rules must not have two authors. The claim form asks the server for its preview instead.

### Three readings the policy forced, each taken deliberately
- **§13 beats §8.1 on a conference.** §8.1 says DA is *not paid* when the company arranges all meals; §13's own conference row says **50%**. The narrower, more specific rule wins.
- **§14 has a fourth row that is not in any checklist: DA is discontinued after 90 days.** It is implemented (`stop_after_day`), because leaving it out would have quietly paid a 120-day deputation for its whole length.
- **§14.1 keys on BAND NUMBER, not travel category** — *"Band 1 to Band 7… TC-A (Band 8 & 9) exempted"*, which is another sighting of H1. Band numbers are unambiguous, so this rule does not wait on H1 being answered.

**§16 caps automatically, and says so plainly when it cannot.** The rate card holds the entitled *class* as words — "Economy — Saver fare" — not as a price, so there is nothing to cap against until a human records what the compliant option would have cost (`fms_travel_legs.entitled_fare`). The engine names the entitlement and asks for the comparable rather than inventing the size of a deduction from somebody's pay.

### Verify — 16 worked examples in SQL, each asserting an exact figure
**Daily allowance — 12 examples, every figure exact**
- [x] 3-day Tier 1 ⇒ **₹3,000**, factors [1, 1, 1]
- [x] Customer supplies meals ⇒ **₹1,500** (0.5 × 3); meals **and** room ⇒ **₹750** (0.25 × 3); room only ⇒ **₹3,000 unchanged**
- [x] Same-day round trip ⇒ **₹0**
- [x] **H2 — the short overnight**: out after 14:00, back before 14:00 next day ⇒ 2 days, factors **[0.5, 0]**, **₹500** total
- [x] Returns before 6 PM on the last day ⇒ [1, 1, 0.5] = **₹2,500**
- [x] 40-day deputation ⇒ 7 full + 23 at 75% + 10 at 50% = **₹29,250**
- [x] 122-day deputation ⇒ **32 zero days** past day 90
- [x] Family joining, 26 days, band 3 ⇒ all 26 days cut; **band 9 ⇒ 0 days cut** (exempt)
- [x] Multi-city ⇒ days 1–2 priced Tier 1, days 3–4 Tier 3, **from the legs**
- [x] **The rate follows the tier, it is not merely reported.** Proved by giving a card a Tier 3 DA row: the same trip returned **₹600 a day on that card and ₹1,000 on the card without one**. (The seeded card has one figure for every tier — that is **H6**, the policy's own missing city column, not an engine limitation)

**The claim checker — 15 examples, every figure exact**
- [x] Hotel ₹2,750 against the ₹1,750 TC-C Tier 1 cap ⇒ allowed **1,750**, disallowed **1,000**, with the §7.2/§7.3 sentence on the line
- [x] Same claim in a **Tier 3** city ⇒ cap **1,500**
- [x] **§7.3 exception under the ceiling**: ₹2,400 with evidence of unavailability + HOD approval ⇒ **allowed in full, 0 disallowed**, carrying the §7.3 note
- [x] §7.3 at **1.6× the cap** ⇒ still capped at **2,625** (the 1.5× hard ceiling), *"the rest needs written Director approval"*
- [x] **Alcohol ⇒ 0, refused BY THE CATEGORY** with its own sentence: *"Never reimbursable under any circumstances, regardless of band or whether a client was present (Policy 9.1 and 15)"* — no reviewer involved
- [x] Local conveyance ₹1,500 against the ₹800 Tier 1 daily cap ⇒ **800**
- [x] Team meal ₹1,600 for 4 ⇒ cap **₹1,200** (₹300 per person per meal)
- [x] A claim **35 days after travel ⇒ 0** with the §11.3 sentence; the same line **with Director approval ⇒ 1,500**
- [x] A line with **no receipt** falls to the category's self-declaration limit, and the reason says which rule bit — this is why two earlier runs showed 0 where a cap was expected
- [x] `preview_claim` totals: claimed **5,450** / allowed **2,550** / disallowed **2,900** / DA **3,000** / **net_payable 5,550**
- [x] **§16** — a Band-3 (TC-C) traveller booked in Business at net ₹18,500 against a recorded ₹6,200 comparable ⇒ **personal excess 12,300**, the sentence naming *"the TC-C entitlement (Economy — Saver fare)"*
- [x] The same leg with **no comparable recorded** ⇒ excess 0 and the engine **says so**, asking for the figure instead of inventing one
- [x] A train within entitlement ⇒ *"Within the band entitlement."*
- [x] **The frozen card decides.** A card superseded between the journey and the claim: the trip frozen on the old card is still capped at **1,750** and disallows **1,000**, while the identical claim on the new card's **4,000** cap is **allowed in full**
- [x] `npm run build` green; cleanup: **0 trips, 0 legs, 0 DA days, 0 test rates, 0 counters**, the seeded card still `draft`, email still **OFF** — every example ran inside a transaction that rolled back

### Two defects the worked examples found, both fixed
- **`text[] || 'literal'` is not an append.** Thirteen sites built the per-day reason as `v_why || 'some sentence'`. Postgres types the bare literal as an *array* and raised *"malformed array literal: Full DA — a complete calendar day…"* — i.e. the engine failed on the most ordinary day there is. All thirteen rewritten to `array_append`.
- **`20261005121800` — the leg's mode and the rate card's name for it are not the same word.** `class_excess` built its lookup by concatenation, `l.kind || '_entitlement'`. A leg's kind is `flight | train | bus | cab | hotel`; the card's rate types are `air_ | train_ | road_entitlement`. **Only `train` is spelt the same in both**, so a flight asked for `flight_entitlement`, got nothing, and named the entitlement it was capping against as the anonymous *"(band entitlement)"* — on the one line where naming it is the entire justification for a deduction from someone's pay. Worse, a flight with **no comparable recorded produced no note at all**, because that sentence is guarded on the entitlement resolving: the case the engine was built to speak up about stayed silent. A bus resolved nothing either — it was not in the list. The mapping is now explicit, with bus reading `road_entitlement` alongside cab per §5.

**A gap in the verification, not in the engine, and worth recording.** The first pass at *"§7.3 evidence + HOD ⇒ allowed"* used ₹2,750 — already above 1.5 × 1,750 = 2,625 — so it landed on the hard-ceiling branch and silently re-proved the example after it. Re-run at ₹2,400, where the allowance is what is actually being tested. An example that passes is not the same as an example that tests what its title claims.

---

## Phase 8 · Expense claim + AI bill extraction `[x]` done & verified 24-Aug-2026

### SQL — `20261005121900_add_fms_travel_claim.sql`
- [x] `fms_travel_claim_lines` — `category_id` · **`city_id`** (the hotel cap is per night *per city*) · date · description · `amount` · `gst_amount` · vendor · `gstin` · `invoice_no` · `has_receipt` · `self_declared` · doc path · **`cap_applied` / `allowed_amount` / `disallow_reason` / `engine_note` / `priced_at` — engine-written, ignored on the way in however hard a caller tries** · `ai_extracted jsonb`
- [x] **The row carries every INPUT the engine read, not just the amount** — nights, persons, days, km, guests, meal kind, vehicle type, full-day rental, the two §7.3 flags and the §11.3 Director flag. A line storing only "4,200" cannot be re-priced, so the first correction to a rate card or a return date would silently change the answer with nothing to explain it
- [x] **The column names ARE the engine's JSON keys** — `guests`, `meal_kind`, `vehicle_type`, `full_day_rental`. One word, one meaning, both ends. This is a direct consequence of the §16 defect below
- [x] Three CHECKs: no negative amounts · **GST may not exceed the bill** (it would flow into the ITC register as a credit that does not exist) · counts non-negative
- [x] **`fms_travel_next_stop` extended through the whole lifecycle** — claim → claim review → Finance → settlement, as further arms of THE SAME router. `20261005121000` stopped at booking because phases 6–9 did not exist; adding a second router would have been the exact shape of all three defects `20260905120000` documents
- [x] `fms_travel_record_actual_travel` — the real dates and times, plus the four DA inputs only the traveller knows (§8.3 customer-hosted, §13 conference, §14.1 family dates)
- [x] `fms_travel_save_claim_draft` — replaces the lines whole, like the passenger list. A diff means the client decides what changed, which is how a deleted row survives
- [x] `fms_travel_price_claim` — reads the stored rows, hands them to the **same** `check_claim` the live preview runs, writes back what came out, freezes the DA and rolls up the totals
- [x] `fms_travel_submit_claim` · `fms_travel_decide_claim` (approve / return, refusing without a reason)
- [x] **`net_payable` stays NEGATIVE when the traveller owes money back.** Flooring it at zero would hide exactly the figure §11.2 and the hr-exit `travel_advance` clearance row exist to read
- [x] **Nobody approves their own claim, including a coordinator and an admin** — tested on the TRAVELLER, not on who filed it, and for a stronger reason than the approval steps: this one releases money to the person deciding
- [x] A **return CLEARS `cl_at`**, so the one router puts the trip back on the claim step — which is the only state in which the lines are editable. No separate "reopened" state to get out of step

### `fms_travel_no_claim` — routed by the MONEY, not by the request
Same reasoning as a cancelled trip in `20261005121500`. *"I have no receipts"* is not *"the company owes nothing"*: the daily allowance needs no receipt at all, and an advance already paid has to come back. Proved in all three arms — same-day trip with no allowance and no advance ⇒ **closed** outright; 3-day trip with no receipts ⇒ **awaiting_claim_review with ₹3,000 of allowance**; same-day trip with ₹5,000 advance out ⇒ **awaiting_claim_review, net −5,000**.

### Edge function
- [x] `extract-travel-doc` mode `bill` was already built in phase 6 with a **separate prompt** from `ticket`; phase 8 is where it is used. It reads vendor, GSTIN, invoice no, date, city, gross, tax and a category guess

### Frontend
- [x] `data/travelClaimWrites.ts` · `components/ClaimPanel.tsx` · `ClaimReviewPanel.tsx` · `ReceiptCapture.tsx` · `DaPanel.tsx` · `pages/queues/ClaimQueue.tsx` · `ClaimReviewQueue.tsx` · `lib/claimFormPdf.ts`
- [x] **Not one cap, rate or DA rule anywhere in the frontend.** The form sends the lines as they are typed to `preview_claim` and renders what comes back. The stated divergence from OCPI: two authors of a branch rule is acceptable, two authors of a cap is somebody's salary
- [x] The preview is **debounced and race-guarded** — typing "1750" fires four requests, and without the sequence ticket the answer to "1" can land after the answer to "1750" and show a cap against a figure nobody typed
- [x] **A refusing category is labelled as refusing IN THE PICKER** — "Not reimbursable (§15)" — so somebody learns it before they type an amount and attach a photo
- [x] The extractor **never picks the category**, deliberately. The category decides reimbursability and the cap; a model guessing "Meal" over a bar bill would move money. It says *"it looks like a Hotel bill — pick the category yourself, because the category decides the cap"*
- [x] The §7.3 checkboxes appear **only on a hotel line that is actually over cap**, so they cannot be ticked where they mean nothing
- [x] Only the counts a category prices on are shown — a Nights box on a taxi fare is a box somebody fills in wrongly
- [x] **TRVL-FRM-01** with the policy's four §11.1 signature blocks. Three are printed as facts with names and dates; **the CFO block stays an empty ruled line**, because nothing in this module captures that approval and a pre-filled block for a decision nobody made is a forged document

### Verify
- [x] `npm run build` green
- [x] **Every guard fires with a sentence**: submitting on planned dates · submitting with no lines (pointing at *Nothing to claim*) · a line with no category · approving your own claim · editing a claim under review · returning with no reason
- [x] **The preview and the stored figures are IDENTICAL**, in SQL and again through the browser: claimed 5,150 / allowed 2,550 / disallowed 2,600 / DA 3,000 / net 5,550, with hotel 1,750 · conveyance 800 · alcohol **0 refused by the category**
- [x] Return → `booked` at the claim step, `returned_stage = claim_review`, **`cl_at` cleared**; the bar tab removed and resubmitted ⇒ claimed 4,250, disallowed 1,700, `returned_*` cleared
- [x] **DA frozen at submit does not move when the rate card changes** — the card's DA was pushed to 9,999 a day and the frozen figure stayed 3,000
- [x] The router runs the whole lifecycle: claim_review → finance_review → settlement → closed
- [x] **End to end in the browser, on a real trip.** A hotel bill PDF extracted vendor "THE GRAND BHAGWATI", the invoice number, GSTIN `24AABCT3518Q1ZV`, the date, ₹2,610 gross and **₹279.60 tax — the model correctly summed CGST 139.80 + SGST 139.80**. Picking the category made the cap appear **live**: ₹1,750 allowed, ₹860 disallowed with the §7.2/§7.3 sentence; ticking the two §7.3 boxes took it to **₹2,610 allowed in full** (under the 1.5× ceiling of 2,625). Filed ⇒ stored 2,610 / 0 / 3,000 / **5,610**, exactly the preview
- [x] **TRVL-FRM-01 renders**, ₹ intact throughout (the `pdfBrand` Poppins fix), three DA days each with its sentence, the settlement block reading *"Payable to the employee ₹5,610"*, and all four signature blocks
- [x] Cleanup: 0 trips, 0 legs, **0 claim lines, 0 DA days**, 0 counters, 0 files in the bucket; card still `draft`; email still **OFF**

### Three defects this phase found, all fixed
- **`20261005121800` — the leg's mode and the rate card's name for it are not the same word.** `class_excess` built its lookup by concatenation, `l.kind || '_entitlement'`. A leg's kind is `flight | train | bus | cab | hotel`; the card's rate types are `air_ | train_ | road_entitlement`. **Only `train` is spelt the same in both.** So a flight named the entitlement it was capping against as the anonymous *"(band entitlement)"* — on the one line where naming it is the entire justification for a deduction from someone's pay — and a flight with no comparable recorded produced **no note at all**, because that sentence is guarded on the entitlement resolving: the case the engine was built to speak up about stayed silent. A bus resolved nothing either. **This is why the claim-line columns are named after the engine's JSON keys.**
- **`20261005122000` — the daily allowance could not be frozen through the API.** `freeze_da` parked Finance's overrides in a temp table and cleared it with `delete from _da_keep;` — no WHERE clause. **PostgREST runs with `sql_safe_updates` ON**, so that is refused outright: *"DELETE requires a WHERE clause"*. Every phase 7 worked example passed because they ran on a session where the setting is off, so the function was correct everywhere except the one place it is actually called from. It surfaced when a real traveller pressed **File this claim**. The temp table is gone entirely — it was the wrong shape anyway, since `create temp table if not exists` inside a SECURITY DEFINER function interacts with PostgREST's **connection pool**, making the `if not exists` branch load-bearing in production and never taken in a test. **A rollback-wrapped SQL test run as the owner and the same code called through PostgREST as `authenticated` are not the same execution environment.**
- **Two opposite claims in one box, again.** A claim line with no category yet claims nothing, so it disallows nothing — and the verdict box, keyed on the disallowed amount, painted itself green and read **"₹0 allowed in full"** directly above the engine's own sentence saying the line could not be priced at all. The same defect the lifecycle rail carried in phase 4. It now keys on whether the engine had a complaint.

**Plus one latent defect in phase 4's work that only a two-page document could expose:** both travel PDFs passed the literal `"1"` as the total page count, so a claim form running to two pages footed them *"Page 1 of 1"* and *"Page 2 of 1"*. The Master Report and the receivables collections export have always used the `"{tp}"` placeholder resolved by `putTotalPages`; both travel documents now do too.

---

## Phase 9 · Finance review & settlement `[x]` done & verified 24-Aug-2026

**Finance is not a second author of the caps.** Every cap in §7, §9, §10 and §15 was applied by the engine before a claim reaches this step, and `allowed_amount` is **never overwritten**. What Finance records is a different figure *beside* it, with a reason — lower for a judgement no rule can make, higher for a §7.3 exception once the evidence is in the file. The engine's answer and the human's sit side by side on the row, and **the gap between them IS the Policy Exceptions report.** Had Finance edited the engine's answer in place — the obvious design — there would be nothing to report, and the only trace of an exception would be a total that no longer added up.

### SQL — `20261005122100_add_fms_travel_settlement.sql`
- [x] `fms_travel_claim_lines.finance_amount` / `finance_reason` / `finance_by` / `finance_at`, mirroring the DA override pair exactly. Two CHECKs: **a reason is mandatory**, and **a line may never be settled above what was claimed** — you cannot reimburse somebody more than they spent, and that is a constraint rather than a comment
- [x] `fms_travel_trips.fr_note` · `settled_mode` · `settled_note`
- [x] `fms_travel_price_claim` corrected twice: the roll-up now reads `coalesce(finance_amount, allowed_amount)`, and **the advance is netted at what is still OUTSTANDING rather than at what was gross paid** — a cancelled trip whose advance was handed back in cash already has `advance_recovered_amount` set, and netting the gross figure would take it off the traveller twice
- [x] `fms_travel_set_line_settlement` — Finance's per-line figure, in either direction. Passing `null` **clears** it, which is deliberately not the same as settling at zero: zero is a decision needing a reason, null is undoing one
- [x] `fms_travel_override_da_day` — the allowance is overridable **a day at a time, never in total**. A lump sum would leave a figure nobody could reconcile against the days that produced it, and §8 puts a reason on every day
- [x] `fms_travel_complete_finance_review` — **re-prices one last time** before handing the figures on, so settlement reads what is current rather than what the traveller submitted
- [x] `fms_travel_settle` — records amount, date, mode and reference, and closes the trip

### `fms_travel_settle` — a payment and a recovery are two different events
The RPC refuses to record one as the other, and the screen never asks which it is — **the claim decides**. The amount is always entered as a POSITIVE figure, because a payment stored as −4,390 is a row nobody can tie to a bank statement, and a user asked to type a minus sign will eventually forget it.

- **Paying** needs a reference (UTR, cheque, voucher); a figure differing from the net needs a note saying why.
- **Recovering** credits `advance_recovered_amount` as well as storing `settled_amount` negative. That column is what `outstanding_advance`, §11.2 and the Employee Exit `travel_advance` clearance row all read — settling without it would close the trip while the ledger still said the money was out, and the traveller would be refused their next advance for ever.
- **Nothing to move** closes the trip with a stamp and a sentence, taking no amount at all.

### Frontend
- [x] `data/travelSettlementWrites.ts` · `components/FinanceReviewPanel.tsx` · `SettlementPanel.tsx` · `pages/queues/FinanceReviewQueue.tsx` · `SettlementQueue.tsx` · `pages/reports/PolicyExceptions.tsx` · `GstItcRegister.tsx`
- [x] Each claim line reads **"Settles at ₹X · claimed ₹Y · engine ₹Z"**, so the three figures are never confused for one another
- [x] **The settlement panel renders past its own step.** Once a trip is closed it is the only place the amount, date, mode and reference are visible, and *"what was actually paid, against what reference"* is the question asked most often about a trip that finished months ago
- [x] The settlement queue holds payments and recoveries in **one list** with a Direction column — the same job done two ways, and splitting them would mean the person doing the bank run has to remember to check both screens

### Two reports that are not in the source PRD, and are the ones Finance and audit will live in
- [x] **Policy Exceptions** — three kinds of row in one list: `Capped` (the engine cut it, nobody argued), `Relaxed` (Finance settled ABOVE the allowance — the row an auditor is looking for), `Tightened` (Finance settled below). The §7.3 evidence column shows which half of the exception is on file, so a row reading *"HOD only"* or *"Evidence only"* is an exception granted without the whole of its basis
- [x] **GST input credit register** — the tax is **apportioned to the settled share** of each line, because tax on a disallowed portion is not claimable either. A ₹5,200 hotel bill capped at ₹3,500 carries 67% of its ₹468 tax, so ₹315 is claimable. Lines with tax and no vendor GSTIN are listed separately as **credit lost**, which is the list to go back to
- [x] **H8 is stated on the screen, not papered over.** The company GSTIN tile reads *"Not recorded"* in red with the sentence explaining that until Finance confirms it, invoices are being raised in employees' names and the credit is lost at source — a larger figure than anything in the table, and not measurable from here

### Verify
- [x] `npm run build` green
- [x] **The checklist example, exactly**: claim ₹13,390 + DA ₹3,000 − advance ₹12,000 ⇒ **net ₹4,390**, paid against UTR and closed, and the traveller's outstanding advance drops to **0**
- [x] Finance cutting a hotel night showed **engine 11,400 / Finance 7,600** side by side with the reason, and disallowed rose to 3,800 — the engine's figure untouched
- [x] A DA day overridden to ₹500 with a reason moved the total to 2,500 and the net with it; clearing it put the computed figure back
- [x] **An advance larger than the claim produces a RECOVERABLE, not a negative payment** — ₹9,000 advanced against a ₹700 claim ⇒ net −8,300, recovered against a payroll reference, `settled_amount` stored **−8,300**, `advance_recovered_amount` credited, outstanding **0**
- [x] Claim and advance cancelling exactly ⇒ closed with nothing moved and the sentence saying so
- [x] Guards, each with a sentence: no reason · above what was claimed · a negative amount · a payment with no reference · a recovery with no reference · a figure differing from the net with no note · a settlement dated in the future
- [x] **End to end in the browser**: a trip at Finance verification with a capped hotel, an allowed cab and a refused bar tab ⇒ verified, sent to settlement showing **Recoverable ₹4,000**, recovered against `SEP-2026-PAYROLL-0042`, closed, outstanding advance 0
- [x] Both reports render on real data — exceptions showing the two capped lines with their sentences, the ITC register showing ₹315 claimable at a 67% settled share
- [x] Cleanup: 0 trips, 0 legs, 0 claim lines, 0 DA days, 0 counters, 0 step owners, 0 grants; card still `draft`; email still **OFF**

### The §12 clock, measured end to end
A trip returning **Mon 10-Aug-2026** read off the four live queues:

| Step | Anchor | §12 | Due shown |
|---|---|---|---|
| Claim | return 10-Aug | +5 working days | **15-08** |
| Claim review | filed 17-Aug | +2 | **19-08** |
| Finance verification | HOD approved 19-Aug | +5 | **25-08** |
| Credit | HOD approved 19-Aug | +7 | **27-08** |

**Settlement anchors on HOD approval, not on Finance's own verification** — the queue shows the claim verified on the 20th and the credit still due on the 27th, seven working days from the 19th. That is what stops Finance taking its full five days from quietly buying the traveller another week, and it is why the 14-day promise holds.

⚠ **A correction to my own expectation, not to the code.** I first read 15-Aug as wrong because it is a Saturday, and expected 17-Aug. The Orange O Tec working week is **Mon–Sat — only Sunday is skipped** — documented at the top of `shared/lib/workingDays.ts` and shared by every FMS in the portal. Every figure above is right under that definition. Worth recording because the instinct to "fix" it would have broken six other modules.

### One defect this phase found, and it was the important kind
**`20261005122200` — Finance could pay a line the policy refuses outright.** `set_line_settlement` let any line be settled at any figure up to what was claimed, with a reason. That is right for a **cap** — §7.3 exists precisely so a cap can be exceeded on evidence. It is wrong for **§15**, which is not a cap: it lists categories that are *"never reimbursable under any circumstances, regardless of band or whether a client was present"*. Before the fix:

```
set_line_settlement(<the bar tab>, 900, 'Client was present.')   -- accepted
```

The engine refused the line and the human override walked straight past it — using, word for word, the justification the policy pre-emptively rejects. **A prohibition any reviewer can set aside with a sentence is not a prohibition; it is a default.** The RPC now refuses a positive figure on a non-reimbursable category and quotes the category's own refusal note back, and the panel does not offer the control at all — it says *"Nothing to decide — §15 refuses this outright"*. Settling such a line at zero stays legal, since it changes nothing.

The distinction now enforced in one place: **a CAP is a figure Finance may exceed with a reason; a REFUSAL is a category Finance may not pay at all.** `reimbursable` is the column that separates them, and it is already what the engine reads to refuse the line in the first place.

---

## Phase 10 · Round-out `[x]` done & verified 24-Aug-2026

### SQL — `20261005122300_add_fms_travel_email.sql`
- [x] `fms_travel_email_payload()` — **19 branches, one per event**, each naming the ACTION the reader must take. `fms_travel_announce` re-issued with the gated enqueue, so email goes exactly where a bell goes and nowhere else
- [x] **Installs OFF**, with an assertion in the migration that refuses to apply if it is ever seeded on
- [x] **No amount ever reaches a subject line.** Subjects are logged by mail servers, shown on lock screens and quoted in replies — and everything this module reports is a fact about one named individual's pay. The figures are in the body, behind a login
- [x] **Every CTA points somewhere the recipient can actually open** — defect (C) of `20260905120000`. An approval mail links to the approval QUEUE (only approvers receive it); everything sent to the traveller links to the TRIP, which they can always see
- [x] The `trip_settled` headline **says which direction the money went**, because "settled" alone reads as "you have been paid" and is wrong half the time
- [x] Corrections stay bell-only via the standing `%edited` guard. `tc_downgraded` is the one event that lands on the generic arm, and it announces to an empty recipient list — so it never becomes mail

**Two branch names were wrong before it was applied**, caught by listing what the module actually announces: the event is `advance_approved`, not `advance_requested`, and `trip_held`, not `trip_on_hold`. `advance_recovered` and `cancellation_refused` had no branch at all.

### `send-email/index.ts` — the `travel_` prefix in SIX places
The guard, plus the **three parallel ternary chains** the plan warned about (`appLabel`, `basePath`, `tag`) — miss one and the mail still sends, just unbranded — plus a footer arm of its own. That last one is a real difference: every other sender here mails the next actor, and half of Travel Desk's mail goes to the **traveller**, who is not the next actor on anything. Telling them they are sends them looking for a button that is not there.

### SQL — `20261005122400_add_fms_travel_comments.sql`
- [x] `fms_travel_post_comment` — a comment is an **activity row of `type = 'comment'`**, not a comments table, so the conversation and the history are ONE timeline
- [x] **Only a mention notifies.** Commenting does not page the whole trip; naming somebody is the deliberate act that says "you, specifically"
- [x] **A mention of somebody who cannot see the trip is DROPPED** — not raised, not delivered. Raising would let an author probe who can see what by watching which names error; delivering would mail them a link to Access Denied
- [x] **Read access is the test, not edit.** A Director querying a claim and HR chasing a booking are the two commonest reasons to write, and neither is the current actor
- [x] Attachments are checked against the **same storage predicate the bucket policies use**, so a comment cannot reference a file on another trip

### SQL — `20261005122500_travel_advance_clearance_handoff.sql`
- [x] hr-exit's `travel_advance` clearance was **a tick with nothing behind it** — nobody could answer whether a leaver still owed travel advance, so the box was ticked from memory and §11.2 died at the exit door
- [x] **No schema change.** A master-row edit turns on `requires_file` AND `allows_link`, and `fms_exit_toggle_clearance_check` reads them as *"a file OR (allows_link AND a link)"* — so it demands EVIDENCE without demanding an upload. Turning on `requires_file` alone would have manufactured screenshots of a figure that has since moved
- [x] `fms_travel_exit_clearance(code, user_id, as_at)` — reads **both** employee code and user id and takes the LARGER. A leaver can have trips under each, and under-reporting here writes money off at the exit door
- [x] Returns the sentence, not just the number: the person ticking it is an HR coordinator, and "12000.00" tells them nothing about what to do next
- [x] The recovery head already existed — hr-exit's **Advance Recovery** deduction. Nothing new is created, which is the point: the hand-off is two systems agreeing on a figure, not a third place to record it
- [x] ⚠ The flags are **copied onto a case when it is raised**, so this changes cases raised from now on. Zero `travel_advance` checks exist today, so it is moot — but it is the kind of thing that reads as a bug six months later

### Frontend
- [x] **Dashboard** completed — monthly spend and a "waiting on nothing dated" strip, which is the one bucket nothing else chases: a row with no due date is never late, so it never turns red and never reaches the late list
- [x] **Control Center** was already complete from phase 1 — five due buckets, `StepPipeline` over the four stages, the open-trip table and the Parked strip, all reading the same `store.entries` every queue reads
- [x] **Trip Register** — one flat grid replacing THREE of the PRD's reports. Traveller, department and purpose are ordinary sortable, cascading-filterable columns, so "what did Sales spend on customer visits in August" is three dropdowns rather than a fourth report nobody built. No `groupBy`
- [x] **Spend Summary** — one screen with a dimension picker over seven dimensions. A trip's cost is what the company PARTED WITH (booked + allowed + allowance), not what was claimed; reporting the claim alone omits the flights and hotels, which are the biggest line on most trips and the one the traveller never sees
- [x] **Desk Performance** — median as well as mean, because one trip held six weeks drags an average far enough to hide that everything else cleared next day. **Calendar days**, and the screen says so: the targets are working days, so the verdict column is a reading rather than a measurement. **No per-person league table** — §12.1 puts a slow approval in HR's hands to escalate, which is a conversation
- [x] **TripThread** — one list, events and comments interleaved, with **attachments**, which `CandidateTimeline` has none of. A travel argument is almost always about a document; a thread that cannot carry one sends the conversation to WhatsApp, where the evidence is lost by the time Finance asks
- [x] **Settings completed** — Due dates (marking the two steps not measured from the step before, and the one counted BACKWARDS), Policy (every §-referenced figure, with the three that are *refused in SQL* badged as such), Email notifications
- [x] **My Work** — `providers/travel-desk.ts` and `items/travel-desk.ts`, and the **work-snapshot bundle rebuilt**: *"coverage: 11 providers on screen, all wired into the mail."* Its build refuses to compile a provider that is registered and not covered, so forgetting the mail is impossible to do quietly
- [x] A coordinator is deliberately **not** given every trip in My Work. `can_act` lets them act on any step, which is right for a permission and wrong for a worklist — it would hand the desk all nine steps of every open trip

### One inconsistency the round-out found and fixed
The dashboard computed **its own** answer to "what advance is outstanding" — gross paid, filtered on status — while `lib/advance.ts` was the module's answer. It disagreed in two ways: it ignored `advanceRecoveredAmount`, so a cancelled trip whose money came back in cash still counted; and it keyed on the STATUS rather than on whether the trip had been SETTLED. Two answers to "who owes what" on one screen is how a rule stops being trusted. The tile now reads the shared helper.

### Verify
- [x] `npm run build` green; work-snapshot bundle rebuilt clean
- [x] **The whole lifecycle, end to end, on a real Band-3 traveller**: `TRV-2627-0001` → band 3 = **TC-C, Director step skipped** → manager approved → advance ₹15,000 approved and paid → booked (₹10,080) → actual dates recorded → claim filed (claimed 6,100, **disallowed 1,700** on the hotel cap, DA 3,000, net **−7,600**) → HOD approved → **Finance cut a line to ₹400 with a reason** (disallowed 2,200, net −8,100) → settled as a **recovery** → `closed`, outstanding advance **0**
- [x] **§11.2 refused the second trip's advance** while the first was unreconciled, naming the figure
- [x] **A Band-7 trip shows the Director step** — TC-B, `director_approval_skipped` false, and after the manager it moves to `awaiting_director_approval`
- [x] **A traveller with no HOD row still reaches an approver** — 0 snapshot approvers, the row carrying *"No reporting manager is recorded for this traveller, so it routes to the configured approvers"*, the named step owner can act, and a notification went out. Not a dead end
- [x] **The thread**: a mentioned comment produced 1 notification; a second comment mentioning nobody produced **no further notification but a second timeline entry**; an empty comment is refused. Posted through the real UI and rendered
- [x] **Email stayed OFF and nothing was enqueued** — 0 outbox rows. Payloads render correctly (`Approval needed - travel request TRV-2627-0002` → `/travel-desk/queues/approve-trip`), and the settled headline correctly reads *"the balance of your advance was recovered"*. ⚠ **The gate was NOT switched on**: this is a production database and turning it on is a live send to real people about their own pay
- [x] **The FMS Control Center shows Travel Desk · Delayed 1**, matching the module dashboard and the queue exactly, and clicking the row lands on `/travel-desk/monitoring`
- [x] The Master Report carries `travel-desk` enabled, `fms_travel_trips`, closing on `closed / cancelled / rejected`, detail path `/travel-desk/monitoring`
- [x] Spend Summary, Desk Performance and the Trip Register all render on live data with figures that reconcile: total cost **₹17,480** = booked 10,080 + allowed 4,400 + allowance 3,000
- [x] Cleanup: **0 trips, 0 legs, 0 claim lines, 0 DA days, 0 activity, 0 notifications, 0 counters, 0 step owners, 0 grants, 0 outbox rows.** Masters intact (36 cities, 25 expense categories), rate card still `draft`, email still **OFF**

---

## Deliberate exclusions

- **Group travel** — reimbursement is personal (§11 is entirely per-employee), so v1 is one trip = one claiming traveller, with co-passengers recorded for ticketing only. Two employees travelling together raise two linked trips.
- **Push notifications** — the PRD asks for them; the portal has **no push infrastructure of any kind** (no service worker, no web-push, no subscriptions table). In-app + email only.
- **Tally / payroll write** — settlement stops at Finance-marked Paid, per the confirmed scope.
- **The PRD one-service-per-requisition rule** — replaced by one trip with many legs.
- **Twelve PRD statuses collapse** — `Submitted`/`Pending Approval` are one state, `Approved`/`Pending Booking` are one state, and `Ticket Shared` is what uploading a ticket already does.

---

## Demo data · `supabase/seed/fms_travel_demo_seed.sql` `[x]` 24-Aug-2026

A trip parked at **every one of the sixteen statuses**, so every screen, queue, panel and report
has something in it. Twenty numbered `TRV-DEMO-01 … TRV-DEMO-20` plus one unnumbered draft.
Teardown: `supabase/seed/fms_travel_demo_teardown.sql`. Same shape as `fms_exit_demo_seed.sql`.

- [x] **Every state change goes through the real RPC, as a real person** (`set_config('request.jwt.claims', …)`),
      so `fms_travel_can_act` is genuinely exercised and the seed FAILS rather than manufacturing a
      state the app could never reach. Raw UPDATEs do three things only: renumber to the demo series,
      backdate what the RPCs stamped `now()`, and set the one `entitled_fare`
- [x] **The cast is four people who already hold portal admin** — Shweta Chanchad (EA · raises, books,
      cancels, files claims), Aayush Rathi and Karan Toshniwal (Directors · approvals), Yash Agarwal
      (CAIO · stands in for Finance). ⚠ **Deliberately NOT the real Travel Desk / CFO / HODs**:
      `can_act` opens with `module_can_edit(uid,'travel-desk')` and there is **not one `app_access`
      row for travel-desk**, so impersonating them would have meant this seed handing out production
      access to a dozen named people and putting an unfinished module on their launcher
- [x] **No configuration is written at all** — no `app_access`, no `fms_travel_step_owners`, no
      `process_coordinators`, no master managers. Those are decisions about named people
- [x] Travellers span **bands 3 → 9**, so TC-A/B/C, the §3.2 Director fork and every cap are hit
- [x] What the twenty cover: overdue manager approval · Director approval · returned · rejected ·
      advance approved-not-paid · awaiting booking · booked-and-upcoming · back-with-an-advance-out ·
      **retrospective/emergency downgraded TC-B → TC-D (§3.5)** · cancellation requested ·
      cancelled-but-the-money-is-not · cancelled-fully-refunded · cancelled-before-booking · on hold ·
      a full claim hitting **five different engine branches** · nothing-to-claim-but-DA-is-due (§8.3
      half rate) · with Finance · awaiting settlement with a **line settled above the cap with a
      reason** · closed-and-paid · closed-and-**recovered** through §11.3
- [x] **The email gate is asserted OFF and the seed refuses to run if it is on** — ~120 notifications
      would otherwise become ~120 real emails about trips that never happened. Verified: 0 outbox rows
- [x] Also writes, and the teardown deliberately KEEPS: **13 hotels + 5 bus operators** (both masters
      were empty, and a hotel leg needs one) and a **base city per demo traveller**
      (`on conflict do nothing`, so a real preference is never overwritten)

### ⚠ The counter bug this found, in the seed itself
The first version **deleted** the `trip:<fy>` counter row on the assumption that no real trip existed
— true when the session started, and false four minutes later: `TRV-2627-0001` was raised through the
UI while the seed was being written. Deleting the row resets the series to 0001, so the next real
submit would have died on the `trip_no` unique index, inside an RPC, with a constraint name for an
error message. Fixed in the DB (counter restored to 1) and in the file: step 7 now winds the counter
back to the **highest number a real trip actually holds**, which costs one query and cannot be wrong.

### The gap it could not fill honestly
**Nothing writes `fms_travel_legs.entitled_fare`** — not `fms_travel_save_leg`, not the booking panel —
so §16 (booked above band entitlement) is unreachable through the UI and `fms_travel_class_excess`
always returns nulls. One value is set by a raw UPDATE so the Policy Exceptions report has a §16 row
to render. Worth closing properly: it needs a field on the booking form, and the RPC to accept it.
