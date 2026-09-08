# Bushra-LOT-Complaint-FMS

Branch document. New FMS module: **Complaint (RM/FG)**.

| | |
|---|---|
| App id | `complaint` |
| Path | `/complaint` |
| Schema | `fms_complaint_*` |
| Numbering | `CMP-2627-0001` |
| Run locally | `cd frontend && npm run dev` → http://192.168.1.105:5300/complaint |

## What it does

A complaint against a **LOT No.**, of two types:

- **Finished Good** — a customer complains, keyed to a sales invoice.
- **Raw Material** — we complain to a vendor, keyed to a purchase invoice.

One shared party/invoice block; the type only changes the labels and the picker
filter (`is_customer` vs `is_vendor`).

## The flow

    Raise → Plant → Service → [Approval] → Management Review → Closed

- **Plant** — corrective action, remarks, attachment.
- **Service** — remarks, conclusion, and **"Commercial call taken?"**
  - **Yes** → management approval with the call remarks → back to service to close.
  - **No** → service closes it there. The conclusion is the closing remark.
- **Management Review** — one click, "Review done". Chain closed.

Four queues. Service is one bucket entered twice, so it is one step with two
statuses. The pipeline rail runs across the top of every complaint; Approval is
hidden entirely when no commercial call was taken.

## LOT lookup — from ConnectWave

Type a LOT No. and it offers matches — item, category of ink, party, invoice no.
and date.

**The source is ConnectWave**, table `rpt_batch_line` (project
`ieeefdnyhzgrroifiqbb`), which gained the batch dimension on 07-09-2026. Nothing
local is involved: no Tally on the user's machine, no sync script, and it works
the same in production.

Coverage, measured 08-09-2026 — this is why it replaced the local sync:

| | our old synced index | ConnectWave |
|---|---|---|
| real lots | 31,852 | **112,277** |
| purchase lines | 1,875 | **9,698** |

The purchase column is what changed behaviour: the RM side used to miss about
three times in four, and now answers.

ConnectWave knows Tally **names**, not our ids, so a second call resolves them —
company first, then party and item *within that book*, then the ink category.
Where a name is ambiguous the id stays empty and the user picks; it never guesses,
because a wrong customer flows into a credit note.

The company is matched on **`tally_guid`, not the company name.** Tally renames a
company file when the financial year rolls over, so ConnectWave lists the same
book under two names — `…(F.Y.2026-27)` and `…(F.Y.2024-26)` are one book of
39,235 lines. Matching on the name left the Company picker empty for most lots;
the guid does not change when the file is renamed. Resolution measured
08-09-2026: company 100%, party 100%, item and category ~98%, in 0.26s for a
100-row lookup.

A lot is **not** unique — 92% appear on more than one line — so it offers candidates
and never fills silently. Every field stays editable.

⚠ **LOT expiry is still typed by hand.** `rpt_batch_line` has a `batch_expiry`
column and it is filled on **zero** of the 112,277 real lots. The column existing
is not the data existing.

`tools/sync_tally_lot_index.py` and its table are kept as a fallback but are no
longer read.

## Masters

Customers, vendors, items, Category of Ink and units all come from the central
Tally masters. Only two new ones: **Nature of complaint** and **Root cause**.

## Done

43 frontend files, 16 migrations (all applied to the live Supabase, additive only),
the Tally sync script. `npm run build` green. Eight complaints walked end to end,
both types, both branches of the commercial call.

## Still pending

1. **No undo on the commercial call** — answering "No" closes the complaint for
   good. Hit once by mistake in testing.
2. **Step owners are not set** — until Setup → Step Owners names the plant, service
   and management buckets, the queues stay empty for everyone except admins.
3. **Cross-module registration** — Control Center, My Work Today, Process
   Coordinator and the work-snapshot bundle do not know about Complaint yet.
4. Three early test rows (CMP-2627-0001, -0004, -0006) sit on statuses that the
   reshaped workflow retired, so they are in no queue.
5. Nothing is committed on the branch yet.
