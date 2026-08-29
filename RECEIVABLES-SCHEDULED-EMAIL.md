# Emailing the Collection reports — status and what is left

**Where it stands (20-Aug-2026): sending BY HAND is live. Sending ON A SCHEDULE is now BUILT and
DISARMED.** Every piece works and has been run end to end; nothing goes out until somebody flips
one switch. See §2 for what was built and §6 for the order it goes live in.

*(Written 17-Aug-2026, when only the manual half existed. The reasoning is kept; the boxes say
what actually happened.)*

Live state verified against project `icutjkrqkbzwvmnfbzpr`.

> **⚠ CORRECTION, 20-Aug-2026 — read this before Phase 3.**
>
> This document was written against the old receivables project `lkwtvcpeamkzzqkfnkuc`. **That
> project no longer exists** — its hostname does not resolve. The report now reads the
> **ConnectWave live-Tally mirror** (`ieeefdnyhzgrroifiqbb`, `VITE_CONNECTWAVE_SUPABASE_URL` /
> `_ANON_KEY`) through `connectwaveFetcher.ts`, and `liveMode.tsx` has Live **on by default**, so
> that is what everybody is actually looking at.
>
> Wherever this doc says "the receivables project", read **ConnectWave**. A builder pointed at the
> old project would fail at 08:00 in front of nobody, which is precisely the failure mode this
> plan exists to avoid.
>
> **The size risk in §5 is retired.** Measured 20-Aug-2026: ~1,850 rows in
> `collection_customer_snapshot` and ~5,754 in `collection_invoice_snapshot`. That fits one
> invocation comfortably; the per-salesperson split fallback is not needed.
>
> **Phases 0, 1 and 2 are done** — the report's definition now lives in `lib/collectionCards.ts`
> and `lib/collectionScope.ts`, both plain TypeScript. **Phase 3 is done too, but not as an Edge
> Function** — that turned out to be impossible on CPU grounds. See §2.1.

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

**Update 20-Aug-2026: the builder and the runner are BUILT. What is left is the list and the
switch, both of which are yours to set.** The rest of this section is kept because the reasoning
still holds; the boxes below say what actually happened.

### 2.1 The report builder — ✅ done, but NOT where this document assumed

The plan said "an Edge Function". **It cannot be one, and that is measured rather than argued.**
A throwaway probe (`cpu-probe`) burned straight-line CPU on the live Supabase runtime:

| asked for | result |
|---|---|
| 1 second of computation | `200 OK` |
| 3 seconds | `546 WORKER_RESOURCE_LIMIT` |
| 8 seconds, awaiting a timer every 200 ms | `546` as well |

The documented ceiling is **2 seconds of CPU per request**, and the budget is **cumulative** —
yielding to the event loop does not reset it. Drawing this report is **~40 seconds of solid CPU**
(101 pages of hand-drawn vector PDF over ~250 customers, plus a 1.5 MB workbook). That is not a
near miss, and §5's fallback does not rescue it either: one salesperson's 18-page extract is
already over the limit on its own.

So the drawing happens on a **GitHub Actions runner**, which has no CPU cap and has the repository
checked out — which means it runs the app's **own TypeScript**, exactly as this plan always
required. Nothing about the "one implementation, two callers" principle is given up; only the
address of the machine changed. The repo is public, so runner minutes are free.

| | |
|---|---|
| `supabase/collectionsreport/build.mjs` | bundles the app's TypeScript with esbuild, four substitutions at the module boundary, **three guards** |
| `supabase/collectionsreport/entry.ts` | the job: ask the database, build, upload, queue, claim the slot |
| `supabase/collectionsreport/reportSpec.ts` | the period and the defaults — the one piece still mirrored rather than shared, and it says so |
| `.github/workflows/collections-report.yml` | ticks every 30 minutes, gates on the database before spending anything |

The three guards, since this repo has no test runner:

1. importing the **dead legacy receivables project** fails the build outright (RC-4).
2. our own code may not reach for `window`, `document`, `localStorage`, `import.meta.env` or React.
   npm packages are excluded from that scan on purpose — jsPDF legitimately feature-detects a
   browser, and failing over a dependency's internals only teaches the next person to delete the
   check.
3. `tsc --noEmit` over these four files. They sit outside `frontend/src`, so `npm run build` — the
   repo's only gate — never sees them. Without this a wrong argument would compile, bundle, deploy
   and fail at 08:00 in front of nobody.

**Measured end to end, 20-Aug-2026.** On the desk: ConnectWave in 2.1 s (1,847 ledgers), day-level
facts 0.2 s, the book drawn in 40.1 s (667 KB PDF + 1,541 KB workbook), one salesperson in 7.7 s.
**On the runner it is faster** — 26.0 s for the book, 4.8 s per rep, 60 s for the whole job
including the checkout and `npm ci`. A full send (the book plus thirteen reps) is therefore about
two minutes, against a 30-minute step timeout.

It reproduced the screen figure for figure: 247 of 362, ₹30.58 Cr, ₹17.53 Cr, 34, 116, ₹3.98 Cr.

Three runs proved the three modes (`32392028439`, `32392193665`, `32392294411`): a dry run built
both shapes; a **scheduled** run asked the database, was told `automatic sending is not armed`, and
stopped without reading a row; a **sample** posted the book and a rep extract from the runner
through storage and the outbox, both delivered, with the send log left empty — a sample must not
burn a slot.

Two things bit on the way, both worth knowing:

- **Node 20 is not enough.** `createClient` builds a RealtimeClient whether or not anything
  subscribes, and that needs a global `WebSocket`, which Node gained in 22. On 20 the job dies at
  module load, before a single row is read. The workflow pins **24**.
- **A wrong secret used to fail unreadably** — `Invalid supabaseUrl` thrown from line 61906 of a
  4 MB bundle, naming neither the variable nor which of the two projects it meant. Both clients now
  check the shape of their URL and say which one is wrong.

### 2.2 The timer — ✅ done, split between the database and the runner

> **⚠ SUPERSEDED 29-Aug-2026 — THE WAKING NOW LIVES IN `pg_cron`. See §2.2a below.**
> This section still describes how the *decision* is made, which is unchanged. What changed is who
> does the waking: GitHub's own scheduler proved unreliable enough to miss a slot outright.

Instead the workflow ticks every 30 minutes and asks
**`collections_report_due()`** — one SECURITY DEFINER function that is the single answer to "should
anything go out right now, and to whom". It checks, in order: the arming switch, the report's own
switch, the module switch, the schedule an admin set on the settings screen, whether today is one
of its days, whether the slot has arrived, whether the slot is still inside the grace window
(default 120 minutes), the send log, and finally who the recipients resolve to. On 46 of the 48
daily ticks it answers "no" in about a second, and the runner stops before checking anything out.

That keeps every judgement in the database, where the settings screen writes it — so a change to
the schedule or the list takes effect at the next tick, with no deploy.

- `cron` in the workflow is **UTC**, but nothing here converts by hand: the IST comparison happens
  inside `collections_report_due`, in `Asia/Kolkata`, so the stored hour means what it says.
- The send log is keyed **`(report_key, sent_for_date)`** on the **IST** date, so a retry or a
  manual catch-up cannot double-send. The workflow's `concurrency` group stops two runs racing at
  it in the first place.
- **A run that reaches nobody does not log** — `collections_report_mark_sent` returns `false` on a
  zero count and writes nothing. Adding the first recipient an hour late must not cost the slot.
- **Four switches must all be on**, and the fourth is new. `report_email_settings` is already `true`
  so admins can mail by hand, so without a dedicated lever this feature would have armed an
  unattended send as a side effect of code landing. `private.collections_report_config.armed`
  ships **`false`** and flipping it is a deliberate act:
  `select set_collections_report_armed(true);`

**And one silent failure mode worth knowing:** GitHub disables a scheduled workflow after **60 days
with no commits to the repository**, emailing the owner. This repo is under daily development, so
it is unlikely — but it stops rather than fails, which is the kind worth writing down.

### 2.2a The waking moved to `pg_cron` — 29-Aug-2026

**Why: GitHub's scheduler did not merely run late, it stopped.** Ticks actually fired, against 48/day
expected from `*/30`:

| 22-Aug | 23-Aug | 24-Aug | 25-Aug | 26-Aug | 27-Aug | 28-Aug | 29-Aug |
|---|---|---|---|---|---|---|---|
| 40 | 39 | 29 | 31 | 18 | **3** | **2** | **1** |

On **Saturday 29-Aug the 08:00 IST slot was missed.** The last tick before it ran at 06:53 IST and
the next never came, so the 120-minute grace expired at 10:00 IST having had **zero** opportunities.
Nothing was misconfigured — replaying the gate at 08:05 returns `due:true`, 63 mails. Meanwhile
pg_cron's `master-report-daily`, scheduled for **the same minute**, fired at `08:00:00 IST` (±40 ms)
on nine consecutive days including that one.

So the **decision is unchanged** — `collections_report_due()` is still the single answer — but the
**waking** is now `pg_cron`, which keeps time. The runner still draws and sends; it just no longer
has to remember when.

- `collections-report-kick` (`*/15`) → `collections_report_kick()`: asks the same gate, and only if
  due fires `net.http_post` to GitHub's `workflow_dispatch` API. No HTTP on a quiet tick.
- `collections-report-watchdog` (`*/30`) → `collections_report_watchdog()`: once the grace window
  closes with no send-log row, queues a `collections_report_missed` mail to
  `alert_email`. **This is the part that was missing**: every run reports success, because "not due"
  is a success, so a missed slot was previously invisible to everyone.
- Config + token live in `private.collections_report_kick_config` (never Vault — see the migration
  header). Set with `select set_collections_report_kick_pat('<token>', '<alert email>');`
- **GitHub's own `*/30` cron is deliberately left in place** as a free backstop. It cannot
  double-send: `entry.ts` re-asks the gate and the send log claims the slot.

Migration: `supabase/migrations/20261022120000_collections_report_kick.sql` (header carries the full
reasoning, the four things that break it silently, and the reversal).

**Timing, honestly — revised.** With pg_cron doing the waking, 08:00 IST means 08:00 IST: the job
fires at 02:30:00 UTC to the millisecond. `grace_minutes` is now a safety net rather than the thing
the design leans on.

**Testing without sending.** `collections_report_dispatch()` takes a mode, so the whole chain can be
proved from SQL with nothing leaving the building:
```sql
select public.collections_report_dispatch('dry-run');                    -- builds, sends nothing
select public.collections_report_dispatch('sample', 'you@example.com');  -- one address, slot NOT claimed
```
Verify with `select status_code from net._http_response order by id desc limit 1;` — GitHub returns
**204**.

### 2.3 Housekeeping — ✅ retention done, ⚠ size guard not

- **Retention** ships with it: a real run clears anything under `report-exports/scheduled/` older
  than 30 days. Folder names are `YYYYMMDD`, so the string comparison IS the date comparison.
- **Attachment size guard — still not built.** The book is 667 KB + 1.5 MB today, comfortably
  inside Gmail's limit, so this is not urgent; but a much larger month would fail the send rather
  than degrade it. Over ~10 MB the right behaviour is to drop the files and send a time-limited
  link.

---

## 3. Known open items

- **A salesperson name still resolves to EVERYONE holding the tag** (see §4). The send *dialog*
  shows each candidate with how many books they can see and makes a human choose; a schedule has
  no human at send time. Rather than invent an exclusion rule, `collections_report_due()` now
  returns `covers` on every resolved recipient and the run log prints
  `NAKUL JI → nakul@… (also covers 13 names)` — so an overseer receiving a rep's book is visible
  before the list is signed off, never a surprise afterwards. **Read that log when setting the
  list.** The proper fix is still a chosen **user id** on `report_email_recipients`, so a rep who
  changes address keeps receiving and one who loses the tag stops.
- **Two throwaway Edge Functions are deployed and should be deleted.** `report-spike` answered its
  question in Aug-2026; `cpu-probe` measured the CPU ceiling and has been stubbed to return `410`
  so nothing can burn compute by calling it. There is no delete in the Supabase MCP tools — use the
  dashboard or `supabase functions delete <name> --project-ref icutjkrqkbzwvmnfbzpr`.
- ~~**Size is unmeasured.**~~ Measured: see §2.1. The book is 101 pages, 667 KB + 1.5 MB, built in
  ~40 s. The constraint that bit was CPU time, not size, and not on the axis this document expected.
- **`send-email/index.ts` is not committed** on some branches. It carries both the receivables
  branch and the master-report work, tangled. It IS deployed; the source just is not always tracked.
- Only `zero-collections` is marked `emailable`. `low-collections` and `dormant-debtors` share the
  same code and would probably work — mark them when their output has actually been read.
- **The scheduled path bypasses `queue_report_email`.** It has to: that RPC is the browser's door
  and demands `auth.uid()` plus attachment paths under the caller's own id, neither of which a
  server run has. The checks it performs are performed instead by `collections_report_due()`, which
  is strictly stronger. Anything else that ever inserts into `email_outbox` directly must clear the
  same bar.

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

## 5. Two library traps the builder hits

> **20-Aug-2026: one of these survived contact, the other was overtaken.**
>
> The **jsPDF trap is real and is now pinned**: the package's Node entry is CJS whose default
> export is not the constructor, so `build.mjs` resolves `jspdf` to its ESM build. It is a
> first-USE failure, which is why it is pinned rather than remembered.
>
> **Inlining the fonts is no longer necessary.** The builder runs on a machine that has the
> repository checked out, so `brandAssetsServer.ts` reads `Poppins-Regular.ttf`,
> `Poppins-SemiBold.ttf` **and the logo** straight off disk. Same effect — no network call, no base
> URL — without a 400 KB base64 blob in the tree. The rest of this section still explains WHY the
> fonts are load-bearing, which has not changed.

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

## 6. Deploy order

The frontend calls things that must already exist, and the workflow only ticks from `master`.

1. the migration (`20260922120000_collections_report_scheduled_send.sql`) — ships **disarmed**
2. `send-email` — already deployed
3. the repository secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CONNECTWAVE_URL`,
   `CONNECTWAVE_ANON_KEY` — set 20-Aug-2026
4. merge the workflow to **`master`**. Scheduled workflows only run from the default branch, so
   until this lands the cron does not exist as far as GitHub is concerned. It is harmless there:
   every tick asks the database and the database says "not armed".
5. set the schedule and the recipients on Receivables → Settings → Notifications, then run the
   workflow by hand with **`mode: dry-run`** and read the log — it names every recipient a rep
   entry resolves to, and warns about any name nobody carries
6. `select set_collections_report_armed(true);` — **last, and yours.** Nothing sends before it.

To stop it again at any time, without losing the history:
`update private.collections_report_config set armed = false;`