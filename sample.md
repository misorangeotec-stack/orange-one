# Production Entry FMS — Workflow

> **What this is:** the end-to-end workflow of the **Production Entry** FMS (ink production floor),
> as it currently runs in production. This is a plain-English mirror of the code so you can
> **edit / reorder / rename** steps and hand it back as the spec. Nothing here is auto-synced —
> change freely.
>
> Source of truth in code:
> - Steps: `frontend/src/apps/production-entry/lib/steps.ts`
> - Per-step fields: `frontend/src/apps/production-entry/lib/stepConfig.ts`
> - Data shape: `frontend/src/apps/production-entry/types/index.ts`

---

## 1. Overview

- **App name:** Production Entry (menu: *FMS → Production*)
- **What it tracks:** one **job card** (batch card) from raw-material issue to finished-good transfer to Hojiwala.
- **Shape:** ONE entity per card — no header/line split. One card = one FG item, but **many** raw materials (a BOM).
- **Flow type:** **strictly linear** — a card moves through the steps in order; it is only ever in one queue at a time.
- **Deliberately NOT in this FMS:** no approval, no PO, no quotations. (Unlike the Purchase FMS apps.)
- **Access:** per-user granted (an admin switches it on for the production team); the nav + RLS scope what each person sees.

---

## 2. Masters (reference data)

Picked while raising a card or during steps; managed under **Masters** / governed via **Master Requests**.

| Master | Notes |
| --- | --- |
| Raw Material | Carries its own **unit** (auto-shown on pick) |
| Packaging Item | Carries its own **unit** |
| FG Item | Carries its own **unit** |
| Unit | e.g. Kg, L, Nos |

> *(Category master exists in legacy data but is intentionally hidden — intake no longer captures a category.)*

---

## 3. The workflow — 11 steps

**Step 1 is the origin** (raises the card, holds no queue). **Steps 2–11 each own a work queue.**
A card leaves every queue the moment it is **held / cancelled / closed**.

```
Batch Card → Material Handover → RM Transfer → Log Book → Production →
Quality → M/C Testing → PM Handover → PM Transfer → Packing → FG Transfer → (Closed)
```

---

### Step 1 — Generate Batch Card  *(origin, no queue)*
- **Who:** the requester (production team member raising the card).
- **Captures:**
  - Job Card No. *(required)*
  - FG Item *(required)*
  - BOM lines — Raw Material + Qty + Unit; **at least one**, each qty > 0 *(unit auto-derived from the raw material)*
  - Issue remarks *(optional)*
- **On save:** card is created and moves to **Material Handover**.

---

### Step 2 — Material Handover Confirmation  *(short: "Handover")*
- **Purpose:** confirm the raw-material handover to production.
- **Captures:**
  - Per-raw-material handover grid — actual qty + issue lot no (pre-filled from the batch card BOM)
  - RM Book No.
  - Remarks
  - Handover date *(auto-stamped on save)*
- **Advances to:** RM Transfer. *(Stays revisable until the transfer slip is created.)*

### Step 3 — RM Transfer to Production  *(short: "RM Transfer")*
- **Purpose:** record the **Tally location transfer** of raw material to production.
- **Captures:**
  - Tally Entry *(the Tally location-transfer entry ref)*
  - Remarks
  - Date *(auto-stamped)*
- **Advances to:** Log Book. *(Handover details shown read-only.)*

### Step 4 — Log Book Entry  *(short: "Log Book" — code key `transfer_slip`)*
- **Purpose:** record actual raw-material **use** + capture the **output metrics**.
- **Captures:**
  - Per-raw-material log-book grid — actual use, plus **added items** (master pick or free text) with their own lot no
  - **Output metrics:** Expected (Σ actual use) · Scrap · Actual Output (= Expected − Scrap) · Lab · Packed · Loose (= Actual Output − Lab − Packed)
  - **Attachment — mandatory**
  - Remarks
  - Date *(auto-stamped)*
- **Advances to:** Production Entry.

### Step 5 — Production Entry  *(short: "Production")*
- **Purpose:** post production to Tally. Output metrics captured at the log book are shown **read-only** here.
- **Captures:**
  - Tally Entry
  - Remarks
- **Advances to:** Quality Checking.

### Step 6 — Quality Checking  *(short: "Quality")*
- **Purpose:** lab quality check — **approve / reject, with retests**.
- **Captures (multi-round form):**
  - Per-round: result (Approved / Rejected) · test date · remarks · attachment
  - Retest due date (when a round rejects)
- **Advances to:** M/C Testing.

### Step 7 — Testing of M/C  *(short: "M/C Testing")*
- **Purpose:** machine testing after lab testing — a **single approve / reject**.
- **Captures:** result (Approved / Rejected) · remarks · optional attachment.
- **Advances to:** PM Handover.

### Step 8 — Packing Material Handover  *(short: "PM Handover")*
- **Purpose:** hand over packing material for packing.
- **Captures:**
  - FG packed qty
  - Multi-line packaging grid — item + qty (+ auto unit + line total)
- **Advances to:** PM Transfer.

### Step 9 — Packing Material Transfer  *(short: "PM Transfer")*
- **Purpose:** confirm the packing-material transfer. **View-only** — shows production Tally no., FG packed qty and the handover packaging list; user saves to advance.
- **Captures:** confirmation (date auto-stamped).
- **Advances to:** Packing Entry.

### Step 10 — Packing (Consumption) Entry  *(short: "Packing")*
- **Purpose:** log packing consumption in Tally. **Review-only** — shows net packing qty (= Actual Output − Lab), packed/loose qtys, production Tally entry, packaging list, all read-only.
- **Captures:** confirmation.
- **Advances to:** FG Transfer.

### Step 11 — FG Transfer to Godown  *(short: "FG Transfer")*
- **Purpose:** transfer finished goods to the godown — **closes the card**.
- **Captures — two Tally-entry ticks (both required to save):**
  - ☐ Production → Finished Goods
  - ☐ Finished Goods → Hojiwala
- **On save:** card **Closed**. *(As the last step, it stays editable after close.)*

---

## 4. Scoreboard stages

For the Control Center strip and cross-FMS scoreboard, the 10 queue steps roll up into **5 stages**:

| Stage | Steps included |
| --- | --- |
| Handover & Log Book | Material Handover, RM Transfer, Log Book |
| Production | Production Entry |
| Quality | Quality Checking, M/C Testing |
| Packing | PM Handover, PM Transfer, Packing Entry |
| Dispatch | FG Transfer |

---

## 5. Card statuses

A card is always in exactly one status. The `awaiting_*` statuses map 1:1 to the queue it is sitting in.

- `awaiting_material_handover` → `awaiting_rm_transfer` → `awaiting_transfer_slip` → `awaiting_production` → `awaiting_quality` → `awaiting_mc_testing` → `awaiting_pm_handover` → `awaiting_pm_transfer` → `awaiting_packing` → `awaiting_fg_transfer`
- **`closed`** — completed (set at FG Transfer)
- **`on_hold`** — parked with a hold reason (leaves every queue)
- **`cancelled`** — cancelled with a reason (leaves every queue)

**Per-step "Status of…" pick-list** (on the applicable steps): `Completed` · `Pending` · `Not Applicable`.

---

## 6. Ownership & due dates

- **Step owners** (Settings → Step Owners): each queue step is owned by a mix of **department(s)**, an optional **designation**, and named **employees**. Owners see that step's queue and get notified.
- **SLA / due dates** (Settings → Step Due Dates): every queue step defaults to **1 working day after the previous step**. Overrides live in config; the linear chain means the default anchor is usually right.
- **Master governance** (Master Owners + Master Requests): non-owners *request* a new master (raw material / packaging / FG / unit); the master owner approves or rejects.

---

## 7. Edit / hold / cancel rules

- Each completed step **stays revisable until the next step is recorded** (FG Transfer stays editable even after close).
- A card can be put **on hold** (with reason) or **cancelled** (with reason) from its detail view — both remove it from all queues.
- Every change stamps **who** and **when** (`editedBy` / `editedAt`, plus per-step `*By` / `*At`).

---

## 8. Edit this workflow

To change the actual app after editing this doc:
- **Rename / reorder / add / remove a step:** `frontend/src/apps/production-entry/lib/steps.ts` (`STEPS` array + `StepKey` union) and the matching `STAGES`.
- **Change what a step captures:** `frontend/src/apps/production-entry/lib/stepConfig.ts` (`STEP_CONFIG`).
- **New fields need a DB column + RPC:** `types/index.ts`, `data/productionWrites.ts`, and the `fms_production_*` Supabase schema (additive-only).
- **Due-date defaults:** `frontend/src/apps/production-entry/lib/sla.ts`.
