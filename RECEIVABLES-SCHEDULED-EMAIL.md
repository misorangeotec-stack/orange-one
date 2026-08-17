# Emailing the Collection reports — status and what is left

**Where it stands (17-Aug-2026): sending BY HAND works and is live. Sending ON A SCHEDULE is not
built.** Somebody has to press a button. This file is the handover for the half that remains.

Live state verified against project `icutjkrqkbzwvmnfbzpr`.

---

## 1. What is done and live

| | |
|---|---|
| Storage for generated files | `report-exports` bucket — private, upload-only, own-uid prefix, **no client read** |
| The enqueue | `queue_report_email(report_key, …)` — checks Reports full access, the report's own switch, and that every attachment path belongs to the caller |
| The switch | per REPORT (`report_email_settings`), not per module. Settings → Permissions |
| Manual send | Export → **Email all…** / **Email salesperson-wise…** |
| Recipient picking | you choose who receives a salesperson's book; nothing is inferred (see §4) |
| Isolation | two tripwires; a rep's file refuses to build if anyone else's customer is in it |
| Progress | a real bar — three phases per artefact × number of salespeople |
| Schedule + recipient list | **stored** (`report_email_schedule`, `report_email_recipients`) but **nothing reads them** |

Delivery itself has long worked: 844+ mails sent, 0 failed. The repo note claiming Gmail has been
down since July is stale.

**The switch is OFF** and stays off until an admin flips it. That is the hard stop: with it off
`queue_report_email` raises before writing anything, so no path leads from a button to an inbox.

---

## 2. What is PENDING — the automatic send

Three pieces, in order. None of them exists yet.

### 2.1 The report builder (the real work)

An Edge Function that builds the report with nobody logged in.

**Why it is needed at all:** the PDF and workbook are drawn in the BROWSER, from a *different*
Supabase project. At 08:00 there is no browser. And it is not only the drawing — every figure on
the report (each KPI card, each customer's overdue, the sale-type split) is computed by the app
from raw ledgers; none of it sits in a table waiting to be selected. So the report engine has to
run server-side however much of the report we mail.

**How:** follow `supabase/worksnapshot/build.mjs`. That is an existing, working precedent for
running the frontend's own code on Deno: esbuild bundles the real TypeScript, substituting the
browser Supabase client for a service-role one, and the build FAILS if React, `window`,
`localStorage` or `import.meta.env` reach the graph. Copy that shape rather than inventing one, and
copy its guard — it is the only test this repo has.

**What has to move out of the React page** (`CollectionPerformanceReport.tsx`, ~2,500 lines): who
counts as a zero-collection customer, the `eligible` pool, `computeKpis` / `cardsFor`, and
`filterSummary`. Into one plain module both the screen and the server call, so the mailed report
and the on-screen report cannot drift. The engine underneath (`collections.ts`, `groupTree.ts`,
`appDataCore.ts`, `supabaseFetcher.ts`) is already plain and moves as-is.

### 2.2 The timer

`pg_cron` → the builder over `pg_net`, following `masters_sync_tick` (20260902120400) for the
call and `master_report_enqueue_daily` (20260830120200) for the shape:

- `cron.schedule` is **UTC**. Convert from the stored IST hour by hand and state the conversion.
- A send log keyed on `(report, date)` so a retry or manual catch-up cannot double-send.
- **A run that reaches nobody must NOT log.** Otherwise adding the first recipient at 09:00 costs
  the whole day.
- Three switches must all be on: the schedule, the report's email switch, the per-recipient flag.

### 2.3 Housekeeping that ships with it

- **Retention.** A PDF + workbook per recipient per day accumulates in `report-exports`. A cleanup
  job (30 days) goes in with the cron, not "later".
- **Attachment size guard.** Over ~10 MB, drop the files and send a time-limited link instead.
  Degrade, do not fail.

---

## 3. Known open items

- **`ReportDeliveryConfig` resolves recipients the wrong way** (see §4). It stores only the
  salesperson NAME and would resolve to everyone holding the tag. Nothing reads that table yet, so
  nothing is sending on it — but it needs the same treatment as the send dialog, plus a column for
  the chosen **user id** (not the address, so a rep who changes email keeps receiving and one who
  loses the tag stops).
- **`supabase/functions/report-spike` is deployed and should be deleted.** It answered its question.
  There is no delete in the Supabase MCP tools — use the dashboard or
  `supabase functions delete report-spike --project-ref icutjkrqkbzwvmnfbzpr`.
- **Size is unmeasured.** The spike proved the runtime with a two-page toy. Whether ~60 pages over
  a few thousand invoices fits the function's memory and wall clock is the first thing to measure
  in 2.1. If it does not, fan out per salesperson across invocations.
- **`send-email/index.ts` is not committed** on some branches. It carries both the receivables
  branch and the master-report work, tangled. It IS deployed; the source just is not always tracked.
- Only `zero-collections` is marked `emailable`. `low-collections` and `dormant-debtors` share the
  same code and would probably work — mark them when their output has actually been read.

---

## 4. The one lesson worth not relearning

**`profiles.receivables_salespersons` is a VISIBILITY SCOPE, not an identity.**

It answers *"whose figures may this person see"*. It does **not** answer *"who is this
salesperson"*. The live data is unambiguous: three accounts (`PC`, `collection`, `ritesh`) carry
all thirteen salespeople, `nitesh` carries eight, and `nakul` — a real rep — carries five.

The first version of the send dialog read it as an address book and would have mailed one rep's
book to five people, four of them oversight accounts. Nor can the right answer be inferred:
"tagged with exactly this one name" correctly identifies `khurshid` and `umesh` and fails on
`nakul`.

So recipients are **chosen**, with every candidate shown alongside how many books they can see (1 =
the rep, 13 = credit control). Anything that later resolves a salesperson to an address — the cron
job above, especially — must do the same. Do not reintroduce the shortcut.

---

## 5. Two Deno traps the builder will hit

Both libraries ship CJS, and Deno's interop hands back the wrong thing. **Neither fails at import
time** — they fail on first use, which in a scheduled job means 08:00 in front of nobody.

```ts
import jsPDF from "npm:jspdf"               // -> "jsPDF is not a constructor"
import * as XLSX from "npm:xlsx-js-style"    // -> XLSX.utils is undefined

import { jsPDF } from "npm:jspdf@4.2.1";     // named   ✓
import XLSX from "npm:xlsx-js-style@1.2.0";  // default ✓
```

Assert both are callable at module load rather than discovering it mid-render.

**Fonts should be INLINED into the server bundle,** not fetched. Built-in Helvetica is WinAnsi and
has no ₹, so `addFileToVFS` + `Identity-H` is load-bearing for every money cell — and the app's own
copy is not reliably reachable over https (`portal.orangeotec.com` does not resolve from every
runtime, and the Vercel build does not serve `/assets/fonts` as a fetchable file; both checked).
Inlining removes a network call, a base URL and a whole class of failure from the send path.

Proven on the live runtime 17-Aug-2026: Poppins embedded, valid 2-page PDF in 75 ms, and pdfjs read
`₹ 1.25 L and ₹ 42.19 Cr` back out with both rupee signs intact.

---

## 6. Deploy order, when the time comes

The frontend calls things that must already exist.

1. migration (bucket / functions / switches — seeded **off**)
2. `send-email`
3. the report builder
4. the frontend
5. switch the report on, add recipients
6. enable the schedule — **last**, so nothing sends before it has been seen
