# OCPI — build log & checklist

**Module:** OCPI (quotation → order confirmation), `apps/ocpi`, id `ocpi`, tables `fms_ocpi_*`.
**Plan of record:** `C:\Users\Admin\.claude\plans\https-forms-cloud-microsoft-pages-respon-noble-cupcake.md`
**Tracked in WORKLIST.md as:** OCPI-1
**Started:** 22-Aug-2026

This file is the LIVE LOG. Tick items as they land; add a dated note under a phase when something
changes shape. Same role `CENTRAL-MASTERS.md` plays for the masters operation.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` dropped

---

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
