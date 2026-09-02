# Bushra — Work List

Bushra's own day-to-day work: the tasks, answers and sheets that are hers to move, filed
**module-wise**. Ask *"what's on Bushra's list?"* and this file is the answer.

**This is now the ONLY work list.** `WORKLIST.md`, the team build log this file was written as a
companion to, was deleted on 2026-09-02 at Bushra's instruction. It is recoverable from git history
(`git show HEAD~1:WORKLIST.md`) and nowhere else. This file holds what is **Bushra's to decide,
supply or walk through**.

⚠ **The main-list IDs below (`OD-2`, `AM-1`, `PF-14`, `OCPI-3`, …) no longer resolve to anything in
the working tree.** They were deliberately written as links rather than restatements, on the rule
that a task written in two places is a task nobody trusts — so the full write-up behind each ID now
exists only in git history. Keep the IDs: they still identify the work, and old notes and messages
that quote them still make sense.

**ID prefix:** `BW-`, with the module named on the italic line under the heading. `BW-` numbers are
this file's own and never collide with the main list's.

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

A task that needs someone else's call carries a **"To discuss with …"** checklist at the end — the
open questions to put to them, so the conversation happens once and the answers land back here.

**Last updated:** 2026-09-02

---

## Waiting for

Work of Bushra's that is held up because someone else owes her something. If an item here is late,
this is the first place to look.

| What is needed | From | Blocks | Waiting since |
|---|---|---|---|
| *(nothing recorded yet)* | | | |

---

## What the main list is waiting on from ME

The rows that named Bushra in the retired `WORKLIST.md`'s "Waiting for" table, pulled together so
they are visible in one place. **These are the things whose absence is stopping other people.**
This is now the only copy — clear one and strike it here.

| What is needed | Blocks | Waiting since | Status |
|---|---|---|---|
| Who owns the approvals in OCPI, Customer Onboarding, Asset Maintenance and Travel Desk — no step owners are configured at all *(jointly with Ritesh Bhai)* | **PF-14** | 2026-08-27 | `[ ]` |
| The REAL dryer names, Indian and Chinese — six `[SAMPLE]` placeholders are standing in *(jointly with Ritesh Bhai)* | **OCPI-3** go-live | 2026-08-29 | `[ ]` |
| A walkthrough of Asset Maintenance, to list the changes it needs | **AM-1** | 2026-08-20 | `[~]` |
| Department, sub-department + employee code for the 10 people who joined after the 27-05-2026 sheet | **OM-1** | 2026-08-20 | `[ ]` |
| The final list of production steps to add *(factory first, then Bushra)* | Widens **PE-2** | 2026-08-20 | `[ ]` |
| Confirm the true maximum `QT-M####`, and proof-read the ten transcribed OCPI templates | **OCPI-1** | 2026-08-27 | `[ ]` |

---

## Questions on the table for me

Decisions the build is waiting on. Each was written up in full under its own ID in the retired
`WORKLIST.md`, so the summary below is now the working copy — the fuller version is in git history.
**Answer here.**

### Order to Dispatch

- **OD-1 · Internal transfer / Others on a dispatch**
  - [ ] Everything that has to carry the internal tag — which master holds it, who maintains it,
        and whether it comes from Tally or is ours
  - [ ] Is "internal" one flag, or internal *and* related as separate tags?
  - [ ] Does Internal transfer change anything downstream — credit check, sales bill, gate-out — or
        only who appears in the picker?
  - [ ] What happens to orders already raised for internal movement under the current options
- **OD-2 · Stop creating customer and item masters inside Orange One**
  - [ ] Remove "request a new customer / new item" from Order to Dispatch **entirely**?
  - [ ] If not removed: is the request still approved here, or does it become "create it in Tally
        and wait for the sync"?
  - [ ] What a user should see when the customer or item genuinely isn't there yet
  - [ ] How loudly a portal-created master should be flagged, and what happens to the ones already
        sitting there
- **OD-3 · Who maps customer to item**
  - [ ] Does the user create the mapping directly, or does the PC keep approving it?
  - [ ] If the user: any guard at all, or a free hand?
  - [ ] Does this land in the coordinator's single queue (**PC-1**)?
- **OD-7 · Sale type on the sales order**
  - [ ] Can one order mix sale types, or is a mixed order meant to be split?
  - [ ] Who owns the group → sale type map once it exists?

### Production Entry

- **PE-2 · Lot-wise and stage-wise cycle-time report**
  - [ ] Which steps are missing, and where they sit in the existing chain (Handover & QC → Log Book
        & Production → M/C Testing → Packing → Dispatch)

---

## To discuss with Ritesh Bhai

A running list of what Bushra needs from Ritesh Bhai. Two kinds of item live here and they are
marked differently:

- **`[decided]`** — already agreed and already applied. Listed so it can be confirmed, and so the
  exact wording is on record if it is ever queried.
- **`[open]`** — nothing built or acted on either way; the answer changes what happens next.

*(nothing yet)*

---

## Platform — all modules

*(nothing yet)*

---

## OCPI

*(nothing yet)*

---

## HR

*(nothing yet)*

---

## New Recruitment

*(nothing yet)*

---

## Asset Maintenance

*(nothing yet — the walkthrough that starts this off is **AM-1** in the main list)*

---

## Admin / Masters

*(nothing yet)*

---

## Order to Dispatch

- **BW-1 · The sales bill carries its own quantity** `[~]`
  *Order to Dispatch — Generate Sales Bill, and everything downstream of it*

  `ship_qty` — the store keeper's "Ship now" at Check Material Status — was the only quantity in
  the system. The gate pass printed it, the gate-out and delivery recaps showed it, and the order's
  delivered total was worked out from it. The billing desk could see what had been picked but had
  **no way to say the Tally invoice covered less**, and no screen would have shown the difference.

  Generate Sales Bill now carries a per-line **Sales bill qty**, typed by whoever owns that step
  (rights needed nothing new — `fms_dispatch_can_act` already gates the step). From there on it is
  the figure that counts: it prints on the gate pass, the gate-out and delivery screens show it, and
  the order settles against it. **A line released as 60 but billed 40 settles 40** — the 20 stays
  pending and comes back as its own round, exactly as a short-shipped line does.

  Decided 2026-09-02: the box opens **blank** on a first record (pre-filling would make
  "bill everything" the accidental default), and is **capped per line at what the store released** —
  a gate pass must never list more than is on the vehicle.

  Two things rode along, both found while building it:
  - **Every remark is now visible to the next desk.** Each step collected a Remarks box only its own
    step could read, so the store keeper could not see why credit released part of the order and the
    gate could see neither that nor the store's note. The recap panel carries the whole trail now,
    with who wrote each and when.
  - The quantity box had to be sized on its **wrapper**, not on the input: `cn()` is a plain string
    joiner, not tailwind-merge, so a `w-24` className never replaced the `w-full` baked into
    `fieldBase`. Worth knowing — **the same trap is live in `ShipLinesGrid`**, and in any other grid
    that sizes a shared field by className.

  **Where it stands.** Migration `20261104120000` is **applied to the live database** (2026-09-02) —
  verified: 3,172 archived rows backfilled, none left null, and **zero orders whose delivered total
  would move**. A compatibility shim means the old screen still bills normally, so nothing broke for
  anyone while the frontend waits. The screens are on branch `Bushra-O2D` with a PR open; they reach
  the team when it merges and Vercel deploys.

  **To discuss:**
  - [ ] Should `ShipLinesGrid`'s "Ship now" box get the same width fix?
  - [ ] A line released but left blank on the bill has physically left the gate with no invoice
        against it. The order keeps asking for it — who reconciles that, and is it worth a report?

---

## Production Entry

*(nothing yet)*

---

## Purchase RM Domestic

*(nothing yet)*

---

## Purchase RM Import

*(nothing yet)*

---

## Task Management

*(nothing yet)*

---

## Outstanding Dashboard (Receivables)

*(nothing yet)*

---

## Fixes

Bugs found and repaired, **newest first**. This is not the same thing as [Done](#done): Done holds
tasks somebody *asked for*, this holds faults somebody *hit*. A fix has no open entry above — it was
never on the list, because nobody planned it.

Three rules:

- **Stamp the date and time it went live**, in IST, and name the commit.
- **Lead with what the person saw**, not with the cause. What will be searched for a year from now
  is the symptom; the explanation is the second line.
- **Say what else was at risk.** A fault is rarely alone — if the same mistake sits elsewhere, write
  down where, so the next reader does not have to find it twice.

*(nothing yet)*

---

## Done

Finished work, **newest first**. A task moves here from its module heading the day it goes live.

Four rules, so the section stays worth reading:

- **Stamp the date and time it shipped**, in IST, on the entry's italic line — the moment it went
  live, not the moment the work was done. Two tasks finished on the same day still read in order.
- **The ID and the module travel with it.** BW-1 stays BW-1, so a note or a message that referred to
  it while it was open still resolves.
- **Say what a reader will now see**, not which lines moved.
- **Delete the open entry in the same edit.** A task listed in two places is a task nobody trusts.

*(nothing yet)*
