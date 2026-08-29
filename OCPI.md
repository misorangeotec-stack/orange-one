# OCPI — build log & checklist

**Module:** OCPI (quotation → order confirmation), `apps/ocpi`, id `ocpi`, tables `fms_ocpi_*`.
**Plan of record:** `C:\Users\Admin\.claude\plans\https-forms-cloud-microsoft-pages-respon-noble-cupcake.md`
**Tracked in WORKLIST.md as:** OCPI-1
**Started:** 22-Aug-2026

This file is the LIVE LOG. Tick items as they land; add a dated note under a phase when something
changes shape. Same role `CENTRAL-MASTERS.md` plays for the masters operation.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped

---

> # ⚠ READ THIS FIRST — the chain is changing (24-Aug-2026)
>
> **Phases 0–9d below describe what was BUILT. They are no longer the target.** A second round of
> client requirements folds the order confirmation into the quotation, changes the step chain, and
> adds two steps after the countersignature. Tracked as **OCPI-2** in `WORKLIST.md`; the live
> checklist is **[The revision · stages 0–H](#the-revision--stages-0h)** at the foot of this file.
>
> Plan of record: `C:\Users\Admin\.claude\plans\now-there-is-a-memoized-mccarthy.md`
> Client-facing flow: https://claude.ai/code/artifact/bd77ceb1-a5f5-46fa-a37e-5f51977b6b0c
>
> **All pricing is phase 2** — no price master, no deviation limit, no price approval. Do not build
> `fms_ocpi_price_*`; earlier drafts specified it and it is withdrawn.

## Status at a glance

| Phase | What | State |
|---|---|---|
| 0 | Audit & plan | `[x]` done 22-Aug-2026 |
| 1 | Foundations — SQL backbone + module skeleton | `[x]` done & verified 22-Aug-2026 |
| 2 | Quotation capture (part A) | `[x]` done & verified 22-Aug-2026 |
| 3 | Machine master + template transcription | `[x]` built & seeded 22-Aug-2026 — awaiting proof-read |
| 4 | Quotation document (PDF, versions, revision log) | `[x]` done & verified 22-Aug-2026 |
| 5 | Approval gate 1 (quotation) | `[x]` done & verified 22-Aug-2026 |
| 6 | Order confirmation capture (part B) | `[x]` done & verified 22-Aug-2026 |
| 7 | OC document + approval gate 2 | `[x]` done & verified 22-Aug-2026 |
| 8 | Signature loop (customer → management → closed) | `[x]` done & verified 22-Aug-2026 |
| 9 | Round-out (dashboard, register, SLA, email, settings) | `[x]` done & verified 22-Aug-2026 |
| 9b | Pipeline (Control Center) + setup masters & their governance | `[x]` done & verified 22-Aug-2026 |
| 9c | send-email deployed · quotation series confirmable · wrong-entity warning | `[x]` done & verified 23-Aug-2026 |
| 9d | The lifecycle rail on the deal page (shared PoStageRail) | `[x]` done & verified 23-Aug-2026 |
| 10 | Zoho CRM source (product phase 2) | `[ ]` deferred |

**Gate for every phase:** `cd frontend && npm run build` green (tsc strict; there is no test runner).

---

## Phase 0 · Audit & plan `[x]`

- [x] Extract the MS Form definition — 47 questions, 8 branch rules, validation
- [x] Decode all 11 PPTX order-confirmation decks
- [x] Decode the filled submission in `Machine Order form.pdf`
- [x] Inspect `Orange Letterhead.pdf` (vector, US Letter)
- [x] Map the FMS engine, shared components, PDF toolkit, storage, email, approvals
- [x] Probe live data: `mst_parties` fill rates, companies, locations, `app_access`
- [x] Second audit round — slide geometry, embedded media, retract two wrong claims
- [x] Confirm the four scope decisions with the user
- [x] Write the plan
- [x] Write this checklist

---

## Phase 1 · Foundations `[x]`

### SQL
- [x] `20260929120000_add_fms_ocpi_foundations.sql` — `step_owners`, `config`, `counters` + `next_seq`,
      `activity`, `notifications`, `fy_code`, `announce`, `company_profiles`, bucket
      `fms-ocpi-docs` + 4 storage policies
- [x] `20260929120200_add_fms_ocpi_deals.sql` — `fms_ocpi_deals` (part A + B columns, `company_id` /
      `location_id`, currency-aware value, per-step `*_at` / `*_by`, status CHECK,
      draft-completeness CHECK), `fms_ocpi_quotation_versions`, `can_act`, `can_see_deal`, step RPCs
- [x] Every write predicate written as `module_can_edit(uid,'ocpi') and …` from the start
- [x] Deals SELECT policy carries the viewer arm, wrapped `(select …)`
- [x] Every policy scoped `to authenticated` (never `{public}`)
- [x] Each migration has a prose header and a `-- Reversal (reverse order):` block
- [x] Applied to `icutjkrqkbzwvmnfbzpr` — 10 tables, RLS on all, 0 policies scoped `{public}`, 8 functions present

### Frontend skeleton
- [x] `apps/appInfo.ts` — added the `ocpi` entry (name, basePath `/ocpi`, category `sales`, order)
- [x] `apps/ocpi/meta.tsx` — `AppManifest` + inline SVG icon
- [x] `apps/ocpi/OcpiApp.tsx` — internal `<Routes>` + guards
- [x] `types/index.ts`, `OcpiLayout.tsx`, `nav.tsx`, `store.tsx`, `components/Loaded.tsx`
- [x] `apps/registry.tsx` — import and register
- [x] `lib/steps.ts` — the 6-step chain (array order is semantic)
- [x] `lib/queues.ts` — queue membership derived purely from status + `*_at`
- [x] `data/ocpiFetch.ts`, `data/ocpiWrites.ts` (`const db = supabase as any;`)
- [x] `apps/fms-control-center/adapters/ocpi.ts` + register in `adapters/registry.ts`
- [x] Dashboard renders (real counts from `buildQueueEntries`; widgets deferred to phase 9)
- [x] `20260929120300_register_ocpi_module.sql` — `email_module_settings` row, enabled false. **No `app_access` seed**: admins bypass module checks, and every other grant is a decision about a named person, so it belongs in Admin → Module Access

### Verify
- [x] `npm run build` green — tsc strict + vite, 4,067 modules, 13.9s
- [x] Admin sees the launcher card (Sales → between Leads Dashboard and New Customer Onboarding); `/ocpi` renders with all five queues, real zero counts, and the "no machines" card
- [x] Permission boundary proved IN THE DATABASE with a temporary grant, then cleaned up: no grant → level `none`, `can_raise` false **even though the quotation step has no owners** (the `module_can_edit` gate short-circuits the open-origin arm); view → reads a live deal, cannot raise, cannot see another author’s draft; edit → can raise but still cannot approve (not a step owner).

---

## Phase 2 · Quotation capture — part A `[x]`

- [x] `lib/fieldSpec.ts` — single source of truth for all fields (label, type, options, part A/B,
      document slot)
- [x] `lib/branching.ts` — the 8 rules as data, **with the two form bugs corrected**
      (Q6 = No must not skip Q8; Q19 = No must skip to Q25)
- [x] `shared/lib/gstin.ts` — lift from `receivables-hub/lib/customerOnboarding/gstin.ts`, update the
      hub's imports
- [x] `components/CustomerPicker.tsx` — `mst_parties where is_customer`, own query key, 30-min
      refresh, IndexedDB-persisted
- [x] Customer pick resolves `company_id` → selling entity + location
- [x] GSTIN field: offline PAN/state derive + `gstin-lookup` soft-fill of the registered address
- [x] Contact prefill from the party's most recent prior OCPI deal
- [x] `components/QuotationForm.tsx` — part A, branching applied
- [x] Deal value carries `{currency, amount}` (USD is real — audit finding 7)
- [x] Server drafts: `fms_ocpi_save_draft` / `fms_ocpi_delete_draft`; drafts private to their author
- [-] Local autosave via `useStepDraft` + `draftStore` + `DraftBar` — **not built, deliberately.** The server draft is one click and needs only a customer name, so the crash-recovery window this closes is small; adding a second, browser-local copy of the same form introduces a "which version is right?" question on every reopen. Reconsider if people report losing work.
- [x] `pages/deals/` — `NewDeal`, `EditDraft`, `DealDetail`, `MyDeals`, `Drafts`, `DealsList`, sharing one `QuotationEditor` and one `DealsTable`
- [x] Every grid: `QueueTable`, sort + cascading filter on every column, flat (no `groupBy`)

### Verify
- [x] `npm run build` green — tsc strict + vite, 4,067 modules, 13.9s
- [x] Customer picker loads all 1,888 Tally customers and fills only what Tally holds
- [x] GSTIN validator rejected a wrong check digit (`24AAACC1206D1ZX`) and accepted the corrected one
- [x] Full draft lifecycle in the browser: saved → URL moved onto the row → reopened with every field restored → deleted. **The quotation counter never moved off 23.** Mobile normalised `+91 88262 28008` → `8826228008`; GST upper-cased
- [x] Branching proved in BOTH places: the form revealed the GST field on "Yes", and a SQL test flipped High Seas → Local and every inclusion off, confirming `fms_ocpi_write_quotation` cleared each hidden field and kept the visible one

---

## Phase 3 · Machine master + template transcription `[x]`

- [x] `20260929120100_add_fms_ocpi_machines.sql` — `fms_ocpi_machines`, `fms_ocpi_machine_sections` (applied early: fms_ocpi_deals.machine_id references it)
- [x] `pages/machines/Machines.tsx` via `MasterCrud` (Excel import/export free) + `pages/machines/MachineTemplate.tsx` for the spec rows, composition and sections — an ordered document needs a real editor, not a JSON blob in a textarea
- [x] `lib/tokens.ts` — token resolution; an unresolved token renders a **ruled blank**, never `{{…}}`
- [x] Transcribe the 10 real templates **from PowerPoint, not from a text dump**:
  - [x] Homer K24
  - [x] Homer K32
  - [x] Kolorado Alpha 15
  - [x] KoloRado Alpha II — 1.8 m, 8 heads
  - [x] OT-1908A — 1.9 m, 8 heads
  - [x] KoloRado Alpha II — 2.2 m, 8 heads
  - [x] KoloRado Alpha 3.2 — 24 heads
  - [x] P8S
  - [x] P8D (title is **OFFER QUOTE**, not ORDER CONFIRMATION — kept as the deck has it)
  - [x] Pengda PD-1700XD-1000
- [x] `20260929120500_seed_fms_ocpi_machines.sql` + `20260929120600_seed_fms_ocpi_compositions.sql` — 28 machines, 82 sections, applied and verified
- [x] 18 models carry `has_template = false` — quotable now, blocked at the order confirmation
- [!] **Bushra still to proof-read the transcription.** The decks' own typos were carried across on purpose ("CHINES DRYER", "regural", "continous") — silently correcting a customer-facing contract is not a transcription decision. All of it is editable in Administration → Machines without a deploy.

### Verify
- [x] `npm run build` green — tsc strict + vite, 4,067 modules, 13.9s
- [x] Machines list and the K24 template editor both render; tokens show as `{{machine_count}}` / `{{head_count}}` in the spec rows, with reorder and delete
- [ ] A `has_template = false` machine blocks at `order_confirmation` — cannot be tested until phase 7 builds that step

---

## Phase 4 · Quotation document `[x]`

- [x] Letterhead pulled from `K24.pptx` media → `public/assets/ocpi/orange-logo.png` + `letterhead-default.png`; placement read off the SLIDE MASTER (logo 58.1%/0.6%, footer band 0%/55.2%) so it lands correctly at any page size
- [x] `lib/letterhead.ts` — full-page letterhead + per-company bank block
- [x] `lib/quotationPdf.ts` — one page, matching `Quotation Format.jpeg` box for box
- [x] `components/DocumentPreview.tsx` — preview, download, print (print = the same PDF blob)
- [x] `20260929120700_add_fms_ocpi_generate_quotation.sql` — mints `QT-M####` on the FIRST generation only; revisions keep the number and bump the version
- [x] Each version freezes `field_payload` **and** `document_payload` (resolved spec rows + section bodies + company profile), and the PDF is stored under the deal's own folder

- [x] `lib/revisionDiff.ts` + `components/RevisionHistory.tsx` — field-level v(n-1) → v(n)

### Verify
- [x] `npm run build` green — tsc strict + vite, 4,067 modules, 13.9s
- [x] Generated on letterhead with the section A–D boxes in the order the paper sheet has them. **One layout defect found and fixed:** rows were sized from the value only, so long labels ("No. of Print Heads Required") wrapped and printed over the row beneath
- [x] Regenerated after two edits; history read "2 versions", listing the address change and "Total deal value 4850000 → 4600000", with version 1 labelled "This is where the quotation started"
- [x] **THE FREEZE HOLDS.** Reworded K24's cancellation clause in the live template; version 1 still carried the original wording while the template showed the new one. Restored afterwards
- [x] ₹ renders — "₹ 46,00,000" printed correctly (Poppins/Identity-H; jsPDF’s built-in Helvetica has no rupee glyph)

---

## Phase 5 · Approval gate 1 `[x]`

- [x] `quotation_approval` step + queue page, rows from the shared `buildQueueEntries` so the dashboard tile and the queue cannot disagree
- [x] `components/ApprovalPanel.tsx` — approve / reject / send back, with the reason enforced in the DATABASE, not just the form
- [x] `fms_ocpi_announce` wiring — audit trail + bell. Submitting notifies the approvers; every decision notifies the salesperson
- [x] `pages/settings/Setup.tsx` + `StepOwnersSection` — the approvers ARE the owners of `quotation_approval`; no second list to drift
- [x] Rework returns the deal to `draft` (what the salesperson can actually edit and regenerate) with `rework_stage`, `rework_reason` and an incrementing `rework_count`

### Verify
- [x] `npm run build` green — tsc strict + vite, 4,067 modules, 13.9s
- [x] Full round trip driven in the browser: generate → send → sent back with a reason → revise → resend → approve. Ended at `awaiting_order_confirmation`, one rework recorded, SAME number QT-M0024 throughout, 4 notifications raised
- [x] Guards proved: "Send back" with no reason was refused by the database ("Say why, so the salesperson knows what to do next"); "Send for approval" stays disabled until a document exists; and with a SECOND approver added, self-approval was refused and the buttons disappeared

---

## Phase 6 · Order confirmation capture — part B `[x]`

*Note: a THIRD deliberate correction to the source form. It asks for a dryer warranty period even
when the dryer is "Not Applicable" — which would print a warranty for equipment that is not in the
deal. Hidden here, and nulled by `fms_ocpi_write_oc`, alongside the chamber and heating questions
the form already skips.*

- [x] `components/OrderConfirmationForm.tsx` + `lib/ocFieldSpec.ts` — part B only; the quotation's answers appear in a read-only panel at the top rather than being asked again
- [x] OC-only fields: `ref_no`, `delivery_days`, `trade_term`, `gst_rate`,
      `machine_value_inr`, `post_warranty_head_price`, `machine_model_no`, `prepared_by`,
      `approved_by`
- [x] `20260929121000_add_fms_ocpi_order_confirmation.sql` — `write_oc` (part-B columns ONLY, so saving the OC cannot blank the quotation), `save_oc_draft`, `submit_oc`
- [x] Token values captured — printer + head warranty, post-warranty head price, consumables supplier, dryer warranty, model no

### Verify
- [x] `npm run build` green — tsc strict + vite, 4,067 modules, 13.9s
- [x] Nothing from part A retyped — customer, machine, 16 print heads, ink, dryer, head included, ₹52,00,000 and transport all carried over; the model no pre-filled from the template
- [x] **OTPL/OC/2627/0001** minted on submit (FY-scoped), not on save. GST computed live and STORED — ₹52,00,000 + 18% = ₹61,36,000 — so a signed contract keeps the arithmetic it was signed under

---

## Phase 7 · OC document + approval gate 2 `[x]`

- [x] `lib/ocPdf.ts` — spec table, composition, totals, then that machine's own sections in its own order, and its own sign-off wording. Hard-codes nothing
- [x] Header fields per machine — K24 printed Attn/Date/Address and no `Ref:`, as its deck does
- [x] Totals block — supply description + Machine Value / +GST / Total, with the rate off the deal
- [x] `20260929121100_add_fms_ocpi_oc_approval.sql` + `OcApprovalQueue` + `OcApprovalPanel`, which renders the actual PDF: nobody confirms a contract from a list of field values
- [x] Frozen and stored ON SUBMIT (not approval) — `oc_document_payload` holds the resolved document, `oc_pdf_path` the file, both under the deal's own folder

### Verify
- [x] `npm run build` green — tsc strict + vite, 4,067 modules, 13.9s
- [x] K24 rendered and compared against its deck — title, header, all 13 spec rows, composition, multi-page. **P8D correctly headed OFFER QUOTE**; **Pengda leads with WARRANTY TERMS and carries no print-head policy**, K24 has both in its own order
- [x] **K32 sold with 16 heads printed 16** installed against **32** installable, and its supply line read "WITH 16 PRINTHEADS" — the exact case the real submission would have got wrong
- [!] Raise a deal for an Enterprises / Noida customer — the plumbing is in (`fms_ocpi_company_profiles`, the
      `{{bank_block}}` and `{{ex_works_city}}` tokens, per-entity `letterhead_path`) but only the
      default Orange O Tec profile exists, so there is nothing to test it against yet. Waiting on
      open item 5

---

## Phase 8 · Signature loop `[x]`

- [x] Print action from the approved OC — `components/ApprovedOcPreview.tsx` fetches the
      STORED pdf, so what is printed is what management approved; it rebuilds from the
      template only when the file is missing, and says so on screen when it does
- [x] `components/SignedDocCapture.tsx` → `fms-ocpi-docs`, path `<deal-id>/<slot>/<epoch>-<file>`,
      multi-page (camera one sheet at a time, or a scanned PDF). `uploadPages` writes an
      upload memo back into state, so a dropped connection retries only what is left
- [x] `components/SignedDocStrip.tsx` — the filed pages, read-only; images inline, PDFs to a tab
- [x] `..._add_fms_ocpi_signature_loop.sql` — `cs_doc_pages` / `ms_doc_pages`,
      `fms_ocpi_doc_pages` (primary stripped, blanks dropped, empty forms → NULL),
      `record_customer_sign`, `return_signature`, `record_management_sign`
- [x] `customer_signoff` step + queue; the upload notifies the management-sign owners
- [x] `management_signoff` step + queue; the countersigned upload closes the deal
- [x] Management can SEND A SIGNED COPY BACK, with a reason — without it, one unsigned page
      parks the deal for good and the only escape is countersigning a document management
      can see is wrong
- [x] `..._fms_ocpi_doc_storage_policies.sql` — path-derived RLS via `fms_ocpi_can_see_deal`,
      replacing the four `bucket_id`-only placeholders phase 1 left behind
- [x] `lib/docUrls.ts` — bulk signed URLs cached under the signature TTL, plus `fetchStoredPdf`
- [x] `lib/signatures.ts` — one reader for the two-column storage split, so no screen re-derives it
- [x] The two raiser steps (`order_confirmation`, `customer_signoff`) open their queue to any
      salesperson, not only to step owners — the RPCs let them act, so hiding the list left the
      person who owes the work with nowhere to see it. RLS still hands them only their own deals
- [x] `DocumentPreview` revokes the PREVIOUS object url one render AFTER the new one is on the
      iframe. Revoking in the creating effect's cleanup — the obvious place — ran before the
      `src` swap, so every regeneration flashed an empty frame and logged ERR_FILE_NOT_FOUND

### Verify
- [x] `npm run build` green — tsc strict + vite, 4,113 modules, 14.1s
- [x] Full loop walked live: QT-M0024 → approved → OTPL/OC/2627/0001 → confirmed →
      two pages filed → sent back → three pages re-filed → countersigned → **Completed**
- [x] The row after filing: page one in `cs_doc_path`, two extras in `cs_doc_pages`,
      **no duplicate of page one**, every path under the deal id
- [x] Sending back with no reason is refused BY THE DATABASE; the filed scan is kept and
      pre-loaded, so the salesperson can see what was refused
- [x] **A user with no OCPI access is refused both read and write on a signed contract** —
      `can_see_doc` / `can_add_doc` both false for every non-admin without a grant
- [x] **The raiser asymmetry holds in Storage as well as in the RPC**: with an edit grant, the
      deal's raiser may write `quotation`, `oc` and `customer-signed`, is refused
      `management-signed`, and is refused another deal's folder entirely
- [x] Nine activity rows tell the whole story end to end, including the send-back
- [x] Dashboard reads Completed 1 / everything else 0, and the empty customer-signature queue
      shows its empty state rather than a bare table
- [x] Both new queues render a sort toggle and a filter control on every column (they are
      `QueueTable`, so the cascade and the "filter matched nothing" row come with it)
- [x] Test data removed: 0 deals, 0 versions, 0 activity, 0 notifications, 0 owners, 6 storage
      objects deleted, quotation counter back to 23, OC counter gone, 28 machines and
      82 sections intact

---

## Phase 9 · Round-out `[x]`

- [x] `pages/Dashboard.tsx` — KPI row, plus **Past its due date** and **Stalled**. No throughput
      chart, deliberately: at a few dozen deals a year a trend line is noise dressed as insight
- [x] `lib/exportRegister.ts` + `pages/reports/DealRegister.tsx` — five filters, and the export
      carries them in words on its About sheet. Money is a NUMBER with the currency in its own
      column, so a dollar deal and a rupee deal can share a summable column without lying
- [x] `lib/sla.ts` + `StepDueDatesSection` + `DueCell` on all five queues. **The defaults are not
      all 1**: order confirmation gets 2 days and the customer signature 7, because one of those
      is our work and the other is a document on somebody else's desk
- [x] `..._add_fms_ocpi_submitted_stamp.sql` — `qs_at`, **without which every approver's queue is
      born red**: quotation approval would otherwise have to anchor on the deal's creation, so a
      quotation drafted over three weeks would arrive twenty days overdue
- [x] `..._add_fms_ocpi_lifecycle.sql` — `hold` / `resume` / `cancel`, and
      `update_signed_docs` (the one correction the module offers), announcing with an **empty
      recipient list**. `on_hold` and `cancelled` had existed since phase 1 with **nothing able to
      set them** — a deal whose customer went quiet could only sit in a queue for ever
- [x] `..._add_fms_ocpi_email.sql` — `fms_ocpi_email_payload` + the gated outbox enqueue, one
      branch per event, each naming the action the reader has to take. Installs OFF
- [x] `EmailNotificationsSection`, `CoordinatorsSection`, `CompanyProfilesSection`
- [x] The Control Center adapter resolves the SLA map, so its Delayed column is real
- [x] `..._register_ocpi_in_master_report.sql` — the adoption row. `due_column` deliberately
      NULL: OCPI's due dates are derived at read time, and a zero would read as "nothing is late"
      when the truth is "not measurable from SQL"
- [x] Update `WORKLIST.md` OCPI-1

### Verify
- [x] `npm run build` green — tsc strict + vite, 4,122 modules, 13.2s
- [x] Settings renders all five sections; changing a due date saves and comes back
      (`step_sla` written with anchors intact)
- [x] A quotation submitted 10 days ago shows **13-08-2026 · 9d overdue** in the approval queue
      AND on the dashboard's late list — same due date from the same builder
- [x] The cross-FMS scoreboard shows OCPI **1 delayed**, agreeing with the queue
- [x] Hold refuses without a reason, removes the deal from every queue and count, and puts it on
      the **Stalled** list; resume returns it to `awaiting_quotation_approval` — the REMEMBERED
      status, with the hold fields cleared
- [x] Cancel names the deal, says plainly it cannot be undone, refuses without a reason, and
      leaves the reason on the deal afterwards
- [x] Deal Register filters, and the .xlsx carries the filter line, 34 columns, and the notes
- [x] Master Report reports OCPI `active`, 1 new today, 0 open — a cancelled deal is closed
- [x] The deals SELECT policy has **every** helper and every `auth.uid()` wrapped `(select …)`,
      read back off `pg_policies` — the property the dispatch timing query diagnoses. A timing
      measurement itself is meaningless at zero rows and was not faked
- [x] Test data removed: 0 deals, 0 activity, 0 notifications, 0 owners, 1 storage object
      deleted, quotation counter back to 23, `step_sla` removed, email still OFF
- [!] **`send-email` needs deploying** — the `ocpi_` prefix is in the repo, not on the server.
      The Supabase CLI is not installed on this machine, and hand-copying a 72 KB production
      file that nine modules' mail depends on is a worse risk than the delay. One command:
      `supabase functions deploy send-email --project-ref icutjkrqkbzwvmnfbzpr`.
      Until then the switch is off and OCPI rows would be **skipped**, not mis-sent

---

## Phase 9b · The pipeline, and the setup masters `[x]`

*Raised 22-Aug-2026 after a review against the other nine modules found two things every
one of them has and OCPI did not.*

- [x] `pages/monitoring/ControlCenter.tsx` — the coordinator's board: five due-date buckets,
      the stage-grouped step rail with its bottleneck read-out, a filterable table of every
      open deal, and a **Parked** strip. Reads `store.entries` — the SAME builder the five
      queues, the dashboard and the cross-FMS scoreboard read
- [x] The cross-FMS row and the Master Report now point at `/ocpi/monitoring`, not at the
      dashboard. Clicking OCPI on the scoreboard lands where every other module lands
- [x] `..._add_fms_ocpi_master_governance.sql` —
      `fms_ocpi_head_types` / `_ink_types` / `_dryer_types` (seeded from the arrays that
      were hardcoded in `lib/fieldSpec.ts`), `_master_managers`, `_master_requests`,
      `fms_ocpi_is_master_manager`, `fms_ocpi_resolve_master_request`
- [x] **The three lists were code, and now they are data.** Adding a print head meant a
      commit, a build and a deploy — so in the meantime people typed it free-hand, which is
      how one head model ends up in the data as four different strings
- [x] `pages/masters/Masters.tsx` — the hub, tabbed, on `MasterCrud` (sort, filter, Excel
      round-trip, deactivate-never-delete). Machines keep their own screen and the two link
      to each other, because a machine is a whole template rather than a name in a list
- [x] `pages/MasterRequests.tsx` + `components/RequestMasterModal.tsx` + `lib/masterFields.ts`
      — ask for an entry, and see what happened to the one you asked for
- [x] `pages/settings/MasterOwnersSection.tsx` — one owner list per master. An owner edits
      that list and resolves requests against it, and **nothing else**
- [x] Machines is no longer admin-only: whoever owns the `machine` master may edit it and its
      template sections. That is what the ownership grant is FOR
- [x] The old `HEAD_TYPES` / `INK_TYPES` / `DRYER_TYPES` constants are **deleted, not kept as
      a fallback** — two copies of an editable list is a list that will disagree with itself

### The one deliberate divergence from the other modules
- [x] **A request does not block the form for three of the four masters.** Head / ink / dryer
      are stored on the deal as TEXT, so typing a new value keeps working AND asks for the
      list to grow; a machine is a foreign key, so that one must be approved first — exactly
      as an item request works in General Purchase. Making a salesperson wait mid-negotiation
      for somebody to approve a vocabulary entry would be a worse product than the free-text
      box this replaces

### Verify
- [x] `npm run build` green — tsc strict + vite
- [x] Masters lists the six seeded print heads, sorting, filtering and Excel intact
- [x] Typing "Acid Ink" into Type of ink **keeps it on the draft** and opens the request
      modal, which names who it goes to ("an admin — nobody owns this list yet")
- [x] The request reaches Master Requests; the reviewer **corrected the name to "Acid Dye
      Ink" before approving**, and that is the name the master row got
- [x] Approving wrote the activity row and linked `resolved_master_id`; Reject stays disabled
      until a reason is typed
- [x] The Control Center with one 6-day-old deal reads **DELAYED 1**, marks Qtn Appr as the
      bottleneck, and shows `17-08-2026 · 5d overdue` — the same date the queue shows
- [x] Master ownership is scoped: a non-admin made owner of ink types answers true for
      `ink_type` and **false for `machine`**, read back off the database
- [x] Test data removed: 0 deals, 0 activity, 0 requests, 0 managers; the 6 / 3 / 3 seeds,
      28 machines and 82 sections intact

## Phase 9c · Unblocking the two things that were waiting on somebody else `[x]`

*Built 23-Aug-2026, on the instruction not to wait for answers. Neither item needed an answer
to be made SAFE — only to be made final, and both were sitting where nobody could see them.*

- [x] **`send-email` is deployed.** Version 29, `verify_jwt` still false, byte-identical to
      `supabase/functions/send-email/index.ts`. The blocker was "no Supabase CLI"; `npx.cmd
      supabase@latest` runs it and `SUPABASE_ACCESS_TOKEN` was already in `.env`. Before
      deploying, the LIVE version was pulled and diffed against `git HEAD` — **identical**,
      so the deploy added the OCPI branch and nothing else. OCPI's own switch is still OFF
- [x] `supabase/config.toml` now carries `[functions.send-email] verify_jwt = false`. It never
      did; the CLI defaults to ON, so a deploy by anyone who did not think to pass
      `--no-verify-jwt` would have made every cron send fail 401 — for nine modules, not just
      this one
- [x] `..._add_fms_ocpi_quotation_series.sql` — `fms_ocpi_set_quotation_series(n)`, admin-only
      and **forward-only**, plus a `quotation_series` config key readable by everyone
- [x] `pages/settings/QuotationNumberingSection.tsx` — shows the live counter, what the next
      number will be, and takes the last number actually used. Reads the counter FRESH, never
      from the cached store, because it moves whenever anybody generates a quotation
- [x] `components/SetupWarnings.tsx` → `QuotationSeriesWarning` on the Dashboard and on the
      quotation editor while no number has been issued yet

### The number nobody had checked
The counter was seeded at **23**, read off the one scanned submission (`QT-M0023`), and the
migration header said in as many words that 23 was a floor and not a maximum. That caveat lived
only in SQL. If the paper series had actually reached 41, the first eight quotations raised here
would have handed customers numbers they already held, and nothing afterwards could take them
back. It is now a setting with an owner, a confirmation stamped with who and when, and a warning
on every screen that can mint one until somebody confirms it. **It still needs the real figure —
what changed is that the risk is now visible to the people who would suffer it, and fixable by
them in ten seconds.**

### The wrong company's bank account
- [x] `..._fms_ocpi_default_profile_names_its_company.sql` — the seeded default profile now
      names Orange O Tec Private Limited instead of standing for everybody
- [x] `store.profileStatusFor(companyId)` — the same lookup, but saying whether the answer came
      from the deal's own company or from the fallback
- [x] `CompanyProfileWarning` on the quotation editor, the order-confirmation editor and the
      OC approval panel — naming the company and what it will print instead
- [x] `border-ryg-amber` is not a colour in this build (`ryg` is red / yellow / green). Two
      existing panels used it and had no border at all; all three now use `ryg-yellow`

**What was actually wrong:** `loadLetterhead` computes a `usedDefault` flag and its comment
claimed it "reports it, loudly" — **nothing read it**. With the default profile attached to no
company, every deal took the fallback silently, including the 675 customers of 1,878 booked
under Enterprises, either Noida arm, or Colorix, whose contracts printed Orange O Tec Pvt Ltd's
bank account, CIN and registered address. Attaching the default to its real company splits the
1,203 that are correct from the 675 that are not, so the warning means something.

### Verify
- [x] `npm run build` green — tsc strict + vite
- [x] Deployed function re-fetched after deploy: **version 29, verify_jwt false, identical to
      the local file**, `ocpi_` present twice
- [x] `fms_ocpi_set_quotation_series` — anonymous **refused**, non-admin portal user
      **refused**, admin allowed; lowering 23 → 5 **refused** with the reason; 1,000,000
      **refused**; raising to 41 allowed and stamped with the confirming user
- [x] Counter and config **restored to 23 / unconfirmed** after the test — a confirmed flag
      left behind by a test would have silenced the warning it exists to raise
- [x] Settings → Quotation numbering reads `QT-M0023` live and says the next will be `QT-M0024`
- [x] Dashboard and New Quotation both carry the series warning
- [x] A deal for a **Colorix** customer names "COLORIX DIGITAL PRINTING SOLUTIONS LLP" and says
      it will print M/s ORANGE O TEC PVT LTD's details; an **Orange O Tec Pvt Ltd** customer
      shows no warning at all
- [x] Nothing left behind: 0 deals, 0 activity, counter 23, series unconfirmed

---

## Phase 9d · The lifecycle rail on the deal page `[x]`

*Raised 23-Aug-2026 by the user, against a screenshot of Order to Dispatch's rail. It was in the
plan as `OcpiStepper.tsx` and never got built — every other FMS module has it and OCPI did not.*

- [x] `components/OcpiStepper.tsx` — the adapter. The drawing is the **shared**
      `shared/components/ui/PoStageRail.tsx`, the same rail Order to Dispatch, Purchase, Import,
      Production, Sampling, Asset Maintenance and HR Recruitment already use, so OCPI got the
      identical thing rather than a lookalike
- [x] Mounted at the top of `pages/deals/DealDetail.tsx`, **above** the facts card: "where is it
      and who has it" is what somebody opening a deal they did not raise is actually asking
- [x] `lib/queues.ts` gains `stepActorId(deal, step)` — the counterpart to the existing
      `stepCompletedIso`. Kept beside it deliberately: they answer the same question about the
      same row, and a step added to one and forgotten in the other is a step the rail would date
      without naming
- [x] Position comes from **`STATUS_STEP`**, the same map the five queues read, so the rail cannot
      say a deal is at Approve OC while the OC Approval queue does not hold it
- [x] Parked and dead deals show **where they stopped**, in red, with a chip naming it: on hold
      reads `hold_from_status`, rejected reads `reject_stage`. Cancelled records no stage at all,
      so it falls back to the first step with nothing stamped on it

### A finished step names who DID it; an unfinished one names who OWES it
Not the same question, and the rail answers whichever one the reader can use. Once a quotation is
approved, "the approvers are A and B" is noise — the fact is that **B approved it, on the 18th**.
Before it is approved, who approved it does not exist and the useful answer is who to chase. The
date under a finished step is what tells the two apart at a glance. This is a deliberate divergence
from Order to Dispatch's rail, which captions every node with its assigned owners; OCPI can do
better because it stamps `qa_by` / `oc_by` / `oca_by` / `cs_by` / `ms_by` on the row.

`quotation` is the exception in the other direction: it names its **author** whether finished or
not. Settings leaves that step unowned on purpose (no owners ⇒ anyone with an edit grant may raise
one), so asking the owner list captioned it "Unassigned" on a draft that plainly belongs to
somebody.

### No site chip, and what took its place
Order to Dispatch's "NOIDA · owners shown are the ones covering this site" chip exists because
dispatch step owners are **per site**. OCPI's are module-wide, so the same chip would be a lie.
What OCPI has instead is the fact the slot should carry:

- **`Rev N`** — the quotation was rewritten N times during the negotiation. The direct analogue of
  dispatch's `Round N` chip.
- **`Sent back N times`** — see below.

### Found while building: a returned quotation was invisible
`fms_ocpi_decide_quotation` handles a `rework` decision by setting the deal's status back to
**`draft`** — the same status it had before it was ever submitted — and `fms_ocpi_decide_oc` sets
it back to `awaiting_order_confirmation`. So a deal an approver had **rejected back for changes**
looked, in the rail, the queues, the deal list and the dashboard, exactly like one nobody had ever
looked at. The only surviving evidence was `rework_count` / `rework_stage` / `rework_at` /
`rework_reason`, and nothing read them.

The rail now shows `Sent back N times · last returned from Approve Quotation on 21 Aug 2026 —
<the reason>`. It is not styled as a halted state, because somebody IS working on it; it is a fact
about how the deal got where it is.

⚠ **Consequence for whoever reads this next:** the status `rework` is a legal value in the deals
CHECK and several screens test for it (`OPEN_STATUSES`, the Control Center's Parked strip, the
dashboard's Stalled card, `fms_ocpi_resume`'s status map) — but **nothing in the module can
currently produce it.** Those branches are inert, not broken. They were left in place: the value is
legal, the tests are cheap, and removing them would only make a future RPC that does set `rework`
silently invisible. Do not conclude the rail is broken because you cannot make that branch fire.

### Verify
- [x] `npm run build` green — tsc strict + vite
- [x] **At an approval** — steps 1 done with its date and author, step 2 orange with its owners,
      3–7 grey and numbered
- [x] **With the customer** (rev 3) — four green ticks each dated and named, step 5 orange, and the
      `Rev 2 · the quotation was revised 2 times during the negotiation` chip
- [x] **Closed** — all six ticked with real dates and real actors, and the Closed node itself
      finished
- [x] **On hold from `awaiting_order_confirmation`** — stops at step 3 in red, chip "On hold",
      steps 1–2 dated
- [x] **Returned for changes** — back at step 1 with its author, chip "Sent back 2 times · last
      returned from Approve Quotation on 21 Aug 2026 — Price needs revisiting"
- [x] Test data removed: 0 deals, 0 activity, 0 step owners (the five I set for the test are gone,
      restoring "Nobody assigned yet"), counter 23, series unconfirmed

---

---

## Open items for Bushra (none block phase 1)

- [ ] What OCPI stands for, and the current maximum `QT-M####` — **no longer blocking, but still
      needed.** Settings → Quotation numbering takes the figure and moves the series forward; until
      somebody confirms it, every screen that can mint a number says so (phase 9c)
- [ ] Pengda 800: the deck is a copy of the 1000 — what are the real 800 specs?
- [ ] "Alpha 2 – 8 Heads machine" is three machines (1.8 m / 1.9 m `OT-1908A` / 2.2 m) — confirm names
- [ ] The 15 models with no template — who supplies the content?
- [ ] Five selling companies, one letterhead — which entities raise OCPIs? **The four without a
      profile now warn by name on every screen that produces a document** (phase 9c), so a wrong
      bank block can no longer go out unnoticed — but the right one still has to come from you
- [ ] Q24 "Separate Invoice for Head" — an instruction to accounts, or a second document?
- [ ] Payment Date / Payment Amount / PDC Cheque Details — on the printed form, not the live one
- [ ] Deal value in USD — a separate INR value, or a held conversion rate?
- [ ] "Checked By" (Alpha) vs "Approved By" (Homer / P8) — a real distinction, or drift?
- [ ] Who signs Prepared By / Approved By — automatic, or per deal?
- [ ] The Alpha warranty differs in substance (onsite, no-AMC-with-Orange-ink, 20–24 °C) — current
      policy, or stale text?

---

## Found along the way, outside OCPI

- [ ] **The 1.9 m Alpha deck was copied from the 1.8 m one and not fully edited.** Its composition
      block is still headed "1 LARGE FORMAT INKJET PRINTER(1.8 Meter)". Not reproduced in the seed;
      the spec table's 1900 mm is used instead. Worth checking what else in that deck is stale.

- [ ] **K32's deck lists four DEAL OPTIONS as if they were part of the machine** — Ink Dust
      Exhauster, External Centring Device, Air Blade and Head Cooling System. The Microsoft form asks
      about each separately (questions 34–37), so they belong to the deal, not the model. Left out of
      the seeded composition; phase 7 appends the ones a deal actually includes. Confirm with Bushra
      that no K32 buyer has been getting them implicitly.

- [ ] **The sidebar can highlight two pages at once, portal-wide.** `Sidebar.tsx` marks a row
      active on a prefix match (`end={item.to.split("/").length <= 2}`), which is right for detail
      pages but lights BOTH rows when one nav destination sits under another. Asset Maintenance has
      it at `/assets` vs `/assets/new`. OCPI sidesteps it by flattening its own paths; the real fix
      is "longest match wins", which means threading an active path through `Row` and its six call
      sites — shared chrome fifteen modules depend on, so not something to change mid-feature.

---

## Housekeeping

- [x] Moved to `docs/ocpi/ms-form-questions.json` (decoded to real JSON — the 47-question spec with branching)

- [x] Deleted `ms-form-definition.json` and the phase-1 screenshot from the repo root

---

## Test data · 24-Aug-2026

**20 seeded deals put a row at every stage of the chain**, because the module was live but almost
empty (8 drafts, one quotation waiting) and the queues, the dashboard tiles, the Control Center and
the register all rendered as empty states that could not be judged. Every one was raised and walked
down the chain **through the real RPCs**, acting as real users (Yash raises, Karan approves the
quotation and countersigns, Shweta confirms the OC), so the numbers, stamps, activity rows and
notifications are the ones the app itself would have written — not hand-set columns.

| Stage | Deals |
|---|---|
| `draft` (7 old + Gokul, returned by the approver) | 8 |
| `awaiting_quotation_approval` (+ 1 pre-existing) | 3 |
| `awaiting_order_confirmation` | 4 |
| `awaiting_oc_approval` | 2 |
| `awaiting_customer_sign` | 3 |
| `awaiting_management_sign` | 2 |
| `closed` | 2 |
| `rejected` (one at each gate) | 2 |
| `on_hold` · `cancelled` | 1 · 1 |

Also exercised: both rework loops (Suryodaya's quotation returned then revised to Rev 1; Vardhman's
OC returned then resubmitted), the management signature return (Ravi Kiran), a USD deal on high seas
(Hariom), three deals booked to the Noida entity so the **wrong-entity warning** fires, and one deal
on a machine with **no order-confirmation template** (Rangoli / K64) so the OC step's refusal is
visible. Stamps were then backdated so the SLA colours have a real spread — roughly half of each
queue overdue.

- **The handle is `customer_name like 'ZZ TEST%'`**, and `remarks` also carries
  `DUMMY TEST RECORD - safe to delete`.
- **Twelve real files sit in `fms-ocpi-docs`** behind the customer-signed and countersigned copies
  (10 PDFs, 2 PNGs) — a signature is the one artifact the module cannot re-render, so a path with
  no object behind it would render as "this page could not be opened".
- **Teardown:** storage first, then SQL — scripts in the session scratchpad
  (`SOP/ocpi-test-data/`, gitignored — see its README). `activity` and `notifications`
  have no FK, so they must be deleted by `entity_id` before the deals.
- **⚠ THE COUNTERS DO NOT COME BACK.** The seed burned **QT-M0027…QT-M0046** and
  **OTPL/OC/2627/0001…0011**. Deleting the deals does not return them, and
  `fms_ocpi_set_quotation_series` is forward-only by design, so the quotation series can only be
  lowered from SQL. After teardown, reset `oc:2627` to zero and set the quotation counter to the last
  number really issued, then confirm it in Settings → Quotation numbering.

### Found while seeding

- [ ] **`status = 'rework'` is unreachable.** It is in the table's CHECK, in `OPEN_STATUSES`, and
      `fms_ocpi_save_oc_draft` / `fms_ocpi_submit_oc` both accept it — but no RPC ever sets it.
      `decide_quotation` rework lands on `draft`, `decide_oc` rework lands on
      `awaiting_order_confirmation`, and `return_signature` lands on `awaiting_customer_sign`. So it
      is the one status with no row in the seed, and either the value is dead and should be dropped
      from `OPEN_STATUSES`, or a path was meant to reach it and does not.

---

# The revision · stages 0–H

*Raised 24-Aug-2026. Tracked as **OCPI-2** in `WORKLIST.md`. Plan of record:
`C:\Users\Admin\.claude\plans\now-there-is-a-memoized-mccarthy.md`.*

**What changes:** one form instead of two; both papers generated together headed ORDER QUOTATION and
re-headed ORDER CONFIRMATION when the Directors approve (which is also when the OC number mints);
Sections B and C mandatory; High Seas / Others driving currency and GST; dollar deals showing both
currencies on a live overridable rate; the master form's remark boxes gathered as Special remarks;
every revision keeping its own value and pair of PDFs; and two new steps after the countersignature.

**What does NOT change:** the customer-signature → countersignature loop, and the price — the
salesperson still types it. **All pricing is phase 2.**

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped

## Status at a glance — the revision

| Stage | What | Gate | State |
|---|---|---|---|
| 0 | Track it — WORKLIST + this file | — | `[x]` done 24-Aug-2026 |
| A | SQL foundations | build green | `[x]` done 24-Aug-2026 |
| B | The merged form | build green + form walk | `[x]` done 24-Aug-2026 |
| C | Commercial terms, currency, GST, FX | build green + High Seas walk | `[x]` done 24-Aug-2026 |
| D | Both papers, one set | build green + 2 PDFs stored | `[x]` done 24-Aug-2026 |
| E | The conversion + print gating | build green + **non-admin Director test** | `[x]` done 24-Aug-2026 |
| F | The chain — cutover | build green + full walk | `[x]` done 25-Aug-2026 |
| G | Round-out | build green | `[x]` done 25-Aug-2026 |
| H | Teardown + go-live | counters correct | `[x]` done 25-Aug-2026 |

**Gate for every stage:** `cd frontend && npm run build` green (tsc strict; there is no test runner).

---

## Stage 0 · Track it `[x]`
- [x] `WORKLIST.md` — **OCPI-2** added, `[~]`, cross-referencing OCPI-1 whose "Before it goes live"
      items are explicitly **not** superseded
- [x] `OCPI.md` — the READ THIS FIRST banner at the top, and this section

## Stage A · SQL foundations `[x]` — applied & rollback rehearsed 24-Aug-2026
- [x] Migration `…_add_fms_ocpi_merged_form.sql` — prose header + `-- Reversal (reverse order):`
- [x] `fms_ocpi_quotation_versions` + `deal_value_amount`, `deal_value_currency`, `fx_rate`,
      `oc_pdf_path`, `oc_document_payload`
- [x] `fms_ocpi_deals` + `fx_rate`, `fx_rate_at`, `fx_rate_source`, `fx_rate_overridden`,
      `deal_value_inr`, `fh_at` / `fh_by` / `fr_at` / `fr_by`
- [x] `fms_ocpi_set_version_pdf` widened with `p_slot text default 'summary'` — the default keeps
      every existing caller working
- [x] `doc_title` CHECK accepts `'ORDER QUOTATION'`
- [x] Lift `fetchFxRate` to `shared/lib/fx.ts`; re-point Import's import
- [x] **Rehearse the rollback on live data** — not read it


### Verify — Stage A
- [x] Applied to `icutjkrqkbzwvmnfbzpr`: 5 new version columns, 9 new deal columns, widened
      `doc_title` CHECK, one `fms_ocpi_set_version_pdf`
- [x] **`fms_ocpi_deals` still has 0 write policies** — the RPC is still the only write door
- [x] 28 deals, 28 machines, 27 versions all intact
- [x] **Rollback rehearsed on the live database, not read**: the migration's own Reversal block ran
      clean — every column gone, the 3-arg function back, the CHECK back to two values — and was then
      re-applied. Verified all new columns were NULL first, so nothing was destroyed to prove it
- [x] `npm run build` green — tsc strict + vite, 36.1s

**Found while applying: `create or replace` with an ADDED parameter creates an OVERLOAD, it does not
replace.** After the first apply the catalogue held BOTH the 3-arg and 4-arg `fms_ocpi_set_version_pdf`.
A 3-arg call would have resolved to the stale one, PostgREST can refuse an ambiguous call outright,
and a later edit to one would not have touched the other. Caught by reading `pg_proc` back rather
than trusting the `{"success":true}`. The old signature is now dropped explicitly in the migration.

**⚠ The database is in live use during this build.** `QT-M0047` was generated by somebody else at
13:24 on 24-Aug while Stage A was being applied. Still `ZZ TEST` data, but the quotation counter is
moving, so Stage H must read the counter fresh rather than assume 46.

**Counters as at the end of stage H: `quotation` = 23, and no `oc:` row at all.** The seed and the
stage A–G walks between them consumed `QT-M0024`…`QT-M0048` and `OTPL/OC/2627/0001`…`0013`;
teardown put the quotation series back to 23 — where the seed found it — and removed the OC counter
entirely, so the first order confirmation ever issued will be `OTPL/OC/2627/0001`.
## Stage B · The merged form `[x]` — 24-Aug-2026
- [x] `fieldSpec.ts` absorbs `ocFieldSpec.ts`'s part-B fields as **optional**; `withGst()` kept
- [x] `missingForDetailSheet` — names the blank lines, **never blocks**
- [x] `missingForSubmit` widened to every **visible** field of Sections B and C, gated by `isVisible`
- [x] New branch rule: `dollarClauseAgreed` visible only when currency is USD — in
      `PART_A_VISIBILITY` **and** in `write_quotation`'s clearing (the header says they must agree)
- [x] **Special remarks** — `head_balance_remarks` + `other_commitments` + `remarks` in one group;
      Q46's label renamed, column kept
- [x] Insurance and dollar clauses left as clauses; `spare_details` / `platter_details` left as
      specifics
- [x] `QuotationForm.tsx` — "Document details (optional)" card; deal-value input **unchanged**
- [x] **Check existing rows, then** widen CHECK `fms_ocpi_complete_when_submitted`
- [x] Collapse `clearHidden`'s identical ternary branches


### Verify — Stage B
- [x] `npm run build` green — tsc strict + vite, 15.8s
- [x] **Part-B columns write while the deal is still `draft`** — the exact thing
      `fms_ocpi_save_oc_draft` refuses. Probed `fms_ocpi_write_oc` against a ZZ TEST draft: printer
      warranty, head warranty, delivery days, trade term, GST %, air blade, chilling system, dryer
      chambers, prepared-by and both remark boxes all landed
- [x] **The cross-writer branch reads still work from the merged path**: `head_balance_remarks`
      survived because `incl_head` is true on the row, `dryer_chambers` because the dryer is
      "Chinese" and not "Not Applicable" — `write_oc` reading part-A answers off the row, not the bag
- [x] **The dollar clause is a dollar term.** Same deal written as INR with
      `dollar_clause_agreed: true` → stored **null**; written as USD → stored **true**
- [x] Existing branch clearing unharmed: switching `local` → `high_seas` cleared `local_cost_by`;
      `incl_head = false` cleared `heads_included`
- [x] The widened CHECK was **validated by Postgres against all 28 existing rows** when the constraint
      was added — and measured first: 0 failures on each of its seven new clauses
- [x] Probe row restored **from its own frozen version 1** — the freeze doing exactly what it exists
      for. Every field matches. The one difference is deliberate: `dollar_clause_agreed` came back
      `null` rather than `false`, because it is an INR deal and the clause is no longer asked of one

- [x] **Walked in the browser** (24-Aug, after the profile lock cleared). The merged form renders:
      "Special remarks · section D" carrying the remarks and commitments boxes, and a "Document
      details" card with Warranty & service / Delivery & tax / Options / Sign-off. The conditional
      groups behaved — **the head and dryer groups stayed hidden** with no head and no dryer chosen,
      and so did the dollar-clause block on an INR deal
- [x] **Sections B and C are demanded**: the blocking list read "…whether the deal includes ink,
      whether the deal includes spare parts, whether the deal includes a head, the deal type
      (High Seas or Others), the total deal value, the type of payment, the terms of payment, the
      machine delivery date"
- [x] **THE STAGE-B RISK IS CLOSED END TO END.** A draft saved from the real form with real auth
      (`ZZ TEST Stage B Walk`, deal `e319432f`) persisted `delivery_days`, `consumables_supplier`,
      `prepared_by` and `gst_rate` — part-B columns, on a row whose status is `draft`, which
      `fms_ocpi_save_oc_draft` would have refused outright
- [ ] Still shows the old label "Transportation terms" — Stage C relabels it *Deal type* and moves it
      to the head of section C

**Found while probing: a temp table does not survive between MCP SQL calls.** Each call is its own
session, so the `probe_snap` snapshot taken before a full-bag `write_quotation` was gone by the time
it was needed. Recoverable only because the deal's own frozen version held the original answers.
Anything that needs a restore point across calls must write to a real table — or, better, be probed
on a row whose version history can restore it.

**The browser walk was deferred once.** The Playwright profile was locked by the user's own Chrome
("Browser is already in use"), so Stage B was first proved in SQL alone. Cleared later the same day by
killing only the processes whose command line named the MCP profile — the user's own 75 Chrome
processes were left alone — and then walked properly. Both records are kept: the SQL probes are the
stronger evidence for the writer split, the walk is the only evidence the form itself works.
## Stage C · Commercial terms, currency, GST, FX `[x]` — 24-Aug-2026
- [x] `transport_terms` relabelled *High Seas / Others*, promoted to the head of Section C —
      **no new column**
- [x] `write_quotation`: high seas implies `deal_value_currency = 'USD'`, forced server-side
- [x] `write_oc`: reads `transport_terms` **off the row**, forces `gst_rate = null` on High Seas.
      GST is a part-B column, so the suppression belongs here — the two writers must keep their
      column separation or saving one blanks the other
- [x] The GST rate is **cleared on High Seas, not left at 18** — `branching.ts` rule 5 hides the
      field, `clearHidden` blanks it, and `write_oc` sets the column NULL regardless.
      (`EMPTY_OC` no longer exists; stage B merged it into `EMPTY_DRAFT`.)
- [ ] **DEFERRED TO STAGE D** — High Seas needs a separate RENDER branch that omits the GST rows
      entirely, since `withGst()`'s empty strings would print a blank tax row instead of no row.
      That is the PDF renderer, which stage D builds; the DATA is already correct (null, not zero)
- [x] FX panel — fetch on USD, show source and time, hand override, `fx_rate_overridden`


### Verify — Stage C
- [x] `npm run build` green — tsc strict + vite, 14.1s
- [x] **Others + INR** — ₹52,00,000 at 18% derived to ₹9,36,000 GST and ₹61,36,000 total, with
      `machine_value_inr` taken from the deal value rather than typed
- [x] **High Seas** — the payload deliberately said `deal_value_currency: 'INR'` and the row came back
      **USD**, forced server-side. `gst_rate` and `gst_amount_inr` both **null, not zero**.
      `deal_value_inr` = 62,000 × 87.425 = **₹54,20,350**, and `machine_value_inr` took that converted
      figure rather than the dollar one. `local_cost_by` cleared by the switch
- [x] The FX position stored with provenance — rate, source `xe.com`, fetched-at, and the
      overridden flag
- [x] **Walked in the browser.** Section C now opens with **Deal type**, reading "High Seas"; the
      currency picker is **disabled showing USD** with the hint "fixed by the deal type"; the
      explanatory line prints; the FX panel shows the rate, a *Get live rate* button, the provenance
      line, and **≈ ₹54,20,350** beside it
- [x] **Both directions of the GST rule** — hidden on the High Seas deal, present and defaulted to 18
      on a fresh Others quotation. The FX panel likewise absent on a rupee deal

**Found in the walk: the GST % field was still being asked on a high seas deal.** The branch rule was
declared in `branching.ts` but the field in the Document details card was never wired to it, so the
form asked for a tax rate on a contract that carries no tax. No bad data reached the row — `write_oc`
nulls it regardless — but asking an impossible question is exactly what the branch rules exist to
prevent, and only the browser walk showed it. Fixed by gating the field on `show("gstRate")`.

**The currency picker is DISABLED, not hidden, on a high seas sale.** A reader still needs to see
*which* currency the deal is in; hiding the field would make the rule look like a missing question
rather than a fixed one.
## Stage D · Both papers, one set `[x]` — applied & rollback rehearsed 24-Aug-2026

Migration `20261019120300_fms_ocpi_generate_both_papers.sql`.

- [x] `generate_quotation` stamps value / currency / fx onto the version and freezes **both** payloads.
      The three money columns are **read off the deal row, not taken from the payload** — the server
      is what forced USD on a high seas sale, and the payload may still say otherwise
- [x] Browser uploads **two** PDFs per version under the deal's own `quotation` folder
- [x] `quotationDetailFileName()` — the sibling of `quotationFileName()`. Both papers land in one
      folder with `upsert: true`, so a shared name would mean the second silently replaced the first
- [x] `has_template = false` implies summary only, machine named on screen, **nothing blocked**
- [x] `quotationPdf.ts` `sectionRows()` — Section C now leads with the deal type and is **built, not
      listed**: dual currency and the rate on a dollar deal, the GST row only when a rate exists, the
      dollar-exchange clause and its tick only on a dollar deal
- [x] Section D retitled **"D. Special Remarks"**, carrying all three fields — and the balance-heads
      box only when the deal actually includes a head
- [x] `missingForOc`'s four hard blocks are gone from the live path: `machine_value_inr` stopped
      being a question at all in stage C (it is derived), and the other three are named by
      `missingForDetailSheet` as blanks that will print, never as a gate. `missingForOc` itself
      survives only in `OrderConfirmationEditor`, the retired screen stage F deletes
- [x] `npm run build` green — tsc strict + vite, 15.1s
- [x] **Rollback rehearsed on live data** — not read

### Verify — Stage D

- [x] **High Seas, USD, machine WITH a template** (Homer K24, QT-M0048) — two PDFs written to
      `<deal>/quotation/v1-QT-M0048.pdf` (187,651 B) and `v1-QT-M0048 Detailed.pdf` (232,462 B),
      confirmed as two distinct objects in `storage.objects`
- [x] **The summary's section C, read out of the generated PDF**: Deal Type *High Seas* · Machine
      Value *$ 62,000* · Value in INR *₹ 54,20,350 (at 87.4250 per USD)* · Total Value (INR)
      *₹ 54,20,350* — **and no GST row at all**, not a zero one
- [x] **The detailed sheet's totals block, likewise**: *Machine Value USD $ 62,000* ·
      *Machine Value INR (at 87.4250 per USD) ₹ 54,20,350* · *Total Value INR ₹ 54,20,350*.
      The old `gstRate === null ? 18` line — which printed "+ 18% GST Value INR" with a blank
      figure on exactly the deals that carry no tax — is gone
- [x] **Others, INR, machine WITHOUT a template** (Position Printer, QT-M0047 Rev 1) — one PDF, the
      *"Position Printer has no detailed sheet yet"* notice before generating and *"No detailed sheet
      was produced"* after, and nothing disabled. Section C printed *Deal Type Others · Machine Value
      ₹ 11,50,000 · GST @ 18% ₹ 2,07,000 · Total Value (INR) ₹ 13,57,000*, with no dollar rows
- [x] **Section D on both** — *D. Special Remarks* carrying all three boxes on the head-included deal,
      and only two on the deal without a head
- [x] **The freeze holds, proved rather than asserted.** A `[FREEZE PROBE]` line was appended to
      Homer K24's CANCELLATION section, a revision generated, and the version rows read back:
      **v1 does not carry the probe, v2 does.** The section was then restored to its original 614
      characters
- [x] **Every revision keeps its own strip** — the revision history shows, per revision, the value,
      the rate it was converted at, and working signed links to both papers. A version frozen before
      this stage shows nulls in the money columns and degrades to the summary link alone
- [x] **Rollback rehearsed on the live database.** The Reversal block ran clean — the 4-argument
      function dropped, the previous 3-argument one recreated, `pg_proc` read back to confirm
      exactly one signature — and the migration was then re-applied. Grants came back identical
      (`anon` / `authenticated` / `service_role`), which is the thing a drop-and-recreate silently
      loses

**Found in the walk: the blank-lines warning fired on a machine that produces no detailed sheet.**
"The detailed sheet will print 6 blank lines" sat directly beneath the notice saying no detailed
sheet exists — two cards on one screen contradicting each other. Suppressed when there is no
template.

**Two things this stage deliberately does NOT do.**

1. **The headings are still the old ones.** The summary prints *NEW MACHINE QUOTATION* and the
   detailed sheet prints the machine's own `doc_title` — *ORDER CONFIRMATION* for nine machines,
   *OFFER QUOTE* for P8D — on a paper that has not been approved by anyone. Resolving the heading
   **by stage** is stage E, and it is stage E's first item.
2. **`oc_document_payload` is frozen RESOLVED while `document_payload` freezes the template.** That
   asymmetry is deliberate: the summary is drawn from the deal's own answers, which `field_payload`
   already freezes, whereas the detailed sheet is drawn from a machine template somebody may reword
   next month.

## Stage E · The conversion + print gating `[x]` — applied & rollback rehearsed 24-Aug-2026

Migration `20261019120400_fms_ocpi_conversion_at_approval.sql`.

- [x] `doc_title` resolved **by stage**, not stored — `docHeading(deal)` in `lib/format.ts`. Both
      sheets print **ORDER QUOTATION** until the Directors approve and **ORDER CONFIRMATION** after,
      and the approved summary now carries the OC number in its title bar as the detailed sheet
      always has
- [x] Minting lifted into `decide_quotation`'s approve arm — **only on approve, and only once**
- [x] The `has_template` refusal is **not carried onto the approval**; summary-only is a legal
      outcome there. `submit_oc` keeps its own refusal — see the deviation note below
- [x] **`can_add_doc` admits the approver to the `oc` slot**, and `freeze_oc`'s own check with it
- [x] The Director's browser renders both papers with the minted number, uploads them to
      `<deal-id>/oc/` under two names, and calls `freeze_oc` with both paths
- [x] **Print signature copy** only at `awaiting_customer_sign`, serving the **stored** files, with
      the rebuild fallback labelled on screen
- [x] 🔴 **Proved for a real non-admin, non-coordinator Director** — see below
- [x] `npm run build` green — tsc strict + vite, 14.3s
- [x] **Rollback rehearsed on live data** — not read

### Verify — Stage E

- [x] **Before approval both papers read `ORDER QUOTATION`** — read out of the generated PDFs on
      QT-M0048 Rev 2, summary and detailed sheet alike
- [x] **A quotation sent back at the gate mints nothing.** Returned with a reason: the `oc:2627`
      counter stayed at **11**, `oc_no` stayed null, and the deal went back to the salesperson with
      its quotation number and every revision intact. This was the explicit promise
- [x] **Approving minted `OTPL/OC/2627/0012`** and, in the same action, re-rendered and uploaded both
      papers: `…/oc/OTPL-OC-2627-0012 Summary.pdf` (187,850 B) and `…/oc/OTPL-OC-2627-0012.pdf`
      (232,868 B), two distinct objects, both paths frozen onto the deal, `oc_document_payload`
      recording `doc_title = ORDER CONFIRMATION`. Counter 11 → 12
- [x] **Both approved papers read `ORDER CONFIRMATION` and carry the number**, read out of the
      stored bytes
- [x] **P8D no longer prints `OFFER QUOTE`.** A seeded P8D deal at `awaiting_customer_sign` rendered
      `ORDER CONFIRMATION OTPL/OC/2627/0004` on both sheets. The stage rule supersedes
      `fms_ocpi_machines.doc_title`, which answers open item 1 — the client should confirm it
- [x] **Print gating** — the signature copy is offered only at `awaiting_customer_sign`. On the
      seeded deals, which have no stored files, both sheets rebuilt and the panel said
      *"Rebuilt from the template — the approved file could not be found"* rather than substituting
      silently
- [x] **Rollback rehearsed on the live database.** The whole Reversal block ran — the 4-argument
      `freeze_oc` dropped and the 3-argument one restored, `decide_quotation` and `can_add_doc` put
      back verbatim, the column dropped — verified by reading `pg_proc` and
      `information_schema.columns`, then re-applied. **The rehearsal found something a reading would
      not have:** dropping the column loses the approved summary's path. The files survive in
      storage, so it is a repair rather than a re-render, but a real rollback must copy the column
      out first. Recorded in the migration's own Reversal block

### 🔴 The one test an admin account cannot perform

`fms_ocpi_can_add_doc` is exactly what the storage INSERT policy calls
(`with_check: bucket_id = 'fms-ocpi-docs' AND fms_ocpi_can_add_doc(name, auth.uid())`), and
coordinators pass it unconditionally — so an admin can never see this refusal. A real portal user
was granted OCPI edit and made the sole `quotation_approval` owner, and the predicate evaluated
against **their** id:

| | |
|---|---|
| `is_admin` | **false** |
| `is_coordinator` | **false** |
| raised this deal | **false** |
| may approve (`quotation_approval`) | **true** — they are a Director |
| **`can_act('order_confirmation')` — the arm the `oc` slot used to map to** | **false** ← the bug |
| **`can_add_doc('<deal>/oc/….pdf')`** | **true** ← the fix |
| `can_add_doc('<deal>/management-signed/….jpg')` | **false** — no other door opened |

A control user with OCPI edit who is **not** an approver returns **false** for both, so the new arm
admits Directors and nobody else. The grant and the owner row were then removed; the module is back
to **zero OCPI grants and zero step-owner rows**, exactly as found.

**Not driven through a browser as that user, and deliberately so.** Logging in as them needs their
password — a real employee's, which per CLAUDE.md is also their mobile number — and creating a
dedicated test account means creating a user in the production identity project. Say the word and
I will raise a `ZZ TEST` Director account for the full click-through; what is proved above is the
predicate the policy calls, with the bucket check the only thing between it and the write.

### Two deviations from the plan, and why

1. **The final gate is `ApprovalPanel` grown into a document gate, not `OcApprovalPanel`
   repurposed.** The plan chose `OcApprovalPanel` because it already renders the PDF — but what it
   contributes is a layout, while every binding it carries (`awaiting_oc_approval`, the
   `oc_approval` owners, `decideOc`) is the wrong one for this gate and would all have had to be
   re-pointed. `ApprovalPanel` already owns `decide_quotation`, the `quotation_approval` owners and
   the self-approval rule; it gained the rendering. **`OcApprovalPanel` is therefore deleted in
   stage F rather than kept** — the opposite of what the plan says, and the plan's *behaviour*
   requirement (nobody confirms a contract from a list of field values) is met either way.
2. **`submit_oc` keeps its `has_template` refusal.** The plan says drop it "when the minting
   moves"; the reason was that the refusal must not travel to the Directors' gate, and it has not —
   the approval never checks for a template. Dropping it from `submit_oc` itself would only make the
   retired path worse: a no-template deal would reach `awaiting_oc_approval` with nothing to render.
   Stage F retires that step, and the RPC is retained for historical rows.

### Found in the walk

- **Nobody has OCPI access at all.** `app_access` holds **zero** rows for `ocpi`, so today the module
  is reachable only by admins, who bypass module checks. Stage G's empty-Directors warning is not a
  hypothetical.
- **The UI is stricter than the database about self-approval.** With no step owners,
  `fms_ocpi_decide_quotation` allows the raiser to approve (`array_length('{}', 1)` is null, so the
  guard's condition is null and never raises), but `ApprovalPanel` computes `soleApprover` as
  `owners.length === 1` — false for an empty list — and blocks everyone, admins included. Pre-existing,
  and exactly the confusion the empty-Directors warning should name. Left for stage G.
- **The approved summary carried no OC number.** It said ORDER CONFIRMATION in the title bar while
  its header block named only the quotation number. Fixed during the walk: the number now prints at
  the right of the title bar, where the detailed sheet has always shown it.

## Stage F · The chain — cutover `[x]` — applied & rollback rehearsed 25-Aug-2026

Migration `20261019120500_fms_ocpi_finance_chain.sql`.

**The new chain:** `quotation → quotation_approval → customer_signoff → management_signoff →
finance_handover → finance_receipt → closed`.

- [x] New RPCs `fms_ocpi_record_finance_handover` / `fms_ocpi_record_finance_receipt`
- [x] `record_management_sign` no longer sets `closed` — it hands to `finance_handover`
- [x] `order_confirmation` / `oc_approval` **retired but retained**: statuses stay legal, RPCs stay
      callable, step defs carry `retired: true`
- [x] `customer_signoff` re-anchored from `oc_approval` to `quotation_approval`
- [x] Both Finance steps given **explicit** SLA anchors — and every other step keeps one, so array
      position never decides an anchor
- [x] `fms_ocpi_resume`'s map — both new statuses added, `rework` repointed to `quotation`, the two
      retired rows kept
- [x] All ten chain encodings moved together, including the `STAGES` Finance band
- [x] Two new queue pages, cloned from the countersignature queue so the grid rules come free
- [x] `OrderConfirmationForm.tsx`, `ocFieldSpec.ts`, `OrderConfirmationEditor.tsx`,
      `OrderConfirmationQueue.tsx`, `OcApprovalQueue.tsx` and `OcApprovalPanel.tsx` **deleted**;
      their RPCs kept
- [x] `npm run build` green — tsc strict + vite
- [x] **Rollback rehearsed on live data** — not read

### The ten places that encode the chain, and where each moved

| # | Where | What changed |
|---|---|---|
| 1 | `lib/steps.ts` — `STEPS` | two Finance steps added; the retired pair moved to the end behind `retired: true` |
| 2 | `lib/steps.ts` — `STAGES` | new **Finance** band; the retired pair keeps a band of its own so nothing lands in "Other" |
| 3 | `types/index.ts` — `OcpiStatus` / `OPEN_STATUSES` / `STATUS_STEP` | two statuses added; the retired entries deliberately **kept** |
| 4 | `OcpiStepper.tsx` | the rail is now built **per deal** — see below |
| 5 | `lib/queues.ts` | `stepCompletedIso` / `stepActorId` read `fh_at/fh_by` and `fr_at/fr_by` |
| 6 | `nav.tsx` — `QUEUE_PATH` | two paths added; the loop skips `retired` steps |
| 7 | `lib/sla.ts` — `OVERRIDES` | `customer_signoff` re-anchored; both Finance steps anchored; retired pair still anchored |
| 8 | `adapters/ocpi.ts` | **no change needed** — it reads `STEPS` and `STAGES` generically, verified by opening the Control Center |
| 9 | deals status CHECK | widened by two; nothing removed |
| 10 | `fms_ocpi_resume`'s `VALUES` map | two rows added, `rework` repointed, retired rows kept |

Plus `fms_ocpi_config.step_sla`, the eleventh: **no stored row exists**, so the code defaults are
what apply. Nothing to migrate, checked rather than assumed.

### Verify — Stage F

- [x] **The full chain, walked as a real user** on QT-M0045: approve → the deal went **straight to
      Awaiting customer signature**, skipping both retired steps, minting `OTPL/OC/2627/0013`
- [x] File the customer-signed page → **Awaiting management signature**
- [x] Countersign → **To hand over to Finance**, *not* Completed. This is the change the client asked
      for, and the one that stops the paper going missing
- [x] Record the handover → **Awaiting Finance receipt**, showing *"Handed over to Finance — Yash
      Agarwal on 25 Aug 2026"*
- [x] **The same person cannot confirm their own delivery.** The panel offered no button and said
      why; the DATABASE was then asked directly, impersonating that user, and refused with
      *"You handed this contract over, so somebody in Finance has to confirm receiving it"* — raised
      from the function, not the UI
- [x] **A real non-admin Finance person closed it.** Granted OCPI edit and made sole owner of
      `finance_receipt`, they confirmed receipt: the deal went to `closed` with **two different
      people** on the two halves — `fh_by` the salesperson, `fr_by` Finance. Grant and owner row
      removed afterwards
- [x] **Completed is now dated from Finance receipt**, not the countersignature — *"Completed on
      25 Aug 2026"* off `fr_at`
- [x] **The rail draws the chain each deal actually travelled.** A new deal shows the seven live
      nodes and neither retired one; a deal parked at `awaiting_order_confirmation` shows the old
      nine-node rail with Order Confirmation and Approve OC in place
- [x] **A deal at a retired step says so** — its status reads *"(retired step)"* and a card explains
      that there is nothing to fill in any more and a coordinator can cancel it
- [x] **The sidebar offers exactly the five live queues** and neither retired one
- [x] **Resume, exercised against the deployed function for all eight statuses in its map** — each
      landed on the right step, including both retired ones and `rework → quotation`. Run inside a
      transaction that was rolled back; the probe deal was re-read afterwards and is untouched
- [x] **The Control Center opens** with the Finance steps and the retired band, no errors — proving
      the adapter needed no change
- [x] **Rollback rehearsed on the live database.** The whole Reversal block ran — both Finance RPCs
      dropped, three functions restored verbatim, the CHECK narrowed — verified by reading
      `pg_proc` and `pg_constraint`, then re-applied. **And its own caveat was proved first:** with a
      deal set to `awaiting_finance_handover`, narrowing the CHECK failed with
      *"check constraint … is violated by some row"*, exactly as the header warns

### Found in the walk

- **"Countersign and close" no longer closed anything.** The panel's heading, body copy and button
  all still said the countersignature completed the deal. Corrected to *"Countersign and send to
  Finance"*.
- **"Sent back from Closed."** The rework chip read that on a deal with no recorded rework stage:
  `STAGE_LABEL(null)` matched the Closed node, whose `step` is `null`. Pre-existing, surfaced by
  this walk, fixed with a null guard.
- **Four screens still said a machine without a template would be *stopped*** at the order
  confirmation. Since stage D such a deal simply issues the summary sheet alone and goes all the way
  through, so the copy was the opposite of the truth. Corrected in Machines, Master Requests, the
  request modal and the quotation form.

### A decision left standing, not taken

**`status = 'rework'` is still unreachable.** The plan flagged this as the moment to fix it — land
send-backs on `rework` rather than `draft` — and asked for a decision rather than doing it quietly.
No decision has come back, so the behaviour is unchanged: a returned quotation still goes to
`draft` and is identifiable only by `rework_count` / `rework_stage`. `fms_ocpi_resume` now maps
`rework → quotation` so that the day it becomes reachable it resumes correctly.

### Two things a reader should not mistake for oversights

1. **The retired steps still appear on the Control Center.** Seven deals are parked at them. Filtering
   them out of the breakdown would make the collapsed total stop equalling the sum of the rows
   beneath it — the exact silent hole `buckets.ts` warns about. They disappear when the last deal
   leaves them.
2. **No route exists for either retired queue.** The screens that ACTED on those steps are gone,
   because the questions they asked are on the quotation form now. A parked deal is reached from All
   Deals, reads correctly, and a coordinator can cancel it.

- [ ] `record_finance_handover` / `record_finance_receipt`, cloned from the decision RPCs
- [ ] `record_management_sign` no longer sets `closed` — it hands to `finance_handover`
- [ ] `order_confirmation` / `oc_approval` **retired but retained**; statuses stay legal in the CHECK;
      step defs keep a `retired` flag so a historical deal's rail still draws
- [ ] `customer_signoff` re-anchored from `oc_approval` to `quotation_approval`
- [ ] Both Finance steps given **explicit** SLA anchors — anchors derive from array position, so an
      implicit one would be decided by where a retired step happens to sit
- [ ] `fms_ocpi_resume`'s VALUES map — two new statuses, `rework` repointed to `quotation`, retired
      rows kept
- [ ] All **ten** chain encodings moved together, including the `STAGES` Finance band
- [ ] Two new queue pages cloned from an existing queue (grid rules come free)
- [ ] `OrderConfirmationForm.tsx` + `ocFieldSpec.ts` **deleted** after absorption;
      `OrderConfirmationEditor` / `OrderConfirmationQueue` / `OcApprovalQueue` routes removed;
      **RPCs kept**

## Stage G · Round-out `[x]` — applied & rollback rehearsed 25-Aug-2026

Migration `20261019120600_fms_ocpi_round_out.sql`.

- [x] **Directors on Step Owners** — the gate is `quotation_approval` and Settings now says so.
      Retired steps are no longer listed there: naming an owner for a step nothing can reach would
      be asking somebody to watch an empty queue
- [x] **Empty-owners warning**, naming administrators and process coordinators as the current
      fallback. Shown on the Directors' gate and on both Finance steps
- [x] **`email_payload` branches** — the conversion reworded, **two genuinely new events**
      (`management_signed`, `finance_handover`) given branches of their own, `deal_closed` reworded
      for Finance receipt, and the four retired `oc_*` events re-pointed off two deleted routes
- [x] Finance steps announce to their own `step_owner_ids` — done in stage F, verified here
- [x] **Register**: the USD rate and the rupee equivalent, the two Finance stamps and who did them,
      and the OC date columns renamed to match what they now mean. Control Center needed no change —
      it derives from `STEPS` / `STAGES`
- [x] `Machines.tsx` already carries a read-only **Template** column, sorted and filtered on the
      answer rather than the link text
- [x] `npm run build` green — tsc strict + vite
- [x] **Rollback rehearsed on live data** — not read

### The hole this stage found

**The self-approval guard was not firing.** `fms_ocpi_decide_quotation` computed

```sql
v_sole := (array_length(v_owners, 1) = 1 and v_owners[1] = v_uid);
```

With **no owners named** — which is the state of this module today, zero rows in
`fms_ocpi_step_owners` — `array_length` returns NULL, so `v_sole` is NULL, so
`if v_owner = v_uid and not v_sole` evaluates to NULL. plpgsql takes a NULL condition as false, so
the guard was skipped entirely. A coordinator who raised a deal could approve their own quotation
through the API; the only thing stopping them was a hidden button.

`coalesce(array_length(v_owners, 1), 0)` makes "nobody is named" mean the guard **does** fire.

**Proved both ways, on live data:**

| | |
|---|---|
| the OLD expression, with no owners | evaluates to **NULL** |
| the NEW expression, with no owners | evaluates to **false** — so `not false` fires the guard |
| a plpgsql `if` on a NULL condition | takes the else branch — demonstrated in a `DO` block |
| calling the deployed RPC as the raiser | refused: *"You raised this quotation, so somebody else has to approve it"* |

The old-expression probe was created and called inside a transaction that was rolled back; the probe
function is gone.

### Verify — Stage G

- [x] **Settings → Who does what lists exactly the six live steps**, numbered 1–6, and neither
      retired one
- [x] **The empty-Directors warning shows on a deal awaiting approval**, naming admins and
      coordinators as the fallback and stating the self-approval rule — which the database now
      actually enforces
- [x] **Every event the chain can fire renders a real headline and a live CTA**, checked against a
      real deal: `quotation_submitted`, `quotation_approved`, `quotation_returned`,
      `customer_signed`, `management_signed`, `finance_handover`, `deal_closed`, and the two
      retired `oc_*` events. **No branch now points at a deleted route**, and none falls through to
      the generic "was updated" arm
- [x] **A dollar deal's email carries its rupee equivalent and the rate** —
      *"In rupees: Rs. 54,20,350.00 (at 87.4250 per USD)"* — so a reader does not convert it
      themselves at today's rate
- [x] **The Deal Register opens and its status filter offers all thirteen statuses**, including both
      Finance ones and the two labelled *(retired step)*. It derives from `STATUS_LABEL` rather than
      a hand-written list, which is exactly what that file's header promised
- [x] **Rollback rehearsed on the live database** — the pre-G `decide_quotation` restored, confirmed
      by reading `prosrc` back, then re-applied. Grants unchanged

### What Stage G did NOT need to do

- **The Control Center**: it reads `STEPS` and `STAGES` generically, so the Finance band and the
  retired band arrived with stage F. Verified by opening it rather than assumed.
- **The deal lists**: `DealsTable` already carries value and currency, and the register already
  carried the revision count.
- **The Machines template column**: it has existed since phase 6.

- [ ] `Directors` on `StepOwnersSection` + the empty-Directors warning naming admins as the fallback
- [ ] `email_payload` — **three** new branches (the conversion, and both Finance events). An event
      with no branch mails nothing, silently
- [ ] Finance steps announce to their `step_owner_ids`
- [ ] Register and Control Center: revision count, value, currency, the new chain
- [ ] `Machines.tsx` — read-only "has detailed template" column
- [ ] Verification write-ups here; `WORKLIST.md` OCPI-2 ticked

## Stage H · Teardown + go-live `[x]` — done 25-Aug-2026

Client instruction: *"Don't worry about deleting any of the existing data because all the data is
just the sample data."* That settles the one question teardown was waiting on — whether any of the
earlier drafts belonged to a real customer.

- [x] **Confirmed with the client** that every row was sample data. All **29** deals carried the
      `ZZ TEST` handle, so the handle and the instruction agreed
- [x] **Storage first, then SQL.** `99-teardown-storage.mjs` removed **35 objects** across all four
      slots — `quotation` (15), `customer-signed` (12), `management-signed` (4), `oc` (4). Doing it
      the other way round would have lost the deal ids the object paths are keyed on, and deleting
      the `storage.objects` rows from SQL would have orphaned the bytes in S3
- [x] `fms_ocpi_activity` (114) and `fms_ocpi_notifications` (38) deleted **by `entity_id` before
      the deals** — neither carries a foreign key
- [x] 29 deals and 32 quotation versions deleted
- [x] **Two seeded master requests deleted too**, which the teardown script did not previously cover:
      they hang off nothing, so they would have sat in the Master Requests queue for ever with a
      badge on the nav. `99-teardown.sql` now removes them
- [x] **The OC counter row removed**, so the next order confirmation mints `OTPL/OC/2627/0001`
- [x] **The quotation series put back to 23** — see below
- [x] **Final walk on a clean database**

### What the masters kept

Teardown removed deals and only deals. **28 machines** and their templates, the head / ink / dryer
masters, the company profiles and the module config all stayed: they are real content, transcribed
from the PowerPoint decks, and nothing about them was test data.

### The quotation series: put back, not guessed

The counter is at **23**, which is exactly where the seed found it. Everything from `QT-M0024` to
`QT-M0048` was consumed by the seed and by the stage A–G walks, and setting it back to 23 undoes
precisely that and invents nothing.

⚠ **It does NOT settle whether 23 is the real last quotation.** That figure was read off a single
scanned submission (`QT-M0023`) and has never been checked against the paper register — an open
question before any of this work and an open question still. `QuotationSeriesWarning` therefore
keeps showing on every screen that can mint a number until an admin confirms it in
**Settings → Quotation numbering**, which reads *"Last number issued: QT-M0023 · The next quotation
generated will be QT-M0024 · Not confirmed."* **This is the one thing standing between the module and
go-live, and only somebody with the register can answer it.**

### Verify — Stage H

- [x] **Nothing left**: 0 deals, 0 versions, 0 activity rows, 0 notifications, 0 master requests,
      0 storage objects. 28 machines kept
- [x] **The first numbers come out right, proved without burning them.** A complete walk —
      `save_draft` → `generate_quotation` → `submit_quotation` → `decide_quotation('approve')` —
      was run against the deployed RPCs inside a transaction that was **rolled back**
      (`fms_ocpi_next_seq` upserts a plain table row, so the counters roll back with it):

      | | |
      |---|---|
      | first quotation generated | **QT-M0024** |
      | after submit | `awaiting_quotation_approval` |
      | after the Directors approve | **OTPL/OC/2627/0001**, status `awaiting_customer_sign`, step `customer_signoff` |

      Straight past both retired steps, and the very first OC number is 0001.
- [x] **Re-read afterwards**: 0 deals, 0 activity, 0 step owners, 0 OCPI grants, counter still 23,
      0 storage objects. The walk left nothing behind
- [x] **Every screen renders a clean empty state**, no errors and no Access Denied: Dashboard, All
      Deals (*"0 quotations · No quotations yet"*), Approve Quotation, Hand Over to Finance, Finance
      Receipt, Control Center, Master Requests — whose nav badge is now gone
- [x] **Settings → Quotation numbering** shows 23 / next `QT-M0024` / **Not confirmed**

### Left exactly as found

Zero `app_access` rows for `ocpi` and zero `fms_ocpi_step_owners` rows — every grant and every
step-owner row created for testing was removed. **The module is reachable only by admins today**, and
nobody is named as a Director; the empty-owners warning says so on the approval gate itself.

---

# The order-confirmation series became a setting · 25-Aug-2026

The client, reading Settings: *"I see just the quotation number, but after the quotation is approved,
the quotation becomes the order confirmation. The order confirmation should have a separate number
series than the quotation, so add that as well in the settings."*

**It always was a separate series** — `OTPL/OC/<fy>/nnnn`, minted at the Directors' gate, off its own
counter (`fms_ocpi_counters.scope = 'oc:2627'`). What was missing is everything around it: no way to
see where it stood, and no way to move it. So the first order confirmation raised here would have
been `OTPL/OC/2627/0001` at a company that has been issuing them on paper for years — the exact
failure `fms_ocpi_set_quotation_series` exists to prevent, on the more expensive of the two numbers.
A quotation number goes out on an offer. An OC number goes out on a contract that is signed,
countersigned, and booked against.

**Migration `20261020120000_fms_ocpi_oc_series.sql`** adds `fms_ocpi_set_oc_series(p_last_used int,
p_fy text default null)` — admin-only, `for update` on the counter row, forward-only, and it records
the confirmation. Additive: one function, one config key, no table altered.

**⚠ THE OC COUNTER IS PER FINANCIAL YEAR AND THE QUOTATION COUNTER IS NOT.** The number carries the
year and restarts each April, so the year is an argument, the forward-only rule applies *within* it —
2728 legitimately starts again at 0001 while 2627 stands at 8 — and the confirmation is recorded per
year under `config.oc_series` as a **map keyed by year**, not a flag. A single flag would silence the
question next April, when a fresh counter starts at zero against a paper series that kept counting.
The config upsert is `value || excluded.value`, so confirming a new year does not erase the old one.

**Proven on live data before anything was believed**, in a rolled-back transaction:

| Rule | Result |
|---|---|
| a non-admin sets the series | refused |
| moving 2627 backwards (it stands at 8) | refused, naming the floor |
| a malformed year (`26-27`) | refused |
| out of range (99999 — the number prints as four digits) | refused |
| moving 2627 forward to 25 | counter = 25 |
| setting a different year, 2728, to 0 | counter = 0, unaffected by 2627's floor |
| both years in config afterwards | both present, each with its own stamp |

Counter verified still at **8** afterwards — nothing was burned. The **Reversal block was rehearsed**
too: function dropped, config key deleted, counter untouched, then rolled back and the function
confirmed present again. ⚠ The reversal deliberately does **not** touch `fms_ocpi_counters`: that
table pre-dates this migration and holds numbers already issued to customers.

**On screen:** *Settings → Order confirmation numbering*, mirroring the quotation card and naming the
year it is setting. Plus **`OcSeriesWarning`** on the **approval gate** rather than the editor —
that is where the number is minted, and the approver is the last person who can stop a contract going
out under a number somebody already holds.

**The printouts already carried it.** `deal.ocNo` prints right-aligned in the title bar of both
papers (added at revision stage E), the heading flips to ORDER CONFIRMATION through `docHeading`, the
detailed sheet offers `{{oc_no}}` as a placeholder, and the register exports it. Nothing there needed
changing — what was missing was only the ability to control where the series starts.

## Two things that went wrong while doing this

- **`git checkout -- lib/format.ts` discarded uncommitted work.** A bash patch script mangled the
  file (backticks inside a template literal, interpreted by the shell — the same trap logged twice
  already in this file), and reaching for `git checkout` to undo it reverted the file to its last
  *commit*, throwing away `docHeading` and the Finance/retired `STATUS_LABEL` entries from earlier in
  the revision. Both were recovered from the minified `dist/` bundle of the build made minutes
  earlier, and the comments rewritten. **The lesson is the same one already recorded: write patch
  scripts with a file, never a bash heredoc — and never reach for `git checkout` on a tree whose work
  is not committed.**
- **The build gate cannot go green right now, and not because of this work.** Another session is
  editing `hr-recruitment`, `import` and `procurement` in the same working tree — files changing
  between consecutive builds, and `InterviewsQueue.tsx` importing a `ReassignInterviewModal` that
  does not exist yet, which takes the dev server's whole module graph down. `tsc` reports **zero
  errors under `apps/ocpi`**; every remaining error is in those three modules. Browser verification
  of this change is therefore still outstanding.

---

# The body text was printing over the registered address · 25-Aug-2026

Reported off a live detailed sheet: the paragraph about component compatibility ran straight through
*Shed No. A2/711, Road No. 71, G.I.D.C. Sachin* and the CIN beneath it.

**The pagination logic was never wrong — it was obeying a limit in the wrong place.**
`BODY_BOTTOM_FRACTION` was `0.925`, and the footer artwork's ink starts at `0.875` of the page. So
for every page the renderer believed it had another 5% of the sheet to fill *after* the address block
had already begun. Anything short enough to fit that gap — a two-line paragraph, a signature label —
printed on top of it.

**The new limit is measured off the artwork, not guessed.** `letterhead-default.png` is 806×500 and
mostly a faint watermark; scanning it for the first row carrying pixels below ~55% brightness gives
row **360**, so `FOOTER_INK_TOP = 360/500 = 0.72` of the footer image. The band sits at `y 0.552`
with height `0.448`, so the ink begins at `0.552 + 0.72 × 0.448 = 0.8746` of the page.
`BODY_BOTTOM_FRACTION` is now **derived** from those three numbers minus a 1.5% clearance — not
re-typed as `0.86`, which would be a second copy of the geometry that drifts the moment the band
moves. If the artwork is ever re-cut, re-measure `FOOTER_INK_TOP` the same way.

One constant fixed **both** papers: `room()` in `ocPdf.ts` and the four `bodyBottom` checks in
`quotationPdf.ts` all read it.

**A second collision, at the other end.** `BODY_TOP = 92` has been exported from `letterhead.ts` all
along and used by nothing — both renderers hardcoded their own smaller numbers in `newPage` (70 in
the summary, 78 in the detailed sheet), and both sit *above* the wordmark's lower edge at `0.096` of
the page, about 81pt on A4. A full-width table continuing onto page two therefore started inside the
logo. Both now return `BODY_TOP`.

**Verified by measurement, not by eye.** Both PDFs were pulled out of storage and their text
placement operators read: against an address block starting at 736pt from the page top, the old
detailed sheet put **2 lines inside the footer, the worst 13pt past it**; the re-generated one puts
**none**, its lowest body text landing at 707pt — 29pt clear. The deliberate *Page x of y* line at
`pageH − 16` is excluded from the count; it belongs in the footer.

# The approval dialog is the width of a contract · 25-Aug-2026

The Directors' review opened in the default `md` dialog — 448px, narrower than the A4 page it was
rendering. The reviewer scrolled a portrait document inside a portrait dialog inside a portrait
scroll, and could not take in a table row without panning. Approving is the decision this module
exists for; it does not get the same dialog as a confirm prompt. It is now `size="2xl"`
(`max-w-6xl`), and `ApprovalPanel` takes an `inDialog` flag that shortens the PDF frame to `52vh` —
a viewer taller than its dialog just makes the *dialog* scroll, and the contract is then read through
a letterbox.

⚠ **Only this one modal needed it.** The other four queues (customer signature, countersignature,
and both Finance steps) open the full deal page rather than a dialog, so there was nothing to widen.

---

# The issued papers became a place, not a moment · 25-Aug-2026

The client's report: *"once the quotation is generated, I don't see that anywhere in the draft… the
user can have the option to download the PDF just once, but ideally it should not happen that way…
the user should have the option to re-download both the summary and the detailed version."*

**All three complaints were one defect.** `QuotationEditor` held the generated blobs in a
`useState` set by the Generate handler, and rendered the preview only when that state was full. The
files were never lost — they are in storage, on the version row, and `RevisionHistory` was already
linking them — but the editor never read them back. So the panel existed for exactly as long as the
page did: reload, navigate away, or come back the next morning, and the quotation had no documents.
The single chance to download was the moment of generation, which is the moment somebody is least
likely to want the file.

**`IssuedPapers`** (new) reads the newest version's `pdf_path` / `oc_pdf_path` off the row and
downloads them, and merely *prefers* the freshly rendered pair when Generate has just run — which
also removes a race with the upload. It is mounted on `versions.length > 0`, not on a piece of
component state. There is deliberately **no rebuild fallback**: an issued version is frozen, and a
quotation whose stored file is missing says so rather than quietly handing over a different
document. (`ApprovedOcPreview` does rebuild, because a deal must not be stuck at the signature step;
the reasoning is opposite on purpose.)

**`PaperSet`** (new) replaces `DocumentPreview`, which is deleted. Every one of its three callers
showed a PAIR, and all three did it by stacking two full 70vh PDF frames one under the other — so
reading the detailed sheet meant scrolling past the whole summary, and the page carried two copies
of every control. They are two faces of one issue, so they now get one frame and a switch:

- **Tabs** — Summary / Detailed sheet. The switch is also the statement that a second paper exists;
  a salesperson who never sees the tab sends the summary alone and does not know they have.
- **A paper that does not exist is still a tab**, marked *— none*, and clicking it explains why in
  words. A missing tab reads as a page that failed to load.
- **Download, Print, and Download both**, always, from every screen that shows papers.
- **The browser's own PDF chrome is suppressed** (`#toolbar=0&navpanes=0`). Chrome painted a dark
  bar with its own download button directly under ours — two sets of controls doing the same thing,
  and the browser's would have saved the file as a uuid.

Two traps found while building it:

- **Chrome cancels a second programmatic download fired in the same tick**, so *Download both*
  silently handed over one paper. The second is delayed 400 ms.
- **Auto-selecting the first tab with content must stop once the reader clicks.** Without a `chosen`
  ref, pressing *Detailed sheet* on any of the 18 no-template machines bounced straight back to
  Summary — so the screen that explains why there is no detailed sheet could never be reached, and
  the tab looked broken rather than empty. Caught in the browser, not in review.

Verified on QT-M0036 (Homer K24, both papers) and QT-M0035 (Rocket, summary only), each on a **cold
page load** — the case that was broken. Build green.

---

# The selling entity is now gated on having bank details · 25-Aug-2026

Tally carries five companies. **One has a selling-entity profile; four do not.** Until now all five
were offered on the quotation form, and picking one of the four printed the DEFAULT entity's bank
account, CIN and registered address — Axis Bank A/C 919030077980346, Orange O Tec Pvt Ltd's — on a
contract the customer pays against. Three screens warned about it: the dropdown subtitle, the
quotation editor and the Directors' approval gate.

The client's instruction, in their words: *"whatever entries are there in the master entities, only
those companies should be shown in the quotation."* They are right, and the warning was the wrong
instrument. A warning is read once and clicked past; the consequence is money sent to the wrong
company. **So the choice is removed rather than annotated.**

- `QuotationForm.tsx` `companyOptions` now builds only from companies with an **active profile**.
  Today that is one row, so the dropdown offers one company and names its bank in the sublabel.
- `CustomerPicker` no longer copies the Tally party's company onto a draft unless that company has a
  profile. Without this the picker would set a value the field does not offer, and the reader would
  see a company marked *not set up* that they never chose. Left blank instead — which the form
  already explains, naming the default entity it will print.
- **A company already on a deal is still offered**, labelled *"not set up as a selling entity"*, so
  an existing draft does not silently lose its entity. `CompanyProfileWarning` stays for exactly
  these rows: deals raised before the gate existed.
- Settings → Selling entities is re-worded from *"anything without its own row here prints the
  default"* to **"this list decides what may be quoted under"**, and the amber strip from
  *"Printing the default:"* to **"Cannot be quoted under:"**.

**This is now a data-entry blocker, not a warning.** Until somebody adds profiles for COLORIX
DIGITAL PRINTING SOLUTIONS LLP, both ORANGE O TEC ENTERPRISES rows and ORANGE O TEC PRIVATE
LIMITED-NOIDA, **no quotation can be raised under any of them.** That is the intended behaviour and
it is the client's call, but it means four entities are unquotable until their bank details, CIN,
registered address and Ex-Works city are entered. The letterhead is a path, not an upload, so a
second entity also needs its artwork placed in `public/assets/ocpi/`.

Verified in the browser: the dropdown offers ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27) and
nothing else, with *"M/s ORANGE O TEC PVT LTD. · AXIS BANK · Ex-Works Surat"* beneath it. Build green.

---

# Test data · 25-Aug-2026 (second seed, on the new chain)

⚠ **THE MODULE IS NOT EMPTY.** After teardown the client asked for a fresh set covering every stage
so they could walk the new chain. **13 deals**, handle **`customer_name like 'ZZ TEST%'`**, raised
by Afrin Saiyed so an admin can approve them without hitting the self-approval guard.

| Ref | Customer | Machine | Deal type | Stage |
|---|---|---|---|---|
| — | Suryodaya Prints | Homer K24 | Others, ₹52,00,000 | **draft** (1 day old) |
| — | Meridian Fabrics | Position Printer *(no template)* | Others, ₹11,50,000 | **draft** (17 days old) |
| QT-M0024 | Anmol Textile Park | Homer K32 | Others, ₹59,00,000 | **awaiting approval** — 3 revisions, sent back once, ₹64L → ₹59L |
| QT-M0025 | Gulf Digital LLC | P8S | **High Seas, $62,000** | **awaiting approval** — overdue |
| OTPL/OC/2627/0001 | Girija Prints | Kolorado Alpha 15 | Others, ₹47,50,000 | **awaiting customer signature** |
| OTPL/OC/2627/0002 | Laxmi Fabrics | JP7 *(no template)* | Others, ₹9,80,000 | **awaiting customer signature** — summary sheet only, overdue |
| OTPL/OC/2627/0003 | Shree Textiles | KoloRado Alpha II 1.8 m | Others, ₹42,50,000 | **awaiting countersignature** — overdue |
| OTPL/OC/2627/0004 | Hariom Textiles | Homer K24 | **High Seas, $48,000** | **to hand over to Finance** |
| OTPL/OC/2627/0005 | Chetna Digital | P8D | Others, ₹58,60,000 | **awaiting Finance receipt** — overdue |
| OTPL/OC/2627/0006 | Nirmal Prints | Homer K32 | Others, ₹71,00,000 | **completed** |
| QT-M0032 | Om Sai Textiles | Fab Pro 1I *(no template)* | Others, ₹26,50,000 | **rejected** |
| OTPL/OC/2627/0007 | Manthan Fabrics | Rocket *(no template)* | Others, ₹18,00,000 | **on hold** |
| OTPL/OC/2627/0008 | Dwarkadhish Prints | JPK *(no template)* | Others, ₹15,00,000 | **cancelled** |

**The papers are real.** Every quotation was generated through the browser, and every approval was
taken through the Directors' gate in the browser, so all 42 stored files are genuine renders — the
*"Rebuilt from the template"* fallback appears on none of them. Four deals carry real signature
scans as well.

**What it burned:** `QT-M0024`…`QT-M0034` and `OTPL/OC/2627/0001`…`0008`. Teardown gives none of it
back; `99-teardown.sql` puts the quotation series to 23 and clears the OC counter, exactly as it did
on the first teardown. Storage teardown (`99-teardown-storage.mjs`) must run first, as before.

**Left as found:** zero OCPI grants and zero step-owner rows. The temporary grant that let the
salesperson raise these deals was removed afterwards, so the module is still admin-only and the
empty-Directors warning still shows — which is the state to go live from, not a fault.

**Four more drafts, 25-Aug-2026 — `04-my-drafts.sql`.** The thirteen above were all raised by Afrin
Saiyed, which is right for everything that has to be approved and wrong for the two screens that are
keyed to the reader: **My Deals** was empty, and every draft on the Drafts screen carried somebody
else's name. Drafts have no approver, so they carry no self-approval constraint and belong to
whoever is walking the module. Four now stand in Yash Agarwal's name, at four levels of
completeness, because a draft is the one screen where an *incomplete* record is the correct record:

| Customer | State | What it is for |
|---|---|---|
| ZZ TEST Kesari Textile Mills | a name and nothing else, 11 days old | the screen's promise that you may save with most of it blank |
| ZZ TEST Bhavani Prints | part A done, Sections B and C untouched | what *Sections B and C are mandatory* refuses |
| ZZ TEST Saraswati Fabrics | complete, INR, Homer K24 (**has** a template) | press Generate and both papers come out |
| ZZ TEST Emirates Print House | complete, **High Seas $74,500**, Rocket (**no** template) | the dollar path and the summary-only path in one row |

Three CHECK constraints refused the first attempt and are worth knowing before writing another
seed: `head_ship_mode` is `with_machine | separate`, `head_ship_via` is `directly | hss |
local_sales` (not a courier name), and `high_seas_cost_by` is `customer | company`. The whole
`DO` block is one transaction, so each refusal rolled back all four.

### Two things this seed turned up

- **The revision strip was only on the draft editor.** It vanished the moment a quotation was
  submitted — at exactly the point the Directors are deciding whether the price is right, and the
  question they would ask is how it moved to get there. It now renders on the deal page too, so an
  approver sees ₹64,00,000 → ₹59,00,000 with the author, the date and links to the pair of papers
  frozen at each revision.
- **Going from one draft editor straight to another keeps the first draft's state.**
  `useQuotationDraft` seeds once per mount, and React Router reuses the component when only the route
  param changes. Not reachable through the UI — nothing links editor-to-editor, and going via any
  other screen remounts it correctly — but typing or bookmarking the second URL would show deal A's
  answers under deal B's heading. Logged as an open item below.

---

# The revision is complete

All nine stages (0, A–H) are done, each with its build green and its rollback rehearsed on live data
rather than read. What changed, end to end:

1. **One form.** The order confirmation's questions are optional fields on the quotation form.
2. **Sections B and C mandatory**, visible fields only.
3. **High Seas / Others** at the head of Section C, driving currency and tax: High Seas ⇒ USD and
   **no GST line at all**; Others ⇒ GST charged.
4. **Dollar deals print both currencies** on a live overridable rate, frozen per revision.
5. **Special remarks** — the master form's three boxes in one group, under a Section D headed
   *Special Remarks*.
6. **Both papers issued together**, headed ORDER QUOTATION, **re-headed ORDER CONFIRMATION** when the
   Directors approve — which is when `OTPL/OC/<fy>/nnnn` mints. A quotation sent back mints nothing.
7. **Every revision keeps its own** value, currency, FX rate and pair of PDFs.
8. **Two steps after the countersignature** — who handed the contract to Finance, and who in Finance
   accepted it. One person cannot record both.

**Before it goes live**, three things that are not code:

1. **Confirm the quotation series** in Settings → Quotation numbering. Until then every number issued
   may repeat one a customer already holds.
2. **Name the Directors** on `quotation_approval`, and owners for the two Finance steps. Nobody is
   named, so it all falls to admins.
3. **The four open items** below — the P8D heading rule now answered by stage E and awaiting the
   client's nod, who supplies the 18 missing detailed templates, GST on an *Others* deal quoted in
   USD, and `status = 'rework'` still being unreachable.

- [ ] Confirm none of the 7 pre-existing drafts was a real customer
- [ ] Storage first, then SQL (`SOP/ocpi-test-data/`); `activity` and `notifications` by `entity_id`
      before the deals
- [ ] Reset `oc:2627` to zero
- [ ] Quotation counter set to the last number really issued, confirmed in Settings
- [ ] Final walk on a clean database

---

## The two audit findings that would have stopped this build

Read out of the **deployed** function bodies, not inferred.

1. **A Director cannot upload the Order Confirmation PDF.** `fms_ocpi_can_add_doc` maps the `oc`
   storage slot to the `order_confirmation` step, and its only other arm admits the raiser. A
   Director approving is neither, so the upload is refused **by the storage policy** — silently, with
   nothing in the UI saying why. Worse, it is **invisible to an admin account**, because
   `fms_ocpi_is_coordinator` passes admins through unconditionally. Hence the remap in Stage E, and
   the non-admin Director test.
2. **The OC number and the printed paper cannot both be right** unless minting and rendering happen
   in one action at approval. Minting at submit burns numbers on rejected quotations; rendering
   before minting prints a contract with no number on it. If the upload fails after a successful
   mint, `ApprovedOcPreview` already rebuilds from the template and says so on screen.

## The revision's open items

- [~] **P8D** was headed *OFFER QUOTE* — neither of the two headings this flow uses. **Answered by
      stage E's rule**: the heading now comes from the stage, not the machine, so P8D prints ORDER
      QUOTATION then ORDER CONFIRMATION like every other model. `fms_ocpi_machines.doc_title` is kept
      but no longer printed. **Confirm with the client** that OFFER QUOTE is genuinely gone.
- [ ] **The 18 machines with no detailed sheet** — who supplies the content. Until then those deals
      go out on the summary sheet alone.
- [ ] **GST on an *Others* deal quoted in USD.** Under the rule as stated it still attracts GST.
      Coherent, but unusual enough to confirm rather than assume.
- [ ] The client's own remaining feedback, which they have said is coming.
- [ ] **`useQuotationDraft` seeds once per mount.** Navigating from `/deals/A/edit` straight to
      `/deals/B/edit` — same route, different param — reuses the component and keeps A's draft and
      A's `savedId`, so a save would write to the wrong deal. Nothing in the UI links editor to
      editor, and any other screen in between remounts it correctly, so this is a latent fragility
      rather than a live bug. The fix is one line: key the `seeded` ref on `dealId`.

## Decision taken inside the plan, flagged not assumed

**`status = 'rework'` is unreachable** — recorded above under "Found while seeding". Both send-backs
land on `draft`, so a deal an approver returned looks in every screen exactly like one nobody has
opened. Adding the Finance steps is the moment to fix it: land send-backs on `rework`, which
`generate_quotation` already accepts as revisable, `OPEN_STATUSES` already contains and the rail
already draws. It changes existing behaviour, so it is called out rather than done quietly.

---

# OCPI-3 · the build  —  started 27-Aug-2026

The spec is **OCPI-3** in [WORKLIST.md](WORKLIST.md), sections A–M. **Section M says what the later
pointers superseded** — read it before A–J or you will build the withdrawn version.

Gate for every stage: `cd frontend && npm run build` green. Supabase changes are **additive only**.
Every branch rule must be changed **in the app AND in the SQL writer** — `branching.ts` is the
courtesy copy, `fms_ocpi_write_quotation` / `fms_ocpi_write_oc` are the authority.

All data in the module is **dummy** (client confirmed 27-Aug-2026).

## The master task list

### Stage 0 · The two blank-total faults  `[~]`
- [x] 0.1  High Seas: set the currency to USD when the deal type is chosen, so the rate box appears
- [x] 0.2  Require an FX rate on any USD deal — `missingForSubmit` **and** the table's completeness check
- [x] 0.3  Re-check no submitted deal violates the new check *before* applying the migration
- [x] 0.4  Second route investigated — **NOT a bug.** `QT-M0037` is pre-reshape data: its frozen payload holds 36 keys and **zero** part-B keys, so `fms_ocpi_save_draft` correctly skipped `write_oc` and the money was never computed. Payloads written by the current form carry **68** keys including `gst_rate`. No code change needed.
- [x] 0.5  **Verified in the browser, 29-Aug-2026.** Picking **High Seas** on a fresh quotation switches Currency to **USD** and labels it *"fixed by the deal type"*; the **USD → INR rate** box appears with a **Get live rate** button, which fetched **95.489** from xe.com; the **GST %** box disappears (a high seas sale carries none) and the form says so in words. The blocking list grew *"the USD to INR rate"*, so a rate-less high seas quotation can no longer be generated. This was the fault where the currency box greyed out **reading rupees**, the rate box never appeared, and every rupee figure printed blank.
- [x] 0.6  **Verified in the browser, 29-Aug-2026 — the two engines agree.** A draft was raised on **K64** (takes a dryer; air blade *yes*, external centering *optional*, ink dust *yes*, chilling *yes*), every dryer answer and all four shipment rows filled, saved, and reloaded: **nothing was wiped** — chambers, heating medium, dryer price ₹1,25,000, all four ship modes / routes / separate-invoice flags / quantities / amounts, all four extras, GST 18%, the frozen rate. The machine was then switched to **P8S** (no dryer; chilling *yes*, everything else *no*) and saved. The server cleared **exactly** what the form had hidden — `dryer_type`, `dryer_name`, `dryer_chambers`, `heating_mode`, `dryer_included`, `dryer_price`, `dryer_value_inr`, `dryer_gst_inr`, `air_blade`, `external_centering`, `ink_dust_exhauster`, and both the dryer and centering shipment sets — and **kept `chilling_system = true`**, which is the whole reason the extras could not live inside the dryer card. Head and spares answers survived untouched. `grand_total_inr` recomputed correctly ($10,00,000 × 95.489 + 18%). The test draft was deleted afterwards, versions first; **zero residue**.

  Three things the run turned up, none of them a branch fault:

  - 🔴 **The register exported a quantity for the print head only.** The form asks a quantity on all four rows and the contract's SHIPMENT & INVOICE table prints all four, but `exportRegister.ts` carried `Head invoice qty` and no other. A finance reader reconciling a second bill against the register would have found the amount with no quantity beside it on three of the four rows. **Fixed** — `Dryer invoice qty`, `Spares invoice qty` and `Centering invoice qty` added beside their amounts, build green.
  - ⚠ **The dryer master was EMPTY.** `fms_ocpi_dryers` had zero rows, so on all **11** machines that take a dryer the *Dryer* dropdown read *"None set up in this category"* and no dryer could be named. *(Six `[SAMPLE]` dryers were added the same day at the client's request — see the summary at the foot of this file.)* The three categories exist (Indian · Chinese · Not Applicable) and the Masters screen can add them — nobody has. Not a code fault; a **go-live prerequisite** for the business, and the reason `dryer_name` could not be exercised in this run (it is gated identically to the fields that were).
  - The machine-category filter **seeds itself from the saved machine** when a draft is reopened, so the model list opens narrowed. It clears from the box's own ✕, so nothing is unreachable.

### Stage A · Database foundations (one migration)  `[x]` — applied & verified 27-Aug-2026
- [x] A.1  `fms_ocpi_machine_categories` — name, sort order, active
- [x] A.2  Machine columns: billing name, category, dryer required, 4 capability columns (yes/no/optional)
- [x] A.3  `fms_ocpi_machine_head_types` — machine ↔ head link table (many-to-many)
- [x] A.4  Deal columns — dryer: category, name, ship mode, ship via, separate invoice, qty, amount, price, included
- [x] A.5  Deal columns — spare parts + centering device: ship mode, ship via, separate invoice, qty, amount
- [x] A.6  Deal columns — head: qty + amount (ship mode / via / invoice already exist)
- [x] A.7  Warranty settings rows in `fms_ocpi_config`
- [x] A.8  Extend `fms_ocpi_write_oc` for every new column, with the branch rules
- [x] A.9  Add every new key to the part-B sniff array in `fms_ocpi_save_draft`

### Stage B · Machine list + category master  `[x]` — 27-Aug-2026
- [x] B.1  Machine category master screen (admin-only; not a requestable master type)
- [x] B.2  Machine screen: new columns, each with sort + filter
- [x] B.3  Heads as a multi-pick on the machine form
- [x] B.4  Capabilities as Yes / No / Optional
- [x] B.5  Dryer master gains a category, and dryer names are filtered by it

### Stage C · Load the sheet  `[x]` — 27-Aug-2026
- [x] C.1  Add the two new head names — **MS** and **Homer**
- [x] C.2  Seeded Direct / Sublimation / Other. **"JAY" deliberately NOT seeded** — Label Printer and Book Printer are left uncategorised rather than inventing a category. 26 of 28 categorised.
- [x] C.3  Import by machine name; trim + case-fold; blanks stay blank
- [x] C.4  Head mapping applied. All 6 existing names used + 2 new (**MS**, **Homer**). ⚠ Rocket assumed **RC 600 DPI - Hanglory + 300DPI - KJ4B**: its head cell says "EX600" but its DPI column says 300, so the DPI column was taken as the tie-breaker. Reversible; confirm with the client.
- [x] C.5  Verify: 11 machines need a dryer, 5 can take a centering device, Han Glory machines show 2 heads

### Stage D · Fixed warranties  `[~]` — 27-Aug-2026 (D.6 deferred to J, see below)
- [x] D.1  🔴 Re-point `{{machine_warranty_months}}` (10 templates) and `{{head_warranty_months}}` (4) at the settings — **FIRST**
- [x] D.2  Verified against the real clause text. BEFORE: *"will be of 24 months warranty → maximum 25 months from the invoice date months from the date of installation"* and *"of 24 Months months"*. AFTER: *"will be of 12 months from the date of installation"* and *"of 18 months"*. Zero unresolved tokens.
- [x] D.3  Settings screen for the two periods (copy `QuotationValiditySection`)
- [x] D.4  Remove the warranty dropdowns and the dryer-warranty question
- [x] D.5  Drop the warranty checks from `missingForDetailSheet`
- [!] D.6  **MOVED TO STAGE J — my task order was wrong.** Removing the head-price box while `{{post_warranty_head_price}}` is still in the clause on Homer K24, K32, P8D and P8S would print *"priced at INR ________ plus GST"* on those contracts from now until J. The field stays, with a comment saying why, until the wording is corrected.

### Stage E · Machine details + Dryer details  `[x]` — 27-Aug-2026
- [x] E.1  Machine details row 1 → Category · Machine · Print heads. Heads are **shown, not chosen**, and all of them appear; picking a machine copies the joined names onto `head_type`, which both papers and the register still print from. The copy happens in `chooseMachine`, **never in an effect** — an effect would rewrite the head text of a pre-mapping deal the moment somebody merely opened it. Legacy deals with a `head_type` and no mapping show what they hold. A head type can still be requested from **Master requests** (`masterType={null}`), so the picker's removal took the shortcut, not the route.
- [x] E.2  Machine list filtered by category. The category is **UI state, never stored** — the machine already carries it, and a second copy would drift. Seeded from the deal's machine on open; clearing it shows all 28, which is the only way to reach Label Printer and Book Printer (the two the sheet calls "JAY"). The current machine is always an option even when the filter would exclude it.
- [x] E.3  Rename "Ink price" → "Ink selling price" — in `FIELD_LABEL`, the form, and the summary PDF row, so the three do not disagree. "Dryer Required" → "Dryer Category" on the PDF for the same reason.
- [x] E.4  Dryer details is now its **own card**: category (`dryer_type`, relabelled) → dryer name (new `dryer_name`, filtered by category) → chambers → **heating medium** → dryer-in-deal (`dryer_included`) → price when it is not (`dryer_price`). `dryer_price` deliberately does **not** feed `total_inr` — its GST treatment is still unanswered; stage I gives it its own line.
- [x] E.5  The 4 extras are asked **only if the machine can carry them**, and they are **NOT inside the dryer card**. ⚠ **P8S needs no dryer and can still take a chilling system** — nesting the extras under the dryer would have made that machine's one extra unreachable. `"yes"` still asks (it means standard equipment and the deal must record it) with a "standard on this machine" hint; `"no"` and unmapped never appear. Only 7 of 28 machines can take any extra at all.
- [x] E.6  `hasDryer` reads the machine flag — **changed in `branching.ts`, `fms_ocpi_write_oc` AND `fms_ocpi_write_quotation`**, which owns `dryer_type`. Migration `20261021140000`. `isVisible`/`clearHidden` take a second argument now (`MachineFacts`, from `lib/fieldSpec.ts`) reading exactly the five machine columns the SQL reads. **Null is "no", not "maybe"**, which is why the Machine master now REQUIRES the dryer flag — leaving it blank would make a whole section silently unreachable for that model.
      **Verified on live data, three probes, zero residue:**
      · JPK (dryer, air/centering/exhauster = yes, chilling = no) → every dryer answer kept, three extras kept, **chilling_system rejected to null despite the payload saying true**, `total_inr` = 11,80,000 excluding the 1,25,000 dryer price.
      · Same deal switched to **P8S** (no dryer, chilling = yes) → all six dryer columns nulled **including `dryer_type`**, chilling kept, other three extras nulled. This is the inverted case and it proves both writers.
      · Pengda (every capability unmapped/null) → everything nulled; null behaves as "no".
      ⚠ **4 existing dummy drafts name a dryer on a machine now flagged as taking none.** Their dryer answers are nulled the next time somebody SAVES them — not now, and not on a deal nobody edits. Client confirmed all module data is dummy (27-Aug-2026).
- [x] E.7  **Platter moved to Machine details** — and it is the one field nobody asked about, so its home is **still open with the client**. It was moved rather than left because the two engines disagreed: the form showed it only with a dryer while `fms_ocpi_write_oc` stores `platter_details` **unconditionally**. The form was the stricter of the two, so a no-dryer machine could never record a platter the database was willing to keep. It now sits where the SQL already assumed, and "Not Applicable" is one of its own options. If the client says it belongs to the dryer, gate it in **both** places.
- [x] E.8  Deleted the dead `withGst`. It recomputed GST and the total in the browser and **nothing called it** — rightly: those figures are derived in `fms_ocpi_write_oc`, which alone knows High Seas attracts no GST and that a USD deal is valued at amount × rate. Wiring it up would have produced a second, different answer for one price, on a contract. A comment records why, since `noUnusedLocals` is false and there is no test runner.

### Stage F · Shipment & invoice section  `[x]` — 29-Aug-2026
- [x] F.1  New **Shipment & invoice** card between Deal inclusions and Commercial terms, one row per item — print head · dryer · spare parts · centering device. Rendered by a single `ShipmentRow` component with **four callers**, so the four cannot drift apart; every binding is passed in explicitly rather than built from a key prefix, because a template-built key compiles and then silently reads `undefined` the day a field is renamed. The whole card hides when the deal ships nothing on its own terms (`anyShipment`) — an empty heading reads as a section that failed to load.
- [x] F.2  Each row asks: **how it ships** · **route** (only for a separate shipment) · **separate invoice?** · **quantity + amount excluding tax** (only for a separate invoice). Each row also states *why it is being asked* — the branch, in words.
- [x] F.3  Each row branches on its **own** condition, and they are not the same one: head → `incl_head`, spares → `incl_spares`, dryer → the machine's `needs_dryer`, centering → the machine's `opt_external_centering`. **Two of the four are the machine's answer, not the salesperson's.** Written in `branching.ts` as RULE 8, and already matched line-for-line by `fms_ocpi_write_oc` from stage A — so **no new migration was needed**. That was verified, not assumed:
      · **All 20 keys confirmed present in the part-B sniff array of `fms_ocpi_save_draft`.** A key missing there is never written at all — no error, the value simply never lands.
      · **Probe, three states, zero residue.** *All open* — separate shipment and separate invoice on all four — kept every route and every qty/amount. *Shipped with the machine, one invoice* — all four ship modes kept, **all four routes and all eight qty/amount figures nulled**. *Every row closed* — no head, no spares, and a machine with neither dryer nor centering — nulled all twenty columns.
- [x] F.4  Old "The head" block removed from Document details — **moved, not deleted**: its three questions are now row 1 of the new card, with quantity and amount added. Sweep clean: no orphaned setters, no stale labels, `HEAD_SHIP_MODES` / `HEAD_SHIP_VIA` now read by all four rows, and `headBalanceRemarks` was never in that block (it sits with Special remarks; stage H decides its fate).
- [x] F.5  🔴 **Fixed a duplicate introduced in stage E.** Adding the new Dryer details card did not remove the old "The dryer" block from Document details, so **chambers, heating medium and Platter each rendered twice** on the form. Both copies bound the same draft field so they could never disagree, but it was a real defect and it shipped in the stage-E build. Caught by F.4's own sweep. This is the FIX-4 rule failing in reverse — the rule warns about deleting a container and stranding its contents; here a container was *added* and its predecessor left standing. **When moving a block, grep the field names afterwards and count the renders.**

### Stage G · Commercial terms  `[x]` — 29-Aug-2026
- [x] G.1  **GST % moved into Commercial terms — and it was very nearly lost.** It sat inside the "Delivery & tax" block the client asked to be deleted; the instruction was about the *delivery term*, and the tax rate merely shared the box. Deleting the block wholesale would have broken nothing visibly: `EMPTY_DRAFT` and `draftFromDeal` both default it to `"18"`, so every deal would have been taxed at 18% for ever with no way to change it and no error to notice. It now sits beside **Total deal value (excluding GST)** — the field it completes — and beside where it actually prints, since section C of the summary sheet already carries a `GST @ x%` row. Still hidden on a High Seas sale.
- [x] G.2  **Delivery days moved into Commercial terms**, beside the machine delivery date, which is what it is about. Hinted "prints on the detailed sheet", since it left the card whose whole premise was saying so.
- [x] G.3  **"Delivery & tax" block deleted**, with all three of its controls accounted for one at a time before it went — the client's instruction named only the first. The comment left in its place records the audit, and this block is now a worked example of the FIX-4 rule going *right*.
- [x] G.4  **`trade_term` left in place**, moved rather than removed, labelled *"detailed sheet · being retired, keep answering it for now"*. `{{trade_term}}` is written into the *Sale Conditions of the Supply* clause of **all ten** machine templates as "Delivery Terms: {{trade_term}}", and an unresolved token prints a ruled blank by design — so removing the field first would put **"Delivery Terms: ________"** on every detailed sheet until stage J.
      ⚠ **And it is the only delivery route an ordinary deal has.** Commercial terms asks "delivered via" only on a HIGH SEAS deal; an "Others" deal answers nothing else about the route. So removing this field may leave ordinary deals with no route at all — that is **open question 4**, and it has to be answered *before* stage J rather than after.
- [x] G.5  Render counts checked after the move — `deliveryDays`, `tradeTerm` and `gstRate` are **one reference each**. This is the stage-F lesson applied: a moved block that leaves its predecessor standing renders the same field twice and the build cannot see it.
- [x] G.6  Form order now matches the plan exactly: **Customer → Machine details → Dryer details → Deal inclusions → Shipment & invoice → Commercial terms → Special remarks → Document details** (Warranty & service · Options included · Sign-off).

### Stage H · Special remarks  `[x]` — 29-Aug-2026
- [x] H.1  Balance-heads and other-commitments boxes removed from the form. **Not simply deleted** — 13 of the 18 deals on record hold balance-head remarks and 14 hold other commitments, so a deal that already carries text shows it **read-only** in a panel that says the boxes are retired and to write new wording into Special remarks. Deleting the inputs outright would have left that text printing on a regenerated paper with no trace of it anywhere on screen: a line on the contract the salesperson could not find in the form. A deal with nothing in them shows nothing — which is every new quotation from here on.
- [x] H.2  ⚠ **CORRECTION TO MY OWN TASK LIST — the branch rule is NOT an orphan and it stays.** H.2 assumed that removing the box orphaned `headBalanceRemarks`' visibility rule. It does not: `clearHidden` iterates **every key in the map**, not the ones the form happens to render, so the rule is still what blanks the stored text when a deal that had a head stops including one. Deleting it would let that text survive a change it contradicts, invisibly, and print on the next paper. `fms_ocpi_write_oc` keeps the matching branch for the same reason. **No migration needed for this stage.**
- [x] H.3  Point-by-point guidance: the box is 5 rows now, carries a worked numbered placeholder, and a line beneath says one point to a line and that warranty exceptions go here. Newlines already survive to the PDF (`wrapText` → `splitTextToSize` honours `\n`), so no renderer change was needed for the format itself.
- [x] H.4  **Fixed the false hint.** It said *"prints on both sheets"*. Remarks print on the **summary sheet only** — there is no remarks path in `ocPdf.ts` and no `{{remarks}}` token, so no machine template can reference it either. A salesperson writing a delivery caveat here believing it reached the contract would have been wrong.
- [x] H.5  **A row taller than a page now splits across pages.** The loop used to size a row and, if it would not fit, move the **whole** row to a fresh page — with no logic to split one, so a row taller than the body area overflowed the new page too and ran off the bottom **silently**. Unreachable while the boxes held a sentence; reachable the moment remarks are entered point by point, which H.3 now instructs. The drawing was pulled into one `drawChunk` helper so the whole-row and split cases render through identical code.
      · The test is **"taller than an empty page"**, not "taller than what is left" — otherwise a row merely sitting low would be split when moving it whole would do.
      · Continuations re-label the cell **"… continued"** rather than repeating the label, which would read as a second field.
      · `MIN_SPLIT = 3` stops a page-foot fragment being one orphan line.
      · **Verified by simulating the loop against the real page geometry** (`BODY_TOP = 92`, `bodyBottom = 723.7pt` on A4 — derived from `FOOTER`, not re-typed). Ten cases from a 3-line row to an absurd 650-line one, including a row starting 12pt from the foot: **all terminate, none overflow, every value line is drawn exactly once, and no blank page is emitted.**
- [x] H.6  Stale "three boxes, one group" comment rewritten — it described a grouping that no longer exists.
- [x] H.7  The two retired boxes **print only when they hold something**. Two rules were in tension and both are honoured: a retired question must not print a ruled blank (every other blank on this sheet is deliberate, saying "not answered" — a withdrawn question's blank would say "we forgot"), and what a deal already recorded must not vanish from its next paper. Content prints; emptiness does not. The old `incl_head` condition on that row went with it — it only ever existed to avoid exactly the ruled blank now handled properly.

### Stage I · The papers  `[x]` — 29-Aug-2026
- [x] I.1  **Machine total → dryer total → final total**, on BOTH papers, row for row. Appears only when a dryer is charged outside the deal; otherwise the money block is exactly as before. ⚠ **The final total is added for display and stored nowhere** — `total_inr` is derived server-side and deliberately excludes `dryer_price` while the dryer's GST treatment is unanswered. The dryer line says *"excluding GST"* so the arithmetic can be checked from the paper. **This is not the `withGst` mistake deleted in stage E**: that recomputed a figure the server had computed differently; this adds two stored figures and invents neither. When the client answers, the addition belongs in `fms_ocpi_write_oc`. A null machine total prints a blank final total rather than silently becoming zero.
- [x] I.2  **Both machine names.** Summary sheet gains a wide **Billing Name** row; the detailed sheet gains a **"Product:"** header line. ⚠ The machine CODE was already on the detailed sheet — all ten intros read *"we are glad to confirm the supply of &lt;code&gt; Digital Printing Machine…"* and each deck carries two naming spec rows — so only the billing name was ever missing. It prints only where mapped (21 of 28); an unmapped machine gets no row rather than a ruled blank. `machine_name` and `machine_billing_name` are now frozen into `resolvedOcDocument`, so a re-description cannot change what an issued contract appears to have said; revisions frozen before this simply lack the keys, which is honest.
      ⚠ **NOT added as template tokens, deliberately** — `tokensFor` is not given the machine, and threading it through four call sites to offer a placeholder nothing asked for is how a token list fills with unused entries. Both names already print. The reasoning is recorded in `tokens.ts` beside the decision.
- [x] I.3  **A dryer block on both papers.** Summary section A gains Dryer Category · Dryer · No. of Chambers · Heating Medium · Dryer Included in the Deal. ⚠ **Conditional now, and there used to be exactly one row printed on every deal** — *"Dryer Required"*, a ruled blank on the 17 machines that take no dryer, asking a question that cannot apply. Shown when the machine takes a dryer **or** the deal holds a dryer answer of its own; the second half protects a deal quoted before the mapping existed. Platter likewise prints only when set. `{{dryer_name}}`, `{{dryer_chambers}}`, `{{heating_medium}}` and `{{dryer_price}}` added as tokens so a template can also use them in a sentence.
- [x] I.4  **The shipping-and-billing block on the DETAILED sheet** — six columns: Item · How it ships · Sent via · Separate invoice · Qty · Amount (excl. tax), one row each for head, dryer, spare parts and centering device. ⚠ **This closed a real gap, not a request for more detail.** These answers were asked on the form, branch-gated in both engines, written by `fms_ocpi_write_oc` and frozen into every revision — and printed in **neither** paper, in no token, and in no register column. A line appears only if the deal carries one; the branch rules already null anything inapplicable, so an empty line means unanswered, not inapplicable. Amounts are **not** rolled into the totals — a separately-invoiced item is billed on its own document and adding it here would double it. Now frozen into `resolvedOcDocument` too, since it is part of the resolved contract.
- [x] I.5  **Register:** both names (**Billing name** column), plus **Type of head**, the four dryer columns (category · dryer · in deal · price excl. GST) and a **separate-invoice yes/no + amount pair for each of the four items** — the same gap as I.4, on the finance side: a reader reconciling invoices could not see which deals would produce a second bill or for how much. ⚠ **"Delivery term" column KEPT, and the decision is recorded rather than assumed** — it is the only delivery route an "Others" deal records anywhere, so dropping it now would take that fact out of the register while it is still the only place it exists. Revisit when open question 4 is answered.

### Stage J · Contract wording  `[x]` — 29-Aug-2026
- [x] J.1  **Reworded the head-price clause on Homer K24, K32, P8D and P8S — client-approved 29-Aug-2026.** Migration `20261021150000`. Was *"After that period a New Print Head will be priced at INR {{post_warranty_head_price}} plus GST, on the new machine, first time installed head."*; now *"After that period, **replacement print heads will be supplied at the prices prevailing at the time of purchase**, on the new machine, first time installed head."* All four carried the identical sentence — verified before replacing. Recorded on the **To discuss with Ritesh Bhai** list in WORKLIST.md so the exact wording is on record if it is ever queried.
- [x] J.2  **CLOSED AS "NO CHANGE" — the delivery term STAYS.** Settled with the client 29-Aug-2026, reversing the original instruction. The "Delivery Terms: {{trade_term}}" line stays in all ten *Sale Conditions* bodies and the field stays on the form. Three things came out of checking it:
      · It is the **only delivery route an ordinary deal records anywhere** — commercial terms asks "delivered via" on a High Seas deal alone. **11 of the 12 ordinary deals on record had filled it in** (all "Ex-Work Surat").
      · Removing the field before the ten clauses would have printed **"Delivery Terms: ________"** on every detailed sheet.
      · ⚠ **The two papers were never saying the same thing.** The SUMMARY sheet's *"Term of Delivery"* is built from the deal type and who bears the cost — *"Local Delivery · cost by Customer"*. The CONTRACT's *"Delivery Terms"* is this field — *"Ex-Work Surat"*. Two different facts, two similar headings, two papers. That is what made "already covered in commercial terms" look true when it was not. **Left as it is by decision; worth revisiting as a wording question, not a field question.**
- [x] J.3a **`post_warranty_head_price` removed from the form** — and in the right ORDER, which was the whole difficulty. The clause was reworded FIRST and the token confirmed absent from all 82 sections, THEN the field went. Doing it the other way round would have printed *"priced at INR ________ plus GST"* on those four machines' contracts in the meantime. The COLUMN stays (additive-only), so deals raised before this keep what they recorded; nothing reads it.
- [x] J.3b **`trade_term` stays on the form** — see J.2. Its hint no longer says "being retired"; it now reads *"prints on the contract"*, which is true.
- [x] J.4a **`post_warranty_head_price` retired from `tokensFor` and `TOKEN_HELP`** — left OUT rather than set to null, the same way as `dryer_warranty`, so a template still using it is REPORTED as unresolved rather than quietly printing a ruled blank.
- [x] J.4b **`{{trade_term}}` stays a token** — see J.2.

---

## OCPI-3 IS COMPLETE AND VERIFIED — stages 0 and A–J, 29-Aug-2026

Every stage is built, the build gate is green, and **the two browser checks have now been run**
(tasks 0.5 and 0.6 above). Nothing is outstanding on the build.

The dryer-GST question that stood here has been **answered** — a separately-charged dryer is taxed at
the machine's own rate, the arithmetic moved into `fms_ocpi_write_oc`, and `dryer_value_inr` /
`dryer_gst_inr` / `grand_total_inr` are stored, printed on both papers and exported. See stage I and
**To discuss with Ritesh Bhai → OCPI item 6** in WORKLIST.md.

Two things remain, neither of them code:

1. **Four questions are parked for Ritesh Bhai** — Platter, "Homer", "JAY", and whether the two
   centering questions should hide together. All four are listed with full wording in
   **WORKLIST.md → To discuss with Ritesh Bhai**, and none of them blocks anything: the module runs
   today on the assumption recorded against each.
2. ⚠ **The dryer master holds SIX PLACEHOLDERS, not the real list.** It was empty — zero rows — so on
   all **11** machines that take a dryer the *Dryer* dropdown read *"None set up in this category"*,
   and `missingForDetailSheet` asked for a name that could not be given. On 29-Aug the client asked for
   samples until the real names arrive, so three Indian and three Chinese were added: *2-Chamber
   Electric*, *3-Chamber Thermic Fluid*, *4-Chamber Gas Fired*.

   They are prefixed **`[SAMPLE]`** deliberately — a dryer name **prints on the customer's quotation**,
   so accidental use shows on the paper instead of passing silently. Removal is one statement:

   ```sql
   delete from fms_ocpi_dryers where name like '[SAMPLE]%';   -- Postgres LIKE: [ is literal
   ```

   `fms_ocpi_deals.dryer_name` stores the **text**, not an id, so deleting them cannot break a saved
   quotation — but a frozen revision would keep printing `[SAMPLE]`. **Getting the real names is still
   a go-live prerequisite for the business, not a build task.**

   ⚠ **The "Not Applicable" dryer category has no dryers and cannot sensibly have one.** Picking it on
   a machine that needs a dryer leaves the name unfillable and the completeness warning standing. That
   guides rather than blocks — Indian or Chinese is the right pick — but somebody will report it as a
   fault. Whether a dryer machine should be offered "Not Applicable" at all is a business decision.

## Open with the client — none blocks anything; all stages are built
1. Replacement wording for the two clauses *(blocks J only)*
2. Does GST % survive? *(proceeding on yes)*
3. ~~Do ordinary deals still need a delivery term?~~ **ANSWERED 29-Aug-2026 — the field STAYS.** See stage J.2 for what checking it turned up, including that the quotation and the contract were never printing the same delivery fact.
4. **What is "JAY"?** — *narrowed 29-Aug-2026, from the sheet.* The TYPE OF MACHINE column reads DIRECT (10), SUBLIMATION (12), OTHER (4) and **JAY (2)**. The two are **Label Printer** and **Book Printer**. "JAY" sits where a machine type goes and is not one — it looks like a name typed into the wrong column. Both stay uncategorised; the quotation lists all 28 machines when no category filter is set, so neither is unreachable.
5. **Where does Platter belong?** — *put to the client 29-Aug-2026; PARKED, awaiting an answer.* Three choices were offered: **(A)** map it per machine like the four extras, **(B)** keep it as a per-deal dropdown, **(C)** drop it. **Recommended A**, because the client's own sheet carries a **PLATTE column among the MACHINE attributes**, between HEATING MEDIA and AIR BLADE — filed with the air blade and the chilling system, not with anything negotiated per deal. ⚠ **That column is empty for all 28 machines**, so choosing A also needs somebody to say which machines have one; until then the question would simply stop appearing. Nothing built either way — stage E's move to Machine details already agrees with the sheet, so B costs nothing to keep. Full wording in **WORKLIST.md → To discuss with Ritesh Bhai → OCPI item 3**.
6. **Rocket's Kyocera DPI** — *supported, not confirmed.* The sheet's own pattern backs the stage-C assumption: P8D reads head "300 DPI KYOCERA" with DPI "300 DPI", P8S reads "EX600 RC KATAN & KYOCERA" with "600 DPI". Rocket reads "EX600 RC & KYOCERA" with DPI "**300**" — i.e. the DPI column tracks the KYOCERA head. So RC 600 + Kyocera 300 is consistent with how the sheet is filled everywhere else.
7. **Is "Homer" a head?** — *put to the client 29-Aug-2026; they do not know, so it is PARKED for Ritesh Bhai.* Evidence supports yes: "EX600 RC KATAN & HOMER" is structurally identical to "EX600 RC KATAN & KYOCERA" (P8S) and "MS & KYOCERA BOTH" (JP7, JPK), where both terms are head makes. HOMER occupies the head-make slot. It appears on Homer K24, Homer K32 **and K64** — all HAN GLORY, and K64 is not Homer-branded. Built on that assumption: *Homer* exists as a head name and those three machines carry it. If the answer comes back no, delete the head and leave the three on Katana alone — data only, no rebuild. Full wording in **WORKLIST.md → To discuss with Ritesh Bhai → OCPI item 4**.
8. ~~**Is the Fab Pro's Ricoh a Gen 6?**~~ — **ANSWERED 29-Aug-2026: yes, keep Gen 6.** The sheet says only "RICHO HEAD", DPI "300 & 600", supplier ORANGE BRAND, so the generation could not be read from it. **Fab Pro 1I, 2I and 3I** stay mapped to the existing *RICOH GEN 6 HEAD*; the client will say if that ever changes. No code or data change — the stage-C mapping was already correct.
9. **Is the "external centering system" tick the same thing as the centering device?** — *put to the client 29-Aug-2026; they do not know, so it is PARKED for Ritesh Bhai.* The client said keep them separate and they are — one is a yes/no on what the deal includes, the other asks how the device ships and whether it is billed on its own. But both read the same `opt_external_centering` capability, so a machine mapped "no" shows **neither**. If they are meant to be independent — billed for a device the deal does not include, or the reverse — the machine master needs a second column and both rule engines a second condition. Nothing built either way; today's behaviour is the "yes" answer. Full wording in **WORKLIST.md → To discuss with Ritesh Bhai → OCPI item 7**.
