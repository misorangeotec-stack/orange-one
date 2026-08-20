# Orange One — Work List

Day-to-day work: the new tasks and edits we want done, filed **module-wise**. Ask
*"what's on the list?"* and this file is the answer.

Each task carries the module it belongs to. New tasks go under their module's heading;
a task touching several modules is filed under its primary one and cross-referenced
from the others.

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Finished work does not stay under its module — it moves to **[Done](#done)** at the foot of this
file, so the module headings hold only what is still open and the record of what shipped is in one
place.

A task that needs someone else’s call carries a **“To discuss with …”** checklist at the end —
the open questions to put to them, so the conversation happens once and the answers land back here.

**Last updated:** 2026-08-20

Separate, and not repeated here — the two live operation logs keep their own detail:
[CENTRAL-MASTERS.md](CENTRAL-MASTERS.md) (Tally masters consolidation) ·
[RECEIVABLES-SCHEDULED-EMAIL.md](RECEIVABLES-SCHEDULED-EMAIL.md) (scheduled collection emails)

---

## Waiting for

Work held up because someone owes us something. If a task is late, this is the first place to look.

| What we need | From | Blocks | Waiting since |
|---|---|---|---|
| The calibration sheets (the Excel report QC keeps today) | Factory / QC team | **PE-1** | 2026-08-20 |
| The final list of production steps to add | Factory, then Bushra | **PE-2** | 2026-08-20 |
| The R&D flow and the form | Factory team | **RD-1** | 2026-08-20 |
| The COA sample PDF + the raw Excel sheet | Factory team | **PE-3** | 2026-08-20 |
| All the OCPI details | Bushra | **OCPI-1** | 2026-08-20 |
| Decision: weekly or monthly plan on the Collection Report | Ritesh Bhai | **RC-3** | 2026-08-20 |
| Scope of the internal / related company tag | Bushra | **OD-1** | 2026-08-20 |
| Call on removing "new customer / new item" from Dispatch | Bushra | **OD-2** | 2026-08-20 |
| Call on who maps customer to item — user or PC | Bushra | **OD-3** | 2026-08-20 |
| A walkthrough of Asset Maintenance, to list its changes | Bushra | **AM-1** | 2026-08-20 |
| Final approved travel details + travel amounts | HR | **TR-1** | 2026-08-20 |

---

## Process Coordinator Dashboard  *(new)*

### PC-1 · Consolidated dashboard for the process coordinator  `[ ]`
*Also touches: Admin / Masters · every FMS · Raised 2026-08-20*

We have a new process coordinator. Build them one consolidated dashboard — **a different
thing from the existing FMS Control Center** — that does two things:

1. **Approve every master.** All master approvals across every module land with the
   coordinator, in one queue of their own.
2. **See every FMS at a glance.** Which process is running successfully, which is getting
   delayed, and *at what point* the delay is happening — with the person to call, so the
   coordinator rings them and pushes the work on.

The bar is that it reads at a glance. No hunting.

**Where the existing pieces stand** (checked 2026-08-20):

- The [fms-control-center](frontend/src/apps/fms-control-center/) module is already
  org-wide, not per-user: its counts come from `buildQueueEntries`, which walks every open
  entry and emits one item per open step. What *is* per-user is only which FMS **rows**
  show — `MasterControlCenter` filters the list by `hasModule`.
- It gives counts by due-day (today / tomorrow / day after / no date) and expands to a
  per-step or per-stage breakdown, so it names the delayed **step** — but never the
  **person** sitting on it. That is the gap between spotting a delay and ringing someone.
- It does no master approvals at all. Approvals are gated on `isAdmin`
  ([MastersReconcile.tsx](frontend/src/core/admin/MastersReconcile.tsx)), so a coordinator
  who isn't an admin cannot approve anything.
- A "process coordinator" already exists in code, but **per FMS**: Asset Maintenance, HR
  Exit, HR Recruitment and Order to Dispatch each hold a `process_coordinators` config row
  of user ids, set in that module's own Settings. There is no single coordinator identity
  spanning all modules.

**Open questions for when we build it:** is this a new module of its own or a mode inside
an existing one; does the coordinator become a real role, a global permission, or a union
of the per-FMS `process_coordinators` lists; and does the FMS Control Center stay as it is
alongside this, or fold into it.

---

## OCPI  *(new module)*

### OCPI-1 · Build the OCPI module, standalone  `[!]`
*Raised 2026-08-20 · **Blocked:** awaiting the details from Bushra*

A **complete, standalone module** for OCPI, covering the whole thing end to end:

1. **Quotations** — create them in the module.
2. **Final OCPI reports** — produce them off the same data.

Bushra is sharing all the details; nothing is designed until those land.

**Notes:** nothing named OCPI exists in the codebase today — this is greenfield. The only
existing quotation handling is in the Import module
([SourcingModal.tsx](frontend/src/apps/import/components/SourcingModal.tsx)), which
captures up to three *vendor* quotations for a purchase line — inbound, and almost
certainly a different shape from what OCPI needs. Worth a look for patterns, not for reuse.

**To confirm when Bushra's details arrive:** what OCPI stands for and what the final report
must contain; whether a quotation here is customer-facing; what it needs from the central
masters (customers, items, rates); and whether it feeds any existing module or stays
genuinely standalone.

---

## R&D  *(new module)*

### RD-1 · R&D module — log initiatives, let management see them  `[!]`
*Raised 2026-08-20 · From the factory visit · **Blocked:** waiting on the flow and form*

R&D runs the work behind **new sampling and any new development** — different initiatives with
different purposes, and they do the sampling for each. Give them a module where a person records:

- **what kind of R&D** they are doing
- **what they have done**
- **the aim** of it

So management can see the R&D initiatives across the board.

**Notes:** no R&D module exists — "R&D" appears today only as a lab name in the sampling masters
and as a sub-department in the org masters. The real neighbour is the live
[sampling](frontend/src/apps/sampling/) FMS, which already runs a lab request end to end and
already carries a thin version of two of the three fields above: `requirementType`
(`"competitor" | "new_product"`) and a free-text `desiredResult`. Since R&D *does the sampling for*
these initiatives, the likely shape is an R&D initiative that **owns** its sampling requests rather
than a module that re-implements sampling — worth settling before we build.

**To confirm when the factory sends the flow and form:** what the form's fields actually are and
which are required; whether an initiative is a one-off entry or a running log with updates over
time; whether it has stages and owners like the other FMS modules, or is a simple record; whether
it links to the sampling requests it triggers; and what management's view needs to show — a list of
live initiatives, or progress and outcomes against the aim.

---

## HR  *(two new modules)*

### KB-1 · HR knowledge base — a second brain over the HR documents  `[ ]`
*Raised 2026-08-20*

There are a lot of HR documents. Build a **second-brain** over them so people can search and get
answers out of them — a **vector database with a RAG** system behind it.

**Notes:** the hard part here is not the retrieval, it is that **no vector storage exists yet** —
nothing in the repo uses pgvector or embeddings. That piece is genuinely new.

What is *not* new is the AI plumbing, and it is worth copying rather than reinventing. Six Edge
Functions already call models server-side — `score-candidate`, `parse-jd`, `parse-resume`,
`extract-card`, `transcribe-voice`, `analyze-receivables` — and they share a deliberate contract:
the browser sends **one id and nothing else**, and the function fetches everything the model reads
server-side using the caller's own JWT. That exists because a key must never reach the browser (the
receivables AI chat was deliberately left unported for exactly that reason). A RAG endpoint follows
the same shape.

**Worth settling before building:**
- [ ] Which documents are in scope, where they live now, and who keeps them current.
- [ ] Permissions — HR documents are not uniformly readable. Does retrieval filter by who is
      asking, or is the whole corpus open to anyone with the module? This has to be decided before
      indexing, not after.
- [ ] Does an answer cite the document it came from? Without a citation nobody can check it, and an
      HR answer that cannot be checked is worse than no answer.
- [ ] pgvector inside the identity project, or a separate store?
- [ ] How re-indexing is triggered when a document changes.

### TR-1 · Travel reimbursement module  `[!]`
*Raised 2026-08-20 · **Blocked:** waiting on HR's final approved travel details and amounts*

A travel reimbursement module. HR is sharing the **final approved travel details and the travel
amounts**; work starts once those land.

**Notes:** nothing exists — "Travel Desk" appears today only as a clearance owner inside Employee
Exit, which is unrelated. This would be the third HR module alongside New Recruitment
([hr-recruitment](frontend/src/apps/hr-recruitment/)) and Employee Exit
([hr-exit](frontend/src/apps/hr-exit/)), and the FMS engine pattern those use — step owners,
planned-vs-actual due dates, per-owner queues, master governance — is the obvious base, since a
claim raised → checked → approved → paid is the same shape.

**To confirm when HR shares the details:** the approved entitlement slabs and what they key off
(grade? band? distance? city?); who approves a claim and in how many stages; whether bills or
receipts must be attached; how it settles once approved — and specifically whether it hands off to
payroll or stops at "approved"; and whether an advance can be drawn before travel.

---

## Asset Maintenance  *(service & maintenance)*

### AM-1 · Walk the module with Bushra and list the changes  `[!]`
*Raised 2026-08-20 · **Blocked:** needs the review session with Bushra*

The service and maintenance module is already built and live. Go through it **together with
Bushra**, note down every change it needs, and then make them.

**Notes:** this is a review task, not a build task — the outcome is a list, and that list gets
filed back under this heading as AM-2, AM-3 and so on. The module is
[asset-maintenance](frontend/src/apps/asset-maintenance/) and is the odd one out among the FMS:
its entity is **permanent**. Assets and their dated tracks live for years, a service *job* is
raised off a track when it falls due, and closing the job rolls the track forward. Nightly
`pg_cron` opens the jobs and pushes the reminders. Worth having that model in mind during the
walkthrough, because a change that reads as small on another FMS can cut across it here.

Screens to cover so nothing is skipped: Dashboard, Calendar, Assets, Jobs, Queues, Monitoring,
Reports, Masters, Master Requests, Settings, System.

**Also worth raising in the same session** (both already on this list, both touch this module):
- **PE-1** — calibration. Asset Maintenance already treats calibration as a service type on an
  asset. Does the factory's daily QC calibration belong here, or standalone in Production?
- **PC-1** — the coordinator's single approval queue. This module has its own Master Requests and
  its own per-FMS `process_coordinators` list.

---

## Admin / Masters

*(cross-ref: **PC-1** above — master approvals need to reach a non-admin coordinator)*

---

## FMS Control Center

*(cross-ref: **PC-1** above — decide whether this stays alongside the new dashboard)*

### CC-1 · Ranking on the master control center  `[ ]`
*Raised 2026-08-20*

Add a gamification layer to the master control center: **a user sees their ranking** and
understands where they stand against everyone else using the Orange One hub.

**Notes:** the board has **no person dimension at all** today, and that is the size of this job.
[MasterControlCenter.tsx](frontend/src/apps/fms-control-center/pages/MasterControlCenter.tsx) is
process-shaped — one row per FMS — and every adapter returns an `FmsSnapshot` of totals plus
step/stage breakdowns, counts only, nobody's name in it
([adapters/types.ts](frontend/src/apps/fms-control-center/adapters/types.ts)). So a ranking means
threading a per-person dimension through all nine adapters, not adding a widget to existing data.

The raw material does exist per FMS: steps stamp who completed them and when (Order to Dispatch
carries `actorId` per step, Production stamps `mhAt` / `qcAt` / `pkAt` and the rest), and every FMS
carries a step-SLA model, so **on-time vs late per person** is derivable rather than invented.
Nothing ranks anyone today — no leaderboard, no score, anywhere in the codebase. The nearest
existing per-user read is the Master Report's `UserAccess` page, but that is access and last-seen,
not throughput.

**Worth settling before building:**
- [ ] What the rank actually measures — steps closed, steps closed **on time**, or something that
      cannot be won by picking easy work. Counting volume alone rewards whoever handles the
      fastest steps, not whoever keeps the process moving.
- [ ] Ranked across everyone, or within a department / module / role? Comparing a dispatch clerk
      with a QC checker on one ladder may not mean anything.
- [ ] Does everyone see the full table, or only their own position and the top few?
- [ ] Over what window — this week, this month, rolling?
- [ ] Does this belong on the existing board, or on **PC-1**'s new coordinator dashboard? Both
      screens are in play at once.

---


## Order to Dispatch

All three below need a conversation with Bushra before any code moves.

### OD-1 · Internal transfer / Others on a dispatch  `[!]`
*Raised 2026-08-20 · **Blocked:** needs the scope settled with Bushra*

There is no such option today. Add it:

1. The user picks whether this is an **Internal transfer** or **Others**.
2. For an internal transfer, **only the companies tagged internal / related** are offered.

**Notes:** the company tag does not exist yet — that is the bulk of the job, not the dropdown.
Nothing on `Customer` or the company master carries an internal / related flag today. Note also
that the existing `dispatchType` is `"local" | "transport"` — a *how it ships* axis. Internal
transfer vs Others is a *what this order is* axis, so it is almost certainly a new field rather
than two more values on that one; worth confirming rather than assuming.

**To discuss with Bushra:**
- [ ] Everything that has to be updated to carry the internal tag — which master holds it
      (`mst_companies`? `mst_parties`?), who maintains it, and whether it comes from Tally or is
      ours.
- [ ] Is "internal" one flag, or internal *and* related as separate tags? (Receivables already
      reports a "RELATED PARTY" book, so the concept exists in the business.)
- [ ] Does Internal transfer change anything downstream — credit check, sales bill, gate-out — or
      only who appears in the picker?
- [ ] What happens to orders already raised for internal movement under the current options.

### OD-2 · Stop creating customer and item masters inside Orange One  `[!]`
*Raised 2026-08-20 · **Blocked:** needs Bushra's call on removing it outright*

On refresh, **Customer Master and Item Master must come from Tally only.** We should never create a
new customer or item directly in Orange One — it is created in Tally first, and only then appears
here. Down the line, disable that option. And if anyone does create one here, it must be **clearly
highlighted and tagged** so it is obvious at a glance.

**Notes:** the tagging half largely exists already. Every central master row carries `source`
(`"tally" | "portal"`), plus `tally_guid` and `tally_synced_at`
([liveMasters.ts](frontend/src/core/platform/liveMasters.ts)), and the admin Masters grid already
has an **"In Tally"** column that flags anything whose `tally_synced_at` predates the last
successful sync as *Not in last sync*, filterable like any other column. Portal-only rows are a
known quantity too — the Phase 1 cutover recorded 15 Dispatch customers with no Tally ledger
([CENTRAL-MASTERS.md](CENTRAL-MASTERS.md)). So this is mostly about **enforcement in Order to
Dispatch and surfacing the tag there**, not new plumbing.

What is open is the disabling. Today *all five* master types are requestable from the module —
`REQUESTABLE_DISPATCH_MASTER_TYPES` spreads the full list, `customer` and `item` included — via
[RequestMasterModal.tsx](frontend/src/apps/order-to-dispatch/components/RequestMasterModal.tsx).

**To discuss with Bushra:**
- [ ] Remove "request a new customer / new item" from Order to Dispatch **entirely**, to avoid
      confusion? (This is the question to put to her.)
- [ ] If not removed: does the request still get approved here, or does it become "go create it in
      Tally and wait for the sync"?
- [ ] What a user should see when the customer or item genuinely isn't there yet — a dead end is
      worse than a request queue.
- [ ] How loudly a portal-created master should be flagged in Dispatch, and what happens to the
      ones already sitting there.

### OD-3 · Who maps customer to item  `[!]`
*Raised 2026-08-20 · **Blocked:** needs Bushra's call*

Customer-to-item mapping depends entirely on Tally today. When a mapping is missing, the user
raises a request and the PC has to approve it. Give the user the option instead — or, now that we
have a process coordinator, let the PC own this properly.

**Notes:** the mapping is `customer_item` → `mst_party_items`, the one *nameless* master
(`NAMELESS_MASTERS`), already requestable inline from the order lines grid with the customer and
item pre-filled ([OrderLinesGrid.tsx:82](frontend/src/apps/order-to-dispatch/components/OrderLinesGrid.tsx#L82)).
So the flow exists; the question is purely **who is allowed to complete it**. Note the tension with
OD-2: mapping is the one master here that is arguably ours rather than Tally's, so the answer need
not match.

**To discuss with Bushra:**
- [ ] Does the user create the mapping directly, or does the PC keep approving it?
- [ ] If the user: any guard at all, or a free hand? (A wrong mapping puts the wrong item on a
      customer's order.)
- [ ] Does this connect to **PC-1** — should these approvals land in the coordinator's single
      queue?

---


## Production Entry

### PE-1 · Calibration screen  `[!]`
*Raised 2026-08-20 · From the factory visit · **Blocked:** waiting on the calibration sheets*

A calibration module inside Production: **the machines on one side, the QC team's daily calibration
of each one captured against them.** The factory is sharing the Excel report they keep today; the
view gets built from that.

**Notes:** nothing production-side does calibration now. The nearest existing thing is
[asset-maintenance](frontend/src/apps/asset-maintenance/), which already treats calibration as a
service type on an asset, with dated tracks, jobs opened by nightly `pg_cron`, and meter
`readings` — but that model is built for *periodic renewals on a permanent asset*, not a **daily**
QC log. Worth deciding whether this rides on that or stands alone in Production; the daily rhythm
suggests the latter.

**To confirm once the sheets arrive:** what one calibration record holds per machine; which
machines are in scope and whether they are already a master somewhere; whether a day's calibration
is pass/fail, a set of readings, or both; who signs it off; and whether a missed calibration should
raise a queue item the way other FMS steps do.

### PE-2 · Report on how long each production step took  `[!]`
*Raised 2026-08-20 · From the factory visit · **Blocked:** waiting on the final step list*

A report showing the **overall time every step took to complete** in production — critical from the
production side. This needs some **additional steps included** first: only once those are in does
the production cycle read as complete.

**Notes:** the timing data is largely already there — every step stamps its own completion time on
the job (`mhAt`, `rmtAt`, `tsAt`, `peAt`, `qcAt`, `aisAt`, `mcAt`, `pmhAt`, `pmtAt`, `pkAt`,
`rtdAt`, `fgAt`, plus `submittedAt` / `closedAt`), so step durations are derivable for the steps
that exist today. Production also already carries a step-SLA model — every step defaults to one
working day after the one before ([sla.ts](frontend/src/apps/production-entry/lib/sla.ts)) — which
gives a planned-vs-actual to report against, not just a raw duration. The new work is the
*additional* steps, then the report itself.

**To discuss with Bushra:** which steps are missing and where they sit in the existing chain
(`STAGES` in [steps.ts](frontend/src/apps/production-entry/lib/steps.ts): Handover & QC → Log Book
& Production → M/C Testing → Packing → Dispatch); whether the report measures step-to-step elapsed
time or time against the SLA; and whether it reads per job, or averages across jobs over a period.

---

### PE-3 · COA at the QC step — import the Excel, generate two PDFs  `[!]`
*Raised 2026-08-20 · From the factory visit · **Blocked:** waiting on the sample PDF and raw Excel*

Today the COA lives in an Excel sheet the team maintains, and they generate the PDF out of it.
Bring it into Production at the **QC step**: they hand us the Excel, we **import** it, and from that
import we generate **two PDF views** —

1. **Client side** — the copy that goes out to the customer.
2. **Internal factory side** — the copy the factory keeps.

The factory is sharing the PDF they produce today plus a raw Excel sheet; both feed the build.

**Notes:** nothing named COA exists in the codebase. Two patterns to copy rather than invent, both
already in this module:

- **Import in the business's own file shape.** [bomIo.ts](frontend/src/apps/production-entry/lib/bomIo.ts)
  reads the BOM master from the exact block layout the business already writes its formulations in,
  deliberately *not* a normalised one-row-per-record sheet. That is the right instinct here — take
  their COA sheet as it is, rather than asking QC to reformat it.
- **PDF generation.** [printIssueSlip.ts](frontend/src/apps/production-entry/lib/printIssueSlip.ts)
  renders an HTML form to the browser print dialog via a hidden iframe, and is already reused across
  two documents with one layout and different data. COA is the mirror image — one set of data, two
  layouts — so the shared piece is the data, not the template.
- The QC step already exists as `quality_check` ("Quality Checking", step 4, request-scoped) in
  [steps.ts](frontend/src/apps/production-entry/lib/steps.ts), so there is a place to hang this.

**To confirm when the files arrive:** which fields differ between the client and internal copies
(and whether anything on the internal one must never reach a customer); whether the COA attaches to
a job / batch / request and how it is numbered; whether the import is per batch or a sheet of many;
whether the generated PDF must be stored and re-openable later or just printed; and whether QC can
edit values after import or only import-and-generate.

---

## Task Management

*(nothing yet)*

---

## Outstanding Dashboard (Receivables)

The Zero-Collection report itself is built. Live handover doc:
[RECEIVABLES-SCHEDULED-EMAIL.md](RECEIVABLES-SCHEDULED-EMAIL.md).

*(**RC-1**, grouping the bill-wise details by sale type, is done — see [Done](#done).)*

### RC-2 · Send the report automatically, Saturday 08:00  `[ ]`
*Raised 2026-08-20 · Depends on the server-side report builder*

The report should go out on its own every **Saturday morning at 8 a.m.** — set up the cron job.

**This is not just a cron row, and that is the whole difficulty.** As of 17-Aug-2026 the emailing
is **manual only**: an admin presses Export → Email and the PDF + workbook attach. There is no
builder, no cron, no send log. The report is drawn **in the browser** from the second Supabase
project and every figure is computed by the app, not stored — so the report engine has to run
server-side before anything can fire at 08:00. Phases 0–3 of the handover doc are that work; the
timer is only Phase 4.

**Notes:**
- `cron.schedule` is UTC and Edge Functions cannot be given a timezone, so **Saturday 08:00 IST =
  Saturday 02:30 UTC**. State the conversion in the migration.
- The precedent to copy is `supabase/worksnapshot/`, which already bundles the frontend's own code
  to run on Deno — not a fresh SQL reimplementation of the report.
- Needs a send log keyed on `(report, date)` so a retry cannot double-send.
- **The module's email switch is currently off on purpose** (`outstanding-dashboard` has no row in
  `email_module_settings`, so a send today is a silent no-op). An automatic Saturday send means
  flipping it on — confirm that is intended when we get there.

---

### RC-3 · Planned / Gap to plan reads wrong — weekly plan against a monthly report  `[!]`
*Raised 2026-08-20 · Feedback from Ritesh Bhai · **Blocked:** needs a decision from Ritesh Bhai*

On the Salesperson Collection Report, the **Planned (Aug-26)** and **Gap to plan** columns don't
show properly. The team **plans weekly**, but the report — sales, received, outstanding, everything
— is **monthly**. So one weekly-shaped number sits in a row of monthly ones and the gap misleads.

Three ways out, and they are mutually exclusive:

1. **A period tab at the top** — view the whole report weekly or monthly. Note this means *all* the
   data moves to a weekly basis, not just the plan column.
2. **Drop Gap to plan** (and Planned with it) rather than leave one weekly figure among monthly
   ones causing confusion.
3. **Enter the plan monthly**, so it matches everything else on the report.

**Notes:** the stored plan is **already monthly** — one row per `(month, entity)`, keyed
`month:type:name`, with the modal literally setting "the planned collection for ONE customer in ONE
month" ([collectionPlanTypes.ts](frontend/src/apps/receivables-hub/lib/collectionPlanTypes.ts),
[CollectionPlanModal.tsx](frontend/src/apps/receivables-hub/components/CollectionPlanModal.tsx)).
So option 3 is the smallest change by far — it is a data-entry habit, not a schema change. Option 1
is the largest: it needs a week dimension through the whole report, and `month` is a *label*
("MMM-YY") threaded through the plan store, the trend and `lib/months.ts`. `gap` is simply
planned − received, computed in the report and not a stored field
([SalespersonCollectionReport.tsx:107](frontend/src/apps/receivables-hub/pages/SalespersonCollectionReport.tsx#L107)).

**To discuss with Ritesh Bhai:**
- [ ] Weekly or monthly — which is the real planning rhythm the report should follow?
- [ ] If weekly: is the team willing to read *every* column weekly (sales, received, outstanding,
      collection %), or only the plan?
- [ ] If monthly: can the salespeople enter a monthly plan figure instead, or do they need to keep
      planning weekly and have the system roll the weeks up into a month?
- [ ] If neither settles: is dropping Planned + Gap to plan acceptable in the meantime?
- [ ] Does the same answer apply to the emailed PDF/workbook, or only the on-screen report?


---

## Done

Finished work, **newest first**. A task moves here from its module heading the day it goes live.

Three rules, so the section stays worth reading:

- **The ID and the module travel with it.** RC-1 stays RC-1, so a note or a message that referred
  to it while it was open still resolves.
- **Say what a reader will now see**, not which lines moved. Someone scanning this wants to know
  what changed for them; git holds the diff.
- **Delete the open entry in the same edit.** A task listed in two places is a task nobody trusts.

### RC-1 · Group the bill-wise details by sale type  `[x]`
*Outstanding Dashboard · Raised 2026-08-20 · Done 2026-08-20 · Feedback from Ritesh Bhai*

On the Collection Performance Report, a customer's bills used to run in date order with the sale
types interleaved, so there was no way to see how much of their overdue was ink and how much was
hardware without adding it up by hand. They now sit in groups — all the Ink together, then Spare
Parts, Machine, Head, Other, Non-product, always that order — with the **oldest bill still first
inside each group**.

- **PDF:** each group gets a heading strip and a subtotal line, so "Ink ₹6.02 L, Other ₹5.65 L"
  reads straight off the page. A customer selling one type only gets the strip and no subtotal,
  which would merely restate the TOTAL below it.
- **Excel** (*Overdue Bill Details*): the same order and the same per-type subtotals, but no
  heading strips — the Sale Type column already labels every row there.
- The On Account credit still sits alone at the foot of each block, and **no figure changed**: the
  customer TOTAL still reconciles to the Overdue column that linked to it.
- The on-screen drill-down popup was left alone — it already sorts on every column, and its
  largest-pending-first default is the right one for working the phone.
- The emailed report picks this up on its own; it attaches the same two files.

**Worth knowing if you touch this again:** `buildDrillRows` stamps the synthetic On Account line
`voucherType: "other"`, so anything that ranks by sale type must sink the credit *before* it reads
the code — otherwise the deduction files itself inside the Other group. Both comparators carry a
warning to that effect.
