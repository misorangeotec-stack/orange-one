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

**Last updated:** 2026-08-29

Separate, and not repeated here — the two live operation logs keep their own detail:
[CENTRAL-MASTERS.md](CENTRAL-MASTERS.md) (Tally masters consolidation) ·
[RECEIVABLES-SCHEDULED-EMAIL.md](RECEIVABLES-SCHEDULED-EMAIL.md) (scheduled collection emails)

---

## Waiting for

Work held up because someone owes us something. If a task is late, this is the first place to look.

| What we need | From | Blocks | Waiting since |
|---|---|---|---|
| WhatsApp access, so the integration can start | WhatsApp team | **PF-10** | 2026-08-22 |
| Who owns the approvals in OCPI, Customer Onboarding, Asset Maintenance and Travel Desk — no step owners are configured at all | Ritesh Bhai / Bushra | **PF-14** | 2026-08-27 |
| The calibration sheets (the Excel report QC keeps today) | Factory / QC team | **PE-1** | 2026-08-20 |
| The final list of production steps to add | Factory, then Bushra | Widens **PE-2** (no longer blocks it) | 2026-08-20 |
| The R&D flow and the form | Factory team | **RD-1** | 2026-08-20 |
| The COA sample PDF + the raw Excel sheet | Factory team | **PE-3** | 2026-08-20 |
| A walkthrough of Asset Maintenance, to list its changes | Bushra | **AM-1** | 2026-08-20 |
| The filled asset register sheet (vehicles, IT, air conditioners) | Ritesh Bhai / Finance | **AM-2** | 2026-08-29 |
| Department, sub-department + employee code for 10 people who joined after her 27-05-2026 sheet | Bushra | **OM-1** | 2026-08-20 |
| The REAL dryer names, Indian and Chinese — six `[SAMPLE]` placeholders are standing in so the 11 machines that take a dryer can name one | Ritesh Bhai / Bushra | **OCPI-3 go-live** | 2026-08-29 |

---

## To discuss with Ritesh Bhai

A running list. Ask for it by name — *"what needs discussing with Ritesh Bhai?"* — and this is what
comes back. Two kinds of item live here and they are marked differently:

- **`[decided]`** — already agreed and already applied. Listed so it can be confirmed, and so the
  exact wording is on record if it is ever queried.
- **`[open]`** — nothing built either way; the answer changes what gets built.

### OCPI

**1. `[decided]` The print-head price sentence — reworded on 4 machines.** *(29-Aug-2026)*

The client asked for the *"head price after the warranty"* box to be removed from the quotation form.
It could not go while the clause that used it still asked for a figure — an unfilled placeholder prints
as a ruled blank, so every contract on those machines would have read *"priced at INR ________ plus
GST"*.

Machines affected: **Homer K24 · Homer K32 · P8D · P8S** — clause *PRINT HEAD POLICY PROGRAM*.

> **Was:** "After that period a New Print Head will be priced at INR `{{post_warranty_head_price}}` plus
> GST, on the new machine, first time installed head."
>
> **Now:** "After that period, **replacement print heads will be supplied at the prices prevailing at
> the time of purchase**, on the new machine, first time installed head."

Approved by the client and applied (migration `20261021150000`). The form field and its placeholder were
removed afterwards, in that order. **Contracts already issued are unchanged** — every revision freezes
its own document, so only the next generation picks this up.

*For Ritesh Bhai: confirm the new sentence is acceptable commercially. If not, it is one string to swap
back.*

**2. `[decided]` The delivery term stays on the quotation form.** *(29-Aug-2026)*

The original instruction was to remove the **Delivery term** dropdown (Ex-Work Surat / CIF / FOB / EX
Factory), because delivery is "already covered in commercial terms". Checking it showed that it is not,
and the field stays. Three findings:

- It is the **only place an ordinary sale records a delivery route.** Commercial terms asks *"how is the
  printer delivered?"* on a **High Seas deal only**. **11 of the 12 ordinary deals on record had filled
  this dropdown in**, all with *"Ex-Work Surat"*.
- The words in it print on the contract as **"Delivery Terms: Ex-Work Surat"**, on all ten machine
  templates. Removing the dropdown first would have printed **"Delivery Terms: ________"** there.
- ⚠ **The two papers were never saying the same thing.** The **quotation** prints *"Term of Delivery:
  Local Delivery · cost by Customer"* — built from the deal type and who pays. The **contract** prints
  *"Delivery Terms: Ex-Work Surat"* — this dropdown. Two different facts, two similar headings, on two
  papers. That is what made "already covered" look true when it was not.

*For Ritesh Bhai: nothing needs doing. But it may be worth deciding whether those two lines SHOULD say
the same thing — e.g. the contract reading "Ex-Work Surat, cost borne by Customer". That is a wording
question about the papers, not a question about the form, and nothing is broken either way.*

**3. `[open]` Should "Platter" be asked on every quotation, or set once per machine?**

*Asked in these words on 29-Aug-2026; still waiting for an answer, so nothing has been built.*

There is a dropdown on the quotation called **Platter** — *With Platter / Without Platter / Not
Applicable*. Nobody has ever mentioned it in any instruction, and it is in no pointer and nowhere else
in this work list.

But the client's own machine sheet has a **PLATTE column sitting among the machine's features**, between
*Heating Media* and *Air Blade* — next to the air blade and the chilling system, which are all set once
per machine. So the sheet treats it as part of the machine, not as something agreed deal by deal.

**The three choices, in plain words:**

- **A.** It is a **machine feature**, like the air blade — tick it once per machine and stop asking on
  every quotation.
- **B.** It is a **per-deal choice** — leave it as a dropdown on the quotation, exactly as it is now.
- **C.** **Drop it** — nobody uses it.

**My recommendation: A.** A platter is part of the machine, not something negotiated on each deal, and
the client's own sheet already files it with the machine's features.

⚠ **One thing to know before choosing A:** that PLATTE column is **empty for all 28 machines**, so there
is nothing to load. Someone would have to go through the list and say which machines have one. Until
that is done the question would simply stop appearing anywhere.

*For Ritesh Bhai: A, B or C. If A, we also need somebody to fill in which machines have a platter.*

**4. `[open]` One head-name check left. Two are settled.**

- **`[decided]` The Fab Pro's Ricoh IS a "Gen 6".** *(29-Aug-2026)* The sheet says only *"RICHO HEAD"*,
  with no generation. **Fab Pro 1I, 2I and 3I** were mapped to the existing *RICOH GEN 6 HEAD* and the
  client has confirmed that is right for now, and will tell us if it ever changes. The name prints on
  the quotation, so it was worth asking. Nothing to change.
- **`[open]` Is "Homer" a print head, or the machine brand typed into the head column?** *(put to the
  client 29-Aug-2026 — they do not know; it needs Ritesh Bhai.)*

  Three machines — **Homer K24, Homer K32 and K64** — have *"EX600 RC KATAN & HOMER"* in the head column
  of the sheet. *Katan* is certainly a head. But **Homer is also a machine brand** — two of those three
  machines are called Homer. So is Homer a **second print head**, or did somebody type the machine's
  brand into the head column by mistake?

  **We have assumed it is a head**, and added *Homer* as a new head name linked to those three machines.
  Two reasons: the other machines are written the same way — *"EX600 RC KATAN & KYOCERA"*, *"MS &
  KYOCERA BOTH"* — and there both names are heads; and it also appears on **K64**, which is not a Homer
  machine at all.

  *For Ritesh Bhai: is Homer a print head, yes or no? If no, we delete the head name and those three
  machines keep Katana only — a few minutes of work, no rebuild. The name prints on the customer's
  quotation, which is why it is worth confirming.*
- **`[decided]` Rocket's Kyocera is 300 DPI.** *Resolved from the sheet's own pattern:* P8D reads head
  *"300 DPI KYOCERA"* with DPI *300*; P8S reads *"EX600 RC KATAN & KYOCERA"* with DPI *600*. The DPI
  column tracks the **Kyocera** head. Rocket reads *"EX600 RC & KYOCERA"* with DPI **300**, so RC 600 +
  Kyocera 300 is consistent. Mapped that way; mention only if it looks wrong.

**5. `[open]` What is "JAY"?**

The machine sheet's TYPE OF MACHINE column reads DIRECT (10), SUBLIMATION (12), OTHER (4) — and **JAY
(2)**. The two are **Label Printer** and **Book Printer**. "JAY" sits where a machine type goes and is
not one, so it reads like a name typed into the wrong cell. Both machines are left **uncategorised**;
they are still fully quotable, since the machine list shows all 28 when no category is chosen.

**6. `[decided]` A separately-charged dryer DOES attract GST.** *(29-Aug-2026)*

When the dryer is not part of the deal it carries its own price. The question was whether tax applies to
it. **Answer: yes, at the same rate as the machine.** On a ₹10,00,000 machine with a ₹1,25,000 dryer at
18%, the papers now print:

> Machine Total: **₹11,80,000**  ·  Dryer Value: **₹1,25,000**  ·  Dryer GST @18%: **₹22,500**  ·  **Final Total: ₹13,27,500**

Built and verified against those exact figures. Two things came out of doing it properly:

- **The arithmetic moved into the database**, where the rest of the money already lives. The papers had
  been adding two numbers in the browser as a holding position. Only the database knows that a High Seas
  deal attracts **no GST at all** — so there the dryer gets none either, and no zero-tax line is printed.
- **A dollar deal converts the dryer at the same frozen rate as the machine.** A $1,500 dryer at ₹83.50
  prints as ₹1,25,250, not ₹1,500. Reading it as rupees would have been an ~85× error on a contract.

*For Ritesh Bhai: confirm the dryer is taxed at the same rate as the machine, rather than at a rate of
its own.*

**7. `[open]` On a machine that takes no centering device, should BOTH centering questions disappear?**
*(put to the client 29-Aug-2026 — they do not know; it needs Ritesh Bhai.)*

There are **two** centering questions on the quotation, and the client asked for them to be kept
separate. They are separate:

1. **"External centering system"** — a yes/no tick under *Deal inclusions*. Asks: *is it part of this
   deal?*
2. **"Centering device"** — a row under *Shipment & invoice*. Asks: *how does it ship, and is it billed
   on its own invoice?*

**But both of them only appear when the machine is marked as able to take a centering device.** So on a
machine marked **"No"**, **neither** question shows.

*For Ritesh Bhai: is that correct?*

- **Yes** → nothing to do. This is how it is built today.
- **No** → i.e. there is a case where a customer is billed for a centering device on a machine that does
  not normally take one (or the reverse). Then the machine list needs a **second tick**, so the two can
  be set independently — a small build change in the machine master and in both rule engines.

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
### PF-14 · Four modules have no step owners at all, so every approval in them is admin-only  `[!]`
*Raised 2026-08-27, found while auditing for **PF-13** · this needs the business to name people, not
code*

`fms_ocpi_step_owners`, `fms_customer_step_owners`, `fms_asset_step_owners` and
`fms_travel_step_owners` hold **0 rows each**, and none of those four modules has a
`process_coordinators` row either. So **OCPI** quotation approval, **Customer Onboarding**'s three
approvals, **Asset Maintenance**'s `verify_close`, and **Travel Desk**'s director / advance / finance
steps have nobody configured at all: only an admin can move them, because only the admin arm of
`can_act` ever matches. Six travel trips are sitting with no approver.

**Reassign cannot help this** — there is nobody to reassign *from*. It is a configuration gap, and it
is the reason **PF-13** stops where it does.

**Two more of the same class, found while building PF-13 and confirmed on live data:**

- **Seven of HR Exit's fifteen step owners cannot act on the steps they own.**
  `fms_exit_is_step_owner` is module-gated and these four people have `hr-exit` access `none`:
  DHARMISHTHA PRAJAPATI (`asset_return`, `handover`, `leave_verification`), Ritesh Tulsyan
  (`fnf_approve`), Bushra (`fnf_generate`, `payroll_inputs`) and Jyoti (`fnf_payment`). `fnf_approve`
  is one of the module's two approvals, so those seven steps are admin-and-coordinator only. The fix
  is a module grant, not code.
- **Nobody has Travel Desk edit access at all** — zero rows in `app_access` at level `edit` — so every
  non-admin is refused before any ownership rule is consulted, on top of the empty step-owner table.

- [ ] Grant those four people `hr-exit` edit access, or move the steps to somebody who has it.
- [ ] Decide who gets Travel Desk edit access when the module goes live.

**To discuss with Ritesh Bhai / Bushra:**
- [ ] OCPI — who approves a quotation, and is it banded by value the way Purchase is?
- [ ] Customer Onboarding — who signs off each of the three approvals?
- [ ] Asset Maintenance — who owns `verify_close`?
- [ ] Travel Desk — who is the director approver, who clears an advance, and who is finance? Those
      are the six trips sitting with nobody.
- [ ] For each of them: **two names, not one.** A one-person step is exactly the thing PF-13 exists
      to work around, so naming a single person here just recreates the problem.

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

### OCPI-2 · The OCPI revision — one form, one document set, tracked to Finance  `[x]`
*Raised 2026-08-24 · Plan of record:
`C:\Users\Admin\.claude\plans\now-there-is-a-memoized-mccarthy.md` · Client-facing flow:
https://claude.ai/code/artifact/bd77ceb1-a5f5-46fa-a37e-5f51977b6b0c*

⚠ **OCPI-1's phases 0–9d describe what was BUILT. This entry changes the chain itself** — read the
plan before touching the module, or you will build against the old shape.

OCPI today splits one commercial act across two stages: a **Quotation**, then — through a second
form, a second number series and a second approval gate — an **Order Confirmation**. The price is
typed twice (`deal_value_amount` and `machine_value_inr`) with nothing reconciling the two. The
client wants one act.

**What changes**

1. **One form.** The order confirmation's questions move into the quotation form as *optional* fields.
2. **Sections B and C become mandatory** — visible fields only; the branch rules still hide questions.
3. **Section C opens with High Seas / Others**, which drives currency and tax:
   High Seas ⇒ USD always and **no GST line at all**; Others ⇒ GST charged.
4. **Dollar deals print USD and INR** on a live overridable rate, frozen onto each revision. The
   dollar-fluctuation line prints in Section C, and its tick is asked only on dollar deals.
5. **Special remarks** — the master form's three remark boxes gathered into one group.
6. **Both papers generated together**, headed ORDER QUOTATION, **re-headed ORDER CONFIRMATION** when
   the Directors approve — which is also when `OTPL/OC/<fy>/nnnn` is minted, so a returned or
   abandoned quotation burns no number. Printing the signature copy is gated on that approval.
7. **Every revision keeps its own value, currency, FX rate and pair of PDFs.**
8. **Two new steps after the countersignature** — Finance handover, then Finance receipt.

**All pricing is phase 2**, by explicit instruction: no price master, no per-machine price, no
deviation limit, no price-approval gate. The salesperson types the value, as today.

**Stages** (live checklist in [OCPI.md](OCPI.md)): 0 track · A SQL foundations · B merged form ·
C commercial terms/currency/GST/FX · D both papers · E conversion + print gating · F the chain
(cutover) · G round-out · H teardown + go-live. Gate for each: `cd frontend && npm run build` green.
**All nine stages done: 0, A, B, C, D, E, F, G, H** (25-Aug-2026) — a quotation issues both papers at once, each
revision keeping its own price, rate and pair of PDFs; the Directors' approval mints
`OTPL/OC/<fy>/nnnn` and re-heads the pair as the contract, and a quotation sent back mints nothing.
The chain is cut over: approval hands straight to the customer signature, the countersignature no
longer closes the deal, and the signed contract is tracked to Finance in two halves — who handed it
over, and who accepted it. The round-out is done: Directors named on the approval gate with an empty-owners warning, every
email event given a branch that points somewhere that exists, and the register carrying the FX rate,
the rupee equivalent and both halves of the Finance handover. **Teardown is done too** — every
`ZZ TEST` deal, version, activity row, notification, master request and stored file removed, the OC
counter cleared and the quotation series put back to 23. A full chain was walked against the deployed
RPCs inside a rolled-back transaction to prove the first numbers: **QT-M0024** and
**OTPL/OC/2627/0001**.

**Before it goes live** (none of these is code): confirm the quotation series in Settings → Quotation
numbering; name the Directors on `quotation_approval` and owners for the two Finance steps, since
nobody is named and it all falls to admins today; and settle the four open items at the foot of
[OCPI.md](OCPI.md).

**Two audit findings that would have stopped the build**
- `fms_ocpi_can_add_doc` maps the `oc` storage slot to `order_confirmation`, so **a Director cannot
  upload the Order Confirmation PDF** — refused by the storage policy, silently, and *invisible to an
  admin account* because coordinators pass unconditionally. Remap to `quotation_approval`.
- The OC number and the printed paper cannot both be right unless minting and rendering happen in
  **one action at approval**.

**Relationship to OCPI-1:** OCPI-1 stays `[~]`. Its "Before it goes live" items are **not** superseded
and must not be lost — the true maximum `QT-M####`, the ten transcribed templates awaiting a
proof-read, and which selling entities actually raise OCPIs.

**Still open** (none blocks the build): P8D is headed *OFFER QUOTE*, neither of the two headings this
flow uses; who supplies the 18 missing detailed-sheet templates; whether an *Others* deal quoted in
USD really attracts GST; and the client's own remaining feedback.


### OCPI-3 · Machine categorisation, derived head + warranty defaults, and a dryer section of its own  `[x]`  — built, green and browser-verified 29-Aug-2026
*Raised 2026-08-27 · **Batch 1 of a larger set** — the client is still giving pointers, so this entry
is open and will grow. The audit of what it reaches:
`C:\Users\Admin\.claude\plans\now-there-are-a-precious-bear.md`*

**Build progress (29-Aug-2026): ALL STAGES DONE — 0 and A–J, built, green, and verified in the
browser.** Both remaining checks were run on 29-Aug: the High Seas rate now appears and is demanded,
and a dryer draft survives a save/reload while a switch to a no-dryer machine clears exactly what the
form hid and keeps the chilling system. The tickable master list — what each stage actually changed and how it was
verified — is in [OCPI.md](OCPI.md) under *"OCPI-3 · the build"*. Read that for state; this entry
stays the SPEC.

The machine master grows a billing name and a category; **type of head stops being a free choice** and
becomes a property of the machine; the dryer questions leave the bottom of the form and become a
**Dryer details section** of their own; and — for the first time since OCPI-2 declared *"all pricing is
phase 2"* — a deal can carry **a second price**, for a dryer sold outside it.

Section **E**, added on the second pointer, is a different kind of item: it asks for a rule that is
already built everywhere except the form — where the gap prints a **High Seas contract with no rupee
total on it**. Read it before the rest; it is the only part of this entry that can hurt a live deal.

🔴 **READ SECTION M FIRST.** Six later conversations amended A–J — warranties became fixed rather than
mapped, the shipping questions collapsed into one section, and the dryer flag moved from the category
to the machine. **M lists what supersedes what.** The build order and live checklist are in
[OCPI.md](OCPI.md) under *"OCPI-3 · the build"*.

**A · Machine master** ([Machines.tsx](frontend/src/apps/ocpi/pages/machines/Machines.tsx) · `fms_ocpi_machines`)

1. Add a **machine name / billing name** column beside the existing one. What is in the master today
   **is the machine code and stays exactly as it is** — nothing re-keyed, no back-fill; the new field
   is added next to it. **Both** names print on the papers and show in the register.
2. New **machine category** master; every machine maps to one category.
3. Map **type of head** against each machine.
4. Map **dryer required (yes / no)** on the **machine category** — every machine in it inherits.

**B · Dryer masters**

5. `fms_ocpi_dryer_types` is relabelled **Dryer category** (Indian / Chinese) everywhere it shows.
6. New **dryer name** master, each name mapped to a dryer category.

**C · Quotation form — Machine details, section A**
([QuotationForm.tsx:361-495](frontend/src/apps/ocpi/components/QuotationForm.tsx#L361-L495))

7. The first row becomes **Machine category · Machine · Type of head**.
8. The machine list filters to the chosen category.
9. **Type of head is display-only**, read from the machine's mapping — the user cannot change it.
10. Then No. of machines · No. of print heads required.
11. Then Type of ink · **Ink selling price** (rename of "Ink price") · Ink credit terms.
12. "Dryer required" leaves section A entirely.

**D · Quotation form — a new Dryer details section, below Machine details**

13. Shown only when the machine's **category** says a dryer is required; hidden otherwise.
14. **Dryer category**, then **Dryer name** filtered by that category.
15. Move in from the detail card
    ([QuotationForm.tsx:938-978](frontend/src/apps/ocpi/components/QuotationForm.tsx#L938-L978)): how many chambers ·
    **Heating medium** (rename of "Heating mode"). ⚠ **AMENDED by the third pointer — the dryer
    warranty does NOT come here.** It moves to *Warranty & service* instead; see **F** below. This
    point originally listed it, and the two would contradict each other.
16. Move the **Options included** block in as well
    ([QuotationForm.tsx:980-1008](frontend/src/apps/ocpi/components/QuotationForm.tsx#L980-L1008)).
17. New: **is the dryer part of the deal?** If it is not inclusive, ask for a **dryer price**.
18. The PDF money block reads in three lines — **machine total → dryer total → final total**.

**E · Commercial terms — the dollar position**  *(added 27-Aug-2026, second pointer)*

19. **High Seas is always a USD deal**, and its value is always exclusive of GST.
20. The **USD → INR rate belongs to any dollar deal**, High Seas or Others alike — not to one of them.
21. Wherever a deal is in USD, the papers show **both USD and INR**.

⚠ **MOSTLY ALREADY BUILT — the requirement is met everywhere except the form, where it fails
completely.** Checked in full on 27-Aug-2026:

- *Already correct:* High Seas ⇒ USD is **forced server-side** in `fms_ocpi_write_quotation`
  ([20261019120200:70-71](supabase/migrations/20261019120200_fms_ocpi_commercial_terms.sql#L70-L71)) — `case when v_transport = 'high_seas'
  then 'USD'` — with a comment saying it is forced rather than defaulted *"so a stale INR left on the
  row cannot survive the switch"*. High Seas carries no GST ([branching.ts:102](frontend/src/apps/ocpi/lib/branching.ts#L102), `gst_rate`
  null and not zero, both papers omitting the tax row). The value field already reads **"Total deal
  value (excluding GST)"**. The rate is **not** gated on deal type — [branching.ts:105](frontend/src/apps/ocpi/lib/branching.ts#L105) tests the
  currency alone. And both papers already print both currencies with the frozen rate beside them:
  summary [quotationPdf.ts:98-107](frontend/src/apps/ocpi/lib/quotationPdf.ts#L98-L107), detailed [ocPdf.ts:253-262](frontend/src/apps/ocpi/lib/ocPdf.ts#L253-L262). **Nothing to add
  for point 21.**
- 🔴 *The defect.* **The form never sets the draft's currency to USD when High Seas is picked.**
  `EMPTY_DRAFT.dealValueCurrency` is `"INR"`; the picker is `disabled={disabled || isHighSeas}`
  ([QuotationForm.tsx:631-638](frontend/src/apps/ocpi/components/QuotationForm.tsx#L631-L638)) but **nothing patches the value**, and there is no
  `useEffect` in the file at all. So a High Seas deal shows **Currency: INR**, greyed out, directly
  under a note reading *"A high seas sale is in US dollars … Both are set for you"* — and, because
  `show("fxRate")` tests `dealValueCurrency === "USD"`, **the USD → INR rate box never renders**.
  High Seas, the one deal type that is *always* a dollar deal, is the only one where the rate cannot
  be fetched or typed.

  **What that costs, end to end:** no rate is required anywhere — not in `missingForSubmit`
  ([fieldSpec.ts:600-630](frontend/src/apps/ocpi/lib/fieldSpec.ts#L600-L630)), not in the `fms_ocpi_complete_when_submitted` check constraint
  ([20261019120100:240-266](supabase/migrations/20261019120100_fms_ocpi_merged_form_writes.sql#L240-L266)) — so the deal submits happily. The server then
  forces the row to USD with `fx_rate` null, so `deal_value_inr` is null
  ([:126-127](supabase/migrations/20261019120200_fms_ocpi_commercial_terms.sql#L126-L127)), so `write_oc`'s `v_value` is null, so
  `machine_value_inr`, `gst_amount_inr` and `total_inr` are **all null**. Both papers take the USD
  branch and print **"Value in INR" blank and "Total Value INR" blank** — including the orange total
  strip on the detailed sheet. **A High Seas contract goes to a customer with no rupee total on it.**
  It self-corrects only if somebody saves, reloads, notices the rate box has appeared, and
  regenerates.

  **The fix is small and belongs in two places, not one:** coerce `dealValueCurrency` to `"USD"` when
  the deal type becomes High Seas (mirroring what the SQL already does, so form and server agree —
  the same two-engines trap as the dryer branch above), and make the rate **required to submit** on
  any USD deal, in `missingForSubmit` and in the check constraint. This is a **defect, not new
  work** — move it to [Fixes](#fixes) once it is repaired and stamped.


**F · Warranty & service — defaults per machine, and no post-warranty price**  *(added 27-Aug-2026, third pointer)*

The block at [QuotationForm.tsx:815-865](frontend/src/apps/ocpi/components/QuotationForm.tsx#L815-L865) today asks: printer warranty period ·
print-head warranty period · **head price after the warranty** · consumables supplier · the insurance
clause. It becomes the one place every warranty is asked.

22. **Add a spare-parts warranty** — a wholly new field; nothing like it exists on the deal today.
23. **Move the dryer warranty here**, out of the dryer questions. *(This is why point 15 above is
    amended: the dryer section takes chambers and heating medium only.)*
24. **Map a default warranty against each machine in the master** — printer, print head, spare parts
    and dryer, each *where applicable*. **The client will supply the default values per machine.**
25. Selecting a machine **pre-fills all four** from its mapping.
26. The user **may overwrite** any of them and pick another option.
27. **An overridden warranty must be highlighted at approval**, so the Directors can see the default
    was departed from.
28. **Remove "Head price after the warranty" entirely.** No price after the warranty anywhere.

⚠ **Point 28 is not a field deletion — it leaves a ruled blank inside a live contract clause.**
`{{post_warranty_head_price}}` is embedded in the **PRINT HEAD POLICY PROGRAM** section body of **four
machines in the live database** — *Homer K24, Homer K32, P8D and P8S* (checked 27-Aug-2026: 4 of 82
machine sections; `{{dryer_warranty}}` is used by **none**, so point 23 is token-safe). The clause
reads:

> *"…After that period a New Print Head will be priced at INR {{post_warranty_head_price}} plus GST, on
> the new machine, first time installed head."*

An unresolved token renders as a **ruled blank**, deliberately ([tokens.ts](frontend/src/apps/ocpi/lib/tokens.ts) — so a wrong token name
degrades to "somebody must fill this in" rather than leaking braces). Delete the field alone and those
four contracts print *"priced at INR ______ plus GST"*. **The four clause bodies must be reworded as
live data** through the Machine template screen — the seed migration is history and editing it changes
nothing — and the token retired from `tokensFor` and `TOKEN_HELP`. The `post_warranty_head_price`
column itself **stays** (additive-only); it simply stops being asked and written. This is CLAUDE.md's
container rule again: removing the control is the easy half.

⚠ **Point 27 has nowhere obvious to go, and the reason is deliberate.** `ApprovalPanel`'s own header
states the rule: *"THE DOCUMENTS ARE RENDERED, NOT SUMMARISED — approving here issues a contract; doing
it from a list of field values would mean confirming something nobody had read."* There is no field
table on that screen to highlight in. So the override notice has to be a **callout above the rendered
papers** — an annotation beside the documents, not a substitute for reading them — naming each
overridden warranty, the value chosen and the machine's default. Printing it on the paper itself would
put an internal control note on a customer's contract; do not.

✅ **The pattern to copy already exists in this module: `fxRateOverridden`.** A boolean on the deal,
set by the form the moment a person replaces a fetched value, frozen onto the revision, and carrying a
`FIELD_LABEL` ("Rate entered by hand") so it also surfaces in the revision diff. Four warranty
overrides should take exactly that shape — one flag each, set on change, labelled, frozen. Do not
invent a second mechanism.

**Other things this touches**

- The warranty option lists are **code constants**, not masters — `WARRANTY_MONTHS` and
  `PRINTER_WARRANTY` ([fieldSpec.ts:278-289](frontend/src/apps/ocpi/lib/fieldSpec.ts#L278-L289)). A default held on the machine master must
  draw from the same vocabulary, or the two will drift — which is the exact failure `fieldSpec.ts`'s
  own header describes for the head/ink/dryer lists that were promoted to masters. Decide before
  building whether these become masters too, or whether the master field is a `select` bound to the
  constants.
- **Spare-parts warranty is a new column**, so it needs: a nullable column on `fms_ocpi_deals`, an
  entry in `payloadFromDraft` **and** `FIELD_LABEL` (or the revision diff shows a raw key), a place in
  the **part-B key-sniff array** in `fms_ocpi_save_draft`, and a line in `fms_ocpi_write_oc`. Same four
  places every new field in this entry needs.
- A `{{spare_warranty}}` token is worth adding alongside `{{machine_warranty_months}}` and
  `{{head_warranty_months}}` if any template should quote it.
- Moving the dryer warranty out of the dryer block means the **branch rule changes**: `dryerWarranty`
  is currently gated on `hasDryer` in [branching.ts:89](frontend/src/apps/ocpi/lib/branching.ts#L89) *and* nulled by `fms_ocpi_write_oc`. In
  Warranty & service it should still only be asked when the machine's category carries a dryer — so it
  keeps a branch, but on the new category mapping, **in both engines**.


**G · Delete the "Delivery & tax" block from Document details**  *(added 27-Aug-2026, fourth pointer)*

29. **Delivery days** moves out of Document details into **Commercial terms**.
30. **Delivery term** (`tradeTerm`) is **removed** — the client's reading is that Commercial terms
    already covers it.
31. The **Delivery & tax** block itself then goes.

🔴 **THE BLOCK HOLDS THREE CONTROLS AND THE POINTER NAMED TWO. The third is GST %.**
[QuotationForm.tsx:867-900](frontend/src/apps/ocpi/components/QuotationForm.tsx#L867-L900) is Delivery days · Delivery term · **GST %** — the last
hidden on a High Seas sale, which is why it is easy to miss when reading the screen. **GST % must move
to Commercial terms with the delivery days, not go with the block.** It is the rate that produces
`gst_amount_inr` and `total_inr` on every *Others* deal. Delete it and nothing breaks, nothing fails to
compile, and every deal is quoted at 18% forever — `EMPTY_DRAFT.gstRate` is `"18"` and `draftFromDeal`
falls back to `"18"`, so the value keeps being sent, silently, with no way to change it. That is the
[FIX-4](#fixes) signature exactly: the trigger removed, everything behind it intact, the build green.
Commercial terms is where it belongs anyway — it is tax on a price, and the price is already there.

⚠ **"Already covered in commercial terms" is true for High Seas and false for Others.** `TRADE_TERMS`
is `Ex-Work Surat · CIF · FOB · EX Factory`. Commercial terms carries **High seas delivery via**
(`CIF · EX Factory · FOB`) — but [branching.ts:91](frontend/src/apps/ocpi/lib/branching.ts#L91) shows it **only on a High Seas deal**. An
*Others* deal gets only *Local delivery cost borne by*, which is a **cost bearer, not a delivery term**.
So after this change an Others deal would carry no delivery term at all. Either widen the high-seas
field to every deal type, or accept that Others deals stop stating one. **Worth putting back to the
client before building.**

⚠ **`{{trade_term}}` is in a live clause on ALL TEN templates that exist.** Checked 27-Aug-2026:
10 of 10 machines with a template carry it in **SALE CONDITIONS OF THE SUPPLY**, which reads:

> Delivery Terms: `{{trade_term}}`
> Delivery Days: `{{delivery_days}}`
> Payment terms: `{{payment_terms}}`
> Insurance: Product Insurance borne by Customer.

Unresolved tokens print as ruled blanks, so removing the field puts **"Delivery Terms: ______" on every
detailed sheet the module can produce**. The line must be deleted from all ten section bodies as **live
data**, through the Machine template screen. (`{{delivery_days}}` is unaffected — that field survives,
it only moves.) This is the second time in this entry that removing a field would blank a contract
clause; see also point 28.

**The orphan sweep for this one** — per CLAUDE.md, every control accounted for:

| In the block | Where it goes |
|---|---|
| Delivery days | → Commercial terms (point 29) |
| Delivery term | → removed (point 30) |
| **GST %** | → **Commercial terms** — *not named by the client, must not be dropped* |

And what `tradeTerm` leaves behind once the field is gone:
- `missingForDetailSheet` warns when it is blank ([fieldSpec.ts:653](frontend/src/apps/ocpi/lib/fieldSpec.ts#L653)) — **remove that check too**, or the
  salesperson is warned that a field they cannot see is empty.
- The Deal Register's **"Delivery term"** column ([exportRegister.ts:71](frontend/src/apps/ocpi/lib/exportRegister.ts#L71)) — keep it for deals
  raised before the change, or drop it; a decision, not an oversight.
- The `trade_term` token in `tokensFor` and its `TOKEN_HELP` entry ([tokens.ts:68,137](frontend/src/apps/ocpi/lib/tokens.ts#L68)) — retire
  both once the ten clause bodies no longer reference it, and **in that order**.
- The `trade_term` column **stays** (additive-only), and so does its key in `payloadFromDraft` and the
  part-B sniff array until the writers stop setting it.


**H · WHERE the mapped data lives — master, or template?**  *(design decision, 27-Aug-2026)*

The client asked this directly, wanting the machine master not to be loaded up unnecessarily. The
answer is **all of it in the masters, none of it in the template — but split across two masters, not
piled onto one.**

**The test that decides it.** Both screens edit *the same table* — `fms_ocpi_machines` carries the
identity columns *and* the template columns, with `fms_ocpi_machine_sections` as its child. So this is
not a schema question, it is a question of what the value **does**:

> **Does it drive the form, or does it appear as prose in the document?**
> Drives the form → **master** (read live, every time the form renders).
> Appears in document prose → **template** (frozen onto each version at generate time).

Every item across batches 1–3 — category, type of head, dryer-required, the four warranty defaults,
the billing name — **drives the form**. None of them is document prose. So none belongs in the
template.

**Three reasons the template is not merely a worse home but a wrong one:**

1. **The template is frozen per version, by design.** `MachineTemplate.tsx`'s own header: *"editing here
   changes what future documents say, not past ones — every finalised quotation freezes the resolved
   template into its own version row."* A default read out of frozen text would be the default as of
   the last generation, not the one in force now.
2. **It holds prose, not values.** A warranty written into a clause body is a sentence. It cannot
   prefill a `Combobox`, and — fatally for point 27 — there is **nothing to compare against** to detect
   that the salesperson overrode it.
3. **18 of the 28 machines have no template at all** (checked 27-Aug-2026: 28 machines, 10 with a
   template, 18 without, all 28 active). Those 18 are fully quotable today — a machine with no template
   still issues the summary sheet. Put the mapping in the template and **two thirds of the catalogue
   cannot be mapped**.

**The proposed split**

| Where | What it holds | Why |
|---|---|---|
| **Machine category master** *(new, a handful of rows)* | category name · sort order · **dryer required** | Already settled: dryer-required is a category property. Anything constant across a category belongs here — one edit covers every machine in it. |
| **Machine master** *(28 rows)* | **billing name** · category *(FK)* · **type of head** *(FK)* · warranty defaults **only if they vary machine by machine** | Identity and the per-model facts the form reads. |
| **Machine template** | unchanged — spec rows, composition, clause bodies | Document text only. |

**This is also the answer to "don't load up the machine master".** The way to keep it light is not to
move data to the template — it is to push whatever is *constant per category* up to the category
master. If the four warranties are the same for every machine in a category, that is **~6 categories ×
4 values ≈ 24 entries instead of 28 machines × 4 ≈ 112**, and one correction fixes a whole family.
Where a single machine genuinely differs, it overrides — the same category-default-plus-override shape
the warranties already need for the salesperson.

**What the Excel sheet decides** *(client is sending it)*: whether each warranty is constant per
category or genuinely per machine — which is the only open input to the table above; how many
categories there actually are; whether *type of head* is truly one per machine or one per category; and
which machines have no dryer/spare warranty at all, since the client said *"if applicable"*. Nothing
else in this entry is blocked on it, so the sheet can arrive whenever it is ready.

⚠ Whatever the sheet says, the **28 existing machines still need back-filling** before a
category-filtered picker returns anything — already on the discuss list.


**I · The head and the centering device get sections of their own**  *(added 27-Aug-2026, fifth pointer)*

The form's order becomes **Machine details → Dryer details → Head → Centering device**, and the three
equipment sections share one shape: *how it ships*, and *whether it is invoiced separately*.

32. **Move "The head" out of Document details** ([QuotationForm.tsx:902-936](frontend/src/apps/ocpi/components/QuotationForm.tsx#L902-L936)) into its own
    section, placed **after** the Dryer section.
33. **Reword it** so the section covers both the shipment questions and the invoice question, rather
    than reading as shipping alone.
34. **The Dryer section gains the same pair** — *how to ship the dryer* and *separate invoice for the
    dryer* — and its wording likewise covers both. *(Confirmed 27-Aug-2026.)*
35. **A new, small Centering device section** after the head: *how to ship* and *separate invoice for
    the centering device*. Two questions, as specified.
36. The centering section applies to the **K64 only**.
37. **The "External centering system" tick stays where it is** — it travels with the other three
    *Options included* ticks into the Dryer section (point 16). *(Confirmed 27-Aug-2026: "that is a
    separate option, and this is a separate thing".)* The new section does **not** branch on it.

🔴 **THESE ANSWERS CURRENTLY PRINT NOWHERE — ON EITHER PAPER.** Swept 27-Aug-2026: `head_ship_mode`,
`head_ship_via` and `head_separate_invoice` appear in the form, the field spec, the branch rules, the
fetch mapping and both SQL writers — and in **neither** [quotationPdf.ts](frontend/src/apps/ocpi/lib/quotationPdf.ts) nor
[ocPdf.ts](frontend/src/apps/ocpi/lib/ocPdf.ts), in no template token, and in no register column. They are asked, stored,
and frozen onto every revision, and then no document ever says what was agreed. Giving them a section
of their own makes them **more** prominent on screen while they remain invisible on the contract.
**Decide where they print before building this** — most likely a shipment/invoicing block on the
detailed sheet, alongside the money rows. The same decision covers the new dryer and centering
answers, which would otherwise join them.

⚠ **K64 has no template**, so it issues the summary sheet alone (10 of 28 machines have a template;
K64 is one of the 18 without). Even once the above is fixed, a centering answer with nowhere to print
on a *detailed* sheet still prints nowhere for the one machine the section exists for — unless it goes
on the **summary** sheet, or K64 gets a template. This is the sharper half of the finding.

🔴 **DO NOT HARD-CODE `machine.name === "K64"`.** Section **H** settled the principle and it applies
directly: this is a **machine-master flag**, not a name check. A literal name breaks the moment the row
is renamed, a variant is added, or a second machine gets a centering device. Add one nullable boolean
to the machine master — *centering device applicable* — false by default, true on K64, and the rule
becomes data the client can maintain. One column, no code change ever again.

⚠ **The master row is named `K64`, not "Homer K64".** The client said *"Hammer K64"*; the live row is
bare **`K64`** — `has_template = false`, `sort_order = 900`, active — while its siblings are **"Homer
K24"** and **"Homer K32"**. Confirm this is the right row, and consider renaming it *Homer K64* for
consistency. (With the flag above, a rename is harmless; with a name check it would silently disable
the feature — which is the argument for the flag in one sentence.)

**What this costs in the four usual places.** Four new nullable columns —
`dryer_ship_mode`, `dryer_separate_invoice`, `centering_ship_mode`, `centering_separate_invoice` —
each needing its column, an entry in `payloadFromDraft` **and** `FIELD_LABEL`, a place in the part-B
key-sniff array, a line in `fms_ocpi_write_oc`, and a branch rule **in both engines**. Plus the one
machine-master flag.

**Reuse, do not re-declare.** `HEAD_SHIP_MODES` (*With the machine* / *Separate shipment*) and
`HEAD_SHIP_VIA` are code constants in [fieldSpec.ts](frontend/src/apps/ocpi/lib/fieldSpec.ts). The dryer and the centering device should
read the **same** lists rather than gaining parallel copies — three lists of one vocabulary is the
exact drift `fieldSpec.ts`'s own header warns about.

**Branching that must move with the block.** The head questions are gated on `incl_head = true` in
[branching.ts:79-84](frontend/src/apps/ocpi/lib/branching.ts#L79-L84) *and* nulled again by `fms_ocpi_write_oc`. Moving the block changes where
it renders, not what governs it — **both** engines keep the rule. The new sections need the same
treatment: the dryer pair gated on the machine category carrying a dryer, the centering pair on the
new machine flag.

⚠ **Centering is now asked about in two places on one form** — the *Options included* tick in the
Dryer section, and this section. That is the client's explicit decision, recorded here so it reads as
intended rather than as a duplication somebody later "tidies up". Note the tick alone drives the
printed **"External Centring Device"** composition line ([ocPdf.ts:57-64](frontend/src/apps/ocpi/lib/ocPdf.ts#L57-L64)); the new section
drives nothing printed at all until the finding above is settled.


**J · Special remarks — one box, entered point-wise**  *(added 27-Aug-2026, sixth pointer)*

38. **Remove "Remarks — balance heads to be sold later"** (`headBalanceRemarks`).
39. **Remove "Any other commitments on charges made by us"** (`otherCommitments`).
40. **Keep "Special remarks"** and tell the user, prominently, to enter every remark **point-wise** —
    a stronger hint on the field and a placeholder that shows the shape.

**The orphan sweep** — per CLAUDE.md, the card holds **four** controls, not three:

| In the Special remarks card | Outcome |
|---|---|
| Special remarks (`remarks`) | stays, with point-wise guidance |
| Balance heads to be sold later | removed (point 38) |
| Any other commitments | removed (point 39) |
| **Dollar-exchange clause + "Agreed with the customer"** (`dollarClauseAgreed`) | **stays** — shown on USD deals only ([QuotationForm.tsx:779-786](frontend/src/apps/ocpi/components/QuotationForm.tsx#L779-L786)) |

The client's wording was precise and the fourth control is safe; it is listed because proving it is the
rule, not because it was in doubt.

🔴 **THE FIELD'S OWN HINT IS ALREADY A FALSE PROMISE, AND THIS MAKES IT WORSE.** Special remarks is
labelled `hint="prints on both sheets"` — and the **detailed sheet prints no remarks at all**. There is
no code path for it in [ocPdf.ts](frontend/src/apps/ocpi/lib/ocPdf.ts) and **no `{{remarks}}` token exists**, so no machine template can
reference it either (swept 27-Aug-2026). It prints on the summary sheet only. This pointer makes
Special remarks the *sole* surviving free-text box and asks to give it more prominence, so the
salesperson is being pushed to put more into a field that reaches half the places the form claims.
**Either print remarks on the detailed sheet, or correct the hint** — but not neither.

✅ **Point-wise text will survive onto the summary sheet — verified.** `wrapText` calls
`pdf.splitTextToSize`, which honours `\n`, and `safeText` only substitutes specific glyphs (arrows, Δ,
fullwidth brackets) — it does **not** strip newlines ([pdfBrand.ts:125](frontend/src/shared/lib/pdfBrand.ts#L125)). So one point per line
renders as one line per point. No renderer change is needed for the format itself.

⚠ **But a long point-wise block can run off the page.** A row's height is `max(17, 7 + lines × 10)`
and the page-break check moves the **whole row** to a fresh page — it never *splits* a row
([quotationPdf.ts:296-317](frontend/src/apps/ocpi/lib/quotationPdf.ts#L296-L317)). A remarks block taller than the body area therefore overflows the
bottom silently. Today that is unreachable in practice because the box is three rows and people write
a sentence; **encouraging point-wise entry is exactly what makes it reachable.** Either cap the input,
or teach the renderer to split a tall row across pages. Worth doing at the same time.

⚠ **This partly reverses OCPI-2's point 5**, which deliberately *gathered* the master form's three
scattered remark boxes — Q23 (balance heads), Q43 (other commitments), Q46 (remarks) — into one group
so a salesperson no longer had to remember which heading a note belonged under. Two of the three now
go away entirely. That is a legitimate change of mind, but **the comment at
[QuotationForm.tsx:737-742](frontend/src/apps/ocpi/components/QuotationForm.tsx#L737-L742) explains the gathering and would be left describing a form that
no longer exists** — rewrite it, do not leave it.

**What else moves**

- **Section D of the summary sheet drops to one row.** [quotationPdf.ts:137-145](frontend/src/apps/ocpi/lib/quotationPdf.ts#L137-L145) builds it from
  three; the balance-heads row and its `inclHead === true` guard go with the field.
- **A branch rule is orphaned.** `headBalanceRemarks: (d) => d.inclHead === true`
  ([branching.ts:82](frontend/src/apps/ocpi/lib/branching.ts#L82)) becomes a visibility rule for a field nobody can see — remove it there
  **and** the matching null in `fms_ocpi_write_oc`, the usual pair.
- **Both columns stay** (additive-only), as do their keys in `payloadFromDraft` and the part-B sniff
  array until the writers stop setting them. Deals already raised keep their text, and their **stored**
  papers are untouched — but a re-render of an old deal would silently drop those two rows, since
  `sectionRows` builds from the live row. Acceptable; worth knowing before somebody regenerates one.


**K · The machine sheet — what it gives us**  *(27-Aug-2026)*

Source: `Misc/Bushra Reports/OCPI/OCPI Machine Templates.xlsx`, sheet **Machines**, 28 rows × 20
columns. ⚠ An older copy sits at the repo root — the OCPI-folder one is live.

✅ **All 28 machine names match the live master exactly**, so it imports by name.

| Sheet column | Fills | Coverage |
|---|---|---|
| PRODUCT NAME - AS PER INVOICE | billing name (point 1) | 21 of 28 |
| TYPE OF MACHINE | category (point 2) | 28 — Direct 10 · Sublimation 12 · Other 4 · "JAY" 2 |
| DRYER | dryer required (point 4) | 28 — yes on 11, no on 17 |
| TYPE OF HEAD | print heads (point 3) | 22 of 28 |
| MACHINE / HEAD WARRANTY | — | 5 of 28 — **now irrelevant, see M** |

🟢 **A good idea nobody asked for.** The four extras — air blade, external centering, ink dust
exhauster, chilling system — are given per machine as **Yes / No / Optional**. That third value says
*whether to ask at all*: No = the machine cannot carry it, never show the question; Optional = ask.
Today all four are asked on every deal regardless. **Adopted.**

Also present, not requested: **SUPPLIER NAME** (11 distinct) and **HEAD DPI**, which overlaps TYPE OF
HEAD. **CHAMBER · HEATING MEDIA · PLATTE** appear as machine columns but are blank for every machine
that has a dryer, so they give no defaults and stay deal-level questions.

🔴 **The sheet overturned the category-level dryer flag.** *Other* is split — Position Printer needs a
dryer, the three Pengdas do not. **Settled: the flag goes on each machine.** Point 4 is amended.

🔴 **The centering device is not K64-only.** It is *Optional* on Homer K24, K32, K64 and JP7, and *Yes*
on JPK — five machines. Point 36 is amended: drive it from the machine's capability, never a name check.

**Data to tidy in the sheet:** "JAY" is not a machine type (it is the category on Label Printer and
Book Printer); 6 machines have no head; 7 have no billing name; the three Fab Pro rows are empty from
the extras onward; Yes/No values vary in case and padding, so the import must trim and case-fold.

⚠ **The sheet claims 21 templates; the system has 10**, and the eleven missing decks are not in the
folder either. This names them for OCPI-1's standing question: **K64, JP7, JPK, Fab Pro 1I, Fab Pro 2I,
Position Printer, KoloRado Alpha 3 (12 heads), KoloRado Alpha 3.2 (8 heads), Pengda PD-1700XD-800,
Pengda PD-1800XD-800, Rocket.**

**L · Print heads are many-per-machine, and the name mapping**  *(settled 27-Aug-2026)*

41. **A machine may carry several heads**, and the quotation shows **all** of them. Point 3 assumed one;
    it is amended. Machine→heads becomes a link table; the deal keeps storing the names as joined text,
    so old quotations still read correctly and the revision diff is unaffected.

The sheet and `fms_ocpi_head_types` share **no** common value. The mapping below is mine, proposed at
the client's request; the supplier column supports it — every "EX600 RC Katan" machine is a Han Glory
machine, and the system's Katana and RC rows are both Hanglory.

| Sheet value | Machines | Becomes | In the system? |
|---|---|---|---|
| I3200 | 9 Kolorado + Foil | Epson I3200 | ✅ *EPSON PRINTHEAD I 3200* |
| 300 DPI KYOCERA | P8D | Kyocera 300 | ✅ *300DPI - KJ4B* (KJ4B is Kyocera) |
| EX600 RC KATAN & KYOCERA | P8S | Katana 600 **+** Kyocera 600 | ✅ both |
| EX600 RC KATAN & HOMER | Homer K24, K32, K64 | Katana 600 **+** Homer | ✅ Katana · ❌ **Homer new** |
| MS & KYOCERA BOTH | JP7, JPK | MS **+** Kyocera 600 | ❌ **MS new** · ✅ KJ4B |
| MS HEAD | Mini Lario | MS | ❌ **MS new** |
| EX600 RC & KYOCERA | Rocket | RC 600 **+** Kyocera | ✅ both |
| RICHO HEAD | Fab Pro 1I/2I/3I | Ricoh | ✅ *RICOH GEN 6 HEAD* ("Richo" = Ricoh) |
| "NO" / blank | 3 Pengdas, Position, Label, Book | none | — |

**All six existing rows are used; only two new ones are needed — "MS" and "Homer".**

⚠ Three doubts, all data corrections rather than build changes: is **"Homer"** a head or the machine
brand written into the head column; is the Fab Pro's Ricoh really a **Gen 6**; and **Rocket** says
"EX600" in the head column but **300** in the DPI column — which is right?

**M · What the later pointers changed — read this before building A–J**

Six conversations amended earlier sections. The current shape is:

- **Warranties are FIXED, not mapped** — machine **12 months**, head **18 months**, **no** dryer or
  spare-parts warranty. No dropdown, no per-machine default, **no override highlight at approval**.
  An exception is written into Special remarks. Section **F** points 22–27 are withdrawn; only point
  28 (remove the post-warranty price) survives. The periods become **settings**, like quotation
  validity. 🔴 The machine-warranty placeholder is in **all ten** templates and the head-warranty one
  in **four** — re-point them at the settings *before* removing the fields, or every detailed sheet
  prints a blank warranty.
- **Shipment and invoice become ONE section**, not questions scattered per item. Sections **D** and
  **I**'s separate Head and Centering sections collapse into it. A row per item that is in the deal —
  **head · dryer · spare parts · centering device** — each asking how it ships, the route when
  separate, whether it is separately invoiced, and **if yes, quantity and total amount excluding tax**.
  Spare parts gain shipment and invoicing for the first time.
- **The shipping and billing block prints on the DETAILED paper** *(settled)* — which answers the open
  question about answers that were collected and never printed.
- **The dryer flag is per machine**, not per category (section K).
- **A machine may have several heads** (section L).
- **All data in the system is dummy**, confirmed by the client, so no change here has to protect live
  customer work.

**Settled with the client 27-Aug-2026**, recorded as decisions rather than questions: dryer-required is
mapped on the **category**, not the machine; **both** names print, and the existing master value *is*
the code and is left untouched; the money block is machine total · dryer total · final total.

**What this reaches beyond the form.** Five findings from the audit, each of which loses data silently
if it is missed:

- **There are two branch engines and they must change together.** `hasDryer` lives in
  [branching.ts:56](frontend/src/apps/ocpi/lib/branching.ts#L56) *and again in SQL*, in `fms_ocpi_write_oc`
  ([20261019120200:197-202](supabase/migrations/20261019120200_fms_ocpi_commercial_terms.sql#L197-L202)), both keyed on the
  string `dryer_type = 'Not Applicable'`. The server **nulls `dryer_chambers`, `heating_mode` and
  `dryer_warranty` on every write** it believes is dryer-less. Move the condition to the category
  mapping in TypeScript alone and the server erases the answers on save. `branching.ts`'s own header
  says it: *"delete it here AND in the matching SQL writer — they must not disagree."*
- **`fms_ocpi_save_draft` sniffs for part-B keys by name** —
  [20261019120100:112-120](supabase/migrations/20261019120100_fms_ocpi_merged_form_writes.sql#L112-L120) lists 26 literal keys and calls
  `write_oc` only when one of them is present. Every new dryer field must join that array, or a payload
  carrying only them never reaches the writer.
- **The money is derived server-side and has no room for a second price.** `write_oc` computes
  `machine_value_inr`, `gst_amount_inr` and `total_inr = value + gst`; the browser never holds them. A
  dryer price needs its own column and a new derived grand total, in that function.
- **The frozen payload is enumerated by hand, in two places** — `payloadFromDraft` and `FIELD_LABEL`
  ([fieldSpec.ts](frontend/src/apps/ocpi/lib/fieldSpec.ts)). [revisionDiff.ts](frontend/src/apps/ocpi/lib/revisionDiff.ts) takes both its
  labels **and its display order** from `FIELD_LABEL` by camel→snake. A field missing from either shows
  in the revision history as a raw `dryer_price`, or not at all.
- **`machine_name` is frozen onto each version at generate time**
  ([useQuotationDraft.ts:149](frontend/src/apps/ocpi/pages/deals/useQuotationDraft.ts#L149)). If the billing name prints it must be
  frozen alongside — and every version generated before this change carries only the code, so the
  renderer needs a fallback rather than a blank.

**Smaller things the build should not have to rediscover.** The options-included ticks are **machine**
options in the printed document — `optionalExtras()` ([ocPdf.ts:57-64](frontend/src/apps/ocpi/lib/ocPdf.ts#L57-L64)) appends them to the
machine's *composition* list, so moving the block changes where it is asked, not where it prints.
`OcpiMasterType` is a four-value union mirrored in **six** places (the type, two SQL `check`
constraints, the `elsif` chain in `fms_ocpi_resolve_master_request`, Settings → Master owners, and
`RequireMasterOwner`), so making the two new masters *requestable* touches all six and making them
admin-only touches none. `fms_ocpi_machines.name` is `unique` and referenced `on delete restrict` — the
new name column must **not** be unique, since two machines may share a billing name. `MasterCrud` has
no boolean field type, so "dryer required" is a Yes/No `select`, and the category-filtered dryer picker
is a `custom` field — whose `render` already receives sibling values and a `setField` to clear a choice
its narrowing has invalidated. Master import/export columns derive from `fields` automatically, so the
client's own `OCPI Machine Templates.xlsx` will be a column short. And per CLAUDE.md's container rule:
moving the head-type Combobox out of the form was checked — its master-request path survives via
[MasterRequests.tsx:173](frontend/src/apps/ocpi/pages/MasterRequests.tsx#L173) — but the same check is owed to `dryer_type` when its
Combobox moves.

**Supabase stays additive-only.** New nullable columns and new tables; never a rename of `dryer_type`,
`heating_mode` or `ink_price`. The labels move, the columns do not.

**To discuss with the client**

- [ ] **Does the dryer price attract GST**, and is the "final total" before or after tax? Three lines
      were specified; where GST sits among them was not.
- [ ] **Where should the options-included ticks print?** They are asked in the dryer section now but
      print under the machine's composition. Moving the printing is a second change.
- [ ] **Are machine-category and dryer-name requestable masters**, or admin-only? Requestable costs six
      touch points; admin-only costs none.
- [ ] **Who back-fills the 28 machines** with a category and a head mapping? Until somebody does, a
      category-filtered machine picker shows nothing.
- [ ] **What happens to deals already raised** whose `head_type` was typed free-hand and no longer
      matches the machine's mapping — read-only history, or re-derived on the next revision?
- [ ] **The default warranty values per machine** — printer, print head, spare parts, dryer. The
      client said they would share these; nothing can be mapped until they arrive.
- [ ] **How the four warranty clauses should read once the post-warranty price is gone.** Removing the
      field leaves a ruled blank mid-sentence on Homer K24, Homer K32, P8D and P8S — somebody has to
      supply the replacement wording, and it is contract text, not a code decision.
- [ ] **Do the warranty option lists become masters**, or stay as code constants the machine master
      selects from? Two copies of one vocabulary will drift.
- [ ] **Is the GST % meant to survive?** It sits inside the Delivery & tax block being deleted and was
      not named. It must move to Commercial terms, or every *Others* deal is pinned at 18% with no way
      to change it.
- [ ] **Does an *Others* deal still need a delivery term?** Removing `trade_term` leaves High Seas
      covered (via *High seas delivery via*) and Others with nothing but a cost bearer.
- [ ] **The replacement wording for "Delivery Terms:" on all ten templates** — the line has to be
      removed from *SALE CONDITIONS OF THE SUPPLY*, and that is contract text.
- [ ] 🔴 **Where should the shipment and separate-invoice answers PRINT?** Head, dryer and centering
      are all captured and stored today and appear on **neither** paper. A section of their own makes
      them prominent on screen and still invisible on the contract.
- [ ] **K64 has no template**, so it issues the summary sheet only — the centering answers have no
      detailed sheet to print on even once the above is decided. Summary sheet, or give K64 a template?
- [ ] **Is the master row `K64` the right machine**, and should it be renamed *Homer K64* to match
      Homer K24 / K32?
- [ ] **Should Special remarks print on the detailed sheet?** The field's hint already claims it prints
      on both; it does not, and there is no token for it. Now that it is the only remark box, decide:
      add it to the detailed sheet, or correct the hint.

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

*(cross-ref: **PF-13** — Recruitment's HOD / probation / `hr_head_approval` / `final_decision` and Exit's `hr_head_approval` / `fnf_approve` all rest on one person; **PF-14** — Travel Desk's director, advance and finance steps have nobody configured at all)*

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

### TR-1 · Travel reimbursement module  `[x]`
*Raised 2026-08-20 · Unblocked 2026-08-20 · **Built 23–24 Aug 2026.** Ten phases, each verified
against the live database and the running app before the next started. Live log:
[TRAVEL-DESK.md](TRAVEL-DESK.md).*

Delivered as **Travel Desk** ([frontend/src/apps/travel-desk/](frontend/src/apps/travel-desk/)) —
the whole trip lifecycle, not only the reimbursement half: request → band entitlement → approval →
advance → booking → travel → claim → daily allowance → HOD review → Finance verification →
settlement. One trip carries all of it, with many legs.

**Every question this entry asked has an answer, and it is a setting rather than code:**

| Asked | Answered |
|---|---|
| What the entitlement slabs key off | **Band → travel category → city tier.** The band comes from the org masters; the mapping and every rate live on an effective-dated **rate card** a Director confirms, so January's revision is a new card and not a deploy |
| Who approves, in how many stages | **Reporting manager for bands 1–5; manager + Director for bands 6–9** (§3.2), configurable in Settings → Approval matrix. The claim is approved again by the manager, then verified by Finance |
| Whether bills must be attached | **Per expense category**, with a receipt threshold and a self-declaration limit on each. §15's non-reimbursable list is carried as categories that refuse **by the category** — alcohol, fines and personal entertainment cannot be claimed or paid, and Finance cannot override that |
| How it settles, and whether it hands off to payroll | **It stops at Finance-marked Paid** — amount, date, mode and reference recorded — per the confirmed scope. Nothing writes to Tally or payroll: the ConnectWave mirror is read-only and there is no payroll integration. Where money comes *back*, the recovery is recorded against hr-exit's existing **Advance Recovery** deduction head |
| Whether an advance can be drawn before travel | **Yes**, capped at 90% of the estimate (§11.1), due **before departure** — the one deadline in the portal that counts backwards — and §11.2's "no second advance while one is unreconciled" is now enforceable, because Outstanding Advances can finally answer who owes what |

**Two things it does that were not asked for and are worth knowing about:**
- **GST input credit register** — §11.3 wants the credit on travel invoices; nothing in the business
  could list it, so nobody claimed it. The tax is apportioned to the settled share of each line.
  The company GSTIN is still unknown (**H8**) and the screen says so rather than printing a
  placeholder — until Finance confirms it, hotels bill employees personally and the credit is lost
  at source.
- **Policy exceptions** — §16 asks for a periodic review of exceptions and there was no list to
  review. Every capped line, every one Finance settled higher, every one settled lower, with the
  reason and whether §7.3's evidence and HOD approval are both on file.

**The hand-off this module makes possible:** hr-exit's `travel_advance` clearance row was a tick
from memory, because nothing could answer whether a leaver still owed travel advance. It now demands
evidence and can read the live figure by employee code — which matters, since exit cases carry a
nullable user id and plenty of staff never had a login.

**Not built, deliberately:** group travel (§11 is entirely per-employee, so two people travelling
together raise two trips), push notifications (the portal has no push infrastructure of any kind),
and any write to Tally or payroll.

**⚠ BUILT, NOT LIVE. Two things gate go-live, and both are HR's to answer:**
- **H1 — the policy contradicts itself on band → travel category.** §2 contains two tables, one
  after the other, that disagree: Band 8 is TC-A *and* TC-B; Band 3 is TC-D *and* TC-C. On live
  headcount that is **23 of 59 employees**, and Band 3 is the largest band and the field staff who
  travel most. Every cap, rate and class rule keys off it. Both readings are seeded on the draft
  card; confirming the card is what makes caps enforce rather than advise.
- **~30 figures marked `[⚠ CONFIRM]`** in the source, and Annexure C says no rate is final until
  both Directors sign off.

Six further contradictions (**H2**–**H7**) are recorded in [TRAVEL-DESK.md](TRAVEL-DESK.md) with the
reading taken for each. **H2 — the half-DA rule, which is impossible as written** — is resolved by
reading rather than guessing, and every threshold behind it is config, so a correction is a settings
change plus a recompute.

**Email notifications ship OFF.** Turning them on in Settings is a live send, and this module mails
people about their own pay.

---

## New Recruitment

*(cross-ref: **PF-13** — the MRF approvals get a reassign, and `fms_hr_can_act`'s hiring-manager branch `return`s with no fall-through)*

The live recruitment FMS — [frontend/src/apps/hr-recruitment/](frontend/src/apps/hr-recruitment/),
id `hr-recruitment`, tables `fms_hr_*`, shown in the portal as **New Recruitment**. The two entries
under **HR** above are separate *new* modules and do not belong here.

### NR-1 · Round 2 offers every head set up to raise an MRF, and can be handed over  `[x]`
*Raised 2026-08-25 · **Live 2026-08-26, 08:17 IST** on `master` at `adea51c` · SQL applied to
`icutjkrqkbzwvmnfbzpr` (`20261020130000`, `20261020130100`) BEFORE the frontend, and the rollback
rehearsed rather than read · **Not walked through in the running app** — the Playwright browser
profile was locked by an open Chrome session, so the picker, the handover and the outgoing-head ping
were proven against the database and by `npm run build`, but never clicked. Worth one pass by hand ·
Plan of record: `C:\Users\Admin\.claude\plans\now-in-this-the-groovy-cherny.md`*

Booking **Interview R2 — HOD** offers one name, and it is usually not a head of department. On
MRF-2627-0009 (Krishan Pal, Design Engineer) the only option was *Saloni Rathod · Executive* — the
person who raised the requisition.

**Root cause:** R1 resolves against the HR department and R3 against anyone designated Director, but
R2 alone reads the *requisition* — `hiring_manager_ids ∪ reporting_to_ids`
([interviewers.ts:42-45](frontend/src/apps/hr-recruitment/lib/interviewers.ts#L42-L45)) — and
`fms_hr_submit_mrf` defaults that to whoever raised the MRF. The stage has always been *labelled*
"HOD" while the picker delivered the raiser.

**Measured on live data:**

| Checked | Found |
|---|---|
| Requisitions naming any HOD / sub-HOD | **4 of 16** — so 12 of 16 R2 pickers offer no head at all |
| People assigned "Raise the MRF" in Setup → Step owners | **20** — the President, two Directors, the CFO, the HR Head, the Plant Head, the GMs and DGMs |
| Of those 20, holding no `hr-recruitment` module grant | **4** — Dimple, Khushi Soni, Nakuleshwar Sharma, Sourabh Rakesh Nagpal |

**What was decided:** the R2 list becomes the 20 people set up to raise an MRF, plus this
requisition's own hiring managers and reporting-to. A booked round gains a **Change interviewer**
button. The assigned head and the hiring manager **both** own the round, and the head is told by
bell, by the daily work email and by an immediate mail.

**⚠ It is not just a dropdown.** "The HOD" is hard-wired to `hiring_manager_ids` in five more
places — the RLS read gate `fms_hr_can_read_requisition`, the act gate `fms_hr_can_act`, its client
mirror in `store.tsx`, My Work and the daily digest in `items/hr.ts`, and the bell fan-out. Widening
only the picker books a head who cannot see the candidate, cannot record the result, and is never
told. Two further defects were found while auditing this: the queue calling an unbooked round
"Booked" (**FIX-3**, already affecting live rows) and panel names vanishing for anyone outside the
reader's own department.

**Email ships OFF.** `email_module_enabled('hr-recruitment')` is `false`; the rows enqueue and
nothing sends. Turning it on also releases the master-request mail already built behind the same
switch.

**Worth settling before it goes live:**
- [ ] **Redeploy `send-email` before the email switch is ever turned on.** The renderer change is
      committed but NOT deployed: `supabase/functions/send-email/index.ts` now knows that a
      `hr-recruitment_interview_*` kind is a panel notice, not master-data governance. Left
      undeployed deliberately — the running copy serves five modules that DO have email on, and
      hand-uploading 1,261 lines to fix a footer that cannot render while the HR switch is off is
      the wrong risk. Deploy it in the same change that flips the switch:
      `supabase functions deploy send-email --project-ref icutjkrqkbzwvmnfbzpr`.
- [ ] Grant `hr-recruitment` to the four heads above, or accept that booking them notifies someone
      who cannot open the app. Four edits in the admin User form, no code.
- [ ] Whether the R1 and R3 lists should be repaired at the same time — both silently drop a
      cross-department interviewer today, and it is the same one-line source swap.
- [ ] Whether HR wants the *named* hiring manager corrected on live requisitions. It is effectively
      immutable after submit — only `fms_hr_resubmit_mrf` writes it, requester-only, sent-back only.

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

### AM-2 · Load the real asset register from the field  `[~]`
*Raised 2026-08-29 · **Template built and sent, waiting on Finance to fill it.***

The register holds 10 rows, 9 of them seeded `[TEST DATA]`. Until the real assets are in, the
module reminds nobody about anything. Ritesh Bhai asked for a sheet to fill in, so the collection
template is the deliverable and the bulk importer is how it comes back.

**Done:**
- `Asset Data Collection Template.xlsx` at the repo root (untracked). Four tabs — Data Entry
  (blank, dropdowns, frozen header), Read Me, Sample (filled), Picklists. Regenerate with
  `npm run asset-template`; the generator is
  [build-asset-template.mjs](frontend/scripts/build-asset-template.mjs) and it **asserts its
  columns against `IMPORT_COLUMNS`**, so it cannot drift from the importer.
- The importer gained a **`Reading as on`** column (a meter reading with no date is a guess) and
  now **skips wholly blank rows** — without that the 2000-row validated grid opens the preview
  with a screen of red. [importAssets.ts](frontend/src/apps/asset-maintenance/lib/importAssets.ts).
- The in-app **Download template** button now emits the same four tabs off the live masters
  ([importTemplate.ts](frontend/src/apps/asset-maintenance/lib/importTemplate.ts)). It had been
  shipping a worked example whose Location was `"Head Office"` — not a master, so anyone who
  followed the example got a row the importer rejected.
- Verified: `npm run build` clean; the real `buildImportPlan` against the real file with live
  masters gives **3 assets, 7 tracks, 0 rejected**, unchanged with 200 blank rows appended.
  Nothing was committed to the register.

**Round one is vehicles, IT equipment and air conditioners only.** The other four categories are a
re-send of the same 27 columns, not a redesign.

**Two traps the Read Me warns about, because neither gives a usable error:**
- A serial number identifies one physical unit. Give two different assets the same one and the
  second is absorbed as a track on the first, its details discarded silently.
- `Warranty months` + a purchase date auto-creates the Warranty Expiry track
  (`fms_asset_submit_asset`). Adding a Warranty Expiry row as well breaks the
  `unique (asset_id, schedule_type_id)` key, and the importer swallows that in a bare `catch`.

**When the sheets come back:** add any new makes / locations / vendors as masters *first*, then
upload — the importer resolves masters by name and rejects anything it does not already hold.
Note the preview undercounts tracks: the auto-created Warranty Expiry ones never appear in it.

**Before the first real load, two decisions that are not mine to take:**
- The 9 `[TEST DATA]` assets and their 20 tracks. Removal is destructive and constrained by
  `on delete restrict` from schedules and jobs.
- **PF-14** — `fms_asset_step_owners` still holds 0 rows, so a loaded register would have nobody
  able to action its jobs except an admin.

---

## Admin / Masters

*(cross-ref: **PC-1** above — master approvals need to reach a non-admin coordinator)*

---

### MS-2 · Credit terms in the masters are half-filled, and the ₹1 flag is stale  `[ ]`
*Raised 2026-08-29 · the data half of **RC-8**, which builds the report that surfaces this*

**RC-8** gives Finance the list. This is the cleanup it will point at, and it is Accounts' call, not
a build.

`mst_parties` carries one row per ledger per Tally company — 7,886 rows, 6,424 names, 5 companies —
and **1,043 names live in more than one company** (424 customers). Credit **days** are set in some
books and blank in others for **117** names, credit **limit** for **130**; where set in every book
the values still disagree for **28** (days) and **136** (limit). **180 of the 424** multi-company
customers have at least one gap.

**To discuss with Accounts:**
- [ ] **Is blank always wrong?** A book that never sells to a party needs no limit. VAIBHAV
      ENTERPRISES argues for weighting by activity: the book holding ₹16 lakh overdue matters, the
      one holding −₹92 does not.
- [ ] **136 names carry different limits in different books** — deliberate per-company exposure, or
      drift nobody has looked at?
- [ ] **The 184 rows still flagged ₹1 in Tally** — only 12 are on the Red Mark master. Clean them up
      so ₹1 means something again, or leave them and teach every reader to ignore ₹1?
- [ ] **Who fixes it** — Accounts correct it in Tally and the next sync carries it across, or may the
      portal hold a credit term of its own? Today the field is read-only by design.

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

*(cross-ref: **PF-1** — Save Draft lands here second, after Production · **PF-6** — this module is the pilot for opening view-only access, and **PF-7** ships with it · **PF-13** — the credit check gets a reassign, and the empty all-locations fallback row is the cheap fix that needs no code)*

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

### PE-2 · Lot-wise and stage-wise production cycle-time report  `[~]`
*Raised 2026-08-20 · From the factory visit · **Unblocked 2026-08-25**, scope agreed ·
in build*

Two screens under Production Entry → Reports, both gated on `canMonitor` (the same flag that
already opens the Control Center):

- **Lot Cycle Time** — one row per lot: when it started, how long it has spent at each stage, and
  how long the whole lot has taken. Finished stages show a duration; the stage the lot is sitting
  in right now shows age-so-far.
- **Stage Cycle Time** — one row per stage: average, median, P90, fastest, slowest, and what share
  came in inside the target. So "this stage takes this long on average" has an answer.

**Decided 2026-08-25:**
- Durations run on the **system timestamps** (`*_at`) — the only stamps carrying a time of day.
- Time is counted as **plain clock time**, nights and Sundays included, **plus** a late/on-time
  verdict against the step SLA already configured in Setup → Due Dates.
- **Both granularities**: the 5 rolled-up `STAGES` by default, expandable to all 11 steps.
- **In-flight lots are included** — they have to be; see the caveat below.

**Why it is no longer blocked on the step list.** Everything derives from `STEPS` / `STAGES` in
[steps.ts](frontend/src/apps/production-entry/lib/steps.ts) and the `AT` / `ANCHOR_AT` maps in
[queues.ts](frontend/src/apps/production-entry/lib/queues.ts) — the same four places any new step
has to be added anyway. When the factory's additional steps land, both reports widen on their own
with no report code changed. The step list is still wanted; it is no longer a gate.

**Notes:** the timing data was already there — every step stamps its own completion time on the job
card (`mhAt`, `rmtAt`, `qcAt`, `aisAt`, `tsAt`, `peAt`, `mcAt`, `pmtAt`, `pkAt`, `rtdAt`, `fgAt`,
plus `submittedAt` / `closedAt`), and `ANCHOR_AT` already says which stamp starts each step's clock,
so a stage's duration is `AT[step] − ANCHOR_AT[step]`. **No migration, no new column, no new table.**

**⚠ What the first version cannot tell you, and says so on screen.** Checked against live data on
25-Aug: 125 job cards, **none closed**, nothing ever stamped at M/C Testing or FG Transfer — so
every total reads "so far" until the first card clears. More importantly, much of the current
spread is **data-entry cadence, not floor time**: eight cards share `RM Transfer → Quality = 26.6h`
to the decimal, and `Log Book → Production` reads under a minute on most cards because both are
saved in the same second. The report renders those as `<1m` rather than `0h` and states the caveat,
instead of presenting them as a fast stage. **That gap is itself a finding for the factory** and
worth raising separately from this build.

**Known under-counts, latent rather than live** (no lot is affected today): a QC-rejected lot that
loops back through Additional Issue Slip keeps its *first* handover timestamps, because every step
stamps `coalesce(x_at, now())`; and a hold has `hold_at` but no resume stamp, so a held lot's
current stage silently includes the hold. Both are surfaced as columns, not hidden.

**To discuss with Bushra:** which steps are missing and where they sit in the existing chain
(Handover & QC → Log Book & Production → M/C Testing → Packing → Dispatch) — the report widens to
fit them automatically, so this is now about completeness of the record, not about unblocking.

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

## Purchase RM Domestic

*(nothing yet — **PD-1** shipped 2026-08-27, see [Done](#done))*

---

## Purchase RM Import

*(nothing yet — **IM-1** shipped 2026-08-27, see [Done](#done))*

---

## Task Management

*(nothing yet)*

---

## Outstanding Dashboard (Receivables)

The Zero-Collection report itself is built. Live handover doc:
[RECEIVABLES-SCHEDULED-EMAIL.md](RECEIVABLES-SCHEDULED-EMAIL.md).

*(**RC-1**, grouping the bill-wise details by sale type, is done — see [Done](#done).)*

---

### RC-8 · Credit days and credit limit are not set for most customers, and differ book to book  `[ ]`
*Raised 2026-08-29 · off a check on VAIBHAV ENTERPRISES · cross-ref **MS-2** (the masters half of this)*

**VAIBHAV ENTERPRISES** was checked: credit days and credit limit filled in for one company, blank
for the others. It is one ledger in four books, and only the smallest carries a term.

| Company | Credit limit | Credit days | Outstanding |
|---|---|---|---|
| O-tec — Noida | ₹40,000 | **15 Days** | ₹28,792 |
| Enterprise — Noida | ₹16,51,000 | — | **₹16,01,201, all overdue** |
| Enterprise — Surat | ₹1 *(a flag, not a limit)* | — | ₹0 |
| O-tec — Surat | ₹1 *(flag)* | — | −₹92 |
| O-tec — Surat · `VAIBHAV ENTERPRISES MACHINE` | ₹1 *(flag)* | — | ₹4,00,000 |

The book holding **₹16 lakh, all of it overdue**, has no credit days at all — so no rule can call
anything there late.

**It is not one party.** Measured on the source the report reads — `collection_customer_snapshot`,
all 1,854 customer rows, one per ledger per book, resolved to companies through `ext_company_map`:

| Company — Location | Rows | Neither set | Days missing | Limit missing | Set on the bills | Complete |
|---|---|---|---|---|---|---|
| O-tec — Surat | 1,189 | **604** | 68 | 144 | 93 | 280 |
| Enterprise — Surat | 303 | 53 | 2 | 41 | 20 | 187 |
| O-tec — Noida | 176 | 36 | 10 | 26 | 7 | 97 |
| Enterprise — Noida | 105 | 15 | 1 | 31 | 8 | 50 |
| Colorix — Surat | 81 | 23 | 10 | 16 | 14 | 18 |
| **Total** | **1,854** | **731** | **91** | **258** | **142** | **632** |

**The genuinely uncontrolled money is ₹1.42 Cr**, not the ₹24 Cr a ledger-only reading gives — see
the bill-wise trap below, which is the single most important thing on this entry. And the Vaibhav
pattern: 391 customer names appear in more than one book, and **206 records** are missing a term the
same customer already holds in another book — ₹5.33 Cr outstanding, ₹2.10 Cr of it overdue. Those
are demonstrably an oversight rather than a deliberate no-credit book, and they are one filter click.

**It is Tally's data, not our sync** — confirmed row-for-row against the mirror's `v_ledger_detail`.
Fixing the data is **MS-2**; this entry is the report that shows Finance where to look.

**What we are building.** *Credit Terms Not Set* — Outstanding Dashboard → Reports → Receivables, at
`reports/credit-terms`. Two panels: a **company-wise** summary (one row per company + location, with
the counts above and the money owed with nothing set) and the **customer-wise** list beneath it,
every column sorting and filtering, filters cascading, 25 a page, Excel out in two sheets.
**Filters by sale type** — Ink / Paper / Spare Parts / Machine / Head / Other, a customer matching on
open outstanding or sales, with the mix shown per row: Spare Parts alone is 355 customer records, 80%
of them fully set up. A **Has outstanding** toggle drops the 1,131 ledgers sitting at exactly
zero — 1,080 rows become 140, which is the list somebody can actually work through — and a **Last
activity** column (newest receipt or bill; dormant ledgers read "—") says whether a gap is worth
chasing at all. **Every figure in the company panel is a drill-down**: click a count and the
list below becomes exactly those customers (604 -> 604 rows), click it again to come back. Clicking
the money column also switches the balance filter to *owes money*, because that column sums positive
balances only — without that the ₹82.47 L cell landed on a list whose own total read −₹3.42 Cr,
having dragged back in the credit balances the figure deliberately excludes. A zero count is inert:
it could only ever land on an empty table. The five status columns are mutually exclusive and add up to Customers; the panel
says so, and each Customers cell carries the sum as a tooltip so a future change cannot break it
quietly. Default view is the gaps, sorted by outstanding, so the largest exposure with
no terms is the first line; one
click on the filter chip widens it to the full customer list. Reads `useAppData().allCustomers` — no
new fetcher, no migration, no schema change.

**⚠ Four traps, all of which bite a naive reading of this data.**
1. **🔴 CREDIT DAYS LIVE IN TWO PLACES, AND THE LEDGER IS ONLY ONE OF THEM.** A bill carries its own
   `BILLCREDITPERIOD` — "45 Days", or an explicit date like "5-May-26" — typed at invoice entry;
   61,410 such values are stored. **142 ledgers here hold no master credit period while their open
   bills each carry a due date.** Reading the ledger alone called every one of them "Days missing".
   BISHEN DYEING (MACHINE) — 44 open bills, ₹4.62 Cr, a machine instalment schedule due 15-Apr,
   15-May, 15-Jun — was the report's number-one offender and is perfectly controlled. Correcting
   this took "owed with nothing set" from **₹24.32 Cr to ₹1.42 Cr**: the ledger-only reading
   overstated the problem by seventeen times. They now carry their own status, **Set on the bills**,
   which is visible but deliberately outside the default gap view. *(Caught in review on 29-08-2026, after the
   report had already been built and verified — the ledger-only reading looked entirely plausible.)*
2. **Tally stores a debtor's credit limit as a NEGATIVE (Cr) amount.** 817 of `mst_parties`' rows are
   negative against 123 positive. A `credit_limit > 0` test calls 817 real limits "blank".
3. **A limit of ₹1 is a flag, not a limit** — 184 rows. Tally reads 0/blank as *no credit control at
   all*, so Accounts used ₹1, the smallest figure that any sale breaches, to mean "blocked". It once
   drove the Red Mark badge; `ext_redmark` replaced it and now holds 54 ledgers, **only 12 of which
   overlap the 184**. So on Live a ₹1 row is NOT a Red Mark customer and must never be labelled one.
   The report treats `creditLimit <= 1` as not set and shows a "₹1 flag (Tally)" chip, never a rupee.
4. **Money owed must sum POSITIVE balances only.** Netting credit balances in flips a whole company:
   Colorix reads +₹0.83 Cr owed against a net of −₹4.03 Cr. An advance is not negative exposure.

**⚠ A new report reaches nobody until an admin grants it.** `profiles.receivables_allowed_reports` is
an allow-list — the opposite polarity to the menu deny-list, deliberately: *a new menu reaches
everyone until it is hidden, a new report reaches no one until it is granted*
([reportAccess.ts](frontend/src/apps/receivables-hub/lib/reportAccess.ts)). After deploy, tick
**Credit Terms Not Set** for each finance user in Admin → User form. Admins see it at once.

**To discuss:**
- [ ] Who on the finance team gets the grant.
- [ ] Should this go out on a schedule, like the Collection report? Not wired — `emailable` is only
      set in the same commit that wires an Email action and someone has actually read the output.

---

---

### RC-11 · One storage blip cost half the send, and nothing said so  🔴  `[x]`
*Raised and fixed 2026-08-29, off a failure seen in this session's own testing · **live** ·
`entry.ts` + migration `20261022130000`*

**What happened.** A run threw `could not upload …: <none>` — an error carrying **no message**, the
storage API answering with nothing rather than refusing. The identical run seconds later succeeded
untouched. A blip, not a fault.

**What the blip cost is the point.** That throw escapes the per-recipient try/catch and kills the
run, so every salesperson still queued gets nothing — while the ones already mailed keep their copy,
and the `finally` claims the slot because `queued > 0` (it must, or a retry would double-send to
them). The result is a **half-delivered report recorded as sent**, which will never be retried.
On a real Saturday that is ~30 of 63 people served and 33 silently missing.

**And the watchdog could not see it.** It speaks when a slot goes **unserved**; here the slot has a
row, so it stayed quiet. **Half looked exactly like success** — the same silent-failure shape the
watchdog exists for, one level in.

**Two changes, because either alone leaves the hole open:**
- `upload()` **retries three times** with a widening pause. A repeat that comes back *already
  exists* counts as **success**: on a retry that is our own earlier attempt landing after its
  response was lost, not the two-runs-racing case `upsert: false` guards — that guard is about the
  per-run id in the prefix, which is ours alone. Anything still failing after three tries throws.
- the watchdog now **reads the send log's note**. `collections_report_mark_sent` has always written
  `… 3 FAILED: …` into it, so the evidence was being recorded and never read. A row whose note
  carries `FAILED` now raises an alert saying it went out **partly** and **will not retry**.

The partial alert's wording lives in `reason` rather than in the mailer, so this needed **no
redeploy of `send-email`** — which currently also carries another session's unmerged work. The
consequence is that the alert's body headline still reads "was not sent"; the subject line and the
facts list are accurate. Worth tightening the next time that function is deployed for its own
reasons.

**Verified.** The partial branch end to end — subject *"Collection report only PARTLY sent - 29
Aug"*, `partial=true`, `queued=30`, delivered — simulated inside **one transaction** that put the
send log back, so the 29-Aug slot stayed unclaimed. Then a live sample from `master` (07:45 IST,
book + NAKUL JI, both `sent`) proving ordinary uploads still pass through the retry.
⚠ The retry's *failure* branch is not directly exercised — forcing a storage outage is not
something to do on the live bucket.

---

### RC-9 · The Saturday send was missed — GitHub's clock stopped  🔴  `[x]`
*Raised and fixed 2026-08-29 · **Live 2026-08-29, 11:00 IST** · migration
`20261022120000_collections_report_kick.sql`, `send-email` v30*

**What happened.** The 08:00 IST slot on Saturday 29-Aug **did not go out**, and nobody was told.
Nothing was misconfigured: replaying the gate at 08:05 returns `due:true`, **63 mails** (4 book + 59
rep copies), 0 unclaimed. GitHub's `schedule` trigger simply stopped — ticks/day against 48 expected:
40 → 39 → 29 → 31 → 18 → **3** → **2** → **1**. The last tick before the slot was 06:53 IST; the next
never came, so the 120-minute grace expired at 10:00 IST with **zero** opportunities.

**The comparison that settled it.** pg_cron's `master-report-daily` is set for **the same minute**
and fired at `08:00:00 IST` (±40 ms) on nine consecutive days including that one. Same building, two
clocks; only one keeps time.

**The fix — the waking moved, the deciding did not.** `collections_report_due()` is still the single
answer. `collections-report-kick` (`*/15`) asks it and, only if due, pokes GitHub's
`workflow_dispatch` API over `pg_net`. The runner still draws and sends — it must, at ~40s CPU
against a 2s Edge ceiling. GitHub's own `*/30` cron is **left in place** as a free backstop; it
cannot double-send.

**The silent-success trap, now closed.** Every run exits *success* — "not due" is a success — and a
dropped tick creates no run at all, so a missed slot was invisible. `collections-report-watchdog`
(`*/30`) now queues an alert once the window closes unserved. ⚠ A new outbox `kind` alone is not
enough: `send-email` ends in `markSkipped(…"unknown kind")` and `receivables_` is not in its generic
prefix list — the very first alert **was itself silently dropped** until the renderer shipped in v30.

**Proved on live data, nothing at stake:** `dispatch('dry-run')` → GitHub **204**, run built 4 files,
posted nothing. `dispatch('sample','e.techie4@gmail.com')` → 2 mails, `sent`, PDF + workbook, nobody
else. Watchdog alert requeued → `sent`. Gate simulated at 05-Sep 07:59 / 08:00 / 08:15 / Fri →
`not yet` / **due, 63** / due / `not a send day`.

**Deploying `send-email` also carried three other people's undeployed changes live** — OCPI emails
(committed 23-Aug), HR interview round 2 (26-Aug) and Travel Desk (uncommitted). All additive, none
had ever queued a mail. Done on the user's explicit go-ahead; the mailer had been two commits behind
`master` since 22-Aug.

**The 29-Aug slot went unserved all day and is being caught up at 18:30 IST** — see the two one-off
cron jobs described under RC-10. It was held deliberately (the send log still ended at 22-Aug) while
the group-wise rework was proved, then released on the user's instruction. Serving it late needs
`grace_minutes` widened, because the gate reads `missed` and `entry.ts` returns on `due:false` — a
plain re-run refuses.

---

**⚠ The 29-Aug slot is being served LATE, at 18:30 IST, by two ONE-OFF cron jobs.** On the user's
explicit instruction (29-Aug). They remove themselves; if you are reading this after 29-Aug-2026 and
they still exist, something went wrong.

| job | when | what |
|---|---|---|
| `collections-report-catchup-open` | `55 12 29 8 *` (18:25 IST) | `grace_minutes` 120 → **660**, so the 08:00 slot may be served until 19:00 IST |
| `collections-report-catchup-close` | `30 14 29 8 *` (20:00 IST) | grace back to **120**, then unschedules both |

**The schedule itself is NOT touched** — it stays weekly Saturday 08:00. Widening the grace is the
honest lever here: it means exactly "this missed slot may still be served", which is the situation.
Changing `hour_ist` would have left next Saturday at 18:30 if the restore ever failed.

**Opened five minutes early on purpose.** The regular `*/15` kick fires at 18:30 IST on the dot; had
the widening run in the same second it could have read the old grace and skipped the slot for
another quarter hour.

Checked before arming: slot 08:00, window closes 19:00, kick fires 18:30 (inside), slot unclaimed,
last kick 11:00 IST so the 20-minute `min_gap_minutes` guard cannot block it. Everything else the
gate wants — armed, both switches, a Saturday, 63 recipients — was already confirmed.

---

### RC-10 · The reports are Customer-wise; the dashboard is Customer Group-wise  🔴  `[x]`
*Raised 2026-08-29 · called critical · **LIVE on `master` 2026-08-29**, Vercel deploy green ·
`collectionsExport.ts`, `exportCollectionsPdf.ts`, `pdfBrand.ts`*

**Proved by running the real builder locally in `MODE=dry-run` — 0 mails queued.** Not a mock: the
same `entry.ts` the runner executes, against live ConnectWave, writing the actual PDF and workbook.

| Check | Result |
|---|---|
| `npm run build` | clean (`tsc` strict + vite) |
| Totals vs the screen | **236 customers · ₹23.57 Cr · ₹14.40 Cr overdue** — identical |
| Whole book | 236 customers → **225 group rows**, 9 holding >1 ledger |
| **NAKUL JI** vs the screen's `NAKUL JI (64)` | **64 group rows** from 67 customers — exact |
| NAKUL JI figures | 67 · ₹6.40 Cr · ₹3.43 Cr overdue · ₹49.12 L On Account — identical |
| Workbook header | `Salesperson · Customer Group · Customers · …` |
| PDF header + suffix | "Customer Group"; `DASS DIGITAL (3)`, `SHREE RAMANUJ … (2)` |
| Multi-ledger bill page | Ledger column separates `DASS EMBROIDER…` from `DASS DIGITAL` |
| Single-ledger bill page | **no** Ledger column (K3 FABRIC HUB) — the conditional holds |
| **The tripwire** | NAKUL JI's extract built without throwing — the whole point |

⚠ **`MODE=dry-run` draws one rep's extract** (`firstRepIn(ctx)` in `entry.ts`), which is why a local
dry-run exercises the per-rep tripwire at all. A run that only built the book would have proved
nothing about the guard.

**Round 2 — the bill page, off the first sample (29-Aug).** Grouping the rows by customer group
made a group's bill page span several ledgers, and banding it only by sale type interleaved them:
46 INK bills from three accounts in one run, told apart by a repeated Ledger column. That page
cannot be worked — chasing is done one ACCOUNT at a time. So the **ledger opens the section and its
sale types sit inside it**, with the ledger's own figures carried ON its band (which is what avoids
a third tier of subtotal rows):

```
DASS DIGITAL        ₹84.19 L      INK · Subtotal 20 · SPARE PARTS · Subtotal 3 · HEAD · Subtotal 2
M/S. DASS PRINTS    ₹37.75 L      INK …
DASS EMBROIDERY     ₹4.57 L       INK …
```

- **`ledger` is a new `RowKind`** in the shared `pdfBrand` — there was one band weight and this
  needs two. Same ground as a subtotal but opened by an orange rail rather than closed by a navy
  rule, which is what tells them apart when a subtotal sits immediately above the next ledger.
- **The Sale Type column is GONE and paid for the rest.** It repeated its own band on every row —
  under INK every cell said "Ink", under SPARE PARTS every cell said "Spare Par…", ellipsized
  because the width it needed was spent restating the heading eight rows above it. Its 13 went to
  the two date columns (clipping to `03-07-2…`; a truncated date is not a shorter date) and to
  Bill No, which now also holds a ledger name. **Fixed on width, not by shrinking the type.**
- **A blank row between a closed section and the next heading** — subtotal and band are both filled
  rows, so back to back they abutted into one grey slab.
- A **single-ledger page is unchanged**: no ledger band, no removed column beyond Sale Type, bands
  where they were.

Verified on the regenerated book: `DASS DIGITAL ₹84.19 L → INK/SPARE PARTS/HEAD → M/S. DASS PRINTS
→ DASS EMBROIDERY → On Account → TOTAL`, full `dd-mm-yyyy` dates throughout. Samples to
`e.techie4@gmail.com` at 06:55 and 07:19 IST — book + NAKUL JI, all `sent`, **slot still
unclaimed** (log still ends 22-Aug).

**Round 3 — a heading may use the empty cells beside it.** `DASS EMBROIDERY PRIVATE LIMIT…` was
ellipsizing inside its 28/100 column while the three date columns to its right sat **empty on that
very row** — the name was being lost to nothing at all. New `PdfColumn.span` (shared `pdfBrand`)
lets a cell say how many columns it occupies ON THIS ROW, so a heading measures against the space
it actually has. The span stops at Amount, because every heading row here — ledger band, sale-type
band, subtotal, TOTAL — carries figures in the last three columns; a bill row spans nothing, its
dates being the point. Verified: the full ledger name prints and **no ellipsis remains** on those
pages, with bill dates and the band's own figures both intact.

⚠ **Round 1's sample run failed once on `upload` with an empty error message**, after the book had
already been mailed — the retry succeeded unchanged, so it was transient. But there is **no retry
around `upload`**, so one flaky storage call aborts a live send partway through. The slot is still
claimed in a `finally` when anything was queued, so it will not re-send to people who already have
it — the rest simply never get it, and only the watchdog would notice. Worth a retry (**RC-11**).

**The mismatch, and it is mislabelled rather than merely different.** The dashboard's default view is
**Salesperson → Customer Group**. Every artefact that leaves the building is **Salesperson →
Customer** — and prints "Salesperson → Customer Group" at the top of itself anyway.

| Path | Grouped by | Heading printed |
|---|---|---|
| Dashboard | **Customer Group** | — |
| **Export** button | Customer | "Salesperson → Customer Group" |
| Email report dialog | Customer | "Salesperson → Customer Group" |
| Per-salesperson dialog | Customer | "Salesperson → Customer Group" |
| Scheduled Saturday mail | Customer | "Salesperson → Customer Group" |

**One hardcoded line causes all four.** `reportSpec.ts` correctly asks for
`groupBy: ["salesperson","group"]`, but `collectionsExport.ts` **ignores `req.groupBy`** and uses its
own `EXPORT_DIMS = ["salesperson","customer"]`. Every caller passes a *scope* only, never dims — so
the one line fixes all four paths together.

**What does NOT change.** Only non-paying ledgers are grouped: the table only ever holds customers
who paid nothing, and grouping buckets *those* rows rather than pulling in the rest of a group —
exactly what the dashboard does. Grand total stays 236 customers / ₹23.57 Cr. The KPI cards keep
counting **customers**, not groups, because the screen does too (236 customers above 64 group rows).
Nothing renders blank: `groupNameOf()` resolves by Tally ledger **GUID** — 387 ledger names repeat
across companies — and falls back to the ledger's own name when unmapped.

**⚠ The tripwire, which is why steps 1-3 cannot ship alone.** `collectionsExport.ts:371-378` guards a
rep's file against another rep's customer by comparing printed names against `r.customer.name`. Once
leaves are groups the first multi-ledger group throws and **nothing is sent**. It must be rebuilt
from `r.group` in the same edit. It is not weakened: it is the second of two independent leak guards
(`assertOnlyTheirs` checks rows going in, this checks what comes out).

**Two gaps the audit found, without which the change is technically done and practically worse:**
- The PDF has **no Customers column** (screen and Excel both do), so a 4-ledger group would look
  identical to a 1-ledger one. Rendered as an `ABC GROUP (3)` suffix, shown only when > 1 — the
  Customer column is already tight and a truncated ledger name is the worst thing on that page. The
  suffix must be added by the **renderer**, never baked into the row name, or it breaks the tripwire.
- A group's **bill page merges bills from several ledgers with no way to tell them apart**.
  `PdfBillRow` carries no ledger identity though `InvoiceDrillRow.customerName` already has it.

**Decided:** ledger names stay in the Excel bill-by-bill sheet (which already carries `customerName`
*and* `groupName` per row); the PDF shows group names only, so it does not grow past its 101 pages.

**Behaviour that shifts at group grain** — all inherited from the screen, so matching it keeps mail
and dashboard in agreement: `Last Receipt ₹` becomes a **sum** of different receipts while
`Last Receipt` is the **latest** date; `daysSinceLastReceipt` takes the worst member;
`neverPaid` / `stillBuying` become "**any** ledger in this group"; the Still Buying appendix lists
groups while its sentence counts customers; the send-log note still counts ledgers.

**Verify:** `npm run build`, then `collections_report_dispatch('dry-run')` (builds the real files,
sends nothing). ⚠ **A whole-book dry-run does not exercise the tripwire** — it fires only on a
per-rep file, so prove it with `collections_report_dispatch('sample','e.techie4@gmail.com')`, which
mails one address and does **not** claim the slot.

Frontend-only: no migration, no Edge Function redeploy; Vercel picks it up on merge to `master`.

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

### FIX-4 · A requisition could not be cancelled once sourcing had begun  `[x]`
*Purchase RM Domestic · RM Import · **Fixed 2026-08-25, 13:35 IST** · Live on `master` at `3c71504`*

**What was seen:** PR-2627-0034 — ₹19,82,400, one line approved and sitting in the PO pool, no PO
raised — needed to be cancelled, and there was no button anywhere to do it. Not on the requisition,
not on the line, not in the PO workbench. The server even told the user to *"Cancel the individual
lines instead"*, pointing at a control that no longer existed.

**What was wrong:** `d6c9f65` (20-Jul-2026) removed the per-line **Actions** column from Request
Detail in both purchase apps, reasoning that *"whole-requisition actions already live in the
header"*. That was true of Source and Approve, which had moved there in `03e2389` — and false of
**Cancel**, which had never been in the header. The header's *Cancel request* is gated pre-sourcing
only, so deleting the column left no cancel path at all from the first sourcing action onwards.

**Why it went unnoticed for five weeks:** nothing broke. The commit removed the *trigger* and left
everything it fed — the state, the handler, the whole "Cancel line" modal, `s.cancelLine`, both
RPCs. `setCancelling` was only ever called with `null`, which is legal TypeScript, and
`noUnusedLocals` is `false` in this repo, so the build stayed green. There is no test runner. The
screen looked complete because the dialog was still there; only the way in was gone. It surfaced
the day someone actually needed to cancel something.

**The fix:** a **Cancel line(s)** header button opening a picker — tick lines, one shared reason —
matching how Source / Approve / Generate PO already work, rather than reinstating the column that
was deliberately removed. It is offered for every status the RPC accepts (`sourcing`, `approval`,
`on_hold`, `approved_pending_po`), which is wider than the control it replaces. Permission is
unchanged: admin, or the `po` / `sourcing` step owner. Both `cancel_line` RPCs now also stamp
`edited_at`/`edited_by` in-transaction and roll the request header to `cancelled` once no live line
remains — a requisition emptied one line at a time used to sit at `open` forever, so the red "This
request was cancelled" banner never appeared and the Dashboard counted it as open indefinitely.

**What else was at risk:** the same commit hit **both** apps, and in Import it took a second path
with it — the per-line **Source / Re-source**, whose `SourcingModal` takes a line. Its `sourcing`
state sat there for five weeks, likewise only ever set to `null`. The dead code is now removed;
whether the stage is retired or rebuilt is **FIX-4a** below. The general lesson is the one worth
keeping: **a cleanup that removes a container must account for each thing inside it, one by one.**
Removing the container and orphaning its contents compiles, ships, and looks fine.

**Still open — to settle with whoever owns Import:**
- [ ] **FIX-4a ·** Retire Import's sourcing stage (drop `SourcingModal` + `SourcingQueue`), or
      rebuild it request-scoped the way RM Domestic was? Import lines are born at `approval`, Import
      approval carries no rate or value, and **no `sourcing` step owner is configured**, so the
      stage feeds nothing Import currently routes on — which argues for retiring it. Rebuilding
      needs a new request-scoped RPC.
- [ ] `importWrites.ts`'s `announce` doc still says recipients equal to the actor are skipped
      server-side; untrue since `20260726150000`. The RM Domestic twin was corrected in `3c71504`;
      Import's was left out of that commit because the file also held an unrelated in-flight change
      (`fetchFxRate` moving to `shared/lib/fx.ts`) whose new file was not yet in git. Fix it once
      that lands.

---

### FIX-3 · An interview nobody was assigned showed as "Booked"  `[x]`
*New Recruitment · Found 2026-08-25 while auditing **NR-1** · **Fixed 2026-08-26, 08:17 IST** ·
Live on `master` at `adea51c`, shipped with **NR-1***

**What was seen:** in the Interviews queue, rounds with no interviewer and no date read **Booked**
and offered **Record result**. There was no way to book them from that screen at all — the **Book
it** button never appeared for them.

**Root cause:** passing a round auto-advances the candidate and inserts a *stub* interview row for
the next round — no panel, no date, `status = 'scheduled'`
([20260816120100:542-544](supabase/migrations/20260816120100_add_fms_hr_hired_stage.sql#L542-L544)).
The board tests for a real booking — `!iv?.interviewerIds.length && !iv?.interviewerName`
([CandidateCard.tsx:75](frontend/src/apps/hr-recruitment/components/kanban/CandidateCard.tsx#L75)) —
but the queue tested only that a *row existed*
([InterviewsQueue.tsx:82](frontend/src/apps/hr-recruitment/pages/queues/InterviewsQueue.tsx#L82)).
So the board said "To be scheduled" and the queue said "Booked" about the very same round.

**Live when found:** 3 rows — one at Round 2, two at Round 3.

**The fix:** one `isBooked(iv)` predicate in `lib/interviewers.ts`, used by the card, the queue's
lookup, its Booked / Not booked badge, its filter, its export and its action branch — so the two
screens cannot drift apart again. It sits beside `interviewerPool` and `panelNames` for the reason
those do: an interview can be reached from two places and both must say the same thing.

**What else was at risk:** the same round's panel was named through the RLS-scoped `profileById` in
**four** places — the board card, the queue, Prior rounds and the candidate's Meetings tab — and
`panelNames` drops any id it cannot resolve. An interviewer outside the reader's own department
therefore rendered as no name at all, making a booked round look unassigned. All four now use
`personName`, which reads the org-wide directory.

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

### PF-13 · Reassign an approval — every module now has one  `[x]`
*Platform · **Live 2026-08-27** · closes the sweep that began with **IM-1** and **PD-1***

**What happens now, everywhere.** Each module's Setup carries **who may receive a handover**, and the
work awaiting a decision carries **Reassign**. It **moves**: it leaves the usual owner's queue, appears
in the receiver's, and only they or an admin may act. The usual owner can pull it back. The shared
controls are `shared/components/approvals/ReassignModal.tsx` and `ReassignPoolSection.tsx`.

| Module | What it hands over | Shape |
|---|---|---|
| **Purchase RM Import** (IM-1) | one requisition | `assigned_approver_id` column |
| **Purchase RM Domestic** (PD-1) | one requisition | column · amount-banded |
| **Office Supplies** (PF-13a) | one request's first approval | column · HOD-routed |
| **HR Recruitment** (PF-13b) | one **step** of one requisition | `(requisition, step)` table |
| **HR Exit** (PF-13c) | one **step** of one case | `(case, step)` table |
| **Travel Desk** (PF-13d) | one **step** of one trip | `(trip, step)` table · migration only, see below |
| **Order to Dispatch** (PF-13e) | one **step** of one order | `(order, step)` table · location-scoped |

**The shape split is the finding.** The first three modules carry **one** approval in flight per
entity, so a single column says everything. The last four do not — an HR requisition walks nineteen
steps across three scopes with several open at once — so the holder has to be keyed on
`(entity, step)`. And that key is right because it is already how those modules authorise: every one
of HR's eighteen RPCs calls `fms_hr_can_act(step_key, requisition_id, uid)`, so the rule landed inside
the gate they already go through with **no signature or call-site change**.

**Three rules that held in every module:**

1. **The holder REPLACES the natural owner, never ORs with it.** An OR is a *share* — the item stays
   in the original owner's queue and nothing has moved.
2. **Visibility is separate from authority.** The queue follows the holder **even for an admin or a
   coordinator**; `canAct*` keeps its admin arm. This mattered most in HR, where `hr_head_approval`'s
   sole owner is also the sole process coordinator.
3. **The read gate had to be widened in four modules**, for a counterintuitive reason: the module arm
   is `module_is_viewer`, which is `module_level(...) = 'view'` **exactly** — so a receiver holding an
   *edit* grant matches nothing and cannot open what was just handed to them.

**⚠ Two failures that only the browser caught, both at the RLS / PostgREST layer:**

- **Travel Desk went dark.** The new assignee table's policy read `fms_travel_trips`, whose policy now
  reads the assignee table — Postgres refused both with *"infinite recursion detected in policy"* and
  the whole module showed "could not be loaded". Fixed within minutes; the assignee policy no longer
  consults the trips table.
- **Every Order to Dispatch queue emptied.** That module's `fetchAll` adds a secondary sort on `id`
  for stable paging, and the new table had a composite primary key and no `id`. PostgREST answered
  400, the store's `Promise.all` rejected, and `orders` was empty. The table now carries an `id`.

**Neither was visible to `tsc`, to the build, or to the SQL suites** — those connect as `postgres`,
for whom **RLS is not enforced at all**. Every table added in this sweep is now read back with
`set local role authenticated`, as an admin and as a non-admin, which is the check that would have
caught both.

**⚠ Travel Desk shipped its MIGRATION ONLY.** The Travel Desk app is another session's in-flight work
— 88 files, untracked here and on master, never committed anywhere — so its frontend half (store,
fetch, writes, Setup section, modal, queue trigger, My Work item) is left in the working tree for that
session to commit with the rest of the module. The migration is additive and inert until then.

**Verification, per module:** authorisation cases on live data inside rolled-back transactions (15,
17, 22, 22, 19, 14), a rollback rehearsed the same way each time (8/8, 9/9, 8/8, 8/8, 7/7), and a
browser walkthrough (12, 10, 7, 3, 3, 6). **No email was sent by any run** — the four HR/Travel/
Dispatch switches are off, and Import's and Purchase's were turned off for their runs and back on
after, with the outbox confirming zero rows each time.

**Two configuration gaps this surfaced, both needing the business rather than code — see PF-14:**
seven of HR Exit's fifteen step owners **cannot act on the steps they own** (no module access,
including `fnf_approve`), and Travel Desk has **no step owners at all** plus **nobody with edit
access**.

### PF-13b · HR Recruitment — a step owner can hand a step to someone else  `[x]`
*HR Recruitment · **Live 2026-08-27, 19:20 IST** · the fourth module after **IM-1**, **PD-1** and
**PF-13a**, and the first that needed a different **shape***

**What happens now.** Setup gains a **Reassignment** tab naming who may receive a step. The MRF
approvals queue gains **Reassign** on each row. The handover **moves** that one step: it leaves the
usual owner's queue, appears in the receiver's, and only they or an admin may act. The usual owner
can pull it back. The rest of the requisition is untouched.

**⚠ Why this is a table and not a column.** The other three modules carry **one** approval in flight
per entity, so a single `assigned_approver_id` column says everything. HR does not: a requisition
walks **nineteen steps across three scopes** — requisition, candidate and hire — and several are open
at once. It can be at `job_posting` while one of its candidates is at `final_decision` and last
month's hire is at `probation_m2`. So the holder is `fms_hr_step_assignees`, keyed on
**(requisition, step)**.

**And that key is right because it is already how the module authorises.** Every one of the
**eighteen** HR RPCs calls `fms_hr_can_act(step_key, requisition_id, uid)` — even the hire-scoped
ones, which resolve `probations.requisition_id` first and pass that. So the new rule lands inside the
gate they all already go through: **no signature change and no call-site change anywhere**.

**The hard stop this fixes.** `fms_hr_can_act__ungated`'s hiring-manager branch **`return`s with no
fall-through**, so for `hod_shortlist`, `interview_2` and the five probation steps the hiring managers
are the only non-admins who can *ever* act — and there is no step-owner list an admin could add a
second name to. **15 of the 17 live requisitions name exactly one hiring manager.** Putting the holder
check *before* that branch is what makes those steps movable at all.

**⚠ A finding worth carrying forward.** `hr_head_approval` and `final_decision` are both owned by
**Riya Kumari, who is also the sole process coordinator** — and the coordinator arm returns true
before the holder check. So for *her* a handover **adds** the receiver without removing her, by
design: a coordinator oversees the whole flow. That is correct, but it means the **queue** must follow
the holder even for a coordinator, or the feature looks inert to the one person most likely to use it.
`store.stepIsMine` does that, kept separate from `canActOn`; the browser check confirms it — the gate
left the queue while signed in as an admin.

**The read gate needed widening**, for the same counterintuitive reason as Office Supplies:
`fms_hr_requisitions`' RLS select is `fms_hr_can_read_requisition OR module_is_viewer`, and
`module_is_viewer` is `= 'view'` **exactly** — so an edit-level receiver matched nothing and the
requisition would not even load.

**One rule, two readers.** The pre-existing ownership test was lifted out verbatim into
`fms_hr_is_natural_step_owner`: the gate asks it **after** the holder check (*who owns it now*), the
reassign RPC asks it directly (*who owned it before*), so the original owner can still take it back.

**Not the same thing as `fms_hr_reassign_interview`, which stays.** That moves one **interview** to
different interviewers; this moves a **step**. Both can be in play on one requisition at once — and in
`mywork/items/hr.ts` the two rules sit three lines apart and mean opposite things: the holder
**replaces** every other rule, while the Round-2 panel arm is deliberately **additive**.

**Verified:** 22 authorisation cases on live data in a rolled-back transaction — including the hard
stop before and after, the read gate before and after, and proof that it is per-**step** (handing over
`interview_2` left the same manager owning `probation_m1` on the same requisition); the reversal
rehearsed the same way (8/8), which **confirmed its unusual ordering** — dropping
`fms_hr_is_natural_step_owner` first breaks the *whole gate*, not just reassign, so the bodies go back
**first** here, unlike the other three modules; and 7 browser checks. **No email sent** —
hr-recruitment's switch is off and the outbox confirms zero rows. MRF-2627-0017 was restored to its
exact prior status.

**Still to come under PF-13:** HR Exit, Travel Desk, Order to Dispatch.

### PF-13a · Office Supplies — the first approver can hand a request to someone else  `[x]`
*Office Supplies · **Live 2026-08-27, 18:35 IST** · the third module to get the handover, after
**IM-1** and **PD-1**, and the first where the exclusivity was structural rather than a config gap*

**What happens now.** Setup → Raising & Routing carries **Who can be handed an approval**. A request
awaiting FIRST approval shows **Reassign**, on the queue and on the request. It **moves**: it leaves
the department head's queue, appears in the receiver's, and only they or an admin may decide it. The
HOD can pull it back. Only first approval — second approval and handover already have two step owners
each, so neither was ever blocked on one person.

**Why this module needed it most.** In Purchase every band held one person, but the schema allowed a
list, so the business could have fixed it in Setup. Not here. First approval routes to
`fms_supplies_departments.hod_user_id` — **one uuid column**, compared with a bare `= p_uid` — and the
`first_approval` row in `fms_supplies_step_owners` was **deliberately emptied** by `20260720100000`
so that list could not be mistaken for the routing rule. There was no second name to add anywhere. A
department whose head was away had no way to move its requests at all. (MIS currently has **no HOD at
all**, so its requests are admin-only until one is set — worth raising separately.)

**One authz site, not four.** Both `fms_supplies_decide_first_approval` and
`fms_supplies_update_first_approval` delegate to `fms_supplies_can_act`, so the holder rule went in
**one** function and both RPCs picked it up untouched. Purchase needed the same rule written into four
hand-written bodies. That is a real advantage of this module's design.

**⚠ The read gate had to be widened, for a counterintuitive reason.**
`fms_supplies_can_read_request` admits admin / coordinator / fulfilment staff / module **viewer** /
raiser / requested-for / department HOD. It looks as though anyone with module access can read a
request — but **`module_is_viewer` is `module_level(...) = 'view'` EXACTLY**. A receiver holding an
*edit* grant is therefore not a viewer and matched no arm at all: the handover would have put the
request in their queue and then refused to let them open it. Proved rather than argued — the SQL run
checked `can_read_request(req, receiver)` **before** the handover (false) and **after** (true).

**Three real bugs the browser caught that `tsc` and the build both passed:**

1. **`ref` is a reserved React prop.** The extracted shared modal took a prop called `ref`; React
   strips it before the component sees it, so the title rendered `undefined` and the console threw
   *"Function components cannot have string refs"*. It is now `docRef`. ⚠ This had also silently
   broken **Purchase's** modal via the retro-fit — which is why Purchase was re-run afterwards.
2. **`useState(saved…)` never re-syncs.** The shared Setup section read its saved values once, so a
   section that mounts before the store's query resolves kept the empty arrays it was born with and a
   reload looked like the save was lost. Import and Purchase never hit it — their Setup tab is opened
   by a *click*, always after the data lands. Office Supplies puts it on the **default** tab.
3. **The queue did not follow the holder for an admin.** `myQueue` used `canActOn`, which opens with
   an admin arm, so a handed-over request never left an admin's queue — the one thing the feature
   promises, invisible to exactly the people testing it. Visibility is now `stepIsMine`, separate
   from authority. The same lesson as Import; it had to be learned again here because this module
   splits the two differently.

**The shared components were extracted at the third instance, not the second** —
`shared/components/approvals/ReassignModal.tsx` and `ReassignPoolSection.tsx`, with Import and
Purchase retro-fitted onto them. ⚠ They live under `approvals/`, **not `fms/`**: the root
`.gitignore` carries `FMS/` with no leading slash, and Windows matches it case-insensitively, so a
folder named `fms/` would have been silently left out of every commit and the build would have failed
on master with no local sign of why.

**The email card is built in SQL here, which is the opposite of Import and Purchase**, so the fix
belonged in a different place: `fms_supplies_email_payload` gained a `reassigned` branch
(`20260827140100`). Its existing `else` arm would have rendered a complete card anyway — it would just
have said *"updated a request"*, which is a poor way to tell somebody an approval has landed on them.

**Verified:** 17 authorisation cases on live data in a rolled-back transaction (17/17), including the
holder approving end to end through the real RPC and then revising her own decision; the reversal
recipe rehearsed the same way with a handover in flight (9/9); 10 browser checks (10/10) after the
three fixes; and Purchase re-run afterwards (12/12) because the retro-fit had touched it.
**No email was sent** — office-supplies' switch is off, procurement's was turned off for its re-run
and back on after, and the outbox confirms zero rows for both.

**Still to come under PF-13:** HR Recruitment, HR Exit, Travel Desk, Order to Dispatch.

### PD-1 · An approver can hand a requisition to someone else  `[x]`
*Purchase RM Domestic · **Live 2026-08-27, 18:05 IST** — `25d27aa` on master, deployed by Vercel ·
raised, built and shipped the same day, straight after **IM-1***

**What happens now.** Setup → Approval Matrix carries a second control, **Who can be handed an
approval** — a departments filter plus the people who may receive one. A requisition awaiting
approval shows **Reassign**, on the queue and on the request. The handover **moves** the work: it
leaves the band's queue, appears in the receiver's, and only they or an admin may decide it. Any
member of the band can pull it back. One requisition at a time.

**It matters more here than in Import.** Purchase routes approvals by **amount band**, and all three
live bands hold exactly one person — L1 Rohan Jariwala, L2 and Director both Karan Toshniwal. Until
now a requisition simply had nowhere else to go.

**Four things differed from Import, each of them load-bearing:**

1. **There is no `fms_purchase_is_approver`, and there cannot be** — band membership depends on the
   amount, so every rule resolves the band inline exactly as the approval RPCs already do.
2. **Four RPCs carry the holder rule, not three.** The two request-scoped ones and the two legacy
   per-line twins. All four already had `is_admin OR band member OR assigned_approver_id =
   auth.uid()`, which as an **OR is a share, not a move**. The per-line twins are unreachable from
   the UI but granted to `authenticated`, so leaving them alone would have left the bypass open.
3. **Ten clear-sites, split 8 stop / 2 keep.** `assigned_approver_id` now survives the decision, or
   the holder could approve but not revise before the PO. The two still cleared are the
   **BLOCK+RE-ROUTE** arms, where an override pushed the total into a different band — that genuinely
   voids the handover.
4. **The override arm had to learn about the holder.** It re-derives the band and asks *may the
   caller approve at the NEW band?*, and a holder is by definition not a band member — so her own
   override would have re-routed and silently undone the handover she was in the middle of acting on.
   It now also passes for the holder **when the band row is unchanged**.

**Something Import does not have:** `requestApprovalOwnerIds` captions the request stepper's Approval
node, so the rail names the holder rather than staying generic.

**How it was verified, in order.** The four new RPC bodies were **diffed mechanically** against the
migrations they are based on — only the intended deltas, nothing lost in retyping. Then **15
authorisation cases** on live data inside a rolled-back transaction. Then the **reversal recipe was
rehearsed** the same way, with a handover deliberately in flight; both claims the migration header
makes about that recipe were tested rather than asserted (the drop order is *not* enforced, and
restoring the four bodies is optional). Then **12 browser checks**, all green.

**The browser run sent no email.** `procurement`'s switch is **on**, so it was turned off for the run
and back on afterwards, and the outbox confirms zero rows added. Import's run, which did not take
that precaution, mailed four real colleagues.

**Setup starts empty on purpose** — the test pool was removed afterwards. Until an admin names who
may receive an approval, a requisition can only be passed between the approvers of its own band.

**The daily-mail bundle was rebuilt** from the clean `oo-master` worktree and `work-snapshot`
redeployed (v16), which also cleared the rebuild still outstanding from **IM-1**. Both handover rules
are now in the mail.

**Next:** **PF-13** ports the same shape to Office Supplies, HR Recruitment, HR Exit, Travel Desk and
Order to Dispatch.

### IM-1 · An approver can hand a requisition to someone else  `[x]`
*Purchase RM Import · **Live 2026-08-27, 15:56 IST** — `507ab47` on master, deployed by Vercel ·
raised, built and shipped the same day*

**What happens now.** Setup carries a second approval control — **Who can be handed an approval**, a
departments filter plus the people who may receive one. A requisition awaiting approval shows
**Reassign**, on the queue and on the request itself. The handover **moves** the work: it leaves the
approvers' queue, appears in the receiver's, and only they or an admin may decide it. Any approver
can pull it back. One requisition at a time — this is not a standing stand-in, and that was a
deliberate choice, so it is not an oversight if someone comes looking for one.

**Reassign existed once and was deliberately dropped**, in
`20260806123000_fms_import_remove_reassign.sql`, for one stated reason: its picker listed **every**
profile, so an approval could be handed to somebody with no authority at all. The configured pool is
the answer to exactly that objection, so the feature came back with the gate it had been missing.

**Two live faults the audit turned up, both fixed in the same migration:**

- `fms_import_decide_approval`, the legacy per-line RPC, resolved its approver by a band lookup on
  `line_value` — and every `line_value` has been `0` since Import became a quantity requisition, so
  it always matched the **first** approver, who could then decide a handed-over line through it.
  Unreachable from the UI, but granted to `authenticated`.
- `assigned_approver_id` is no longer cleared at the decision. Cleared, the holder could approve but
  not revise before the PO, because the revise RPC reads that column.

**The queue follows the holder even for an admin**, while `canApproveRequest` keeps its admin arm.
Both configured approvers here are also admins, so an admin bypass in the queue would have left a
handed-over requisition sitting exactly where it was meant to leave.

**The rollback was rehearsed on live data**, and doing so disproved two things the migration header
had asserted as fact: Postgres does **not** enforce the drop order, and restoring the three RPC
bodies is optional once `assigned_approver_id` is null. The header says so now.

**Verified in the browser, twelve checks** — and that pass caught a bug `tsc` and the build both
missed: the store's `useMemo` was missing the two new config arrays, so Setup's Save stayed enabled
and never confirmed after a successful write. ⚠ The walkthrough also **sent four real emails to real
colleagues**, because Import's email switch is on and there is no staging address. Sent mail cannot
be recalled; the activity rows and notifications were cleaned up afterwards.

**One thing still outstanding:** `supabase/functions/_shared/workSnapshot.bundle.js` was deliberately
not rebuilt — rebuilding it in this tree compiles other sessions' unreleased work. `owners.ts` is
committed, so the next rebuild picks it up, and that rebuild is carried as a step of **PD-1**, which
runs it from the clean `oo-master` worktree.

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
