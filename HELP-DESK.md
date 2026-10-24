# Help Desk — build plan

*HR Help Desk FMS. Source: `files/FMS- Help Desk.pdf` (flow, 11-step process table, 28 ticket
categories, "Key KPIs (MNC Best Practice)"), plus the client's walkthrough on **27-09-2026**, plus
the five KRA/KPI sheets in `files/HR KPI KRA SOP/`. Every schema fact below was re-read off the live
database (`icutjkrqkbzwvmnfbzpr`) on 27-09-2026; nothing was written.*

**Status: BUILT.** All thirteen phases, 28-09-2026. Every screen is real — nothing is a stub.
The database is live on `icutjkrqkbzwvmnfbzpr`; the frontend is on branch `help-desk`
(worktree `D:/AI Development/oo-helpdesk`) and has NOT been merged or deployed.

**Three things are deliberately not switched on**, each needing somebody's word rather than more code:

| Off | Why | To turn on |
|---|---|---|
| **Email** | Ships off in every module here — a desk that starts mailing on day one tells people about a process they have not been trained on | Setup, plus a `send-email` deploy — see below |
| **Auto-close** | It closes real people's tickets | Apply `20261221130000_hd5_auto_close_nightly.sql` |
| **Ranking / KPI scoring** | KPI-1 weights by volume, the appraisal sheets by importance — see section 9 | Flip `fms_rank_modules` |

**⚠ THE MAILER IS NOT DEPLOYED, AND MUST NOT BE FROM THIS BRANCH.** `send-email/index.ts`
is shared by every module and the copies on `master` and `daily-reports` differ by ~115
lines. The `help-desk_` prefix edit is in this branch; deploying it from here would ship
another session's unfinished mailer. Checked 28-09: the DEPLOYED copy also lacks
`travel_` and `learning-development_`, so those two are in the same state. All three have
email off, so nothing is being lost — reconcile the copies and add all three together.

**⚠ HR STILL OWES TWO THINGS**, and the second one is visible in the product:

1. Who at Premware the IT Support category escalates to.
2. **Real people for the escalation levels the sheet names only as roles** — Management,
   Finance Head, Hiring Manager, Admin Vendor, Insurance Provider, Accounts, ICC
   Committee. Not one is an Orange One account, so **every category's level 2 is a label
   with nobody behind it**. Until somebody is named, a second reopen is recorded and tells
   only the fallback in Setup — which is also unset. The Masters screen says so in a
   banner and the reopen dialog says so before the click.

---

## 1. Context — why this is being built

HR answers the same questions all day, by WhatsApp, by walking over, by mail. Nothing records who
asked, when, who answered, or whether the answer ever came. So:

- **Nobody can be held to a TAT.** The sheets promise "1 working day" for an attendance correction
  and "2 working days" for a payroll query. There is no clock anywhere, so the promise is decorative.
- **The employee never knows where their question is.** They ask twice, to two people, and two
  people work on it.
- **Five HR appraisal sheets already score work that does not exist yet.** Khushi's KRA 5 says
  "at least 95% tickets resolved within 2 working days" with evidence "Helpdesk timestamps and
  escalation log". Dharmistha's KRA 4 says "100% requests logged in Orange Hub". There is no
  helpdesk and no tracker — those two lines, 20% of two people's appraisals between them, are
  currently unscoreable.

Help Desk is one front door for every HR question, with a category that decides who owns it and how
long they have, a thread that carries the conversation and its attachments, and a monthly MIS that
answers "did we meet SLA" per category and per person.

**The outcome:** an employee raises a ticket in ten seconds and can see where it is; a process owner
has a queue with due dates; the HR Head has an SLA / ageing / trend report; and five appraisal sheets
start scoring themselves.

---

## 2. What the source documents say

### The flow (PDF, 11 steps)

| # | Process | Owner | TAT | Output |
|---:|---|---|---|---|
| 1 | Employee raises a ticket | Employee | As required | Ticket generated |
| 2 | Employee selects category **and priority** | Employee | Instant | Ticket categorised |
| 3 | System generates a Ticket ID + acknowledgement | System | Instant | Ticket number |
| 4 | Routed to the concerned HR process owner | System | Instant | Ticket assigned |
| 5 | Owner reviews, verifies supporting documents | Process owner | **4 working hours** | Ticket validated |
| 6 | If more information needed, employee is notified | Process owner | **1 working day** | Information requested |
| 7 | Concerned department resolves as per SLA | Process owner | **As per SLA** | Resolution completed |
| 9 | Employee receives notification, confirms satisfaction | Employee | **2 working days** | Confirmation received |
| 10 | Ticket closed (or reopened if not satisfied) | System / HR | Same day | Ticket closed |
| 11 | Monthly SLA, ageing and trend analysis | HR Manager | Monthly | HR Helpdesk MIS |

*(Step 8 is blank in the source table. Nothing is missing — it is a formatting artefact.)*

### The stated KPIs

First Response Time ≤ 30 minutes · SLA compliance ≥ 95% · First Contact Resolution ≥ 80% · Average
Resolution Time · Reopened tickets (%) · CSAT after closure · Pending ticket ageing · Category-wise
trend.

### The 28 categories

Process owner / Escalation L1 / Escalation L2 / TAT, exactly as the sheet states them. Owners map to
four real portal accounts:

| Owner in the sheet | Portal account | Categories |
|---|---|---:|
| Khushi Soni – Assistant Manager HR | `khushi@orangeotec.com` | 10 (9 + engagement, D6) |
| Tanisha – Travel Desk Executive | `travel@orangeotec.com` | 4 |
| Saloni – HR Executive | `recruitment@orangeotec.com` | 5 (engagement moved to Khushi) |
| Receptionist cum HR Executive | **Dharmistha Prajapati**, `office@orangeotec.com` | 6 (5 + IT Support, D5) |
| HR Head / ICC | **Riya Kumari**, `riya@orangeotec.com` | 3 |

Escalation L1 is **HR Head on 25 of 28**; L2 varies: Management, Finance Head, Hiring Manager,
Department Head, HOD, Accounts, Admin Vendor, Insurance Provider, ICC Committee, Director, or `-`.

⚠ **Five TATs are not numbers**: "As per Exit Policy", "As per Calendar", "As per Training Calendar",
"As per POSH Policy", "As per Case". One is "Immediate" (Visitor Management). One is a *response*
time not a resolution time ("Initial Response within 24 Hours", Employee Grievance). The data model
has to carry all four shapes — see section 5.

---

## 3. Decisions taken (27-09-2026)

| # | Question | Decision |
|---|---|---|
| D1 | **Eleven** categories duplicate existing modules — four Travel Desk, four New Recruitment, and one each to General Purchase, Learning & Development and Employee Exit | **Ticket, then hand off.** Help Desk is the one front door. For an overlapping category the owner's resolve action is "Raise it in *module*"; the ticket records the ask, links to the created trip / requisition / session, and closes on the employee's confirmation. The work itself lives in the module that owns it |
| D2 | Access model | **Universal.** Every signed-in person can raise and track a ticket, no `app_access` row. Same as Learning & Development. ⚠ Two known consequences, both live today on L&D: Admin → Module Access renders it as admins-only and is *wrong*, and the card appears for all 70 people the day it deploys |
| D3 | When does escalation fire? | **On REOPEN, not on TAT breach.** Reopen #1 → the category's Escalation Level 1 is notified and joins the ticket. Reopen #2 (and after) → Escalation Level 2 is notified as well. No nightly escalation job is needed |
| D4 | POSH / Disciplinary / Employee Grievance | **Same module, narrow read gate.** A `confidential` flag on the category row, enforced in RLS: readable by the raiser, the named owner (HR Head / ICC), anyone escalated to, and admins. Never the general HR pool, never the reassign pool. Mirrors `fms_hr_may_see_grievances` |
| D5 | There is no IT category in the 27 | **Add one.** "IT Support", owned by Dharmistha, carrying an extra `external_escalated_at` stamp for the hand-off to the IT partner (Premware). Her KRA 9 asks for "escalated within 24 hours", which is a field, not a step |
| D6 | Who owns Employee Engagement Activities — the sheet says Saloni, her own appraisal says Khushi | **Khushi.** Her appraisal claims engagement, celebrations, rewards and internal communication at 25%, with the boundary spelled out line by line; Saloni's sheet carries no engagement line at all. The Help Desk sheet is the document that is wrong |
| D7 | Does a Help Desk grievance also write to the New Recruitment grievance register (`fms_hr_grievances`, NR-10)? | **Yes, but only while the raiser is inside their probation window.** One row, written by the ticket, so Saloni's "closed within 24 hours" line and the HR Head's confidential register both read the same record and nothing is typed twice |
| D8 | Does a TAT breach notify anyone? | **No.** A late ticket turns red, sorts to the top of its owner's queue and counts as a miss in the SLA and ageing reports. Escalation stays tied to reopening (D3). No reminder mail, no nightly chase |
| D9 | The employee has 2 working days to confirm. What if they never reply? | **Close it automatically**, and record *how* it closed. `closed_reason` is `confirmed` or `auto_closed`; the SLA report counts them separately, so "resolved and accepted" is never silently inflated by "resolved and ignored". Needs one nightly `pg_cron` job — the module's only scheduled work |
| D10 | What does the priority field do? | **Dropped entirely.** The category already decides the TAT. A priority that does not move the deadline is decoration, and one that does would be ticked "Urgent" by everybody. PDF step 2's "and priority" is deliberately not built |

---

## 4. Architecture — how it sits in this hub

Help Desk is the **fifteenth FMS module** and uses the engine the other fourteen use: code-defined
steps, a per-step SLA config an admin edits, per-owner queues, a Control Center adapter, My Work
Today, notifications, and module-level view/edit grants. Its own `fms_help_*` schema, independently
droppable — no shared `step_owners` table (they collide on `step_key`).

**Three things are NOT the house pattern, and each is deliberate:**

1. **The TAT is per CATEGORY, not per step.** Every other module's SLA is one number per step for the
   whole module. Here the `resolve` step's clock comes off the ticket's own category row. The engine
   supports this cleanly because `QueueEntryBase.dueIso` is `string | null` — `null` means
   *deliberately untimed, can never be late*, which is exactly right for the five narrative TATs.

2. **The owner is ROW-OWNED, off the category.** Every step routes to a bucket from Setup except
   `resolve`, which routes to the category's `owner_ids` (or to a named reassignee). This is the
   `assignee` pattern from the Complaint FMS — `fms_complaint_can_act` carries one per-request arm —
   and the `owner_ids uuid[]` column pattern from `fms_exit_clearance_depts`.

3. **First Response Time is measured, never made a due date.** `shared/lib/stepSla` has *no hours
   unit*, on purpose: everything downstream (`bucketOf`, `dueState`, `DueCell`) is date-granular, so
   an hours SLA would render "due today" while the real deadline passed at 14:00. The acknowledge
   step therefore gets a **same-working-day** due date, and the ≤30-minute KPI is computed as
   `acknowledged_at − raised_at` in minutes and reported in the MIS. Do not add an hours unit for
   this.

### The steps

| # | Key | Title | Scope | Owner | Due |
|---:|---|---|---|---|---|
| 1 | `raise` | Ticket Raised | ticket | anyone (`noQueue` — raising *is* the event) | — |
| 2 | `acknowledge` | Acknowledge Receipt | ticket | the category's process owner (row-owned) | same working day (config) |
| 3 | `awaiting_info` | Waiting on the Employee | ticket | **the person tagged** (row-owned) | 1 working day (config) |
| 4 | `resolve` | Resolve | ticket | the category's process owner (row-owned) | **the category's TAT**, from `raise` |
| 5 | `confirm` | Employee Confirmation | ticket | **the raiser** (row-owned) | 2 working days (config) |

Five steps, four of them row-owned. `raise` still gets a `step_owners` row so Setup *can* restrict
who may raise — with none set, anybody may, which is what D2 asks for.

**`close` is not a step.** The PDF makes it step 10, owned by "HRMS / HR Executive", same day.
Closing is the side effect of the employee confirming — and a step whose completion is another
step's side effect is a queue row that is always already done. (Travel Desk hit this exactly: its
`ticket_shared` step was dropped for the same reason.) Confirmation closes the ticket.

**The loop.** `resolve` → owner asks a question → `awaiting_info` → the tagged person answers →
back to `resolve`, `round_no + 1`. `confirm` → employee is not satisfied → back to `resolve`,
`reopen_count + 1`, escalation fires. Both loops are rounds, and `stepId` in the ranking scorer
carries the round so round 2's resolve is a different scored step from round 1's — the same thing
Order to Dispatch does.

**Statuses are not step keys** (the rule every module here follows): `open`, `awaiting_info`,
`resolved`, `closed`, `cancelled`, `on_hold` live in `TicketStatus`, never in `StepKey`. A status in
the work queue flows into the KPI tiles as "work owed by Nobody".

---

## 5. Data model

All additive. Tables in `public`, prefix `fms_help_`.

### `fms_help_categories` — the master that does the routing

| Column | Notes |
|---|---|
| `id`, `name` (unique), `code` | `code` is stable and lower-case; **the reports match on it, never on the name**. Same rule as `fms_ld_session_types.code` — renaming "POSH" on the Masters screen must not silently change a compliance count |
| `department_id` | the "concerned department" the PDF routes to |
| `owner_ids uuid[]` | the process owner(s). Plural so leave/cover works; the sheet names one |
| `escalation_l1_ids uuid[]`, `escalation_l2_ids uuid[]` | real portal users |
| `escalation_l1_label`, `escalation_l2_label` | the sheet's own wording — "Management (if policy exception)", "Insurance Provider", "ICC Committee". Printed on the ticket even when nobody is named, so the screen never claims an escalation path that does not exist |
| `tat_days integer null` | working days from `raise`. **null = deliberately untimed** |
| `tat_text` | the narrative TAT, verbatim: "As per Exit Policy", "As per POSH Policy", … Shown wherever the due date would be |
| `confidential boolean` | D4's gate. `true` for Employee Grievance, POSH, Disciplinary Matters |
| `requires_note boolean` | `true` for **Others**, which forces a free-text description |
| `handoff_app_id text null` | D1: `travel-desk`, `office-supplies`, `learning-development`, `hr-recruitment` |
| `active`, `sort_order`, `created_at`, `updated_at` | |

`tat_days` mapping for the six odd TATs: Visitor Management → `0` (same working day); Employee
Grievance → `tat_days = 1` with `tat_text = 'Initial Response within 24 Hours'`; the other four
narrative ones → `tat_days = null` + `tat_text`.

⚠ **Nothing may be seeded with an owner we invented.** The four owner accounts are confirmed above;
escalation L2 targets that are not portal users (Admin Vendor, Insurance Provider, ICC Committee,
Management) are seeded as a **label with no ids**, and the ticket escalates to the Setup-level
fallback instead of to nobody. PF-14 is the standing lesson: four modules shipped with no owners and
every approval in them went nowhere.

### `fms_help_tickets`

`id`, `ticket_no` (`HD-2627-0001`, FY-scoped counter — the `fms_travel_next_seq` / `fms_travel_fy_code`
pattern, copied), `category_id`, `raised_by`, `raised_at`, `priority`, `subject`, `body`,
`other_note`, `status`, `current_step`, `round_no`, `assignee_id` (a reassignment overrides the
category owner), `acknowledged_at` / `acknowledged_by`, `resolved_at` / `resolved_by`,
`resolution`, `info_from_user_id` / `info_requested_at` / `info_answered_at`, `confirmed_at`,
`csat_rating` (1–5) + `csat_note`, `reopen_count`, `escalated_l1_at` / `escalated_l2_at`,
`closed_at`, `hold_*`, `cancel_*`, `handoff_app_id` / `handoff_entity_id` / `handoff_ref`,
`recategorised_from`, `created_at`, `updated_at`.

### The rest, all mirroring an existing module

- `fms_help_step_owners` — identical shape to `fms_travel_step_owners`. Authorization comes **solely**
  from `employee_ids`; `department_ids` / `designation_id` are UI filters for choosing people.
- `fms_help_config` — jsonb singletons: `step_sla`, `process_coordinators`, `reassign_pool`,
  `policy` (the escalation fallback user, the auto-close switch, the FRT target in minutes).
- `fms_help_counters` + `fms_help_next_seq(text)` + `fms_help_fy_code(date)`.
- `fms_help_activity` + `fms_help_notifications` + `fms_help_announce(...)` — one activity row
  always, one notification per recipient, empty recipient list for a correction.
- `fms_help_master_requests` — anyone may ask for a new category; an owner approves. ⚠ The
  **wire contract** trap: every key in `proposed_payload` must appear in the resolve RPC's INSERT
  chain or it is *silently dropped on approve* (see `fms_ld_resolve_master_request`'s own warning).
- Storage bucket `fms-help-docs`, four policies, path-scoped so a comment cannot smuggle a file onto
  a ticket the author cannot see. Copy `20261005121600_fms_travel_doc_storage_policies.sql`.

### The gate

`fms_help_can_act(p_step_key text, p_ticket uuid, p_uid uuid)` — `module_can_edit(uid,'help-desk')`
**and** (admin ∨ coordinator ∨ step owner ∨ the row's own person for that step). Mirrored in
`store.tsx` `canActOn` and in `mywork/items/help-desk.ts`; the SQL comment must say so, as
`fms_complaint_can_act`'s does.

`fms_help_can_see(p_ticket, p_uid)` — the read gate. Ordinary ticket: anyone who can read the module.
**Confidential ticket: the raiser, the category's `owner_ids`, the current `assignee_id`, anyone in
`escalation_l*_ids` once that level has fired, and admins. Nobody else, ever.**

⚠ **Re-categorising a ticket INTO a confidential category is refused.** People have already read it;
moving it behind the gate does not unread it, and the screen would then claim a confidentiality it
never had. The RPC raises, and the message says "close this and raise it under *category*".

---

## 6. Escalation (D3)

```
confirm → "not satisfied"  →  reopen_count += 1
                              status = open, current_step = resolve, round_no += 1

reopen_count = 1  →  notify escalation_l1_ids, stamp escalated_l1_at
reopen_count ≥ 2  →  notify escalation_l2_ids (and l1 again), stamp escalated_l2_at
neither set       →  notify the Setup fallback (HR Head), and say on the ticket
                     which label the sheet names — "Management (if policy exception)"
```

**Escalated people become additive co-owners of `resolve` for that ticket.** Notifying somebody who
then gets Access Denied is worse than not notifying them. This is the same additive co-owner shape
Travel Desk uses for `manager_approval` — the owner arm must **not** early-return.

**A TAT breach notifies nobody** — it colours the due cell, sorts the queue, and counts in the
ageing and SLA reports. See the open question at section 12.

---

## 7. The screens

```
/help-desk                          Dashboard — my open tickets, my queue, SLA tiles
/help-desk/new                      Raise a ticket
/help-desk/mine                     My Tickets (what I raised)
/help-desk/tickets                  All Tickets (scoped by the read gate)
/help-desk/tickets/:id              Ticket Detail — stepper, panels, thread
/help-desk/queues/acknowledge       ┐
/help-desk/queues/resolve           ├ per-step queues, shown only to that step's owners
/help-desk/queues/awaiting-info     │
/help-desk/queues/confirm           ┘
/help-desk/monitoring               Control Center (pipeline)
/help-desk/reports/…                the seven reports — section 8
/help-desk/masters                  Ticket Categories
/help-desk/master-requests          requests for a new category
/help-desk/settings                 Setup — step owners, due dates, coordinators,
                                    reassign pool, escalation fallback, email
```

**Raise form.** Category (searchable `Combobox`), priority, subject, description, attachment,
optional "who else should see this" (mentions). Selecting **Others** reveals a mandatory note.
Selecting a category shows, inline, *who will get this* and *by when* — read off the master, so the
employee's expectation is set before they submit. A category with `handoff_app_id` says so too.

**Ticket Detail.** `StepPipeline` rail, the step's action panel, and **one timeline** — every
workflow event and every comment interleaved, not two tabs. "The owner asked why the date was wrong"
and "the owner resolved it" are the same story; splitting them makes the reader merge two lists by
hand. Modelled on `TripThread` / `CandidateTimeline`.

**The thread.** Free text + attachments + `MultiSelect` mentions. **Only a mention notifies**, and
the box says so — commenting should not page four people. A mention of somebody who cannot see the
ticket is **dropped by the server, silently**: raising would let an author probe who can see what.

**Every grid** sorts on every column and filters under every column, with cascading options and the
"no rows match" row that keeps the table standing. That is the house default, not a per-screen
decision — `QueueTable` and `MasterCrud` both do it already.

⚠ On the Masters form, use `select` (not `choice`) for the yes/no fields. `MasterCrud` wraps fields
in `FieldLabel`, which is a `<label>`; a click on the question text over a `ChoiceButtons` strip
silently picks the **first** option. The bug is shared by every masters page in the hub.

---

## 8. The reports (PDF step 11 — the HR Helpdesk MIS)

| Report | Answers | Notes |
|---|---|---|
| **Ticket Register** | everything, one row per ticket | the export |
| **SLA Compliance** | per category and per owner: raised, resolved, resolved within TAT, % | **Khushi's ≥95% line.** Untimed categories reported separately, never counted as met |
| **Ageing** | open tickets by age band (0–1 / 2–3 / 4–7 / 8–15 / 15+ working days) × owner × category | PDF: "Pending Tickets Ageing Report" |
| **Trend** | tickets per category per month, 12 months, with the reopen rate | PDF: "Category-wise Ticket Trend Analysis" |
| **First Response** | median FRT in minutes, and % answered within the target | minute-grained on purpose (section 4) |
| **Reopened** | count, %, and which escalation level each reached | feeds D3 |
| **Confidential Register** | the three confidential categories, dates, status, closure note | **HR Head + admins only.** This is Riya's KRA 12 "authorised confidential register" |

Reports read literally: headline first, figures as a tree, whole ISO weeks, no jargon.

---

## 9. KRA / KPI pointers

This is the part that makes the module pay for itself. Five HR sheets already reference a helpdesk
that does not exist.

### What each sheet's Help Desk line becomes

| Person | KRA line | Wt. | The sheet's target | Scored from |
|---|---|---:|---|---|
| **Khushi Soni** | 5 · Employee Queries, Loans & Advances — *"Helpdesk closure within SLA"* | 5% | ≥95% tickets resolved within 2 working days; evidence *"Helpdesk timestamps and escalation log"* | `kpiFacts`, module `help-desk`, `rowKeys: ["resolve"]`, `onTimeOfDone`. **A one-to-one match — the sheet is describing this module** |
| **Dharmistha Prajapati** | 4 · Office Administration and Facility Management | 10% | *"100% requests logged in Orange Hub"*; ≥95% routine maintenance closed within 3 working days | `kpiFacts` on her five categories (Admin Requests, Office Assets / Stationery, Visitor Management, Insurance, Employee ID Card) |
| **Dharmistha Prajapati** | 9 · IT Coordination | 5% | 100% IT complaints logged and escalated to Premware within 24 hours; ≥90% closed within 3 working days | ⚠ **There is no IT category in the PDF's 27.** See the gaps below |
| **Riya Kumari (HR Head)** | 12 · Employee Relations, Grievance and Risk Management | 5% | *"Log 100% Level-3 grievances, disciplinary, POSH … on the authorised confidential register"*; acknowledge/escalate within 1 working day | the **Confidential Register** report (section 8) + the acknowledge step's own SLA |
| **Riya Kumari** | 11 · HR MIS and Director Reporting | 5% | consolidated monthly HR review by the 6th working day | the MIS reports are the artefact; submission stays manual |
| **Riya Kumari** | 1 · Overall HR Function Governance | 10% | ≥90% weighted average KPI across the HR team | rolls up the four rows above — this is the *only* line that needs all of them live |
| **Saloni Rathod** | 1C.6 · Employee concerns / grievances | 1% | closed within 24 hours; evidence *"Ticket open-close timestamps"* | see the overlap note below |
| **Tanisha Tikde** | KRA 1 · Travel, Ticketing, Visa & Hotel Booking | 30% | stays on **Travel Desk** | Help Desk only carries the *ask* and the hand-off link (D1). Do **not** score her travel lines off Help Desk or the same booking counts twice |

### What to add in `apps/hr-reports/framework/`

The lab holds one framework literal per role (`saloni.ts`, `tanisha.ts` exist; `registry.ts` maps
them). Three sheets are missing and all three are Help Desk-heavy:

- **`khushi.ts`** — new. 10 KRAs, 100%. Her Help Desk line is `coverage: "system"` once the module is
  live; the other nine are mostly `no-data` (payroll and statutory live in HROne, not here).
- **`dharmistha.ts`** — new. 13 KRAs. KRA 4 and KRA 9 come off Help Desk; KRA 7 (asset movement)
  points at Asset Maintenance; KRA 11 (FMS task management, 15%) at `task-management`.
- **`riya.ts`** — new. 14 KRAs. KRA 12 and KRA 1 come off Help Desk; KRA 4 off New Recruitment, KRA 5
  off Learning & Development, KRA 6 off PMS (not built).

⚠ **Register them by `people` (email), not by `appliesTo`.** Saloni, Tanisha, Khushi and Dharmistha
are *all* "Human Resources · Executive" in the directory — `registry.ts` already carries a long
warning about this, and matching on department+designation would hand Khushi's sheet to whoever
matched first. The real fix is distinct designations in the directory; until then, pin by email.

### Wiring into the scorecard

- `ranking/modules/helpDesk.ts` — the scorer (`closed` / `open` / `load`), keyed `help-desk`. The
  build guard in `supabase/ranking/build.mjs` **fails the build** if a Control Center adapter exists
  with no entry in `RANKED_MODULES` or `NOT_SCORED`, so this cannot be forgotten.
- `fms_rank_modules` row, installed **`active = false`** — the precedent set by Travel Desk, Asset
  Maintenance and L&D. Switch it on when HR has been using it a month, not on day one.
- Rebuild **both** edge bundles: `node supabase/ranking/build.mjs` **and**
  `node supabase/ranking/build.mjs kpi`. One script builds `fmsRanking` *and* `kpiFacts`; building
  only the first leaves the scorecard running last week's scorer.

### ⚠ Three cautions on the scoring

1. **KPI-1 weights by volume; the sheet weights by importance.** If Khushi handles 200 tickets and 20
   New Recruitment steps a month, Help Desk will be ~90% of her KPI-1 score while her own sheet says
   it is worth **5%**. The *framework* lab (KPI-3) is the instrument that gets this right. Switching
   `fms_rank_modules` on without saying this out loud will make a fair scorecard look unfair.
2. **`fms_rank_modules` is a whole-module switch** and CC-1's ranking is a **leaderboard on the home
   screen**. Turning it on puts every HR person's ticket throughput in front of the whole company.
3. **Untimed categories must never count as "on time".** Five categories have no numeric TAT. A step
   with `dueIso = null` is dropped by the scorer as `untimed` and reported as a drop count — that is
   the correct behaviour, and the SLA report must say "n of m tickets were untimed" rather than
   quietly shrinking the denominator.

### Gaps the sheets reveal and the PDF does not cover

- 🔴 **No IT category.** Dharmistha's KRA 9 (5%) is "IT complaints logged and escalated to the IT
  consultancy partner **Premware** within 24 hours". Her sheet's own workflow reads *"Complaint
  logged → IT consultancy escalation → follow-up → resolution or overdue escalation"*. That is a
  Help Desk category with an **external** escalation stamp, and it is not in the 27. Needs the
  client's word: add it, with an `external_escalated_at` field?
- 🔴 **"Employee Engagement Activities" is assigned to the wrong person.** The PDF gives it to Saloni.
  Khushi's own KRA sheet puts *"Employee Engagement, Culture, Celebration & Employer Branding"* at
  **25%** — her single largest KRA — and states the boundary explicitly ("Khushi owns planning,
  calendar, theme, approvals … Tanisha manages only approved travel bookings"). Two of the five HR
  sheets contradict the helpdesk sheet. Needs confirming before the category is seeded.
- 🟡 **"Employee Grievance" overlaps `fms_hr_grievances` (NR-10).** That table already exists, with
  the same narrow read gate, and it is what scores Saloni's KRA 1C.6. It is *probation-scoped* —
  concerns from a new joiner. The Help Desk category is org-wide. Recommend: **keep both, and have
  the Help Desk ticket write an `fms_hr_grievances` row when the raiser is inside their probation
  window**, so one register answers KRA 1C.6 and KRA 12 both. Needs the client's word.
- 🟡 **CSAT is a stated KPI with no step.** The PDF names "Employee Satisfaction (CSAT) after ticket
  closure". Handled here as a 1–5 rating captured *at confirmation* — one extra field, not a step.
- 🟡 **FCR ≥80% is a stated KPI with no field.** First Contact Resolution = resolved with
  `round_no = 0` and `reopen_count = 0`. Derivable from what is already stored; no new column.

---

## 10. Build phases

Each phase ends green (`cd frontend && npm run build` — `tsc` strict is the gate; there is no test
runner). Migration before frontend, always, where a screen reads a new column.

| # | Phase | What lands |
|---|---|---|
| ✅ **HD-0** | Decisions | section 3 above, plus the four open questions at section 12 answered. A record, not a task |
| ✅ **HD-1** | Foundations + the category master | ✅ **Database done 28-09-2026.** `fms_help_step_owners` / `_config` / `_counters` / `_activity` / `_notifications` / `_categories` / `_master_requests`, the seq + fy + authz helpers, and the private storage bucket with **no policies yet** (the real rule needs `fms_help_can_see`, HD-2). **30 categories seeded**, owners resolved by email, label-only escalation where the sheet names a role rather than a person. The Masters SCREEN is still to build |
| ✅ **HD-2** | Raise + My Tickets | `fms_help_tickets`, `fms_help_raise()`, the raise form (with the "who gets this, by when" readout), My Tickets, Ticket Detail read-only |
| ✅ **HD-3** | Acknowledge + Resolve | `fms_help_can_act`, `fms_help_can_see`, the two RPCs, the two queues, the action panels, the stepper |
| ✅ **HD-4** | The thread | `fms_help_post_comment` (activity row + mentions + attachments), `awaiting_info` in and out, the timeline |
| ✅ **HD-5** | Confirm / Reopen / Close | the confirm panel, CSAT capture, the reopen path, `round_no` / `reopen_count` |
| ✅ **HD-6** | Reassign + Recategorise | the shared `ReassignModal` + `ReassignPoolSection`, the recategorise RPC (re-derives owner *and* due date, refuses a move into a confidential category) |
| ✅ **HD-7** | Escalation | D3's reopen ladder, the additive co-owner arm in `can_act`, the fallback |
| ✅ **HD-8** | Hand-off | `handoff_*` columns, the deep link out (reuse `shared/lib/returnTo.ts`), the stamp on return |
| ✅ **HD-9** | Home + Control Center | `mywork/items/help-desk.ts` + `providers/help-desk.ts` + `registry.ts`, `worksnapshot/entry.ts` `COVERED_APP_IDS`, the Control Center adapter, the Dashboard |
| ✅ **HD-10** | The seven reports | section 8, including the confidential register behind its own gate |
| ✅ **HD-11** | Email | the `help-desk_` kinds, `email_module_settings` row **installed OFF**, and the `send-email` prefix edit — see section 11 |
| ✅ **HD-12** | Ranking + KPI + the three sheets | the scorer, `fms_rank_modules` row **inactive**, `khushi.ts` / `dharmistha.ts` / `riya.ts`, both bundle rebuilds |
| ✅ **HD-13** | Confidential verification | sign in as a real non-admin HR person and prove a POSH ticket is invisible. Not an admin — admins bypass every gate |

---

## 11. The wiring checklist

A new module is not one folder. Fifteen places, and four of them have build guards that fail loudly:

**Frontend**
1. `apps/help-desk/` — `meta.tsx`, `nav.tsx`, `HelpDeskApp.tsx`, `HelpDeskLayout.tsx`, `store.tsx`,
   `types/index.ts`, `lib/{steps,sla,queues,format}.ts`, `data/*`, `pages/*`, `components/*`
2. `apps/appInfo.ts` — name `"Help Desk"`, basePath `/help-desk`, category `"hr"`
3. `apps/registry.tsx` — import + push (order `40`, after Travel Desk's `30`)
4. `apps/universal.ts` — add `"help-desk"` to `UNIVERSAL_APP_IDS` (D2)
5. `core/workspace/mywork/items/help-desk.ts` + `providers/help-desk.ts` + `mywork/registry.ts`
6. `core/platform/database.types.ts` — keep in sync with the new tables
7. `apps/fms-control-center/adapters/help-desk.ts` + `adapters/registry.ts`
8. `apps/fms-control-center/ranking/modules/helpDesk.ts` + `ranking/registry.ts` *(build guard)*
9. `apps/hr-reports/framework/{khushi,dharmistha,riya}.ts` + `framework/registry.ts`

**Backend**
10. `supabase/migrations/` — the phases above, each with its `_rollback.sql`
11. `supabase/worksnapshot/entry.ts` — `COVERED_APP_IDS` *(build guard)*. ⚠ It re-exports
    `UNIVERSAL_APP_IDS`; without step 4 the 9am mail counts **admins only** and nothing looks wrong
12. `supabase/functions/send-email/index.ts` — add `help-desk_` to the prefix list at **~line 1227**.
    Until this edit lands, every Help Desk mail is silently skipped as "unknown kind"
13. `email_module_settings` row — **installed `false`**
14. `master_report_modules` row — installed `enabled = false` until `fms_help_tickets` exists, then
    flipped in the same migration that creates it. ⚠ `master_report_snapshot()` builds dynamic SQL
    over `head_table` for every enabled row: an enabled row pointing at a missing table **breaks the
    director's daily report for every other module**
15. `fms_rank_modules` row — **`active = false`** *(build guard on the scorer, not on this row)*

**Then rebuild** `node supabase/ranking/build.mjs`, `node supabase/ranking/build.mjs kpi`, and the
work-snapshot bundle, and redeploy those functions. Deploy from whichever worktree holds `master`
(`git worktree list` — it moves).

---

## 12. Questions put to the client, and the answers

All six were answered on **28-09-2026** and are now decisions D5-D10 in section 3. Kept here as the
record of what was asked, because each one changes something a reader of the schema would otherwise
have to guess at.

| Asked | Answered |
|---|---|
| There is no IT category, but Dharmistha's KRA 9 needs one. Add it? | Yes, with the Premware hand-off stamped on the ticket |
| Employee Engagement Activities — Saloni or Khushi? | **Khushi.** The Help Desk sheet is wrong, not her appraisal |
| Should a Help Desk grievance also write to the New Recruitment register? | Yes, for new joiners only |
| Does a TAT breach notify anyone? | No — it shows as late and counts as a miss, nothing more |
| What if the employee never confirms? | Close it automatically, recorded as `auto_closed`, counted separately |
| What does priority do? | Nothing — the field is dropped |

**Two things still owed by HR, both outside the build:**

1. The **IT Support** category's escalation path — who at Premware, and who internally is Level 2.
2. Real people for the escalation levels that the sheet names only as roles: *Management*,
   *Admin Vendor*, *Insurance Provider*, *ICC Committee*, *Accounts*, *Finance Head*. Until those
   names arrive the category carries the label and escalates to the Setup fallback, which is
   honest but not what the sheet promises.

---

## 13. Verification

- `cd frontend && npm run build` green at the end of every phase — `tsc` strict across all of `src`.
- **Walk the whole lifecycle once, end to end**, not feature by feature: raise as a real employee →
  acknowledge as Khushi → ask for information tagging the employee → answer as the employee →
  resolve → reject as the employee (escalation L1 fires) → resolve again → reject again (L2 fires) →
  resolve → confirm with a CSAT rating → closed. Per-feature testing misses the joins.
- **Sign in as the real people, never as admin.** Admins bypass every module gate, so an admin
  session proves nothing about the confidential gate or the queues. Mint a session for the real
  account; revoke with `scope=local`, never `global`.
- **Prove the confidential gate from the other side**: as an ordinary HR person who is *not* the
  owner, the POSH ticket must not appear in All Tickets, in any report, in the reassign picker, or
  in a mention dropdown.
- **Prove the untimed categories**: a "Full & Final Settlement" ticket must show its TAT text and no
  due date, must never appear as overdue, and must be reported as a drop rather than as a miss.
- Check the live `information_schema` before quoting what exists — this database moves faster than
  the migration folder, and "nothing in the hub" goes stale in days.
