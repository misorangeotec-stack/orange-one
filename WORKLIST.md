# Orange One — Work List

Day-to-day work: the new tasks and edits we want done, filed **module-wise**. Ask
*"what's on the list?"* and this file is the answer.

Each task carries the module it belongs to. New tasks go under their module's heading;
a task touching several modules is filed under its primary one and cross-referenced
from the others.

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked
**Priority:** 🔴 marks a task that is hurting live work and jumps the queue · 🟢 marks a low-priority
task that is worth doing and depends on nothing, so it can be picked up in parallel with whatever
else is running.

Finished work does not stay under its module — it moves to **[Done](#done)** at the foot of this
file, so the module headings hold only what is still open and the record of what shipped is in one
place.

A **bug** is not a task and does not belong in either place. Something that was already built and
turned out to be broken goes to **[Fixes](#fixes)**, just above Done — it was never on the list, so
there is no open entry to move.

A task that needs someone else’s call carries a **“To discuss with …”** checklist at the end —
the open questions to put to them, so the conversation happens once and the answers land back here.

**Last updated:** 2026-08-21

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
| Decision: does a salesperson's copy go to the rep only, or to everyone who can see that book? | Ritesh Bhai | **RC-5**, and the go-live of **RC-2** | 2026-08-20 |
| Scope of the internal / related company tag | Bushra | **OD-1** | 2026-08-20 |
| Call on SO-2627-0413 — wrong copy of SPECTRUM DIGITAL | Bushra | **OD-4** | 2026-08-20 |
| A walkthrough of Asset Maintenance, to list its changes | Bushra | **AM-1** | 2026-08-20 |
| Final approved travel details + travel amounts | HR | **TR-1** | 2026-08-20 |
| Department, sub-department + employee code for 10 people who joined after her 27-05-2026 sheet | Bushra | **OM-1** | 2026-08-20 |

---

## Platform — all modules

### PF-1 · Save Draft on every entry form  `[ ]`
*Raised 2026-08-20 · **Order: Production Entry first, then Order to Dispatch**, then the rest*

A standard **Save Draft** on all entry forms. On save the entry is **not published**; the same user
reopens the draft, finishes it, and publishes.

**The problem it solves:** in Production a user enters 10 raw materials, finds the 11th is not in
the system, and raises a master request for it — at which point the whole page has to be abandoned
and all 10 lines re-entered. That is a real cost on a long form, and it is why people avoid raising
the request at all.

**Notes:** this already exists, fully built, in **Customer Onboarding** — copy it rather than
invent it. Its wizard autosaves through `fms_customer_save_draft` / `fms_customer_delete_draft`
([customerWrites.ts](frontend/src/apps/receivables-hub/data/customerOnboarding/customerWrites.ts),
[WizardShell.tsx](frontend/src/apps/receivables-hub/components/customerOnboarding/WizardShell.tsx)),
with `status = 'draft'` as the first value of the status column. Two hard-won rules come with it,
both spelled out in
[its migration](supabase/migrations/20260802120100_add_fms_customer_requests.sql):

- **A draft is incomplete by definition, so the mandatory fields cannot be `NOT NULL` columns.**
  They are enforced by one CHECK that applies only to rows whose status is not `draft`, with the
  submit function raising friendly field-named errors long before the constraint fires.
- **A draft never burns a number.** The sequence is stamped by submit, not by save, so an abandoned
  draft leaves no gap in the numbering.

Nothing else in the codebase has this — every other `draft` in the frontend is just local component
state that dies with the page.

**Worth settling before building:**
- [ ] Is a draft private to its author, or can a colleague pick it up?
- [ ] Where does a user find their drafts — a tab on the queue, or the module dashboard?
- [ ] Do drafts expire or get cleaned up, and does an abandoned one ever need chasing?
- [ ] Should raising a master request from inside a form **auto-save the draft**, since that is the
      exact moment the work is lost today? (Related: **OD-2** / **OD-3**, which change how master
      requests are raised in Dispatch.)
- [ ] Which forms count as "entry forms" in the modules after these two — every step modal, or only
      the long ones that create an entry?

---

### PF-2 · 🔴 HIGH — queues tell approvers "Nothing here" while they are still loading  `[~]`
*Raised 2026-08-20 · Reported by the team · **Critical: this is delaying live work***

Two symptoms, one cause:

- A master request sits unseen — the approver takes a long time to notice it.
- In Order to Dispatch, once step 1 is done the item takes a long time to reach the second person's
  bucket.

**Root cause (found 2026-08-20): nothing tells a browser that someone *else* changed the data.**

- The FMS stores refresh by calling `invalidateQueries` **inside the tab that performed the
  write** ([store.tsx:302](frontend/src/apps/order-to-dispatch/store.tsx#L302)). The person who
  completes step 1 sees their own screen update instantly. The next person's tab is never told
  anything happened.
- The global query config is `staleTime: 60_000` with **`refetchOnWindowFocus: false`** and no
  `refetchInterval` ([main.tsx:22](frontend/src/main.tsx#L22)). So a page left open never refetches
  — not on a timer, and not even when the user alt-tabs back to it. The data only moves on a
  reload, or when a component remounts after the 60s stale window.
- **Realtime exists in exactly one module** — Task Management subscribes to `postgres_changes` for
  its notifications ([useMyNotifications.ts:77](frontend/src/apps/task-management/lib/useMyNotifications.ts#L77)).
  No FMS has it.
- **Polling exists in exactly one place** — Customer Onboarding's bell, at 60s
  ([CustomerBell.tsx:68](frontend/src/apps/receivables-hub/components/customerOnboarding/CustomerBell.tsx#L68)).


**PROVEN 2026-08-20 by an end-to-end test** (signed in as an approver, raised an item request from
the New Sales Order screen, exactly the flow the team uses):

| Step | Measured |
|---|---|
| Request submitted → row in the database | **instant** (`created_at` stamped on submit, `status = pending`) |
| "Send request" click → dialog closes | **6.0 seconds** |
| Master Requests page: **shows "To review 0 · All 0" and the "Nothing here" empty state** | **for the first 5.8 seconds of every load** |
| Then flips to the true counts | at 5.8 s → "To review 1 · All 110" |

**This is the bug.** While the data loads, the page does not show a spinner or "Loading…" — it shows
a confident, fully-rendered **"Nothing here — Requests for new master entries will appear here."**
An approver opens the screen, is told there is nothing to approve, and leaves. They reload, are told
the same thing, and leave again. The request was in the database the whole time.

That is the 10 minutes: not the system being slow, but the screen **actively saying the queue is
empty** while it is still loading.

**The fix:** never render the empty state until the query has resolved — show the loading state
while `isLoading`, and reserve "Nothing here" for a genuinely empty result. Then check every other
queue for the same pattern; the counts on this page start at 0 for the same reason.


**Step 1 shipped 2026-08-20 (not yet deployed).** `QueueTable` takes a `loading` prop; when it is
true and there are no rows it renders a spinner and "Loading…" instead of the `EmptyState`. Wired
into Order to Dispatch: Master Requests, StageQueue (both tables), OrdersTable, SalesReturnQueue.
The Master Requests tab counts now omit the badge while loading, so nobody reads a placeholder
"To review 0" as an answer.

Verified in the browser, same measurement as before the fix:

| | Before | After |
|---|---|---|
| First paint | "Nothing here", To review **0** | **"Loading…"**, no counts shown |
| Real data | 5.8 s | 3.4 s |

`loading` is optional, so the other 60-odd call sites across the eight other modules are unchanged
and still show the old empty state — **they need the same one-line wiring.**

**Still to do — the actual weight (steps 2-4):** every page still downloads the whole module,
15,425 rows over 25 round trips (notifications 4,993 · customer-items 3,179 · four months of
activity 2,760). Measured 2026-08-20. That is the reason the wait exists at all; the loading state
only stops the screen lying about it.

**⚠ Before doing steps 2-4, watch a real user's load from the factory.** Every number here was
measured on a fast local connection, and 6 seconds is not 10 minutes. The payload finding is solid;
that it fully explains the team's experience is not proven.

Related but separate: the 6-second submit and 5.8-second load are themselves slow for a table of
109 rows, and worth a look once the empty-state bug is fixed.

So the delay is not the approver being slow. Their screen is genuinely showing yesterday's picture
until something forces a reload — and this applies to **every FMS queue and every master request
list in the portal**, not just Dispatch.

**The fix, cheapest first:**

1. **`refetchOnWindowFocus: true`** — one line, and it covers the commonest case: the approver
   switches back to the tab and sees the truth. ⚠ It is global, so weigh it against the heavy
   receivables payload, which would also refetch on every focus. May be better set per query root
   than on the default.
2. **`refetchInterval` on the FMS queue queries** (~60s) — the Customer Onboarding bell already
   does exactly this and is the proven pattern here.
3. **Realtime on the FMS tables** — the correct end state, and the largest change. Task Management
   already shows the shape.

**Decide before building:**
- [ ] Scope: fix Production + Dispatch first (matching **PF-1**'s order), or all modules at once?
- [ ] Is a ~60s lag acceptable, or must a handover be instant (which means realtime)?
- [ ] Should the notification the next owner receives be the thing that wakes their queue up?

---

### PF-3 · 🔴 The `mst-refresh-company-links` job rebuilds ~2,100 rows from scratch every 15 minutes  `[ ]`
*Raised 2026-08-20 · Found while investigating **PF-2***

A cron job added on **17-Aug** (`cron.job` id 30, schedule `5,20,35,50 * * * *`) runs
`mst_refresh_party_companies()` + `mst_refresh_item_companies()` **unconditionally, four times an
hour**. Measured: **11–16 seconds every run, 252 runs, average 11.6s**, steady since the 17th.

**What it does each time:**
- takes the **333** Dispatch parties, strips punctuation from each name on the fly, and compares
  them against **all 7,842** parties (plus a GSTIN match) to find the same firm in another book;
- same for **536** Dispatch items against **all 14,261**;
- writes the result into `mst_party_companies` / `mst_item_companies` — **764 + 1,368 rows** that
  almost never change.

Roughly **10 million string comparisons every 15 minutes to reproduce the same ~2,100 rows.**

**Why it is slow:** the normalised name is computed *inside the join*
(`upper(regexp_replace(name,'[^A-Za-z0-9]+','','g'))`) on **both** sides, so no index can be used —
it is a full scan of every party against every party. It also has **no `statement_timeout`**, unlike
every other heavy job in `cron.job`.

**The fix, in order:**
1. **Guard it** — only rebuild when the masters actually changed. `mst_sync_runs` already keeps a
   watermark, and `masters-sync-watch` (job 8) proves the pattern works: 575 runs, **0.0s average**,
   because it does nothing when nothing changed.
2. **Store the normalised name as a real, indexed column** instead of computing it per comparison.
   That turns the scan into a lookup and should take the run well under a second.
3. **Ease the schedule** to every 3 hours as a safety net (the user's call, 2026-08-20). A manual
   sync covers anything urgent.

**⚠ Not the cause of PF-2.** Checked hour by hour: this job has been flat at 11–13s yesterday *and*
today, so it did not change when the complaints started. It is a standing waste worth removing on
its own merits, not the answer to the delay.

---

### PF-4 · 🟢 Document every Supabase table, view, function and cron job — and list the dead ones  `[ ]`
*Raised 2026-08-20 · **Low priority, high value** · touches no other task, so it can run in parallel
with anything on this list*

Months of building have left the database larger than anyone's memory of it. Nobody can say today
what half the tables hold, and there is no one place that answers it. Along the way we have almost
certainly created tables, views and cron jobs for features that changed shape or were dropped, and
they are still there — costing backup size, autovacuum, and the time of the next person who has to
work out whether a name matters.

**The deliverable:** one file — `docs/SUPABASE-INVENTORY.md` — carrying a **one-line purpose against
every object**, and a second list of **what looks dead**, with the evidence for each.

**What is actually there** — identity project `icutjkrqkbzwvmnfbzpr`, `public` schema, counted
2026-08-20:

| | Count |
|---|---|
| Tables | **240**, of which **44 are completely empty today** |
| Views / materialised views | 0 |
| Functions | 546 |
| Cron jobs | 9, all active |
| Edge Functions | 17 (`supabase/functions/`) |
| Migrations applied | 313 |

The nine jobs are `email-outbox-sweep`, `generate-recurring-daily`, `fms-asset-generate-jobs`,
`fms-asset-send-reminders`, `master-report-daily`, `masters-sync-watch`, `masters-sync-daily-force`,
`user-snapshot-daily` and `mst-refresh-company-links` — the last of which **PF-3** is already
about, and which is the kind of thing this inventory exists to surface.

**What each row should carry:** the object name · the module it belongs to · one line saying what it
is for · what writes to it · what reads it · rows today · last write · a verdict of **live /
historical / dead**.

**Telling dead from merely quiet** — the two are easy to confuse, so check both directions:

- **Written?** row count plus `max(created_at)` / `max(updated_at)`. An empty table can still be a
  live feature nobody has used this month.
- **Read?** grep the frontend, the Edge Functions and the SQL for the object's name. A table no code
  anywhere names is dead however full it is — and that is the stronger signal of the two.

Cron jobs get a third check: `cron.job_run_details` already records every run, so a job's real cost
and its failure rate can be stated rather than guessed.

**⚠ The output is a list, not a drop script.** [CLAUDE.md](CLAUDE.md) holds Supabase changes to
**additive-only**, and that rule stands. Nothing is dropped off the back of this task — the list
goes to Bushra, and each object is removed later, one at a time, with sign-off and a backup taken
first. Several "dead" tables will also turn out to be deliberate history (the `fms_import_*` and
`fms_purchase_*` sets in `backups/fms-purge-2026-07-29/`, for instance) and must be marked
**historical**, not dead.

**Also in scope, kept separate:** the ConnectWave mirror (`ieeefdnyhzgrroifiqbb`). It is the
external Python pipeline's database, read-only to us, so its section only needs the tables we
actually read — not its whole schema.

**Worth settling before starting:**
- [ ] Do the 546 functions go in the first pass, or only tables + cron jobs, with functions as a
  second sweep? (546 one-liners is the bulk of the work, and most are RPCs named after the screen
  that calls them.)
- [ ] Where does the file live — `docs/`, or beside `CLAUDE.md` at the root where the other live
  documents sit?

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

**OD-1 and OD-4 still need a conversation with Bushra. OD-2 and OD-3 no longer do** — both were
answered on 2026-08-21 and the build is **[OD-9](#od-9--the-user-maps-a-customer-to-an-item-themselves-)**.
**OD-5, OD-7 and OD-8 are not blocked either** — OD-5 is decided, OD-7 is a new ask, and OD-8 is the
tail of OD-6, so all can be picked up now.
**OD-7's Step 0 is finished**: every item now carries the type the sheet gave it — **MS-1**, shipped
2026-08-21, see [Done](#done). The screen work is no longer blocked on it. (**OD-6**, the slow save,
is fixed — also in Done.)

*(cross-ref: **PF-1** — Save Draft lands here second, after Production)*

### OD-1 · Internal transfer / Others on a dispatch  `[!]`
*Raised 2026-08-20 · **Blocked:** needs the scope settled with Bushra*

There is no such option today. Add it:

1. The user picks whether this is an **Internal transfer** or **Others**.
2. For an internal transfer, **only the companies tagged internal / related** are offered.

**Update 2026-08-20 — the plumbing landed; only the TAG is still open.** Our own branches were
invisible everywhere: a ledger under Tally's `Branch / Divisions` is neither a debtor nor a
creditor, so `masters-sync` set both role flags false and the row appeared on no tab and in no
picker. The sync now reads the trade registers as well as the group chain, so four internal
ledgers are customers of their own book and are ticked into Dispatch with their catalogues
([CENTRAL-MASTERS.md](CENTRAL-MASTERS.md), items 23–24). So an internal transfer can now be
raised as an ordinary order against the right branch. What is still missing is exactly what this
task is about: **nothing marks those four as internal/related**, so the picker cannot offer
"only internal companies" and no downstream step can behave differently. The four are
ORANGE O TEC PVT. LTD.(SURAT BRANCH), ORANGE O TEC PRIVATE LIMITED(NOIDA),
ORANGE O TEC ENTERPRISES PVT LTD (NOIDA) and ORANGE O TEC ENTERPRISES-(SURAT) — a ready-made
answer to "which ones count as internal", if Bushra agrees the definition is "a Branch /
Divisions ledger that trades".

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

### OD-2 · Stop creating customer and item masters inside Orange One  `[~]`
*Raised 2026-08-20 · **Half answered 2026-08-21** — the removal is decided; the tagging half is still open*

**✅ ANSWERED: remove them.** "Request a new customer" and "request a new item" come out of Order to
Dispatch entirely — they come from Tally only. That is built as part of
**[OD-9](#od-9--the-user-maps-a-customer-to-an-item-themselves-)**, which also answers what a user
sees instead of a dead end: the item they could not find is nearly always merely *unmapped*, and OD-9
lets them map it themselves. Only an item that exists nowhere in Tally now stops them, and it says so.

**Still open here:** how loudly a portal-created master is flagged *inside Dispatch*, and what happens
to the ones already sitting there. The admin Masters grid already carries the tag; Dispatch does not
surface it.

*(cross-ref: **OD-5** — if the request stays, the company it is raised for is the missing half)*

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

### OD-3 · Who maps customer to item  `[x]` *(decision — build is OD-9)*
*Raised 2026-08-20 · **Answered 2026-08-21***

**✅ THE USER DOES IT, DIRECTLY. No approval, and no request.** The mapping stops being something you
ask for and becomes something you do, in place, while raising the order.

**Why it was never really a gate:** of the 122 master requests ever raised in this module, **85 are
customer-item mappings and only 5 of those were rejected** — 94% approved. Nobody was being protected
by the wait; a person mid-order was simply blocked.

**Guard:** the same one that already decides who may raise the order — `fms_dispatch_can_raise`. The
mapping owners are still named, and still told when one is created, but for information only; there is
nothing to approve. **The build is [OD-9](#od-9--the-user-maps-a-customer-to-an-item-themselves-).**

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

### OD-4 · SO-2627-0413 names the wrong copy of SPECTRUM DIGITAL  `[!]`
*Raised 2026-08-20 · **Blocked:** needs Bushra's confirmation before the row is touched*

*(cross-ref: **OD-5** — the companyless approved customer is why this pair could form)*

**Left exactly as it is** on purpose — logged here rather than fixed, pending her call.

A customer exists once per Tally book, so SPECTRUM DIGITAL is three rows: Colorix — Surat,
Enterprise — Surat and O-tec — Surat. Only the **O-tec — Surat** row is ticked into Dispatch.
Five orders have been raised against the firm, all billed by **O-tec — Surat**, and four of them
use that O-tec row. **SO-2627-0413** (raised 2026-08-19, still at `awaiting_dispatch_confirm`)
uses the **Enterprise — Surat** row instead.

**Effect if left:** the order dispatches normally — nothing is blocked. The consequence is on the
paperwork: the sales bill would name the Enterprise — Surat ledger while O-tec — Surat is billing,
so the invoice and the Tally posting disagree about which ledger the sale belongs to.

**Probably nobody's mistake.** `customersForCompany()` deliberately offers a customer with **no**
company under *every* company — the newly-approved-customer case. That Enterprise row most likely
had no `company_id` when the order was raised, and the Tally sync filled it in afterwards, which
is what makes the pair look wrong today.

**How it was found:** comparing every order's billing company against the company its customer row
belongs to. 67 of 437 orders differ; all but this one are explained by rows that had no company at
the time. Re-run any time with the query in
[CENTRAL-MASTERS.md](CENTRAL-MASTERS.md) under the company-scoped masters note.

**To discuss with Bushra:**
- [ ] Repoint SO-2627-0413 at the O-tec — Surat row, or leave it and let the bill go out as is?
- [ ] Should an order whose customer row later gains a *different* company be flagged anywhere, or
      is this rare enough to handle one at a time?
- [ ] The other 66: leave them alone (they are closed or cancelled), or sweep them once?

### OD-5 · A requested customer / item is born with no company  `[ ]`
*Raised 2026-08-20 · **not blocked** — the behaviour is decided; only the details at the foot are ours to settle*

Whenever a user raises **request a new customer** or **request a new item** from the intake form,
**no company is picked** — the form never asks, so the request carries none and the approved row
lands companyless. It should ride along by default: the company the user already chose **at the top
of the sales order form** is the company the request is raised for.

**It breaks in three places, and all three have to move together.**

1. **The modal is never told.** The customer picker prefills `{ name }` only
   ([SalesOrderFields.tsx:197](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx#L197)).
   The pattern already exists twelve lines up — a new *location* prefills
   `{ name, company_id: f.form.companyId }` ([:158](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx#L158)).
   The item side is the same omission plus one more step: `raiseFor` prefills `{ name }`
   ([OrderLinesGrid.tsx:89](frontend/src/apps/order-to-dispatch/components/OrderLinesGrid.tsx#L89))
   and the grid is handed `customerId` but **not** the company, so the intake form has to pass it in.
2. **The form has no slot to put it in.** Neither the `customer` nor the `item` arm of
   [masterFields.ts](frontend/src/apps/order-to-dispatch/lib/masterFields.ts) renders a company
   field, and neither value bag carries a `company_id` key. ⚠ Those keys **are** the write payload
   and the Excel round trip (`emptyValuesFor`'s own warning), so a new key means the column must
   exist on every save path that reads the bag, not just in the modal.
3. **Approval throws it away.** The live resolver inserts `mst_parties` with **no** `company_id`
   and then ticks the new party into **every active company** via `mst_party_companies`
   ([phase2/01_cutover.sql:542](supabase/phase2/01_cutover.sql#L542)); `item` does the same into
   `mst_item_companies`. So even a company sent from the form would be dropped on the floor today.

**Why it is worth doing — this is the mechanism behind OD-4.**
With `company_id` null, `customersForCompany()` treats *no company* as *every company*
([store.tsx:718](frontend/src/apps/order-to-dispatch/store.tsx#L718)), so a freshly approved
customer appears under all five books and can be ordered under the wrong one. The wrong ledger does
not stop at the order — it flows into the sales bill and the Tally posting. Stamping the company at
request time is what removes the guess.

**⚠ It must land on `mst_parties.company_id` — not on `mst_party_companies`.** Migration
[20260921130000](supabase/migrations/20260921130000_revert_dispatch_gate_to_company_id.sql) reverted
a widening that read that table as permission to bill: central masters keeps **one party row per
Tally book**, so *which book may bill this row* has exactly one answer, and it is `company_id`.

**One thing this does NOT change:** an item's company is informational and deliberately does not
narrow the item picker — the customer↔item mapping is the authority there
([types/index.ts](frontend/src/apps/order-to-dispatch/types/index.ts)). Stamping it on a requested
item is record-keeping, so nobody should expect the picker to behave differently afterwards.

**Precedent to match:** Customer Onboarding already asks the company **first**, before the GSTIN,
and refuses to submit without it ([20260918120000](supabase/migrations/20260918120000_add_fms_customer_company.sql),
[20260918120200](supabase/migrations/20260918120200_fms_customer_require_company_and_salesperson.sql)).

**Sequencing:** overlaps **OD-2** — if Bushra removes "request a new customer / new item" from
Dispatch outright, this dies with it for those two types. The prefill half is cheap and safe either
way; do the resolver half once OD-2 is answered.

**Open, for us to settle:**
- [ ] Default-and-editable, or fixed to the order's company? (The same firm legitimately needs a
      ledger in more than one book, but the requester is mid-order under exactly one.)
- [ ] Once the company is stated, does the resolver stop blanket-ticking every active company into
      `mst_party_companies` / `mst_item_companies`, or is that tick still wanted as the sibling map?
- [ ] Show the company on the approver's modal too, so the owner sees which book they are creating
      the ledger in — and can correct it before it exists.
- [ ] The rows already approved companyless: sweep them once, or leave them to the Tally sync (which
      is what produced OD-4)?

### OD-7 · Sale type on the sales order, and the item list follows it  `[ ]`
*Raised 2026-08-21 · **not blocked** — the behaviour is asked for; what is ours to settle is where an
item's sale type comes from*

The intake form gains a **Sale type**, and the item picker then offers only the items of that type.

**✅ Step 0 is DONE — every item carries its correct type, from the sheet.** That was **MS-1**,
shipped 2026-08-21; see [Done](#done) for the numbers, the loader and the two questions it left open.
The field and the filter now have something real to read, so the rest of OD-7 is unblocked. The
group-name reading below is only a sizing exercise showing why guessing does not work; it is
superseded by the sheet and kept for the record.

**What MS-1 settled, and what it means for the rest of OD-7:**
- **It lists items, not stock groups** — 11,431 item names. So the type lives on **`mst_items`**, and
  the `mst_items` vs `mst_item_groups` question below is answered: `mst_items`.
- **The vocabulary does NOT match the five words.** The sheet uses 16, normalised to **13**. The five
  existing keys keep their spelling and each of the 13 carries the bucket it maps down to, so a sales
  order can still be lined up against what it became on the ledger — the filter reads the 13, the
  join reads the 5.
- **Items the sheet does not name (608) keep whatever they carry** — not blanked, not parked under
  Other.
- **The load is re-runnable**: a staging table plus one script, additive-only.

**There is no sale type anywhere in this module today.** Nothing in
[order-to-dispatch/](frontend/src/apps/order-to-dispatch/) mentions one, and `fms_dispatch_orders`
carries 87 columns without it. The only thing shaping the item list is the customer's own mapping —
`itemsForCustomer` ([store.tsx:732](frontend/src/apps/order-to-dispatch/store.tsx#L732)), fed by
`mst_party_items`: **8,025 active mappings, 789 customers, 1,693 distinct items — 10.2 items per
customer on average, but up to 219 on one.** Sale type is the second cut that long list needs.

**It lands in five places.**

1. **The field.** The intake header
   ([SalesOrderFields.tsx](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx)) —
   ⚠ read its layout comment first: Customer must stay immediately before Customer location, and the
   pairing only holds while Customer's position is odd **and** not a multiple of three. It is 5th
   today. Inserting a field re-counts every position, and it breaks on tablet only.
2. **The filter.** `allowedItems` in
   [OrderLinesGrid.tsx:66](frontend/src/apps/order-to-dispatch/components/OrderLinesGrid.tsx#L66)
   narrows further by type — but the `includeIds` escape hatch must survive it. That argument is
   what keeps a line's own item in its picker; drop it and switching the sale type on an order that
   already has lines blanks those rows on the next edit.
3. **The payload.** `OrderInput` / `orderPayload`
   ([dispatchWrites.ts:40](frontend/src/apps/order-to-dispatch/data/dispatchWrites.ts#L40)),
   `fms_dispatch_submit_order` + `fms_dispatch_update_order`, and a new **nullable** `sale_type` on
   `fms_dispatch_orders` (additive-only). The RPC re-checks the customer↔item rule server-side; it
   has to re-check this one too, or a stale row walks an off-type item through.
4. **The Orders grid.** A new column means a sort toggle and a cascading filter under it — the
   default, not a decision.
5. **Where an item's sale type actually comes from.** Answered by Step 0's sheet; the sizing below
   is why it has to be a sheet and not a rule.

**The vocabulary is already fixed, and it is not ours to invent.** Receivables types every rupee on
five buckets — `ink · spare_parts · machine · head · other`
([SaleTypeMultiSelect.tsx:6](frontend/src/apps/receivables-hub/components/SaleTypeMultiSelect.tsx#L6),
[agingReport.ts:55](frontend/src/apps/receivables-hub/lib/agingReport.ts#L55)) — resolved by
ConnectWave's `resolve_sale_type`. Dispatch must use the same five words or an order can never be
lined up against what it became on the ledger.

**And this is the first time the type would be known *before* the invoice.** ConnectWave can only
read a sale type off the voucher type or the bill-name prefix — i.e. after the bill exists, which is
exactly why the SPARE/ and HEAD/ series fell into Other until
[sale_type_rules_spare_head_prefixes.sql](supabase/connectwave/sale_type_rules_spare_head_prefixes.sql)
taught it those prefixes (**RC-1** notes). Stating the type on the order states it up front.

**Sizing the mapping — map the GROUP, not the item.** Every item already carries its Tally stock
group (`mst_items.group_id` → `mst_item_groups`): **14,264 of 14,267 items are grouped**, and the
1,693 orderable ones sit in just **217 group rows — 167 distinct names**, since Tally files the same
group separately in each company book. So typing them is ~167 decisions, not 14,000.
⚠ It cannot be guessed from the name: matching on ink/head/spare/part/machine types 98 of the 167 and
leaves **69 names, 524 orderable items, in Other** — and they are not fringe. REACTIVE H SERIES,
NOVACRON HD and DIGISTAR (BIB) are inks; CHEMICALS, DIRECT TO FABRIC and ELECTRICAL say nothing
either way; and several groups are named after the supplier (ELYSIUM INDUSTRIES INDIA PVT LTD, 41
items). Somebody types those once, and only a person who knows the product can — which is exactly
what the Step 0 sheet is.

**Open, for us to settle:**
- [ ] Is the sale type a property of the **order** (one type, the whole order) or of the **line**?
      One-per-order is the simpler filter and matches how a bill is raised — but it means an order
      for ink *and* a spare part becomes two orders. Confirm before enforcing it.
- [x] Does the type live on `mst_item_groups` or on `mst_items`? — **`mst_items`.** The Step 0 sheet
      names items, one by one, so the type is exact per item rather than inherited from a group whose
      contents do not all bill on one ledger. Settled by MS-1.
- [ ] Untyped items — hidden from every sale type, or shown under **Other**? Hiding them makes an
      unmapped group silently unorderable, which is the failure nobody can diagnose from the screen.
      **608 items are in this position** after MS-1, plus 55 that carry no type at all.
- [ ] Does the sale type also decide the **sales ledger at the bill step**, or is it only a filter on
      intake? If it is only a filter, the order and the invoice can still disagree.
- [ ] The 478 orders already raised (91 still live): leave them untyped, or backfill from the items
      they carry? Untyped history is fine for a filter, and wrong the moment a report groups on it.

**To discuss with Bushra:**
- [ ] Can one order mix sale types, or is a mixed order meant to be split?
- [ ] Who owns the group → sale type map once it exists — the same owner as the item master?

---

---

### OD-8 · Dispatch still re-downloads every master after each save  🟢  `[ ]`
*Raised 2026-08-21 · **not blocked** — the last piece of **OD-6**, deliberately left out of it*

**OD-6** is fixed: the write no longer waits for anything, and the reload behind it fell from 6.1 s to
~1.4 s. But a save still *triggers* a reload of the module's whole snapshot, and most of that snapshot
cannot possibly have changed — a step save does not touch `mst_parties`, `mst_party_items` or
`mst_items`, yet all three come down again, roughly 5 MB, every time anyone saves anything.

Nobody is kept waiting by it any more, so this is bandwidth and database load rather than a
complaint: eight dispatch users saving through the day, each pulling the masters again on every save.

**The fix** is to split the one react-query key
([dispatchFetch.ts:232](frontend/src/apps/order-to-dispatch/data/dispatchFetch.ts#L232)) into a
**masters** query with a long `staleTime` and a **dispatch working set**, so a write invalidates only
the second. Expect the post-save reload to fall from ~1.4 s to a couple of hundred milliseconds, and
the module's first load to get faster too.

**Why it was held back rather than done with OD-6:** three consumers share that one cache entry — the
store, [fms-control-center/adapters/order-to-dispatch.ts](frontend/src/apps/fms-control-center/adapters/order-to-dispatch.ts)
and [core/workspace/mywork/providers/order-to-dispatch.ts](frontend/src/core/workspace/mywork/providers/order-to-dispatch.ts)
— and all three have to move together. That is a data-layer refactor with its own verification
(does the Control Center still render? does My Work?), not a line to append to a fix that was already
measured and proved. It deserves its own change.

---

### OD-9 · The user maps a customer to an item themselves  🔴  `[~]`
*Raised 2026-08-21 · **Built 2026-08-21**, migration applied. Answers **OD-3** and the removal half of
**OD-2**.*

**Where it stands.** All of it is written and `npm run build` passes. The migration
([20260927120000](supabase/migrations/20260927120000_dispatch_map_customer_item.sql)) is **applied to
`icutjkrqkbzwvmnfbzpr`** — the RPC and the `created_by` trigger are live.

The RPC was exercised against **live data as a real non-admin raiser**, inside a transaction that
rolled back. All five behaviours hold:

| | |
|---|---|
| new pair | `created 1` · `source=portal` · `created_by` stamped by the trigger |
| the same pair again | `skipped 1` — not an error |
| a pair switched OFF | `reactivated 1`, active again — no unique violation |
| an item from another book | refused, **naming the item** |
| empty selection | no-op |

An unauthenticated caller is refused by `fms_dispatch_can_raise`, checked separately.

**⏳ Still owed: the browser pass.** Everything above is server-side or the type-checker; nobody has
clicked through the modal yet — the Playwright profile was locked by another Chrome instance. What to
drive, in order: raise an order under O-tec — Surat as an ordinary user; confirm the 8,340-item book
loads without stalling and the Type filter narrows it; map something and confirm it is selectable on
the line immediately; then open one of the 78 twin customers and confirm a name they can **already**
order is not offered a second time.

When the item a customer needs is not in their list, the user stops asking and just does it. The
customer-item mapping becomes a direct action inside the sales order; the request queue behind it goes.

**Two entry points, one modal, one write path, no approval.**

1. **Inside the new sales order.** The item picker's `＋ Request new item…` row becomes
   **`＋ Map an item to this customer`**. The popup opens with the **company and customer already
   filled in from the order** and read-only, the typed text seeded into the search, and every item of
   that company listed. Tick and save; the item is selectable on the line immediately.
2. **Standalone**, from Master Requests → "Request a new entry". "What do you need?" drops from four
   choices to two: **Customer-Item Mapping** (direct) and **Company Location** (still a request).
   **Customer** and **Item** are removed — they come from Tally only (**OD-2**).

**Decided, and not to be re-opened without a reason:**

| | |
|---|---|
| Standalone entry point | Direct create, same as the popup |
| Company Location | Stays requestable — it is our own site, not Tally's |
| Item that exists nowhere in Tally | Say so plainly: create it in Tally first |
| Which items the popup lists | **Only the selected company's own book. No way to widen.** |
| Notification | Mapping owners told, information only |
| Seeing manual mappings | Must be filterable in Central Masters |

**⚠ THE COMPANY FILTER IS A HARD ONE, AND IT WAS CHOSEN KNOWING THE COST.** Tally files a stock item
in exactly one company book, but the firms sell each other's stock: **185 of 1,813 existing order
lines (10%)** use an item from a different book than the one billing — SO-2627-0449 is O-tec **Noida**
billing `444-028 PRINTHEAD WIPER`, an item created in O-tec **Surat**'s book. Those 10% cannot be
mapped in this popup and go to an admin in Central Masters, where the company filter is optional. The
popup must **say which book the item lives in** rather than showing an unexplained empty list.
The compensation is real, though: there are **zero duplicate item names inside a single book**, so the
hard filter removes the twin-ambiguity at the point of choosing.

**Five things the audit caught before any code moved. The first two would have shipped broken.**

1. **⚠ EXCLUDE ALREADY-MAPPED ITEMS BY NAME, NOT BY ID.** `itemsForCustomer` collapses the picker to
   **one row per product name** ([store.tsx:889](frontend/src/apps/order-to-dispatch/store.tsx#L889)),
   while the admin form this popup is modelled on excludes by item id
   ([Masters.tsx:457](frontend/src/core/admin/Masters.tsx#L457)). Those disagree: a customer mapped to
   the Enterprise twin of a name would be *offered* the O-tec twin, the save would succeed, and the
   picker would look **identical** — so the user concludes it failed and does it again.
   **Measured on live data: 375 pairs across 78 customers would be offered a duplicate this way** —
   KALAHANSH FASHIONS LLP (Enterprise — Surat) is already mapped to EP SUBLIMATION SUPER HD YELLOW out
   of O-tec's book, and Enterprise's own book holds a copy of that very name.
   `mappedItemCounts` already counts distinct NAMES for exactly this reason; match it.
2. **⚠ `source` CANNOT CARRY THE "MADE BY HAND" MARK — IT ERASES ITSELF.** `masters-sync` upserts
   `mst_party_items` and sets `source: 'sales_register'` unconditionally
   ([masters-sync/index.ts:561](supabase/functions/masters-sync/index.ts#L561)), so the first time the
   customer actually buys the mapped item the mark flips and the row drops out of the filter. **Four
   rows already show this damage** — `created_by` set, `source` reading `sales_register`. And
   `source='portal'` is useless anyway: 1,823 of its 1,869 rows are bulk migration rows. Use
   **`created_by` / `created_at`**, which that upsert never names. Clean rule: **null = a machine
   made it, non-null = a person did** — the sync runs on the service key, so `auth.uid()` is null
   there and it cannot mis-attribute. `insertMasters` does not set it
   ([masterWrites.ts:158](frontend/src/core/platform/masterWrites.ts#L158)), so a `before insert`
   trigger defaulting it to `auth.uid()` closes every hand path at once.
3. **⚠ DO NOT FILTER ON `modules`.** Only **540 of 14,264** active items are ticked for
   `order-to-dispatch` and **13,724 carry none at all**. Filtering there collapses the catalogue and
   defeats the feature. The company book is the filter.
4. **The Master Owners screen would start lying.** Its "Requestable — Yes / —" column reads
   `REQUESTABLE_DISPATCH_MASTER_TYPES`
   ([MasterOwnersSection.tsx:97](frontend/src/apps/order-to-dispatch/pages/settings/MasterOwnersSection.tsx#L97));
   narrowing that list makes the mapping read "—" while its owners are still the people notified.
   Relabel to **"How it's raised"**: *Direct* / *Request* / *Tally only*.
5. **8,340 items needs a Type filter, not just a search box.** `item_type` is populated on **14,208
   of 14,261** items now (**MS-1**), and O-tec Surat splits spare_parts 4,877 · ink 1,119 · paper 855 ·
   machine 687 · head 485. ⚠ **Show every type, hide none** — the book also holds `raw_material`,
   `packing_material` and `service_expense`, and hiding them silently is the failure **OD-7**
   warns about. Filter, don't hide.

**Two constraints that shape the build.**

- **The module's item list cannot show a company's catalogue — it is derived from the mappings.**
  [dispatchFetch.ts:678](frontend/src/apps/order-to-dispatch/data/dispatchFetch.ts#L678) builds `items`
  from the ids `mst_party_items` names plus ids already on an order: **1,693 of 14,264**. The item
  this feature exists to find is by definition not in it. The modal needs its own per-company fetch —
  Colorix 254 · Enterprise-Surat 1,450 · Enterprise-Noida 2,092 · O-tec-Noida 2,125 · O-tec-Surat 8,340.
  `pagedWalk` already fires its pages **concurrently**, so that is one round trip, not nine — but it
  must be ordered by `name` **and `id`**, or ties silently drop rows (it cost ~300 mappings once).
- **RLS blocks the write for exactly the people this is for.** `mst_party_items_write` is
  `is_admin(uid) OR mst_is_master_manager('party_item', uid)`, so an ordinary user calling
  `insertMasters` gets a policy violation. A `SECURITY DEFINER` RPC
  **`fms_dispatch_map_customer_item`** is required — gated on `fms_dispatch_can_raise`, asserting
  the customer↔company pair with the existing `fms_dispatch_assert_customer_of_company`, and
  refusing any item outside `p_company`'s book. `UNIQUE (party_id, item_id)` means a pair switched
  off in the past must be **reactivated and reported**, not inserted into a unique violation.

**Also swept up:** the company picker on the sales order can raise a `company` request the resolver
then refuses outright with *"Companies come from Tally now"* — after an owner has already approved it
([SalesOrderFields.tsx:127](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx#L127)).
And the reviewer's notification for a nameless master reads *"…was requested: "* with a trailing colon,
because it uses `payload.name` where `describePayload` exists
([store.tsx:1076](frontend/src/apps/order-to-dispatch/store.tsx#L1076)).

---

## Production Entry

*(cross-ref: **PF-1** — Save Draft lands here FIRST)*

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

### RC-2 · Send the report automatically, on a schedule  `[~]`
*Raised 2026-08-20 · Built and disarmed 2026-08-20, 22:00 IST*

**Built. Nothing sends until you flip one switch.** What is left is yours: choose the days, the
time and the recipients, read the dry-run log, then arm it.

*Deliberately still open rather than moved to Done: the code is live on `master` but the feature is
not — nothing is scheduled, nobody is on the list, and the switch is off. It moves to Done the day
it actually posts something.*

**Proved on the runner, 20-Aug-2026** (runs `32392028439`, `32392193665`, `32392294411`):

- a **dry run** built the whole book in 26 s and one salesperson in 4.8 s — 60 s end to end,
  including the checkout and `npm ci` — and reproduced the screen exactly: 247 of 362, ₹30.58 Cr,
  ₹17.53 Cr, 34, 116, ₹3.98 Cr. The runner is faster than the desk it was written on (26 s vs 40 s).
- a run in **scheduled** mode asked the database, was told `automatic sending is not armed`, and
  stopped without reading a row. That is the stop that matters.
- a **sample** posted both shapes — the book and a rep's extract — from the runner through storage
  and the outbox to a test address. Both delivered; the send log stayed empty, because a sample
  must not burn a slot.

**How to turn it on** (full detail in [RECEIVABLES-SCHEDULED-EMAIL.md](RECEIVABLES-SCHEDULED-EMAIL.md) §6):

1. Receivables → Settings → Notifications — set the frequency, the days, the time, the book
   addresses and which salespeople get their own copy.
2. Run **Actions → Collection report → Run workflow → `mode: dry-run`** and read the log. It names
   every address each salesperson resolves to, flags anyone tagged with more than one book, and
   warns about names nobody carries.
3. `select set_collections_report_armed(true);` — last, and yours.

To stop it: `update private.collections_report_config set armed = false;`

**What was built**

| | |
|---|---|
| `20260922120000_…_scheduled_send.sql` | `collections_report_due()`, the send log, the arming switch |
| `supabase/collectionsreport/` | the builder: bundles the app's own TypeScript, three guards |
| `.github/workflows/collections-report.yml` | ticks every 30 min, gates on the database first |

Earlier phases: multi-day schedules `17bad6a`, the KPI numbers and card wording out of the React
page `3ca9e7d`, the row predicate and defaults `dd05708` / `18387c7`, the headless build `3e0cd72`.

**⚠ The plan said "Edge Function". It cannot be one, and that is measured.** A probe burned
straight-line CPU on the live runtime: 1 s → `200`, 3 s → `546 WORKER_RESOURCE_LIMIT`, and 8 s with
an `await` every 200 ms → `546` as well. The ceiling is **2 s of CPU per request** and the budget is
**cumulative** — yielding does not reset it. This report is **~40 s of solid CPU** (101 pages,
~250 customers, a 1.5 MB workbook), and the per-salesperson fallback does not rescue it either: one
rep's 18-page extract is already over. So it runs on a **GitHub Actions runner**, which has no such
cap and has the repo checked out — so it still runs the app's own code, which was always the point.
The repo is public, so runner minutes are free.

**Notes:**
- No `pg_cron` job, and no UTC conversion by hand: the IST comparison happens inside
  `collections_report_due` in `Asia/Kolkata`, so the stored hour means what it says.
- Send log keyed `(report_key, sent_for_date)` on the **IST** date; a run reaching nobody
  deliberately does **not** log, or adding the first recipient an hour late would cost the slot.
- **Four switches** must all be on. `report_email_settings` is already `true` so admins can mail by
  hand — which is exactly why a dedicated `armed` flag exists, so finishing this feature could not
  arm an unattended send as a side effect.
- Timing is honest, not exact: GitHub's scheduler can run several minutes late, so an 08:00 slot
  goes out shortly after 08:00. `grace_minutes` (120) lets a late tick still serve it.
- **GitHub disables a scheduled workflow after 60 days with no commits to the repo.** Unlikely here,
  but it stops silently rather than failing.
- Still open: an attachment size guard (fine today at 2.2 MB), and resolving a salesperson to a
  chosen **user id** rather than to everyone holding the tag — the run log surfaces that for now.
- **⚠ Do not arm this before RC-5 is answered.** Who a salesperson's copy actually reaches is a
  decision for Ritesh Bhai, and on today's tags three accounts would each receive thirteen separate
  emails per send. Arming first and asking after is the wrong order — those mails cannot be recalled.

---

### RC-6 · Spare and Head bills read as "Other" on the salesperson report  🔴  `[x]`
*Raised 2026-08-21 · Feedback from Ritesh Bhai · **Applied live 2026-08-21, 13:54 IST** — four rules
in (ids 40–43) and the snapshot rebuilt. Moves to [Done](#done) at the next tidy-up.*

**Live result, measured after the rebuild:** Spare Parts 74 → **731** bills · Head 138 → **208** ·
Machine 385 → **386** · Other 1,219 → **491**. Exactly the 728 bills predicted, and **zero** `SPARE/`
or `HEAD/` bills are still typed `other`. `INK/`, `HD/HG/` and `HG/SPARE/` re-checked unchanged.

⚠ **The rebuild takes ~2.5 min and Supabase's HTTP gateway cuts at 2 min, so `collection_refresh()`
over PostgREST ALWAYS returns 504** — but the transaction keeps running server-side and commits
anyway. Do not read that 504 as a failure and do not retry: a retry hits the `pg_try_advisory_lock`
overlap guard and answers *"another run in progress; skipped"*, which reads like a stuck lock and is
not one. Poll `collection_meta` instead. Note `refreshed_at` is `now()` = **transaction start**, so
it stamps ~5 min before the data actually appears.

On the zero-collection report a customer's bill page groups the open bills by sale type, and the
spare-parts and print-head bills were sitting in the **OTHER** band:

| Bill | Reads as | Should be |
|---|---|---|
| `HEAD/26-27/40`, `HEAD/26-27/41` | Other | **Head** |
| `SPARE/26-27/384`, `SPARE/25-26/2103`, `SPARE/26-27/563` | Other | **Spare Parts** |
| `SPARE/EN/2627/5`, `SPARE/EN/2627/6` | Other | **Spare Parts** |

**It is not the report — it is the classification, and it is upstream of us.** The report prints
`collection_invoice_snapshot.sale_type` verbatim and the snapshot genuinely says `other`. The
ConnectWave mirror types an **open** bill from its bill NAME alone —
`resolve_sale_type(acct, '', bill_ref)`, with the voucher type passed **empty**, because
`bill_outstanding()` hands back a bill ref and no voucher. So on the open-bill path only the
`voucher_no_prefix` rules can ever fire and every `voucher_type` rule is dead code. The seeded
prefix vocabulary was `INK/ SP/ HD/ MC/ H/ HG/SPARE/` — five series read off the *opening* bills
back when that was the only case it had to cover. The current sales series `SPARE/`, `SPARE/EN/`
and `HEAD/` are in none of them, so every one of those bills fell to the `other` default.

The same snapshot row contradicts itself as a result: FY **sales** by type *are* resolved from the
real voucher type, so a customer can show spare-parts sales and zero spare-parts outstanding.

**The fix** — [sale_type_rules_spare_head_prefixes.sql](supabase/connectwave/sale_type_rules_spare_head_prefixes.sql),
four `voucher_no_prefix` rules. Prefixes are safe to key on here because Tally numbers each voucher
type on its own series: checked across all 22,070 lines of `rpt_sales_register`, no prefix maps to
two sale types. `SPARE/` → `GST SALES - SPARE PARTS` ×1296, `HEAD/` → `GST SALES - HEAD` ×128, and
each of those voucher types already has a rule pointing at the same bucket — the new rows only teach
the open-bill path what the voucher path already knew. They also type the handful of *opening* bills
on these series, which no voucher lookup could reach at all.

**⚠ `HEAD/M/` is load-bearing, not tidiness.** `HEAD/M/24-25/11` (₹16.52 L, an opening balance) is a MACHINE deal
(`GST SALES - HEAD(MACHINE)`). `HEAD/` without it would move that bill from one wrong answer to
another. The resolver breaks a priority tie on `length(match_value) desc`, so `HEAD/M/` beats
`HEAD/` and `SPARE/EN/` beats `SPARE/` — the same mechanism that already makes `HG/SPARE/` beat
`HD/`.

**What it moves** (measured against the live snapshot, refreshed 2026-08-21 10:30 IST):

| Prefix | Open bills | Pending | Other → |
|---|---:|---:|---|
| `SPARE/` | 654 | ₹2,18,40,030 | Spare Parts |
| `HEAD/` | 70 | ₹2,10,73,297 | Head |
| `SPARE/EN/` | 3 | ₹4,976 | Spare Parts |
| `HEAD/M/` | 1 | ₹16,52,000 | Machine |

**Done:**
- [x] Rules inserted into `sale_type_rule` on **ConnectWave** (`ieeefdnyhzgrroifiqbb`) — ids 40–43.
- [x] `select public.collection_refresh();` — committed 2026-08-21 08:29 UTC.
- [x] Resolver spot-checked on every series, including the controls that must NOT move
      (`M/C ADV`, `HAND/…` → `other`; `INK/`, `HD/HG/`, `HG/SPARE/` unchanged).

**Left to eyeball:** open a customer page on the Collection Report and confirm the Spare Parts and
Head bands render. The data is right; this is only confirming the screen.

**`PAPER/` — done too, as its own category.** *(Ritesh Bhai reversed the "leave it in Other" call the
same day: paper is too big to sit in a catch-all.)* 117 open bills, ₹1.05 Cr, its own Tally voucher
type. See [sale_type_paper_bucket.sql](supabase/connectwave/sale_type_paper_bucket.sql) — a new
`paper` bucket plus **two** rules, because the open-bill path and the sales path read different
signals: `voucher_no_prefix 'PAPER/'` types the outstanding bills (that path sees no voucher), and
`voucher_type 'GST SALES-PAPER'` types the sales (that path does). One without the other is the same
split-brain that started RC-6 — right outstanding, wrong sales.

Unlike Spare/Head this is a NEW product line, so the frontend gained a `paper` member in all 20
places that enumerate sale types — the `SaleType` union, the filters, the labels, the card and
reading orders, the aging record and the empty-record builders. `npm run build` (strict `tsc`) and
the collections-report email bundle both pass. Its chart colour is `hsl(165,85%,31%)`, chosen by
running the palette validator rather than by eye: it clears the chroma floor and separates from Ink
orange at ΔE 9.4 under protanopia (the obvious green failed at 8.0).

Two things stayed out: `OTPL/` is a delivery challan, not a sale, so it raises no bill; `NOTPL/`
(2 bills, ₹5.10 L) *looks* like a Nashik paper series but has no voucher to confirm it, and guessing
is what put `SPARE/` in Other for a year.

⚠ `core/platform/liveMasters.ts` has its own `ItemType` union with the same five names. It is the
Central Masters **item** type, a different thing — deliberately NOT extended.

**Still deliberately left out — each needs its own call:**
- `SER/ SER/N/ RENT/ AMC/ JOB/` — ~52 bills, ₹70 L. Income, but not a product line; the mirror has a
  `non_product` bucket the receivables screens already fold back into Other. Not yet asked.
- `CN/ DN/ G/SR/` — credit notes, debit notes, sales returns. Adjustments that belong to the bill
  they offset, not to a product line of their own.
- `HAND/ NOTPL/ PM/ MS/H/` — ~₹36 L, four series with no matching voucher anywhere in the mirror.
  `HAND/25-26/103` is on the screenshot that raised this. **Ritesh Bhai, 2026-08-21: `HAND/` is
  almost certainly a mis-typed `HEAD/`, so it belongs in Head — but leave it in Other for now.**
  Worth fixing at source in Tally rather than adding a rule that blesses the typo: a rule would
  quietly make the misspelling permanent, and any future `HAND/` bill would look correct while
  still being wrong in the books.

Everything still reading `other` after this is genuinely other: advances, on-account, TDS/TCS,
journals, round-off.

**The durable fix, not done here:** type a non-opening bill from its **origin voucher** and fall
back to the prefix only for true opening balances. That is a change to `collection_refresh()` in the
ConnectWave project, so it wants its own sitting — the prefix rules above are complete for every
bill on a numbered series, which is all of them today.

---

### RC-7 · An advance we PAID OUT is listed as an overdue bill  `[ ]`
*Raised 2026-08-21 · Feedback from Ritesh Bhai · Found on VAMA (NAKUL JI) while checking RC-6*

VAMA shows **1 open past-due bill** — bill no `ADV`, Due Days 25, Amount ₹8.50 L,
**Received −₹8.50 L**, Pending ₹17.00 L. A negative Received is the tell: nothing was received at
all, and this is not an invoice.

**The ₹17 L is real — do not "fix" the figure.** Checked against the mirror: VAMA's Tally ledger
closes at **₹17,00,000 Dr** (`v_ledger_detail`), and behind it sit two genuine `BANK PAYMENT`
vouchers, 27-07-2026, ₹8.5 L each, out of AXIS BANK (CC A/C), with different RTGS UTRs (12:44 and
14:55). Money went **out** to VAMA. The mirror and the report are faithful.

**Why it appears as a bill.** Both payments were tagged in Tally to a bill reference literally named
`ADV`. Tally's outstanding statement lists anything carrying a bill reference, and there is no field
saying "this is an advance, not an invoice" — the name is whatever the accountant typed. The report
mirrors Tally.

**Why the columns look broken.** From `ledger_bill_allocs_by_id`:

| Voucher | Bill type | Amount | |
|---|---|---:|---|
| …0002**4304** | `New Ref` | ₹8,50,000 Dr | creates reference `ADV` |
| …0002**432a** | `Agst Ref` | ₹8,50,000 Dr | *settles* reference `ADV` |

An **Agst Ref** is meant to CLEAR a reference, so it should carry the OPPOSITE sign. Both are Dr, so
the second payment **doubled** the reference instead of clearing it. `bill_outstanding()` then
reports `amount` = the New Ref only (₹8.5 L) and `pending` = the whole reference (₹17 L), and
`buildDrillRows` computes `received = amount − pending` ([collections.ts](frontend/src/apps/receivables-hub/lib/collections.ts))
— hence −₹8.5 L.

**Two separate problems. Do not conflate them.**

1. **A Tally entry error.** The second RTGS is a second advance, not a settlement of the first. It
   wants its own New Ref (`ADV-2`), or the two want to be one voucher. **This is the actual defect**
   and it is fixed in Tally, not here.
2. **A report question.** Even with Tally correct, an advance we PAID OUT is not a bill anyone is
   late on. There is no credit period, so due date = bill date and "Due Days 25" is merely age. It
   also drags VAMA onto the zero-collection list with "Last receipt Never" — technically true, and
   still not what that list is for.

**Rare, so do not over-build for it.** Of **3,493** open past-due bills, **7** have a negative
Received (₹71.68 L). Largest is `MC/26-27/45` (a different flavour — the New Ref is itself a credit
of −₹1.5 Cr against ₹53 L pending), then this `ADV` at ₹17 L. The rest are under ₹7 L.

**Decided 2026-08-21 (Ritesh Bhai): nothing changes in Tally. The fix is ours.**

**Do NOT key it on the reference NAME.** `ADV`, `M/C ADV`, `On Account`, `Journal`, `TDS` — a
name-matching rule is a guess, and a wrong guess **hides real money**, which is the opposite of RC-6
and the worse failure of the two.

**Key it on the VOUCHER TYPE that created the reference**, which is a fact rather than a guess.
`ADV` was raised by a `BANK PAYMENT` — it is not a bill and never was.
`ledger_bill_allocs_by_id` already returns `voucher_type` alongside `bill_ref`, so the signal
exists; it simply is not carried into `collection_invoice_snapshot`.

**⚠ DRY RUN, 2026-08-21 — the obvious version of this rule is UNSAFE. Measured, not reasoned.**
Ran against all 3,493 open past-due bills (₹53.32 Cr) by pulling the `New Ref` allocation behind
every one (42,155 voucher lines over the 590 ledgers that carry a past-due bill).

*Attempt 1 — "keep it only if a SALES voucher raised it, drop the rest."* Would have removed **72
bills, ₹1.66 Cr**, and **₹76 L of that was real money**:
- **60 paper invoices, ₹63.78 L**, because the voucher type `GST SALES- PAPER` is **missing from
  `v_voucher_type_nature`**. The classification view has holes, and a drop-by-default rule reads a
  hole as "not a sale". This is precisely the failure mode this task exists to avoid.
- **5 debit notes, ₹12.29 L** (`GST DEBIT NOTE`). A debit note is a genuine charge to the customer.

*Attempt 2 — invert it: drop ONLY when the creating voucher is a MONEY voucher* (chain root
`Receipt` / `Payment` / `Contra` — vouchers that move cash and cannot raise a receivable), keep
everything else including anything unclassifiable. **Default = keep = never hide money.**

*Attempt 3 — the second dry run, widened from the past-due bills to the WHOLE snapshot, caught the
one that mattered.* "Raised by cash" is true of DEBITS and CREDITS alike, and only the debits are
phantoms. Of the 30 references the rule matches, **19 are CREDITS totalling −₹94,02,878** —
`M/C ADV`, `REC 20.06.2026`, `ON ACCOUNT`, all raised by a `BANK RECEIPT`. Those are advances the
customer genuinely **paid us**. Removing them would have raised **17 customers' Outstanding by
₹94 L** and un-credited money sitting in our bank. So the rule acts on **`pending > 0` only**:
a debit with no invoice behind it overstates what we are owed; a credit with no invoice behind it is
real money that already has a home ("On Account (paid, tagged to no bill)").

**Final measured effect — whole snapshot, 21-08-2026:**

| | |
|---|---|
| Bills removed | **11 · ₹1,19,12,014 off Outstanding · 11 customers** |
| Of those, past due | **8 · ₹98,50,281 off Overdue** |
| Book Outstanding | ₹81.62 Cr → **₹80.43 Cr** (−1.46%) |
| Credits removed | **0** — no customer's Outstanding rises |
| Sales-raised bills removed | **none** |
| Paper invoices removed | **0 of 116** |

Biggest: `MC/26-27/45` ₹53.00 L, `On Account` ₹20.00 L, `ADV` ₹17.00 L (VAMA), two `BANK PAYMENT`
at ₹10.00 L each, `24.09.2026` ₹8.00 L.

⚠ `INK/N/26-27/410` (₹1,416) and `HD/HG/26-27/95` (₹295) carry real sales bill NUMBERS but their
`New Ref` came from a `BANK RECEIPT` that over-applied. ₹1,711 between them, so the rule's only
judgement call costs nothing today. Worth re-checking if it ever grows.

**Adopt attempt 3. Do not adopt 1 or 2.**

**This is the SAME missing link as RC-6's root cause** — `collection_refresh()` calls
`resolve_sale_type(acct, '', bill_ref)` with the voucher type empty, because `bill_outstanding()`
returns a bill ref and no voucher. Carry the originating voucher type into the snapshot once and
both are fixed: sale type stops depending on the bill-name prefix, and non-sales references stop
counting as overdue bills. Do them together.

**BUILT 2026-08-21 — not yet live. Two pieces, and the SQL must land first.**

1. [non_bill_refs_view.sql](supabase/connectwave/non_bill_refs_view.sql) — a new **additive**
   view `public.v_non_bill_ref`, granted to `anon`. Deliberately NOT a change to
   `collection_refresh()`: that function is 999 lines, several repo files each redefine it, and the
   live version is none of them for certain — a `create or replace` from a stale copy would silently
   revert the overdue cap, the voucher-class work and the group-GUID migration. A new view touches
   nothing that already exists.
2. [liveNonBillRefs.ts](frontend/src/apps/receivables-hub/lib/liveNonBillRefs.ts) — reads the view
   and strips the matching DEBIT lines out of the live snapshot in place, adjusting `outstanding`,
   `overdue`, `overdueGross`, the aging buckets, the per-type splits, `maxOverdueDays`,
   `utilization` and `risk`. Modelled on `liveOtherPayments.ts` and wired into
   `connectwaveFetcher` immediately after it. `npm run build` passes, and the bundle for the
   emailed report picks it up automatically (it compiles `connectwaveFetcher` itself), so the
   scheduled PDF and the screen cannot disagree.

**⚠ It runs AFTER the Other Payments pass, not before.** That pass settles bills FIFO and must see
the same bill list Tally does; removing lines first would let a manual payment cascade onto a
different bill than it settles in the pipeline, and Live and pipeline mode would stop agreeing.

**Fail-soft on purpose.** If the view is absent the reader logs
`[liveNonBillRefs] DEGRADED` and changes nothing — the report reads exactly as it does today. So
shipping the frontend before the SQL is inert rather than broken. Still apply the SQL first.

**To do:**
- [ ] Run `non_bill_refs_view.sql` in the **ConnectWave** SQL editor. No refresh needed — it is a
      view, not a snapshot column, so it is live the moment it is created.
- [ ] Check its three verify queries, especially the guard that must return zero rows.
- [ ] Deploy the frontend. Confirm the console says `removed 11 non-bill reference(s)` and not
      `DEGRADED`.
- [ ] Open VAMA: it should be gone from the report entirely.

**Shape of the change, for the record** (ConnectWave, then frontend):
- `bill_outstanding()` / `bill_outstanding_by_id()` gain an `origin_voucher_type` column, taken from
  the `New Ref` allocation. Additive — existing callers select columns explicitly.
- `collection_invoice_snapshot` gains the column; `collection_refresh()` fills it.
- The report treats a bill raised by a MONEY voucher as **not overdue**: it keeps its money in
  Outstanding but moves to its own line, exactly as genuine On Account credits already do
  ([collections.ts `buildDrillRows`](frontend/src/apps/receivables-hub/lib/collections.ts)).
- ⚠ `v_voucher_type_nature` is the classifier, but **it has holes** (see the dry run). Only ever ask
  it "is this a money voucher?", never "is this a sale?" — an unknown type must fall through to
  *keep*.

**Found while dry-running this — separate, small, not yet applied.** The paper voucher type has TWO
spellings in live data: `GST SALES-PAPER` (49 lines) and **`GST SALES- PAPER` (473 lines — the
common one)**. The `voucher_type` rule added with the Paper bucket covers only the first, so paper
*sales* on the older books still resolve to Other. Open bills are unaffected (the `PAPER/` prefix
rule carries them). Fix is one more rule row for the variant spelling, exactly like the existing
`GST SALE- SPARE PARTS` note — needs a nod before applying.

**Second, cheaper guard, worth having either way:** a negative Received (`pending > amount`) is
impossible for a genuine bill. Catches all 7 rows today regardless of voucher type, and needs no
schema change.

**Decided 2026-08-21 (Ritesh Bhai) — one rule, and it settles both questions:**

> **If there is an outstanding BILL, show it. If there is no bill, show nothing.**
> Never an outstanding figure with no bill behind it — that mismatch is what made this look broken.

So a removed reference leaves **Overdue AND Outstanding**, not just Overdue. VAMA has no invoice at
all — its ledger holds two bank payments and nothing else, opening balance ₹0 — so VAMA drops off
the report entirely rather than showing ₹17 L against zero bills.

⚠ **Accept the consequence knowingly:** the ₹17 L Orange paid VAMA then appears **nowhere** on this
report. It is real money out of the door and Tally still carries it at ₹17,00,000 Dr. If it is ever
to be chased from here it needs its own place to live — that is a separate ask, not this one.

---

### RC-4 · Remove the legacy receivables connection — ConnectWave only  🟢  `[ ]`
*Raised 2026-08-20 · Found while building RC-2 · **Decided 2026-08-20:** rip it out. Low priority —
nothing is waiting on it, so it can be picked up alongside whatever else is running.*

The hub's **Live (Tally)** switch has two positions. Live — the default — reads the ConnectWave
mirror and works. Turning it **off** selects the legacy pipeline project `lkwtvcpeamkzzqkfnkuc`, and
**that project no longer exists**: its hostname does not resolve at all. The external Python pipeline
that fed it (the separate "Orange Receivables Hub" repo) is out of the picture too.

**The call: the legacy source goes away entirely.** Not "fail with a readable message" — deleted.
ConnectWave is the only receivables backend. The dead path is not merely unused, it actively
**conflicts**, and that is the reason to spend the time rather than leave it dormant.

**Where it already costs us — three kinds of conflict, all real today:**

- **A silent-empty bug it already caused.** In
  [CustomerDetail.tsx:846](frontend/src/apps/receivables-hub/pages/CustomerDetail.tsx#L846) a local
  named `source` once *shadowed* the active source, so the Live path queried the legacy project with
  ConnectWave ledger GUIDs, matched nothing, and returned an empty set **with no error**. It is fixed,
  but the shape of the mistake only exists because two backends are reachable from one screen.
- **Every screen carries a fork.** `source === "connectwave" ? … : …` appears ~20 times across
  [useAppData.ts](frontend/src/apps/receivables-hub/lib/useAppData.ts), CustomerDetail,
  CustomerRiskRegister, LedgerVoucherList and LedgerVoucherStatement — separate cache keys, a Red Mark
  fallback, a whole second alerts story. Each fork is a place the two sources can disagree.
- **The Collections report has to actively fence it out.** `build.mjs` installs an esbuild resolve
  hook whose only job is to make sure nothing in the graph imports `receivablesSupabase`
  ([build.mjs:86](supabase/collectionsreport/build.mjs#L86)). That guard exists solely because the
  dead module is still importable.

**The removal surface** (all of it, so nothing is left half-connected):

| What | Where |
|---|---|
| The toggle + its permission | [liveMode.tsx](frontend/src/apps/receivables-hub/lib/liveMode.tsx), the topbar switch at [UserLayout.tsx:187](frontend/src/apps/receivables-hub/layouts/UserLayout.tsx#L187) |
| `profiles.receivables_allow_pipeline` | the column, `Profile.receivablesAllowPipeline`, its row in [MenuPermissions.tsx](frontend/src/apps/receivables-hub/components/MenuPermissions.tsx), and every seed in [data.ts](frontend/src/core/platform/data.ts) |
| The dead fetchers | `supabaseFetcher.ts`, `receivablesSupabase.ts`, `loadFromSupabase` in useAppData |
| The env vars | `VITE_RECEIVABLES_SUPABASE_URL` / `_ANON_KEY` / `VITE_DATA_SOURCE`, in Vercel and in `.env.local` |
| The forks | the ~20 `source === "connectwave"` branches collapse to their Live arm |
| `sourceContext.tsx` | with one source left, `ReceivablesSource` is a single value — keep `useHubBase()`, drop the union |
| The esbuild fence | the `receivablesSupabase` resolve hook in `build.mjs` can go once the module does |
| The stored preference | `receivables.source.v2` in localStorage — a browser holding `"pipeline"` must land on Live, not on nothing |

**⚠ Do NOT drop the column in the same breath.** The repo rule is additive-only on Supabase: stop
*reading* `receivables_allow_pipeline`, leave the column in place.

**Nobody loses anything when this ships — checked against the live database 2026-08-20.**
`receivables_allow_pipeline` is set on **0 of 60 profiles**, so no non-admin can reach the legacy
view at all. The only people who can still flip the switch are the **5 admins**, who get it from
`isAdmin` rather than the column. So there is no user to warn and no migration path to plan: the
removal is pure deletion.

**Open, minor:**
- [ ] Does the static-JSON (`local`) source go the same way? "ConnectWave only" reads as yes, and
      `loadFromJson` plus the `public/` fixtures would go with it — but it is also the only offline
      dev path, so worth a moment's thought rather than deleting on momentum.
- [ ] Anything in the legacy project worth exporting before the Supabase account is tidied up? (The
      project is unreachable, so the honest answer may be that this question is already closed.)
- [ ] Update [CLAUDE.md](CLAUDE.md) when it lands — the "two separate Supabase projects" section and
      the receivables-hub data-flow notes both still describe the legacy path as live.

---

### RC-5 · Who should receive a salesperson's copy — one person, or everyone who can see it?  `[!]`
*Raised 2026-08-20 · **Blocked:** needs a decision from Ritesh Bhai · Blocks the go-live of **RC-2***

**The question in one line:** when the Collection report goes out automatically for, say, NAKUL JI,
should that copy reach only Nakul — or everyone who is allowed to see his book?

**Why it is a question at all.** `profiles.receivables_salespersons` is a **visibility scope**, not
an identity. It answers *"whose figures may this person see"*, not *"who is this salesperson"*. So
a salesperson name does not resolve to one inbox. Five accounts carry more than one name:

| Account | Email | Names carried |
|---|---|---|
| Bushra | `PC@orangeotec.com` | **13** |
| Jayshree Patil | `collection@orangeotec.com` | **13** |
| Ritesh Tulsyan | `ritesh@orangeotec.com` | **13** |
| Nitesh Prajapati | `nitesh@orangeotec.com` | 8 |
| Nakuleshwar Sharma | `nakul@orangeotec.com` | 5 |

Everyone else carries one or two. Note that even **Nakul** — a real rep — carries five, so "tagged
with exactly one name" cannot be used to identify a salesperson either.

**What happens today if all thirteen names are scheduled:** those three accounts each receive
**thirteen separate emails**, one per salesperson, every send. That may be exactly right for credit
control, but it should be a decision.

**Three ways to go, whichever Ritesh Bhai prefers:**

1. **Leave it.** Everyone who can see a book gets it mailed. Simplest; noisiest.
2. **Send to the rep only**, and give the oversight accounts the whole-book copy instead — they can
   already see everything in it.
3. **Choose the address per name**, the way the manual Export → Email dialog already does. Needs a
   chosen **user id** on `report_email_recipients` (not the address, so a rep who changes email
   keeps receiving and one who loses the tag stops).

Until it is decided, the run log prints who each name reaches and how many books that person can
see, so nothing is a surprise — but the noise is real and it is worth settling before the first
automatic send rather than after.

**Three stale tags found while checking this** — small, separate, and fixable in Admin → Users
without waiting for the decision above. The live data holds 13 salesperson names
(`OTHERS` 703 ledgers, `MANMOHAN JI` 300, `NAKUL JI` 292, `UMESH JI` 132, `KHURSHID JI` 116,
`KARAN SIR` 70, `AAYUSH SIR` 62, `DHANANJAY` 42, `PURAV SHAH` 37, `SUHEL` 27, `RELATED PARTY` 24,
`ABHISHEK` 7, `HARI OM` 2):

- **`MAYANK`** is tagged on all three 13-name accounts and **no ledger carries it**. Dead.
- **`Others`** (lower case) sits on Jayshree and Ritesh *alongside* the real `OTHERS`. Dead, and it
  is why their count reads 13 when only 11 names are live — they are also missing `RELATED PARTY`,
  which Bushra has.
- **`HARI OM`** exists in the data but **nobody is tagged with it**. Scheduling it would report
  "nobody to send to".

**To discuss with Ritesh Bhai:**
- [ ] Should a salesperson's copy go to the rep only, or to everyone who can see that book?
- [ ] If oversight accounts should still receive something, is the whole-book copy enough?
- [ ] Remove `MAYANK` and the lower-case `Others`, and should anyone hold `HARI OM`?

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

## Fixes

Bugs found and repaired, **newest first**. This is not the same thing as [Done](#done): Done holds
tasks somebody *asked for*, this holds faults somebody *hit*. A fix has no open entry above — it was
never on the list, because nobody planned it.

Three rules:

- **Stamp the date and time it went live**, in IST, and name the commit. Same rule as Done.
- **Lead with what the person saw**, not with the cause. "The item was missing from the dropdown" is
  what will be searched for a year from now; the tied-timestamp explanation is the second line.
- **Say what else was at risk.** A fault is rarely alone — if the same mistake sits in other code,
  write down where, so the next reader does not have to find it twice.

### FIX-2 · A long customer name was cut off on the new sales order  `[x]`
*Order to Dispatch · **Fixed 2026-08-21, 13:18 IST** · Live on `master` at `1121181`*

**What was seen:** raising a new sales order, a customer with a long name was clipped — in the
Customer dropdown while choosing, and again in the field itself once picked, where
`INTEGRATED APPAREL TECHNOLOGY AND FACILITATION CENTRE PVT LTD` read as
`INTEGRATED APPAREL TECHNOLOGY AND FA…`. Confusing, and worse than it looks: a firm keeps a
**separate ledger in every book it trades with**, so several of its ledgers collapsed to the *same*
visible prefix and the tail — the only thing that tells them apart — was the part being thrown away.
The person was being asked to pick between identical-looking rows.

**What was wrong:** two cuts, in different places. Every portalled menu carried a flat
`max-w-[320px]`, so any row past roughly 40 characters was trimmed to an ellipsis — **238 of the
1,887 customer ledgers**, the longest running to 61 characters. Separately the picker's trigger
truncated its selected value on one line, so the name was cut a second time *after* choosing, which
is exactly when someone wants to confirm what they picked.

**The fix:** `placeMenu` now returns a `maxWidth` beside the `maxHeight` it already returned — the
room actually available on the side the menu is pinned to, capped at 560px — and pins the menu by
its **right** edge when that is the roomier side, so a picker in the last column of a form opens
leftwards across the form instead of into the window edge. Menu rows wrap instead of truncating, so
nothing in a list is ever cut off again. For the trigger, a new opt-in `wrapLabel` lets the value
run to a second line; it is set on the four master pickers in the sales-order header, which New
Order and Edit Order share. It is off by default because a fixed-height grid cell — the item picker
on the lines grid — cannot take a taller control; those keep the ellipsis and gain a hover tooltip.

**What else was at risk:** the 320px cap and the truncating rows were in the **shared**
`Combobox` and `MultiSelect`, so every dropdown in every module was cutting long values the same
way — masters pickers, queue column filters, form fields alike. All of them are fixed by this
change, not just Dispatch. Queue *table cells* were never affected: they wrap already.

### FIX-1 · A customer's item was missing from the sales order dropdown  `[x]`
*Order to Dispatch · **Fixed 2026-08-21, 07:46 IST** · Live on `master` at `2dde9c0`*

**What was seen:** `LAXMI DIGITAL — DIGISTAR BELLAGIO RJM GREY` sat in **Central Masters → Customer
Items**, active, ticked into the module and proved by 11 sales. Pick that company and that customer
on a new sales order and the item was not in the Item list. The two screens disagreed about the same
row.

**What was wrong:** nothing in the data. The module reads the 8,052 customer-item pairs a thousand
at a time, and it was ordering those pages by `created_at` alone — a column that is *not* unique
here, because the sales-register derivation wrote the pairs in batches sharing a timestamp to the
microsecond (500, 500, 500 … and one of 1,036). Each page is its own query and the database promises
no order for rows tied on the column you named, so a row inside a tie could fall either side of a
page boundary from one request to the next. Replaying the module's nine pages against live: **8,052
rows fetched, 7,754 distinct** — roughly 300 pairs read twice and roughly 300 never read at all, and
a different 300 each time. This pair was one of the missing ones, so the order form had genuinely
never been told it existed. Masters showed it because that screen reads through `liveMasters`, which
orders by `id`.

**The fix:** the primary key is appended as a tiebreaker on all three paged reads in
`dispatchFetch.ts`, which makes the order total and the walk exact — re-measured at 8,052 fetched,
8,052 distinct, the pair present. `fms_dispatch_config` is exempt: it already orders by `key`, its
own unique primary key.

**What else was at risk:** `mst_parties` (1,887 customers over 216 distinct timestamps) and
`fms_dispatch_order_items` carry the identical fault and are whole today only because their page
boundary happens to miss a tie group — a customer or an order line could have vanished the same
silent way. Both are covered by this change.

**Still open, and worth doing:** every other module's loader pages the same way
(`procurement`, `sampling`, `production-entry`, `hr-*`, `office-supplies`, `asset-maintenance`,
`import`, `task-management`). None is broken today, because their tables are smaller than a page —
but each one breaks like this the day it crosses 1,000 rows, and it breaks *quietly*. The receivables
fetchers already carry the rule in their comments; the FMS ones do not. **A sweep of the same one-line
tiebreaker across them is not yet done.**

---

## Done

Finished work, **newest first**. A task moves here from its module heading the day it goes live.

Four rules, so the section stays worth reading:

- **Stamp the date and time it shipped**, in IST, on the entry's italic line — the moment it went
  live, not the moment the code was written. Two tasks finished on the same day still read in
  order, and a question like "was this in yesterday evening's deploy?" has an answer.
- **The ID and the module travel with it.** RC-1 stays RC-1, so a note or a message that referred
  to it while it was open still resolves.
- **Say what a reader will now see**, not which lines moved. Someone scanning this wants to know
  what changed for them; git holds the diff.
- **Delete the open entry in the same edit.** A task listed in two places is a task nobody trusts.

### MS-1 · Every item gets its Type, Category and Ink type from the sheet  `[x]`
*Admin / Masters · **Done 2026-08-21, 14:50 IST** — migrations and data load applied first, frontend
on `master` as `47a4603`, Vercel deploy reported success · was **OD-7 Step 0***

**Every `item_type` in the masters was a guess** until today. It was seeded by
`mst_guess_item_type()` — a pile of regexes reading the item name and its Tally group — and
[that migration](supabase/migrations/20260902121100_add_item_type.sql) called itself *"a BEST-EFFORT
SEED, not a source of truth"*. `Misc/Bushra Reports/Inventory Mapping Sales Register.xlsx` is the
source of truth: 11,431 items, each typed by hand by someone who knows the product.

**What a user sees now.** Admin → Central Masters → **Items** carries three columns instead of one:
**Type**, **Category** and **Ink type**, each with a sort toggle and a searchable, cascading filter.
Type reads in the sheet's own words — Paper, Raw Material, Packing Material, Cartage, Software,
Provision Ink, Other Ink, Service Expense, alongside the original Ink / Spare Parts / Heads /
Machine / Others. Narrow Type to Paper and the Category list collapses from 96 values to the 2 that
actually hold a paper. The edit form gained a **Category** and an **Ink type** picker, and both new
columns come out in the Excel export and go back in through Import.

**What moved in the data.** 2,536 rows changed type — among them **926 papers that were filed as
"other"** and **219 raw materials filed as "ink"**. Category filled 13,220 rows, Ink type 1,673.
`mst_items` stayed at 14,267: only columns were touched, never the item list.

**The vocabulary widened from 5 to 13, and the five original keys did not move.** `ink`,
`spare_parts`, `head`, `machine`, `other` are the strings receivables-hub uses for `SaleType`, so
item and revenue can still be joined without a translation table. The 13 → 5 map lives in exactly one
place — a `saleType` field on `ITEM_TYPES` in
[liveMasters.ts](frontend/src/core/platform/liveMasters.ts) — which is what lets a sales order say
PAPER while the ledger still reports `other`. **OD-7 reads the 13 for its filter and the 5 for its
join.** Receivables itself never touched: its sale type is resolved in ConnectWave off the bill-name
prefix.

**Category is not the Tally stock group**, however much it reads like one — only 858 of 13k rows
agree with their own group, and just 40 of the 96 category names are group names at all. It is a real
middle layer between Type and Group.

**The join collapses runs of whitespace and nothing else.** Every other character, case included,
must match exactly. **15 names in the sheet carry a line break inside the cell** — Excel wrapped them
— and one has a doubled space; character-exact, those 16 read as "the sheet does not know this item"
when the truth was "the cell is wrapped". Deliberately *not* the punctuation-insensitive match that
would equate `LRS-600-36-MEANWELL` with `LRS-600-36,MEANWELL`; nobody confirms this join, so it stays
conservative.

**It is re-runnable, and that was proved rather than promised.** A staging table
`mst_item_sheet_import` plus `mst_apply_item_sheet()`; a revised sheet goes in with
`node supabase/itemsheet/load-item-sheet.mjs`. Re-running an unchanged sheet reports **0 rows
changed** and moves no `updated_at` — that is what the `is distinct from` guard is for. A blank cell
leaves the existing value alone rather than clearing it, so a gap in a future sheet cannot wipe a
hand-correction. **The rollback was rehearsed on live data**: load → `restore-snapshot.mjs --apply`
→ load again, landing on identical counts both times.

**Two migrations.**
[20260921120000](supabase/migrations/20260921120000_item_sheet_type_category_ink.sql) widens the
CHECK, adds the two columns and installs the loader machinery.
[20260921120100](supabase/migrations/20260921120100_reconcile_merge_carries_category.sql) teaches the
reconcile merge to carry the new columns — `mst_apply_reconcile_link` enumerates every column the
survivor absorbs, and one not named there is lost on every merge.

⚠ **No re-seed, ever again.** `20260902121300` re-seeded every row and warned it was "ONLY SAFE
TODAY" because nobody had hand-corrected a type yet. That is now false. `mst_guess_item_type()` and
its INSERT-only trigger are left alone — they still return five of the thirteen, all valid, so a new
Tally item classifies itself and the next sheet load refines it.

⚠ **Every Masters Excel export taken before 2026-08-21 is stale for the Type column.** The importer
matches a dropdown **by label**, so re-uploading an old sheet would silently push all 926 papers back
to "Others". Export fresh before editing.

**Still open, and deliberately not in this task:**
- [ ] The **608 items the sheet does not name** — `PROVISION FOR INK - AADESH`,
      `RECEIVABLE HANGLORY-RAMANUJ`, bare part codes. They keep whatever they carried; nothing was
      blanked and nothing guessed. Listed in `supabase/itemsheet/unmatched.txt`. Leave them on the old
      guess, or work the list down by hand?
- [ ] The workbook's **second sheet, "ink-item mapping"** — 505 rows of PARTICULARS NAME → ITEM
      MAPPING plus a COLOR column, 180 of which rename the particular to a different item name. That
      is an ink naming-alias problem, not a classification one.
- [ ] **2 sheet names have no item at all**: `444-011 INK TUBE(6*3.2)` and `444-030 RESISTANCE
      ADJUSTED SOLID VOLTAGE REGULATOR`.

---

### PE-4 · FG Item Lot Number on the repackaging slip, carried through every step  `[x]`
*Production Entry · **Done 2026-08-21, 13:52 IST** (database) · frontend on master, Vercel deploying*

A repackaging card is a **traded** finished good — imported ready-made, repacked, sold — so it
arrives with a lot number of its own, the supplier's lot printed on the goods. That is what
traceability actually hangs off, and there was nowhere to record it.

**What a user sees now:** on the **Repackaging** tab of Generate Issue Slip there is an **FG Item
Lot Number** field directly after *FG / Packing Quantity*, and it is **mandatory** — the slip
cannot be raised without it. From there the number is read-only and follows the card: the header of
**every step's** modal (packing material transfer → packing entry → ready to dispatch → FG
transfer), an **FG Lot No.** column on those four queues, the card detail page, and the printed and
exported repackaging slip.

**Two different numbers, deliberately both shown.** `jobcard_no` is the Lot/Batch **Card** number
this system allocates (YYMM-NNNN). `fg_lot_no` is the lot the goods came in with. Not
interchangeable, and the labels say so.

**Mandatory is the database's rule, not the form's.**
[20260925120000_fms_production_repack_fg_lot_no.sql](supabase/migrations/20260925120000_fms_production_repack_fg_lot_no.sql)
adds the column and re-issues `fms_production_submit_request` / `fms_production_update_request`;
both reject a blank lot on a repackaging slip.

**The column is nullable on purpose.** The **14 repackaging cards already in the system** have no FG
lot and inventing one would be a lie; NOT NULL would also have blocked their next edit for a field
nobody could have entered. All 14 are still at *awaiting PM transfer*, so all 14 are still
editable — **opening one for edit now asks for the lot before it will save.** That is the intended
moment to supply it, but it is a change anyone editing an old repack card will meet.

**Production cards are untouched.** A manufactured lot has no incoming FG lot (its raw-material lots
are per-line in `mh_bom_lines.lot_no`), so the queue column appears only where a card in view
actually has a lot — the same rule the Status column already follows.

**Two things deliberately left out**, both worth a line if anyone asks: the FG Transfer confirm
popup still says only "*N* job cards will be closed" and names no cards (it never named them); and
the number is not a column on the registers (All Issue Slips / My Requests), which are lists, not
steps — that is where it would go if someone wants to *search* a card by its FG lot.

### OD-6 · Every save in Order to Dispatch was slow — the write was fast, the reload after it was not  `[x]`
*Order to Dispatch · **Done 2026-08-21, 13:35 IST** (database) and **14:05 IST** (the app, on `master` at `74a525b`) · Raised by Bushra*

Reported on the master request and on the bill step after the Tally bill is attached. It was neither
screen: **all 23 write paths** behaved this way, Setup included. Saving was never the slow part —
`fms_dispatch_record_sales_bill` averaged **70 ms**. What the user waited for was the module-wide
reload the client awaited afterwards, traced end to end at **6.1 seconds** (daily maxima 20–24 s).

**What a user sees now:** Save closes the moment the write lands. The screen behind it catches up on
its own. The reload it used to wait for has itself dropped from **6.1 s to ~1.4 s** (four browser
runs: 1,278 / 1,448 / 1,773 / 903 ms).

**Two causes, both fixed.**

1. **The visibility check ran once per row, per table, per page.** `fms_dispatch_can_see_order` is
   `SECURITY DEFINER` *with* `SET search_path`, which makes it non-inlinable — so it ran as a real
   function call for each of ~475 orders, every call doing `has_role` + a config jsonb scan + a
   step-owners scan. Five tables reached it. On top, each table's `*_write_admin` policy was declared
   `FOR ALL`, so an un-wrapped `is_admin(auth.uid())` was ORed into every SELECT as well. Across all
   475 orders there are exactly **four** distinct `(location_id, raised_by)` pairs — four possible
   answers, computed some five thousand times a reload.
   Migration [20260924120000](supabase/migrations/20260924120000_dispatch_visibility_hoisted.sql)
   hoists every row-independent arm into an InitPlan and has the dependent tables ask only *"is my
   parent row visible"*, so the rule is stated once. Measured under live RLS, worst-case persona:

   | | before | after |
   |---|---|---|
   | `fms_dispatch_orders` | 280 ms | **6.1 ms** |
   | `fms_dispatch_order_items` | 758 ms | **7.8 ms** |
   | `fms_dispatch_rounds` | 2,207 ms avg | **4.3 ms** |
   | `fms_dispatch_round_items` | 1,074 ms | **8.7 ms** |
   | `fms_dispatch_activity` | 752 ms | **4.9 ms** |
   | `fms_dispatch_notifications` | 384 ms | **3.3 ms** |

2. **The modal waited for the reload.** Every store action ended `await invalidate()`, and TanStack
   Query resolves that only once the query has refetched. It no longer waits.

**Nobody's visibility changed, and that was proved rather than asserted.** Four personas — a step
owner who raised nothing, a heavy raiser, an admin, and a user with no dispatch access — were counted
across all six tables before and after, with an **id-set checksum** alongside each count so an
equal-sized but different set could not slip through: **24 counts and 24 checksums, identical**,
checked three times (after apply, after rollback, after re-apply). Separately, the old function and
the new predicate were compared for **every user against every order — 28,680 pairs, 0 mismatches**.
That query is kept at the foot of the migration as the standing regression check, because the rule now
lives in two places (`fms_dispatch_announce` still calls the function).

**The rollback was rehearsed, not just written.** It was executed against live data, confirmed in
force (round_items back to 1,074 ms) with visibility unchanged, then the migration was re-applied.

**Also fixed on the way:** the bell's "mark read" `PATCH` (662 ms avg, 2,796 ms max) paid the same
per-row cost and is wrapped too; the paged reads now fetch their pages **concurrently** instead of one
after another (`mst_items`' nine chunks went from ~700 ms serial to a **14 ms** burst); and the bell
now fetches only the signed-in user's notifications instead of the whole table — the store discarded
everyone else's rows anyway, and an admin was pulling all 5,296 of them on every save.

Both halves are live: the migration was applied first, then the app followed on `master` at
`74a525b`. That order matters and is the rule here — the policies only make the existing reads
faster, so the app was safe either way, but a frontend that needs a migration must never land first.
See **OD-8** for the one optimisation deliberately left out.

### PF-5 · Module access gets a level: view-only, or view and edit  `[x]`
*Platform — all modules · Admin / Users · **Done 2026-08-20, 22:19 IST** (the screens went live 2026-08-18, 13:52 IST) · Raised by Bushra*

Live on `master` at commits `d04e9c4` (the screens) and `cd3b69d` (the database half).

A module grant used to be all-or-nothing: anyone who could open Procurement could also raise,
approve and manage its masters. There was no way to hand someone an app to **look at**.

**Admin → Users** and **Admin → Module Access** now offer three levels per module — **No access ·
View only · Full access**. On the user form each module is a row of three pills; on the matrix a
click cycles the cell (empty → eye → tick), with a legend above it. Both screens also set several
modules at once: an **All modules** row at the top, and the same three choices on every category
heading, so "all of Purchase, read-only" is one click rather than three.

**Nobody lost anything.** All 171 grants that existed became Full access as the column was added —
the default is `edit`, so any code that inserts a grant without naming the level still means what it
always meant.

**What a view-only person sees:** the app opens from the launcher as before, every queue, register
and report loads with its real data, and sorting, filtering and the Excel export all still work.
What is gone is every add, edit, delete and action button — across all eleven apps, including the
places that do not go through the shared table: the recruitment kanban's drag-and-drop and its bulk
"share CVs" bar, Employee Exit's six case panels, Order to Dispatch's "Correct" amend editor, the
FG-transfer bulk bar, and Asset Maintenance's "Log reading". A **View only** badge sits in the top
bar so the missing buttons read as a setting rather than a fault.

**It is enforced by the database, not just by the screen.** Every one of the 35 FMS write
predicates — the `_can_act`, `_is_step_owner`, `_is_master_manager` and `_can_raise` functions that
the ~250 stored-procedure guards and every master-table write policy funnel through — now also
requires `edit`. Hiding a button only stops an accident; this stops someone who opens the browser's
developer tools and calls the API directly.

**Worth knowing if you touch this again:**

- **Reads were deliberately left alone.** The gate sits on the write predicates only. Every master
  table whose write policy uses one of them also carries an open `SELECT` policy, and no report or
  snapshot function calls them — so a view-only user keeps the whole app readable. Do not fold the
  level into `canActOn` or `canSeeQueue` in the app stores either: those two also decide which rows
  and queues a person **sees**, and gating them empties the app instead of freezing it.
- **Admins are never affected.** They hold no `app_access` rows at all, so the level cannot apply to
  them. That is also what keeps every Settings screen out of scope — they are already admin-only.
- **The Mobile App offers only No access / Full access.** It is offline-first: an edit made with the
  buttons hidden would still be replayed by the sync queue when the phone came back online, and its
  lead tables check only "is this your own row". A view-only tier there would be a promise the app
  cannot keep. Remove it from `NO_VIEW_ONLY_APP_IDS` once those write policies consult
  `module_level()`.
- **View only wins over step ownership.** Someone who is a step owner or process coordinator in an
  app they hold view-only still sees its queues and still gets its emails, but cannot act on a row.
- **19 step-owner assignments name people with no grant on that module** (HR Exit, Recruitment,
  Import, General Purchase, Production). Pre-existing, not caused by this — they already could not
  open those apps — but worth tidying in Admin.

### OM-1 · Organisation masters: department, sub-department, designation and band  `[x]`
*Admin / Masters · Raised 2026-08-20 · **Done 2026-08-20, 09:35 IST** · From Bushra's employee sheet + the band categorisation sheet*

Live on `master` at commit `ef2de41`.

The user master held one organisational fact — department — and that list had drifted: of its 21
rows several were really sub-departments (`After Sales - Application`, `Spare Warehouse`,
`Travel Desk`) and one was `new test dept`. Designation was free text, so `Deputy GM`, `DGM` and
`Deputy General Manager` were three spellings of one rank. There were four lists' worth of facts in
HR's sheet and room for one.

**Admin → Organisation** (replacing the old Departments screen, whose URL still redirects) now
carries four tabs on the shared `MasterCrud`, so each sorts and filters on every column and takes
an Excel round trip:

- **Departments** — 12 active, 11 switched off. An **In which list** column says whether a row came
  from the portal, HR's sheet, or both.
- **Sub-departments** — all 38 from the sheet, each under its parent.
- **Designations** — 27 canonical rungs, replacing 31 free-text spellings.
- **Bands** — the 9 from the band sheet, Support Staff through Top Leadership.

The user form gained **Employee code**, **Sub-department** (which offers only the chosen
department's own — pick Sales and you see its 4, not all 38), a **Designation** picker in place of
the free-text box, and **Band**. The Users list filters on all four and the Excel export carries them.

**Every user was mapped:** all 57 have a designation and 56 a band; 44 have a sub-department and an
employee code. 15 people moved to the department HR's sheet records, and the 11 departments that
emptied were switched off.

**Worth knowing if you touch this again:**

- **A department is switched off, never deleted.** It is the parent of 5,213 tasks, 195 recurring
  tasks, 45 HR job titles, 12 requisitions and the `department_ids` on nine FMS step-owner tables.
  Switching off hides it from the pickers that make NEW references and leaves every existing one
  readable — the 11 retired rows still hold 132 tasks between them. The old screen had a Delete
  button with no FK guard at all; it is gone.
- **Two departments are the same team under different names** — `Accounting & Finance` is HR's
  "Finance", `Human Resources` its "Human Resource". They are ONE row each, tagged "both lists",
  with `hr_sheet_name` recording the equivalence; the sub-department seed resolves its parent
  through it. Inserting them as fresh rows would have put two live departments meaning one team
  side by side in every picker.
- **Band is independent of designation** and must stay so — several designations share a band, and
  there is deliberately no `band_id` on `designations`.
- **`profiles.designation` (text) is kept and must stay in sync with `designation_id`.** It is not
  a leftover: `list_org_people()` returns it and every @mention picker renders it. Write both.
- A `guard_profile_org_fields` trigger stops a non-admin setting their own department,
  sub-department, designation, band or employee code — `profiles_update_own` gates the row, not the
  columns, so this was reachable straight through PostgREST. The Account page's designation box is
  read-only for the same reason.

**To discuss with Bushra**

- [ ] Ten people joined after her 27-05-2026 sheet and so have no sub-department or employee code:
      Aayush Rathi, Karan Toshniwal, Bharat, Christie Shoham Joy, Kaushal Pawar, Khushi Soni,
      Saloni Rathod, Shweta Chanchad, Sushil Kumar Thakre, Yash Agarwal. *(Designation and band are
      already set for all ten.)*
- [ ] **HR Head → Band 8** was a judgement call — the band sheet has CHRO at 9 and "Business Head"
      at 8, and names neither. Affects Riya Kumari only. Parked as good enough for now.

### RC-1 · Group the bill-wise details by sale type  `[x]`
*Outstanding Dashboard · Raised 2026-08-20 · **Done 2026-08-20, 14:13 IST** · Feedback from Ritesh Bhai*

Live on `master` at commit `ff6dddb`.

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
