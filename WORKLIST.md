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

All three below need a conversation with Bushra before any code moves.

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

### OD-4 · SO-2627-0413 names the wrong copy of SPECTRUM DIGITAL  `[!]`
*Raised 2026-08-20 · **Blocked:** needs Bushra's confirmation before the row is touched*

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

### RC-2 · Send the report automatically, Saturday 08:00  `[~]`
*Raised 2026-08-20 · Depends on the server-side report builder*

**In progress.** Two pieces have landed since this was raised: a weekly schedule can now name more
than one day (`17bad6a`), and the report's KPI numbers and card wording have moved out of the React
page (`3ca9e7d`) — that second one is the "lift the report's definition out of the screen" phase.
The builder, the cron and the send log are still to come.

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

### RC-4 · The "Live (Tally)" toggle can switch to a database that no longer exists  `[ ]`
*Raised 2026-08-20 · Found while building RC-2*

The hub's admin-only **Live (Tally)** switch has two positions. Live — the default — reads the
ConnectWave mirror and works. Turning it **off** selects the legacy pipeline project
`lkwtvcpeamkzzqkfnkuc`, and **that project no longer exists**: its hostname does not resolve at
all. So the off position is a dead end that nobody has walked into recently because Live is the
default.

**What a user would see:** every receivables screen failing to load, with a network error rather
than anything that explains itself. Admin-only, so the blast radius is small — but it is a trap
sitting in the product.

**Notes:** the switch is [liveMode.tsx](frontend/src/apps/receivables-hub/lib/liveMode.tsx), feeding
[sourceContext.tsx](frontend/src/apps/receivables-hub/lib/sourceContext.tsx). The dead path is
`loadFromSupabase` in [useAppData.ts](frontend/src/apps/receivables-hub/lib/useAppData.ts), via
`supabaseFetcher.ts` and `receivablesSupabase.ts` on `VITE_RECEIVABLES_SUPABASE_URL`. The external
Python pipeline that fed it (separate "Orange Receivables Hub" repo) is out of the picture too.

**To decide:**
- [ ] Remove the toggle outright, or keep it and have it fail with a sentence a human can read?
- [ ] If removed: delete `supabaseFetcher.ts` / `receivablesSupabase.ts` and the `VITE_RECEIVABLES_*`
      env vars with it, or leave them dormant?
- [ ] Is there anything in the legacy project worth keeping before the account is tidied up?
- [ ] Does the static-JSON (`local`) source still earn its place, or go the same way?

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

Four rules, so the section stays worth reading:

- **Stamp the date and time it shipped**, in IST, on the entry's italic line — the moment it went
  live, not the moment the code was written. Two tasks finished on the same day still read in
  order, and a question like "was this in yesterday evening's deploy?" has an answer.
- **The ID and the module travel with it.** RC-1 stays RC-1, so a note or a message that referred
  to it while it was open still resolves.
- **Say what a reader will now see**, not which lines moved. Someone scanning this wants to know
  what changed for them; git holds the diff.
- **Delete the open entry in the same edit.** A task listed in two places is a task nobody trusts.

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
