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

**Last updated:** 2026-08-22

Separate, and not repeated here — the two live operation logs keep their own detail:
[CENTRAL-MASTERS.md](CENTRAL-MASTERS.md) (Tally masters consolidation) ·
[RECEIVABLES-SCHEDULED-EMAIL.md](RECEIVABLES-SCHEDULED-EMAIL.md) (scheduled collection emails)

---

## Waiting for

Work held up because someone owes us something. If a task is late, this is the first place to look.

| What we need | From | Blocks | Waiting since |
|---|---|---|---|
| WhatsApp access, so the integration can start | WhatsApp team | **PF-10** | 2026-08-22 |
| The calibration sheets (the Excel report QC keeps today) | Factory / QC team | **PE-1** | 2026-08-20 |
| The final list of production steps to add | Factory, then Bushra | **PE-2** | 2026-08-20 |
| The R&D flow and the form | Factory team | **RD-1** | 2026-08-20 |
| The COA sample PDF + the raw Excel sheet | Factory team | **PE-3** | 2026-08-20 |
| A walkthrough of Asset Maintenance, to list its changes | Bushra | **AM-1** | 2026-08-20 |
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

### PF-6 · 🔴 A view-only user gets the module dashboard and nothing else  `[~]`
*Raised 2026-08-21 · **Order: Order to Dispatch first as the pilot**, then the rest · Follows on from
**PF-5**, which shipped the view/edit level itself*

We can now grant a module at **View only** instead of full access. The intent is written into
[session.tsx](frontend/src/core/platform/session.tsx) in as many words — *"a view-only user opens the
app normally and reads every screen in it, they simply have no buttons"*. **That is not what
happens.** They land on the module dashboard and can reach nothing else.

**Why.** Inside every FMS, *which screens exist* is decided by **ownership config**, never by the
module grant: `fms_<mod>_step_owners` → the queue links and their route guards,
`process_coordinators` → the Control Center, `fms_<mod>_master_managers` → Masters. A view-only user
owns none of these. Nothing anywhere in the read path consults `app_access` at all.

It is not only a nav problem. In four modules the **data itself** is ownership-scoped by RLS, so
even with the routes open the tables would come back empty.

**What the audit found** (2026-08-21, all nine FMS modules) — three things that decide the shape of
the work:

1. **Only four modules need SQL.** Procurement, Import, Sampling, Production Entry and Asset
   Maintenance already read `for select using (true)` — nothing to widen. Dispatch, New Recruitment,
   Employee Exit and General Purchase each funnel every gated table through **one** function, so it
   is about six SQL edits rather than forty.
2. **There is no single lever in the frontend.** `canSeeQueue` exists in only five of the nine.
   Procurement and Import use twelve flat per-step capability flags; the two HR modules have **no
   route guards on their queue routes at all** and self-guard inside each page.
3. **About 25 action buttons are gated by ownership with no write-ceiling test** — see **PF-7**,
   which is that half.

**The decisions, taken 2026-08-21:**

1. **View-only unlocks the whole module.** An `edit` grant keeps today's ownership-driven
   visibility, so **nothing changes for anyone working in the modules now.** This does mean a viewer
   sees more screens than an editor who owns no step — accepted, and to be written into the code so
   the next reader does not "fix" it.
2. **Operational screens only.** Dashboards, lists, registers, queues, Masters lists, Master
   Requests and the Control Center. Setup and configuration stay admin-only — that is where
   permissions themselves are set.
3. **HR and Exit: the operational tier only.** A viewer reads requisitions, candidates, exit cases,
   clearance and handover. The three confidential satellites keep their existing narrow gates —
   **candidate PII**, **exit-interview transcripts**, **F&F settlement amounts**. Note
   `20260712180000_fms_hr_restrict_candidate_pii.sql` exists precisely to stop a wide HR read
   leaking PII; whether its function *is* the PII protection or merely sits beside it has to be
   settled before that module is touched.
4. **Pilot Order to Dispatch, verify on a real view-only login, then roll out.**

**Two that come free with it:** the FMS Control Center lists a viewer's modules but every row
click-throughs to `/<app>/monitoring`, which is behind the coordinator guard — so today
non-coordinators hit Access Denied from a link the page offered them. And **New Customer
Onboarding** carries the same `canSeeQueue` gate and is in scope with the FMS modules.

**Not in scope, deliberately:** the My Work feed. It filters on `hasModule` and no provider consults
the write ceiling, so a view-only user who is *also* a step owner gets an actionable worklist. That
is not a regression — they were made an owner — and the fix is constrained, because
`mywork/items/README.md` forbids filtering in `providers/` and the same builders are bundled and run
server-side for the 9am snapshot email. Filing it rather than bolting it on.

**Deploy ordering:** the migration goes in **before** the frontend, or the newly-visible queues
render empty.

---

### PF-8 · Give the other FMS modules the treatment Dispatch just had  🟢  `[ ]`
*Raised 2026-08-21 · **not blocked** · **low priority on purpose** — nobody is waiting on it and no
module is hurting today. Pick it up when there is room, or when one of them starts to feel slow.*

**OD-6** and **OD-8** fixed Order to Dispatch: a save went from a 6-second wait and ~5 MB of traffic
to instant and 126 kB. Neither problem was unique to that module — **the shape is the house pattern,
and every FMS module has it.**

Counted on 2026-08-21, every write path that ends by re-downloading its whole module:

| Module | Write paths that refetch everything |
|---|---|
| Procurement | **58** |
| Import | **56** |
| Sampling | **43** |
| HR Recruitment | **39** |
| Office Supplies | **29** |
| Asset Maintenance | **23** |
| Production Entry | **12** |

**Why this is 🟢 and not 🔴.** Only Dispatch carried 5 MB, because it is the only module that loads
the full customer/item catalogue — its pickers need it. Every other module's largest table is **701
rows**, and their reads run 120–220 ms. They re-download a few hundred KB per save, which nobody
notices and Supabase barely feels. That is the whole reason this waited.

**What to reuse when the time comes** — Dispatch is the worked example, and each piece stands alone:

1. **Check the RLS shape first, before anything in the app.** Dispatch's real problem was a policy
   calling a non-inlinable `SECURITY DEFINER` function per row. Supabase's own advisor flags this
   across the project (`auth_rls_initplan`, 257 warnings; `multiple_permissive_policies`, 233). See
   [20260924120000](supabase/migrations/20260924120000_dispatch_visibility_hoisted.sql) for the
   rewrite and, more importantly, for how it was proved not to change who sees what.
2. **Stop the modal waiting on the refetch** — the one-line change that users actually feel.
3. **Split the query key** so a save stops re-pulling masters that cannot have changed.
4. **Trim `select("*")`** to the columns the mappers read.
5. **Fetch per-row detail on demand** rather than carrying every row's history in the snapshot.
6. **Ask only for what changed** — but only where the payload justifies it, and only on top of a
   trigger that makes the parent's timestamp trustworthy
   ([20260926120000](supabase/migrations/20260926120000_dispatch_children_touch_parent_order.sql)).

**Do not do all six everywhere by rote.** On these modules, 2 and 3 are cheap and probably sufficient;
5 and 6 buy little against a 701-row table and carry real risk. Measure the module first — bytes and
requests for a cold load and a save — and stop when the number stops being embarrassing.

**One thing already fixed for everyone, not just Dispatch:** sign-out now clears the persisted
IndexedDB cache. It never did, so a signed-out browser kept the last user's receivables payload and
staff directory on disk for 24 hours, readable through devtools without logging in. That shipped with
**OD-8**.

---

**Shipped 2026-08-21 (frontend + both migrations applied to `icutjkrqkbzwvmnfbzpr`):**

**⏳ AWAITING KRITIKA'S FEEDBACK — do not close this until she has actually used it.**
*Remark added 2026-08-21.* Built, migrations applied, `npm run build` green, and the read gates
verified against her real account in SQL — but **nobody has signed in as her and clicked through
yet**, which is the only test that counts. She holds view-only on eleven modules and is the person
who reported this, so she is the reviewer.

What to ask her to check, module by module: the sidebar shows the queues, the register and the
Control Center; every one of those pages **opens with rows in it**, not empty; there are no action
buttons, no row checkboxes and no Add; the **View only** badge shows in the topbar; and Setup is
still refused. If a screen opens empty, that is a read gate, not a nav gate — say which screen and
which module.

**The HR candidate question below is PARKED, not open.** New Recruitment ships as it is — vacancies
and MRF queues readable, candidate boards hidden. Revisit only if Kritika says she needs them.

**Mark this task `[x]` and move it to [Done](#done) once she confirms**, adding the commit and the
IST timestamp — same rule as every other entry there.

`session.isModuleViewer(appId)` is the one place that knows. Each store derives the
VISIBILITY halves from it — `canMonitor`, `canSeeMasters`, `canSeeStep`, and the viewer arm on
`canSeeQueue` — and the AUTHORITY flags (`isProcessCoordinator`, `canActOn`) are untouched,
because widening those would have handed a viewer act-authority rather than a read.

| Module | Screens opened | SQL needed |
|---|---|---|
| Order to Dispatch | queues, register, Control Center | yes — `20260925130000` |
| Production Entry · Sampling · Asset Maintenance | queues, Masters, Control Center | none (already `using (true)`) |
| Purchase RM Domestic · Purchase RM Import | 11 queue routes, Masters, Control Center | none |
| General Purchase | queues, Masters, Control Center | yes — `20260925130100` |
| Employee Exit | approvals, clearance, Masters, Control Center, documents | yes — `20260925130100` |
| New Recruitment | MRF + job-posting queues, Masters, Control Center | yes, **vacancy tier only** — see below |
| New Customer Onboarding | the four back-office queues | none |

**Verified on live data:** General Purchase 8/8 requests visible to a viewer, New Recruitment
13/13 requisitions, candidate tier still 0, F&F still 0. The dispatch equivalence check reports
0 mismatches across 1,500 (user, order) pairs.

**⚠ NEW RECRUITMENT IS HALF-OPEN, AND THAT NEEDS A DECISION.** `fms_hr_can_read_requisition`
turned out to *be* the candidate-PII gate, not merely a visibility rule that covers candidates —
closing a PII hole is the whole reason it exists (`20260712180000`). So `20260925130100` widens a
sibling, `fms_hr_can_view_requisition`, used only by the requisition tables, and leaves the PII
gate alone. A viewer reads the vacancies and the MRF queues; the candidate boards stay hidden
rather than opening empty, and the frontend matches.

- [ ] **PARKED 2026-08-21** — revisit only if Kritika asks for it. Should a view-only holder
      read candidates at all? If yes, the answer is a **masked
      projection** — stage, dates and counts without name, phone, email, CV or expected salary —
      which is its own piece of work with its own call on which columns count as PII. Widening
      the existing function is not an option; an assertion in the migration now refuses it.

**Not in scope, deliberately:** the My Work feed. It filters on `hasModule` and no provider
consults the write ceiling, so a view-only user who is *also* a step owner gets an actionable
worklist. Not a regression — they were made an owner — and the fix is constrained, because
`mywork/items/README.md` forbids filtering in `providers/` and the same builders run server-side
for the 9am snapshot email.

### PF-7 · About 25 action buttons are gated by ownership alone, with no write-ceiling test  `[x]`
*Raised 2026-08-21 · Found while auditing **PF-6**, and it ships with it · **Moves to
[Fixes](#fixes) when it lands** — several of these are live faults, not new work*

A write affordance is supposed to ask `canEdit` (the module write ceiling) as well as "is this step
mine". Roughly 25 do not, and **several leak today**, before any of PF-6:

- **Two store-level root causes.** `canManage` in **Employee Exit** and **New Recruitment** omits
  `canEdit` entirely — the other seven stores fold it. That is every `MasterCrud` Add/Actions column
  plus Approve/Reject on two `master-requests` routes that are already ungated.
- **Twelve capability flags** in Procurement and Import are bare `isStepOwner(...)` and feed the
  buttons as well as the routes, so the nav and the write gate are the same flag.
- **Individually:** the sales-return buttons in Dispatch, `JobDetail` in Asset Maintenance,
  `RequestDetail` in Production Entry, the Ready-to-Dispatch **bulk-action bar** (a viewer gets row
  checkboxes), `requestEditable` in General Purchase, the Decide/Post modals and stage-change menu in
  New Recruitment, and the four decision modals behind the Exit approvals queue.
- **Two with no gate at all:** candidate tag add/remove, and the **AI CV read** — which writes *and
  spends money*.


**Fixed 2026-08-21, alongside PF-6.** Two store-level root causes and the call sites:

- **`canManage` in Employee Exit and New Recruitment** now folds `canEdit`. It did not, so every
  `MasterCrud` Add/Actions column and Approve/Reject on both modules' **ungated** `master-requests`
  routes was live on a view-only grant. Both stores also needed `canEdit` **moved up** — `canManage`
  is called synchronously by `resolvableRequests` above where `canEdit` was declared, so folding it
  in without moving it is a temporal dead zone and the store throws on first render.
- **The twelve `isStepOwner` capability flags** in Purchase RM Domestic and Import now fold
  `canEdit`, which makes them authority; the new `canSeeStep(k)` is what the nav and `RequireCap`
  read. One flag was doing both jobs.
- **New Recruitment's completed entries** — `canEdit` on every `StageEntry` came from ownership
  alone and drove `CompletedTable`, i.e. every Completed tab in the app. The ceiling now applies
  once, at the `completedFor` boundary, so the next branch added is honest by default.
- **Call sites:** the sales-return buttons in Dispatch, `JobDetail` in Asset Maintenance,
  `RequestDetail` and the Ready-to-Dispatch **bulk-action bar** in Production Entry, `RequestQueue`
  and `requestEditable` in General Purchase, the Exit approvals queue, and in New Recruitment the
  Decide/Post modals, the interview actions and the stage-change menu.
- **Two that asked nothing at all** — not even ownership: candidate **tag** add/remove, and the
  **AI CV read**, which writes a score *and spends money* on every press. Both now gate at the
  write itself, and the AI button no longer renders for a viewer.

**One more found while sweeping, and it was a genuine drift.** Customer Onboarding's client
`canActOn` carries a comment saying it mirrors `public.fms_customer_can_act` — but
`20260923120000` wrapped the SQL side in `module_can_edit` and this copy was never updated. Every
correction and step button rendered live on a view-only grant and then failed at the RPC. The
mirror is restored.

**The fix is uniform:** `canEdit && <existing predicate>`, matching the reference implementations in
`production-entry/components/StageQueue.tsx` and `sampling/components/RequestQueue.tsx`. Where a
`QueueTable` wraps the buttons, `readOnly={!canEdit}` does it in one line — it drops the actions
column *and* the whole row-select apparatus. Of 70 `QueueTable` sites across these apps, **three**
pass it today.

⚠ One deliberate counter-example not to "fix": the Completed table in
`sampling/components/RequestQueue.tsx` omits `readOnly` on purpose, so the row action degrades to a
lock that still opens the entry read-only. The comment above it says so.

---

### PF-9 · Browser notifications, on top of the bell and the emails  `[ ]`
*Raised 2026-08-21 · Touches every module that has a bell*

We already notify at two points: the **in-app notification bank** (the bell in the topbar) and
**email**, wired at each step. Both need the person to come looking — the bell only speaks once
they open the portal, the email only once they open their inbox. Add a third: while the portal is
open in a browser tab, a **native OS notification** fires the moment something lands for them, so
they see it without watching the tab.

Scope for this item is **foreground only** — the tab is open. Notifying a user whose browser is
closed is a different, much larger job (see *Later* below); do not let it hold this one up.

**What already exists, and what has to be built**

- The bell's payload shape is already shared and already the right one to notify from:
  `NotificationItem` in
  [types.ts:52-64](frontend/src/shared/components/layout/types.ts#L52-L64) — actor, message,
  `createdAt`, `unread`, and `to` for the click-through. A browser notification is that same
  object rendered by the OS instead of the panel, so nothing new has to be composed.
- **Only ONE of the feeds is live.** The task feed subscribes to `postgres_changes` on
  `notifications` in
  [useMyNotifications.ts:70-85](frontend/src/apps/task-management/lib/useMyNotifications.ts#L70-L85)
  — the **only** `.channel()` call in the entire frontend. The ten FMS
  feeds (`fms_exit_notifications`, `fms_hr_notifications`, `fms_import_notifications`,
  `fms_purchase_notifications`, `fms_supplies_notifications` and the per-module reads in each
  app's `*Fetch.ts`) arrive only with the module payload, on load or after a write. **A browser
  notification needs a live signal, so the realtime subscription is the real work here, not the
  notification API.** Doing it feed-by-feed means ten subscriptions and ten near-identical
  hooks — decide first whether the FMS feeds should be read through one place (a union view, or
  one table) rather than replicating the task app's hook ten times.
- There is no service worker and no web app manifest ([frontend/public/](frontend/public/) holds
  only `assets`), and none is needed for the foreground case.

**How to build it** (the mechanics, so this isn't re-derived later)

1. **One hook, `useBrowserNotifications`,** sitting beside the bell rather than inside any module.
   It takes the same `NotificationItem[]` the bell already renders and fires the ones that are new
   *since mount*. Fire on arrival, not on read.
2. **Ask for permission from a real click, never on page load.** `Notification.requestPermission()`
   returns `granted` / `denied` / `default`, and **`denied` is permanent** — the page cannot ask
   again, the user has to undo it in the browser's site settings. So it goes behind an explicit
   "Enable desktop notifications" toggle on [Account.tsx](frontend/src/core/account/Account.tsx),
   with the current permission state shown and a line telling a denied user where to re-enable it.
   An auto-prompt on load is how people click Block by reflex and lose the feature for good.
3. **Fire it:** `new Notification(actorName, { body, icon, tag: n.id, data: { to } })`, and on
   `onclick` call `window.focus()` then route to `n.to`. Requires HTTPS — Vercel is, and
   `localhost` counts as a secure context, so dev works too.
4. **Only when the tab isn't already being watched.** Gate on
   `document.visibilityState === "hidden"` (or the window not focused) — if the user is looking
   at the queue, the bell and the row updating in place already told them, and an OS toast on top
   is noise.
5. **Never notify someone about their own action.** The feeds carry `actorId`; skip rows where it
   is the signed-in user, or a person who approves ten items gets ten toasts about themselves.
6. **Dedup across tabs.** Two open tabs = two subscriptions = the same event twice. `tag: n.id`
   makes the OS collapse them into one visible toast, which is enough to ship; a `BroadcastChannel`
   leader election is the clean fix if it turns out to matter.
7. **Don't fire the backlog.** On mount, seed the "seen" set from whatever the first fetch returns
   and only notify on rows after that — otherwise opening the portal with 30 unread items detonates
   30 toasts at once.

**Later, and deliberately not now:** notifying a user whose browser is *closed* is Web Push — a
service worker, `PushManager.subscribe` with a VAPID key pair, a `push_subscriptions` table, and an
edge function that fans out on every notification insert. It is a real project of its own, it needs
the same per-user opt-in, and it duplicates what the email already does today. Revisit only if
people say the emails aren't landing. One caveat worth knowing early: **Chrome on Android refuses
the plain `new Notification()` constructor** and throws — mobile needs the service-worker path even
in the foreground. Desktop Chrome, Edge, Firefox and Safari are all fine, so if the coordinator and
the HODs are on laptops, step 1–7 above covers them.


### PF-10 · WhatsApp integration  `[!]`
*Raised 2026-08-22 · **Blocked:** waiting on the WhatsApp team*

Notify people over **WhatsApp**, alongside the in-app bell and email (cross-ref **PF-9**, which adds
the browser as a third channel).

**Where it stands:** in discussion with the WhatsApp team for a while now, and **still no
clearance** — so nothing is designed and nothing is built. It is logged here because it is being
chased weekly and appears on the client report; the moment access is granted this stops being a
waiting item and becomes a build.

**Worth settling before it lands:** which events are worth a WhatsApp (an approval waiting, a step
overdue, the collection report going out) as against the ones that would make it noise; whose
number it goes to, given `profiles.phone` already exists; and whether a message is one-way or
expects a reply.

### PF-11 · Training videos, and a place in the hub to watch them  `[ ]`
*Raised 2026-08-22 · **Joint work with Bushra** · touches every module*

Two halves, and neither is much use without the other:

1. **The videos.** One per module, walking a person through the screens they actually use. Recorded
   jointly — Bushra knows the process, we know the screens.
2. **Somewhere to watch them.** A screen inside the portal where a person finds the video for the
   module they are in, rather than a folder someone has to be sent a link to.

**Notes:** nothing like this exists in the portal today — no help screen, no video anywhere. The
nearest thing is each module's own dashboard. Worth settling before recording: whether a video is
per module or per step (a nine-module portal is a lot of one-hour videos, and nobody watches those);
where the files are hosted, since a video in the repo is a mistake and Supabase storage has a cost;
whether a new joiner is *pointed* at them by the portal or has to go looking; and whether they need
re-recording every time a screen changes, which is the reason most such libraries die.

### PF-12 · The reports management actually wants  `[ ]`
*Raised 2026-08-22 · **Next week's first job** · sit with Ritesh Bhai before building anything*

Brainstorm with **Ritesh Bhai** to understand what he needs out of the hub **on the report side**,
then build those reports into Orange One.

**The session comes first, and it is the point.** We have nine modules stamping who did what and
when, so most of what he asks for is probably derivable from data we already hold — but which cuts
matter, at what frequency, and delivered how (a screen, a scheduled mail, an Excel) is his call, not
ours. Guessing produces reports nobody opens.

**What already exists, so we do not rebuild it:** the receivables side is well covered — the
Salesperson Collection Report, the Risk Register, Saved Views, and the scheduled mail behind
**RC-2** ([RECEIVABLES-SCHEDULED-EMAIL.md](RECEIVABLES-SCHEDULED-EMAIL.md)) which already renders a
PDF and a workbook from the app's own code. The FMS side has almost nothing by comparison: the
Master Control Center is a live-status board, not a report, and **PE-2** (how long each production
step took) is the only report anyone has asked for. That gap is most likely where this lands.

**To settle in the session:**
- [ ] Which decisions he is making today without a number in front of him — start there, not from a
      list of tables we could join.
- [ ] Per report: the period (day, week, month), who receives it, and whether it is a screen he
      opens or a mail that arrives.
- [ ] Whether these are per-module reports or one management view across modules — the second is a
      different build, closer to **PC-1**'s dashboard than to a report.
- [ ] What he wants that the data cannot answer yet, so we know early what needs capturing first.
---

## Process Coordinator Dashboard  *(new)*

### PC-1 · Consolidated dashboard for the process coordinator  `[~]`
*Also touches: Admin / Masters · every FMS · Raised 2026-08-20 · **Built 2026-08-23**, awaiting
the access grants below before it shows anything to a non-admin.*

**What shipped.** A new module at `/process-coordinator` (Control category, between the
Control Center and the Master Report), two screens and nothing else:

1. **Approvals** — every module's master requests in one queue, waiting-first, with the
   decided history one click away. Backed by `pc_master_requests()`, a UNION over the ten
   `fms_*_master_requests` tables. Approving goes back through **that module's own**
   `fms_<mod>_resolve_master_request`, so it creates the real master row, fires the
   module's notification and its email exactly as before.
2. **Processes** — one row per FMS, worst first, reusing the FMS Control Center's own
   adapters so the counts cannot disagree with it. Expanding a row shows **only the steps
   that are delayed or due today**, each with its owners' name, phone and email as
   one-click `tel:` / `mailto:` links — the half the adapter contract cannot express, since
   it stops at counts. Steps with nobody on them render "No owner set" and are counted in
   the footer.

**⚠ TWO GRANTS ARE NEEDED PER COORDINATOR, and the second is counter-intuitive.**
In Admin → Module Access give them `process-coordinator`, **and `view` — not `edit` — on
every FMS module.** Several FMS read policies (dispatch, OCPI, HR Exit) admit
`module_is_viewer()`, which is `module_level() = 'view'` *exactly*, so an `edit` grant makes
it false and the coordinator would silently see **zeros** for precisely the modules that
matter most. Verified 2026-08-23: view grants add no email traffic — no email, recipient,
announce or notify function reads `module_is_viewer`.

**Not covered, deliberately:** Sampling and Customer Onboarding have master managers but no
`master_requests` table, so they cannot appear in the approval queue. Asset Maintenance,
Customer Onboarding, OCPI and Travel Desk have **no step-owner rows at all**, so they show
"No owner set" throughout Processes until configured. Steps routing to a *per-entity* person
(HR Exit's manager steps, travel approvers) are not step-level config and so are not
resolved. `MastersReconcile` is excluded — an admin-only live merge against foreign keys,
a different data shape and authority model.

We have a new process coordinator. Build them one consolidated dashboard — **a different
thing from the existing FMS Control Center** — that does two things:

1. **Approve every master.** All master approvals across every module land with the
   coordinator, in one queue of their own.
2. **See every FMS at a glance.** Which process is running successfully, which is getting
   delayed, and *at what point* the delay is happening — with the person to call, so the
   coordinator rings them and pushes the work on.
3. **Carry that person's contact details, not just their name.** For every FMS and every
   step, resolve the owner sitting on it to a name **plus a working phone number and email
   id**, rendered so the coordinator can act on them there and then — `tel:` / `mailto:`
   links, one click, no copying a number off the screen and no second trip to the admin
   directory to look it up. Both fields already exist on the profile
   ([types.ts:106-111](frontend/src/core/platform/types.ts#L106-L111): `phone` is the
   mobile, `email` the login id), so this is a join the dashboard must carry through from
   the step's owner id — not new data to collect. Where a step has several owners, show
   them all; where it resolves to nobody, say so plainly rather than leaving a blank — an
   unowned step is exactly the kind of delay this dashboard exists to surface.

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
- A "process coordinator" already exists in code, but **per FMS**: **twelve** modules —
  Purchase, Import, HR Recruitment, HR Exit, General Purchase, Sampling, Production,
  Order to Dispatch, Customer Onboarding, Asset Maintenance, OCPI and Travel Desk — each
  hold a `process_coordinators` config row of user ids, set in that module's own Settings.
  (This line said "four" until 2026-08-23; it was written before the last eight shipped.)
  There is no single coordinator identity spanning all modules. **Measured 2026-08-23: the
  union of those twelve lists holds THREE assignments** — Riya Kumari on HR/Exit and a
  `master@taskflow.app` system account on Purchase — so building identity on them would
  have started empty.

**Answered when we built it (2026-08-23):** a new module of its own, `/process-coordinator`
in the Control category; the FMS Control Center stays exactly as it is; and the coordinator
is **neither a role nor the union of the per-FMS lists** — holding the `app_access` row for
`process-coordinator` IS the permission, the Master Report precedent.

⚠ **The per-FMS `fms_<mod>_is_coordinator()` was deliberately NOT widened**, and must not
be: `isProcessCoordinator` is `return true` as the *first arm* of ~15 predicates across
twelve stores — `canActOn`, `canRaise`, `canCancelOrder`, `canTickCheck` and HR Exit's
`canReadConfidential`, which guards the exit-interview PII tier. Only the ten
`*_resolve_master_request` RPCs were widened, one authorisation line each.

### PC-2 · A user's phone doubles as their login password  `[ ]`
*Platform / Admin · Raised 2026-08-23, out of PC-1*

Per platform convention a user's mobile number IS their initial password, set on create and
re-pinned every time the admin user form is saved. Nothing ever forces a change. Measured
2026-08-23: **60 users, 59 with a phone on file, 56 have signed in at least once** — but
signing in does not change the password, so most passwords are probably still the mobile.

That coupling is why `list_org_people()` strips phone and email, and why PC-1 needed a
SECURITY DEFINER RPC to show a step owner's number at all. A work mobile is not really a
secret inside the company; a password is. **The defect is the coupling, not the exposure.**

**To settle:** force a change on next sign-in for anyone whose password still equals their
phone; or stop re-pinning the password on every user-form save; or both. Note the admin
"Share login" modal (`core/admin/Users.tsx:227`) passes `defaultPassword={shareFor?.phone}`,
so it depends on the convention and would need to change with it.

### PC-3 · Collapse the ten duplicated master-request systems  `[ ]`
*Also touches: every FMS · Raised 2026-08-23, out of PC-1 · **This is Central Masters Phase 3***

[CENTRAL-MASTERS.md](CENTRAL-MASTERS.md) already tracks this as Phase 3, not started. PC-1
put one queue **on top of** the ten systems rather than collapsing them, deliberately: the
thin layer carried no regression risk to any module's approval path, and it shipped in a day.

The duplication is still there underneath — ten `fms_*_master_requests` tables with
identical columns, ten `*_resolve_master_request` RPCs (nine sharing a signature, Travel
Desk's differing), ten `*_master_managers` tables, and a `mst_master_managers` that holds
**zero rows** and is the table they are all supposed to fold into.

**Worth knowing before starting:** the resolve RPCs read `proposed_payload` keys VERBATIM
from each module's `lib/masterFields.ts` — a wire contract with no compile-time link, so a
collapse has to reconcile ten field schemas. And `fms_dispatch_resolve_master_request`'s live
body is **not** the one in its migration; the Phase 1 cutover replaced it with a version that
writes into `mst_*`. Read every definition from `pg_get_functiondef()`, never from a
migration file.

---

## OCPI  *(new module)*

### OCPI-1 · Build the OCPI module, standalone  `[~]`
*Raised 2026-08-20 · **Built 2026-08-22**, phases 0–9d of 10 done. Live checklist and build log:
[OCPI.md](OCPI.md). Not yet cut over — see "Before it goes live" below.*

A **complete, standalone module** for OCPI, covering the whole thing end to end. What is built:

1. **Quotations** — raised in the module against a machine master, drafted privately, generated
   as a PDF on the letterhead, revised as often as a negotiation needs, every revision frozen
   and diffed field by field.
2. **Two approval gates** — quotation and order confirmation, owned per step in Settings.
3. **Order confirmations** — part B pre-filled from the quotation, rendered from each machine's
   own transcribed template, frozen at submit.
4. **The signature loop** — print, file the customer-signed copy, countersign, closed. Both
   scans held in a private bucket behind the deal's own visibility rule.
5. **Reports** — the Deal Register with filters and an .xlsx export; due dates, hold / resume /
   cancel, the cross-FMS scoreboard row and the Master Report adoption row.
6. **The lifecycle rail** on the deal page — the same shared `PoStageRail` the other eight FMS
   modules use, dated and named per step, and showing where a parked or returned deal stopped.

**Notes:** greenfield — nothing named OCPI existed before this. The Import module's
[SourcingModal.tsx](frontend/src/apps/import/components/SourcingModal.tsx) captures *vendor*
quotations for a purchase line; it was read for patterns and is a different shape.

**Before it goes live** (all recorded in [OCPI.md](OCPI.md)):
- ~~The `send-email` edge function needs one deploy~~ — **deployed 2026-08-23** (version 29;
  the live copy was diffed against `git HEAD` first, so it added the OCPI branch and nothing
  else, and `verify_jwt` stayed off). OCPI's own email switch is still off.
- **Bushra to confirm the true maximum `QT-M####`.** No longer a blocker: Settings →
  Quotation numbering takes the figure and moves the series forward (admin-only, forward-only),
  and until somebody confirms it every screen that can mint a number carries a warning. The
  counter is still seeded at 23 off the one paper form we have.
- **Bushra to proof-read the ten transcribed templates**, and to say which selling entities
  actually raise OCPIs. The four entities with no profile of their own now warn **by name** on
  every screen that produces a document, saying whose bank block will print instead — so a
  Colorix or Noida contract can no longer go out with Orange O Tec's account on it unnoticed.
- Ten other open questions are listed at the foot of OCPI.md.

**Still to come:** phase 10 — Zoho CRM as a third source behind the customer picker.

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

### TR-1 · Travel reimbursement module  `[ ]`
*Raised 2026-08-20 · **Unblocked 2026-08-20 (Thursday)** — HR has shared the approved travel details
and the amounts, so this is queued for build.*

A travel reimbursement module. The approved details and amounts are in hand; the build runs against
them.

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

### AM-1 · Walk the module with Bushra and list the changes  `[~]`
*Raised 2026-08-20 · **In progress, live in week 35** — the module itself is built. Every entry is
being cross-checked, what that throws up gets fixed, and then it goes live.*

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

**OD-7's Step 0 is finished**: every item now carries the type the sheet gave it — **MS-1**, shipped
2026-08-21, see [Done](#done). The screen work is no longer blocked on it. (**OD-6**, the slow save,
is fixed — also in Done.)

*(cross-ref: **PF-1** — Save Draft lands here second, after Production · **PF-6** — this module is the pilot for opening view-only access, and **PF-7** ships with it)*

### OD-1 · Internal transfer / Others on a dispatch  `[ ]`
*Raised 2026-08-20 · **Unblocked 2026-08-22** — the scope is settled and this is queued for build. The
four internal ledgers already carried in the masters are the ones to tag.*

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

### OD-4 · SO-2627-0413 names the wrong copy of SPECTRUM DIGITAL  `[x]`
*Raised 2026-08-20 · **Cleared 2026-08-22** — the call came back and this is closed. What was decided
still has to be written in here, then the entry moves to Done.*

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

### OD-10 · Item type on the sales order, and the item list follows it  `[~]`
*Raised 2026-08-21 · **Built 2026-08-21, on localhost only** — awaiting the user's test before it goes
to `master`. This is **OD-7's intake-filter half only**; see the boundary below.*

**Where it stands.** Written, `npm run build` passes, **not pushed**. No migration and no database
change — this is entirely frontend, so there is nothing to apply ahead of the deploy.

What landed:
- **Item type**, 7th on the intake header, single-select, cascading to the types that customer
  actually holds. Ink preselected when they have it, blank when they do not.
- The item lines narrow to it, **with the escape hatch** — an item already on a line stays in its own
  picker whatever the type says, so switching the type on an order that has lines cannot blank a row.
- Changing the type does **not** clear the lines (changing the customer still does).
- The mapping modal's type filter became the same single-select, also defaulting to Ink — 1,119 items
  on open for O-tec — Surat instead of 8,340.
- **All four grey help lines removed** from the intake form. The red `noAssignment` line under Billing
  company stayed — it is an error, not a hint. The Remarks box stayed.
- ⚠ The layout rule held: the form went from 7 grid children to 8 and **Customer is still 5th**.

The intake form gains an **Item type**, sitting after Customer location, and the item lines below
offer only that type. **One type at a time** — a single-select, not the multi-picker every table
filter uses. **Ink is the default.** The same field is added to the mapping modal, also defaulting to
Ink. And every grey help line comes off the form.

**⚠ THIS IS NOT OD-7, and the two must not be conflated.** OD-7 is about **sale type** — the five
receivables buckets (`ink · spare_parts · machine · head · other`) — *stored on the order*, re-checked
by the RPC, reported on, and reconciled against what the invoice became. This is a **filter on the
intake picker and nothing else**: no column, no migration, nothing persisted, nothing to backfill on
the 478 orders already raised. Settled with the user on 2026-08-21 — they asked for the item list to
narrow, not for the order to remember. OD-7 still owns the stored half and its open questions
(one type per order or per line? does it decide the sales ledger?).

It also reads **`mst_items.item_type`** — MS-1's 13-word vocabulary — not the five sale-type buckets.
The two line up (`ITEM_TYPES` carries each one's `saleType`), so OD-7 can join through it later
without this being redone.

**Decided:**

| | |
|---|---|
| How many types at once | **One.** Single-select. |
| Default | **Ink** |
| Customer has no ink | **Leave the field blank** and let the user choose — do not auto-pick something else |
| Stored on the order | **No.** Filter only |
| Mapping modal | Same field, also defaulting to Ink |
| The grey help lines | **All removed** from the intake form |

**Ink is unambiguous, checked before building.** MS-1's vocabulary holds three ink words —
`ink`, `provision_ink`, `other_ink` — but **not one mapped item uses the other two**, so "Ink"
means `ink` and nothing has to be decided about ink families.

**The blank case is real and it is why the field cascades.** Of the 789 customers with any mapping,
**677 have ink and 112 (14%) have none at all** — they buy spare parts, heads or paper only. So the
type dropdown must offer **only the types that customer actually has mapped**, the cascading rule
every grid here already follows; Ink is then selected when it is on offer and left blank when it is
not, with no dead options in between. What the customers actually hold: ink 677 · spare_parts 306 ·
head 156 · machine 52 · paper 11 · raw_material 2 · packing_material 2 · other 2 · software 1.
Every mapped item carries a type — **zero untyped** — so nothing falls through the filter.

**Where it lands.**

1. **The field.** [SalesOrderFields.tsx](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx),
   **7th**, after Customer location and before Customer PO no.
   ⚠ Read that file's layout note first — Customer must stay immediately before Customer location, and
   the pairing only holds while Customer's position is **odd and not a multiple of three**. It is 5th
   today and **stays 5th** with the new field inserted at 7, so this particular insert is safe. It
   would not be if the field went in above Customer, and it breaks on tablet only.
2. **The item list carries no type yet.** `Item` has no `itemType`
   ([types/index.ts](frontend/src/apps/order-to-dispatch/types/index.ts)) and `COLS.items` does not
   select `item_type` ([dispatchFetch.ts](frontend/src/apps/order-to-dispatch/data/dispatchFetch.ts)).
   Both have to gain it — one narrow text column on the catalogue query. `CompanyItem` already
   carries it (OD-9), which is the shape to copy.
3. **The filter.** `allowedItems` in
   [OrderLinesGrid.tsx](frontend/src/apps/order-to-dispatch/components/OrderLinesGrid.tsx) narrows by
   type. **⚠ The `includeIds` escape hatch must survive it.** That argument is what keeps a line's own
   item in its own picker; drop it and switching the type on an order that already has lines blanks
   those rows on the next edit — the same trap OD-7 flags.
4. **Changing the type must NOT clear the lines.** Changing the *customer* does, deliberately (the
   mapping changes). Changing the type does not: it is a view over the same customer's items, and the
   rows already chosen stay valid and stay visible through `includeIds`.
5. **The mapping modal.** [MapCustomerItemModal.tsx](frontend/src/apps/order-to-dispatch/components/MapCustomerItemModal.tsx)
   swaps its multi-select type filter for the same single-select, defaulting to Ink with an
   "All types" escape. For O-tec — Surat that is 1,119 items on open instead of 8,340.
6. **The help lines.** Four grey `<p>` hints come off the intake form (Dispatch type, Dispatch
   location, Customer, Customer location). ⚠ **Keep the red one** — the `noAssignment` error under
   Billing company is a failure message, not a hint, and it is the only thing telling somebody why
   their company list is empty. The **Remarks box stays**; only the help text goes.

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

**Final effect — verified against the LIVE view after it was applied, 21-08-2026**, read through the
anon key the app itself uses (850 view rows, 49 matching a snapshot bill):

| | |
|---|---|
| Bills removed | **14 · ₹1,22,07,282 off Outstanding · 14 customers** |
| Of those, past due | **10 · ₹1,01,34,928 off Overdue** |
| Credits matched but **kept** | 35 · −₹1,91,49,520 |
| Customers whose Outstanding rises | **0** — impossible by construction |
| Sales-raised references in the view | **none** |
| Paper invoices removed | **0 of 116** |

Biggest: `MC/26-27/45` ₹53.00 L, `On Account` ₹20.00 L, `ADV` ₹17.00 L (VAMA), two `BANK PAYMENT`
at ₹10.00 L each, `24.09.2026` ₹8.00 L. Every one raised by `BANK RECEIPT`, `BANK PAYMENT` or
`BANK PAYMENT-CHQ.R`.

*The pre-apply dry run predicted 11 bills / ₹1.19 Cr — within 2.5% of the live 14 / ₹1.22 Cr. The
gap is coverage, not logic: the dry run could only read allocations for the 720 ledgers that carry a
snapshot bill, while the view scans every ledger in the mirror.*

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

**Status:**
- [x] `non_bill_refs_view.sql` applied to **ConnectWave** by Ritesh Bhai, 2026-08-21. No refresh
      needed — it is a view, not a snapshot column, so it went live on creation.
- [x] Verified through the **anon** key (not the service key): 850 rows, readable, and the guard
      query for sales-raised references returns zero.
- [ ] Deploy the frontend. Console should read `removed 14 non-bill reference(s)`, never `DEGRADED`.
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

**Found while dry-running this — SQL written, waiting to be applied.** *(Go-ahead from Ritesh Bhai,
2026-08-21.)* The paper sales voucher has **two spellings** in Tally, one per book, and the rule
added with the Paper bucket (id 45) matches only the first — so paper *sales* on the NOIDA book
still resolve to Other. Open bills are unaffected in either direction: `collection_refresh()` types
them with the voucher type passed empty, so only the `PAPER/` prefix rule (44) can fire there.

**⚠ The spelling recorded here was wrong, and it would have shipped a rule that never fires.** This
entry read `GST SALES- PAPER` (one space, after the dash). No such string exists in the mirror.
Read off `v_voucher_type_nature` on 2026-08-21, the three sales-side paper rows are:

| Voucher type | Reserved class | Book |
|---|---|---|
| `GST SALES-PAPER` | GST SALES | COLORIX DIGITAL PRINTING SOLUTIONS LLP |
| `GST SALES-PAPER` | Sales Accounts-HSS | ORANGE O TEC PRIVATE LIMITED (01-04-25 to 31-03-27) |
| **`GST SALES - PAPER`** | Sales | **ORANGE O TEC PRIVATE LIMITED-NOIDA (from 1-Apr-25)** |

Spaces on **both** sides of the dash. Rule 45 is `match_mode='exact'`, `case_sensitive=true`, so the
retyped version would have inserted cleanly, changed nothing, and read as fixed. The value in the
file is copied from the view, not typed. (The 49 / 473 line counts alongside the old spelling came
from the same reading and are equally unverified — `rpt_sales_register` holds 92 `GST SALES-PAPER`
lines for the current FY, and the NOIDA book's are on an older one. The counts don't change the fix.)

Same shape as spare parts, which has carried two spellings as two rows since the start (ids 24-25:
`GST SALES - SPARE PARTS` and `GST SALE- SPARE PARTS`).

**[sale_type_paper_voucher_type_variant.sql](supabase/connectwave/sale_type_paper_voucher_type_variant.sql)** — one
row, plus three verification blocks. **No `collection_refresh()`:** the snapshot stores no voucher
type, `v_sales_voucher` is a view, and `connectwaveFetcher` applies `sale_type_rule` in the browser
— so it lands on the next page load and a refresh would be 2.5 minutes for no change.

- [x] **Applied to ConnectWave by Ritesh Bhai, 2026-08-21** — landed as rule id **46**, active.
- [x] Verify 2 run through the live resolver on the **anon** key: `GST SALES-PAPER` → `paper`,
      `GST SALES - PAPER` → `paper`, and the two controls hold — `GST PURCHASE - PAPER` → `other`,
      `DELIVERY CHALLAN-PAPER` → `other`. A purchase and a challan are not sales.
- [x] Verify 3: open bills unmoved — `PAPER/126/25-26` and `PAPER/26-27/12` → `paper`,
      `OTPL/001` → `other`. Confirms the open-bill path never saw this rule, as intended.
- [ ] Open a NOIDA-book customer and confirm paper sales leave the Other band. Data is right; this
      is only confirming the screen. No `collection_refresh()` — the rule applies at read time.

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

### RC-5 · Who receives a salesperson's copy  `[x]` *(decision — no build)*
*Raised 2026-08-20 · **Decided 2026-08-21 (Ritesh Bhai)** · no longer blocks **RC-2***

**The decision: everyone who can see a salesperson's book receives that salesperson's report.**
Option 1 of the three below — and it is what the code already does, so nothing was built and
nothing changed.

**Why it was a question.** `profiles.receivables_salespersons` is a **visibility scope**, not an
identity. It answers *"whose figures may this person see"*, not *"who is this salesperson"*, so a
name does not resolve to one inbox. `UMESH JI` is carried by six people: Umesh, his HOD Nakul, and
four in credit control. Five accounts carry more than one name:

| Account | Email | Names carried |
|---|---|---|
| Bushra | `PC@orangeotec.com` | **13** |
| Jayshree Patil | `collection@orangeotec.com` | **13** |
| Ritesh Tulsyan | `ritesh@orangeotec.com` | **13** |
| Nitesh Prajapati | `nitesh@orangeotec.com` | 8 |
| Nakuleshwar Sharma | `nakul@orangeotec.com` | 5 |

**The volume this accepts, stated plainly:** with all 13 names scheduled, those three 13-name
accounts each receive **thirteen separate emails per send**. **Accepted 2026-08-21: the report goes
out weekly, on Saturday, so thirteen mails a week is fine.** It would be worth revisiting only if
the schedule ever moves to daily.

**⚠ It follows that arming is now a one-way door on volume.** Nothing else gates it. If the day or
frequency changes later, this decision was made against *Saturday*, not against the schedule in
general.

**The two options NOT taken**, recorded so the same ground is not walked twice:
2. Send to the rep only, and give oversight the whole-book copy instead.
3. Choose the address per name, via a chosen **user id** on `report_email_recipients`.

Option 2 turned out to *require* option 3: nothing in the data says who "the rep" is. A HOD's tag
list is his own name plus his team's — Nakul carries himself, Umesh, Dhananjay, Purav and Abhishek;
Manmohan carries himself and Khurshid — so "carries exactly one tag" identifies a plain salesperson
but not a manager. Option 3 was built on 2026-08-21 (an `owner_user_id` column, the resolver and a
picker) and **reverted the same day, unused**, when the answer came back as option 1. The database
was returned to its prior state — column, constraint and index dropped, both functions restored.
Nothing shipped and the frontend was never touched.

**Three tag problems found while checking this.** Independent of the decision above, fixable in
Admin → Users, and none of them blocks anything. The live data holds 13 salesperson names
(`OTHERS` 703 ledgers, `MANMOHAN JI` 300, `NAKUL JI` 292, `UMESH JI` 132, `KHURSHID JI` 116,
`KARAN SIR` 70, `AAYUSH SIR` 62, `DHANANJAY` 42, `PURAV SHAH` 37, `SUHEL` 27, `RELATED PARTY` 24,
`ABHISHEK` 7, `HARI OM` 2):

- **`MAYANK`** is tagged on all three 13-name accounts and **no ledger carries it**. Dead.
- **`Others`** (lower case) sits on Jayshree and Ritesh *alongside* the real `OTHERS`. Dead, and it
  is why their count reads 13 when only 11 names are live — they are also missing `RELATED PARTY`,
  which Bushra has.
- **`HARI OM`** exists in the data but **nobody is tagged with it**. It is HARIOMSHARAN DAVE
  (`hariomdave@orangeotec.com`), who has an account carrying no tags. Scheduling the name as it
  stands would report "nobody to send to". The same is true of **`AAYUSH SIR`** (Aayush Rathi) and
  **`KARAN SIR`** (Karan Toshniwal) — both have accounts, neither is tagged, so those two reports
  would reach only credit control.

- [ ] Delete `MAYANK` and the lower-case `Others`; add `RELATED PARTY` to Jayshree and Ritesh.
- [ ] Decide whether Aayush, Karan and Hariom should be tagged with their own names before the
      first send, or whether credit control receiving those three is the intent.

---

### RC-3 · Planned / Gap to plan reads wrong — weekly plan against a monthly report  `[!]`
*Raised 2026-08-20 · Feedback from Ritesh Bhai · **Blocked:** needs a decision from Ritesh Bhai ·
**Pulled off the weekly client report 2026-08-22** — it stays open here, but nobody is being asked
for the decision any more, so it will not move until someone puts it back in front of him.*

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

### RC-2 · The Collection report sends itself, on a schedule  `[x]`
*Outstanding Dashboard · **Live 2026-08-21, 21:28 IST** — the first armed slot ran and delivered ·
raised 2026-08-20, built and disarmed the same day*

**What happens now.** Nobody builds or mails this report by hand. A schedule set on the settings
screen posts it on its own: the whole book to a list of typed addresses, and each ticked
salesperson's own extract to everyone tagged with that name. PDF and workbook attached, both drawn
by the app's own code, so the mail and the screen cannot disagree.

**The first armed send, deliberately narrowed to one person.** Rather than go live on the real list,
the schedule was pointed at that same Friday evening with **one** address on the book list
(`e.techie4@gmail.com`) and **no** salesperson ticked — so the real path could run end to end with
nothing at stake. It fired at **21:28:57 IST** and delivered inside a minute: one outbox row,
status `sent`, and the slot logged so it could not repeat. Schedule → runner → build → storage →
Gmail, all proved on live data.

**Why it was held until today.** Two switches shipped **off** on 20-Aug and stayed off for a reason
that was not caution for its own sake: **RC-5** — who a salesperson's copy actually reaches — was
unanswered, and arming first would have posted thirteen separate emails to each of three accounts
with no way to recall them. RC-5 was decided on 21-Aug (everyone who can see a book receives it,
accepted **because the send is weekly**), and the switches went on the same day on Ritesh Bhai's
instruction.

**⚠ Adding a recipient is now a live action, not configuration.** With the system armed, ticking a
name or typing an address on the settings screen reaches a real inbox at the next due slot. There
is no further switch standing between an edit and a send.

**Turning it off**, if it is ever needed: `update private.collections_report_config set armed = false;`

**What was built** — unchanged from the 20-Aug entry, recorded here so it lives with the shipped
task:

| | |
|---|---|
| `20260922120000_…_scheduled_send.sql` | `collections_report_due()`, the send log, the arming switch |
| `supabase/collectionsreport/` | the builder: bundles the app's own TypeScript, three guards |
| `.github/workflows/collections-report.yml` | ticks every 30 min, gates on the database first |

Earlier phases: multi-day schedules `17bad6a`, the KPI numbers and card wording out of the React
page `3ca9e7d`, the row predicate and defaults `dd05708` / `18387c7`, the headless build `3e0cd72`.

**⚠ It is a GitHub Actions runner, not an Edge Function, and that is measured rather than assumed.**
A probe burned straight-line CPU on the live runtime: 1 s → `200`, 3 s → `546
WORKER_RESOURCE_LIMIT`, and 8 s with an `await` every 200 ms → `546` as well. The ceiling is **2 s
of CPU per request** and the budget is **cumulative** — yielding does not reset it. This report is
**~40 s of solid CPU** (101 pages, ~250 customers, a 1.5 MB workbook), and splitting it per
salesperson does not rescue it either: one rep's 18-page extract is already over. The runner has no
such cap and has the repo checked out, so it still runs the app's own code — which was the point.

**Notes worth keeping:**
- No `pg_cron` and no UTC conversion by hand: the IST comparison happens inside
  `collections_report_due` in `Asia/Kolkata`, so the stored hour means what it says.
- Send log keyed `(report_key, sent_for_date)` on the **IST** date. A run reaching nobody
  deliberately does **not** log, or adding the first recipient an hour late would cost the slot.
- Timing is honest, not exact: GitHub's scheduler can run several minutes late, so a 21:13 slot
  went out at 21:28. `grace_minutes` (120) is what lets a late tick still serve it.
- **GitHub disables a scheduled workflow after 60 days with no commits to the repo.** Unlikely
  here, but it stops silently rather than failing.
- Still open, and small: an attachment size guard — fine today at 2.2 MB, should degrade to a link
  rather than fail above 10 MB.

### OD-11 · The gate outward number is the gate pass number, and Noida counts its own  `[x]`
*Order to Dispatch · **Done 2026-08-21, 21:30 IST** — migration applied to live first, frontend on
`master` as `2a1cc88`, Vercel green · raised in conversation, so there was never an open entry*

**What a user sees now.** At **Gate Outward Entry** the *Gate outward no.* is no longer a box to type
in. It shows the gate pass number for that round, read-only, with no red asterisk — the same number
printed on the slip and shown in the panel above it. Fill in the remark and save.

**Why it changed.** It was a required free-text field that nothing generated, sitting directly under
a panel already displaying the gate pass number. So Surat copied it across by hand. Of **401 Surat
gate entries: 193** were exactly the gate pass, **183** were the gate pass with the clipboard debris
still attached — `Sr. No.: OTEC-2608-206`, `: ENT-2608-218`, `.: ENT-2608-202` — and 25 were something
else. Noida never copied it at all: all **38** of its entries read `123`, `PORTER`, `BY VEHICLE`,
`BY BUS`. One number, written twice, wrong about half the time. It is now derived in the database and
the payload key is ignored, so the two cannot drift again.

**Noida numbers itself.** The series was keyed on the company alone, so both plants drew from one pot
and their numbers interleaved. A per-site suffix splits them:

| | Surat | Noida |
|---|---|---|
| Orange O Tec Pvt Ltd | `OTEC-2608-001` | `OTEC-N-2608-001` |
| Orange O Tec Enterprise | `ENT-2608-001` | `ENT-N-2608-001` |

The suffix is on the **site**, not the (company, site) pair, because the gate register is a book kept
at a place. Both Surat sites share the main series; **Admin → Central Masters → Dispatch Locations**
has a *Gate pass suffix* column to set one on any future site. Noida starting at 001 needed no
seeding — a new scope key is a counter that does not exist yet, the same mechanism that already
restarts the numbering each month.

**Nothing already issued was renumbered.** The archive keeps whatever was typed — **227 rounds** where
the two disagree stay exactly as recorded, because those passes were printed under those numbers. Only
the **19 still-open** rounds were corrected, and every one had an empty remark, so nothing was lost.

**Three traps, all found before any code moved:**

1. **A unique index on `go_outward_no` would have failed the deploy.** It looks like the obvious
   companion to the one on `gp_no` — but the archive holds 13 rounds numbered `123`. History is
   staying, so that column can never be unique. Uniqueness lives on `gp_no`, which the value derives
   from.
2. **A hyphen in a prefix or suffix collides two series.** Prefix `OTEC-N` with no suffix composes to
   the same counter key as prefix `OTEC` plus suffix `N`. A check constraint allows letters and digits
   only.
3. **Migration filenames here are labels, not clocks.** `supabase_migrations.schema_migrations` stores
   real timestamps; the files on disk are forward-dated. Taking the next number from the table would
   have produced a filename that sorts wrong.

The migration ends with a `do $$` block that re-reads both gate-out function bodies and fails the
deploy if either ever reads the payload key again — putting it back looks like a kindness and silently
restores the bug.

⚠ **Not visually verified.** The Playwright Chrome profile was locked for the whole session, so the
read-only box was never seen rendered on a real entry. The build gate and the database checks passed;
someone should open one Gate Outward Entry and confirm it reads right.

### OD-9 · A missing item is mapped on the spot, not requested  `[x]`
*Order to Dispatch · **Done 2026-08-21** — migration applied first, frontend on `master` as
`f6ed06c`; verified on the live site by the user · answers **OD-3**, and the removal half of **OD-2***

**What a user sees now.** On a sales order, typing an item the customer is not mapped to no longer
offers *"Request new item"* and a wait. It offers **"Map «X» to this customer"**, and the popup opens
with the order's company and customer already filled in and locked, every item of that company's Tally
book listed, and a Type filter over them. Tick what is needed, save, and the item is selectable on the
line immediately. **Nobody approves anything.**

The same thing is reachable from **Master Requests → New entry**, where *"What do you need?"* now
offers **two** choices instead of four: **Customer-Item Mapping** (created directly) and **Company
Location** (still a request). **Customer** and **Item** are gone — they come from Tally (**OD-2**), and
the pickers that used to offer to create them now say so instead.

**Why the approval went.** Of the 122 master requests ever raised in this module, **85 were mappings
and only 5 were rejected** — 94% approved. The queue protected nobody and blocked the one person who
could see what was missing. The right to map is now the right to raise the order:
`fms_dispatch_can_raise`, checked in the database, not the browser.

**Admin → Central Masters → Customer Items** gained **Mapped by** and **Mapped on**, with a sort
toggle and a filter on each. Filter *Mapped by* to a person and you have exactly the mappings people
made themselves.

**Three things it could not be built on, all found before any code moved:**

1. **The module's item list is DERIVED from the mappings** — 1,693 of 14,264 — so an item mapped to
   nobody was not in it, which is exactly the item somebody opens this to find. The popup fetches the
   company's own book instead (Colorix 254 → O-tec-Surat 8,340), on its own cache key so no write
   drags it down again.
2. **Excluding already-mapped items by ID would have shipped broken.** The order picker collapses to
   one row per product NAME, so a customer holding another book's copy would have been offered this
   book's copy, the save would have succeeded, and the screen would not have changed — **375 pairs
   across 78 customers** were in that state. Excluded by name instead.
3. **`source` could not carry the "made by hand" mark.** `masters-sync` rewrites it to
   `sales_register` on any pair the customer actually buys, so the mark erases itself the moment the
   mapping starts working — four rows already showed that damage. Attribution is `created_by`, which
   that upsert never names, plus a trigger so every hand path fills it.

**Also fixed in passing:** the Billing company picker could raise a request the resolver refuses
outright (*"Companies come from Tally now"*) — after an owner had already approved it; and a mapping
notification read *"…was requested: "* with a trailing colon because it used `payload.name` on a
master that has none.

**⚠ The item book is filtered to the billing company's own Tally book, with no way to widen**, and the
cost was accepted knowingly: **185 of 1,813 existing order lines (10%)** use an item filed under a
different book. Those go to Central Masters, where the company filter is optional — and the popup now
NAMES the book the item lives in rather than showing an empty list. In exchange, there are zero
duplicate item names inside a single book, so the twin ambiguity disappears at the point of choosing.


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

### OD-8 · Dispatch stopped re-downloading itself on every save  `[x]`
*Order to Dispatch · **Done 2026-08-21, 15:40 IST** (on `master` at `4d1e006`, deployed with `f6ed06c`)*

**What a user sees:** nothing — and that is the point. Saves were already instant after **OD-6**; this
was about what the module was doing to Supabase behind them.

**A save now costs 126 kB over 8 requests. It was ~5,000 kB over ~30.** Measured in the browser, end
to end. It was also worse than "per save": the dashboard re-invalidates the whole snapshot **every
time the tab regains focus**, so alt-tabbing cost 5 MB too.

**Six changes.**

1. **A trigger, so "what changed?" can be trusted**
   ([20260926120000](supabase/migrations/20260926120000_dispatch_children_touch_parent_order.sql)).
   `fms_dispatch_rounds` has no timestamp column at all, so a delta has to hang off the parent order —
   and that assumption was **already false**: 447 order lines were newer than their parent's
   `updated_at`, because the helpers that rewrite children do not always touch the order. Nine
   statement-level triggers now bump the parent (`replace_lines` rewrites every line of an order, so
   row-level would have updated the same row once per line).
2. **The catalogue left the save path.** Customers, items and their pairs moved to their own query on a
   30-minute clock — Tally itself only syncs ~5×/day, so the picker stays fresher than its source.
   Only 4 of the 23 writes may refresh it.
3. **Stopped asking for columns nobody reads.** `select("*")` fetched 26 columns of `mst_parties` to
   map 11. Catalogue: 2.1 MB → 678 kB.
4. **An order's history loads when the order is opened.** 2,943 rows / 743 kB rode in every snapshot
   and every save, for a panel with one reader showing one order — and carried master-request rows
   that were never displayed at all.
5. **Ask only for what changed.** Read every visible order's id and stamp (~25 kB), fetch only the rows
   that moved, re-read their children wholesale so a deleted line disappears, and **drop any id no
   longer in the list**. ⚠ That last step is access control, not tidiness: `update_order` can change an
   order's `location_id`, moving it out of a user's visibility — a watermark-only delta would never
   mention it again and the stale copy would sit in their queue.
6. **The catalogue is kept between visits, and sign-out now clears the cache.** ⚠ Found while
   auditing: `removeClient()` existed and was **never called**. The persisted cache already outlived
   sign-out by 24 hours holding the receivables payload and the staff directory, readable through
   devtools *without logging in*. This change would have added customer names, GSTINs, phones and
   emails to it. Sign-out now empties memory **and** deletes the disk copy — a fix that reaches beyond
   this module.

**Verified, not assumed.** The trigger was proved by creating it inside a transaction, testing both
paths and raising an exception so Postgres rolled it all back — no live row was touched. The column
trim was proved by fetching every catalogue table both ways, mapping both through the same mapper and
comparing: identical. The delta was proved against a full fetch over **487 orders and 1,813 lines**,
for an order never seen, a stale one, one no longer visible, and no change at all — byte-identical
every time. In production afterwards: zero non-2xx in 90 minutes, and catalogue requests fell from
1,165–2,008 per half hour to 314–602.

*(cross-ref: **PF-8** — the same treatment for the other modules, when it matters)*

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
The one optimisation deliberately left out of this — a save still re-downloading the whole catalogue —
became **OD-8**, and shipped later the same day.

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
