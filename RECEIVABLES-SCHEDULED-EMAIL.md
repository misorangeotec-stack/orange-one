# Scheduled delivery of the Collection reports

Send the Zero-Collections report on a timer: the consolidated book to the people who run it, and
one extract per salesperson containing only their own customers.

Live state verified against project `icutjkrqkbzwvmnfbzpr` on 14-Aug-2026.

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
> **Phases 0 and 1 are done, and Phase 2 is done** — the report's definition now lives in
> `lib/collectionCards.ts` and `lib/collectionScope.ts`, both plain TypeScript.

---

## 1. What already works

More of this is built than expected. The email pipeline is not theoretical — **844 sent, 0 failed,
last send 14-Aug 16:52 UTC.**

| Piece | State | Evidence |
|---|---|---|
| Outbox → Gmail delivery | **working** | 844 sent, 0 failed. The in-repo note saying Gmail has been down since 24-Jul is **stale** and should be deleted (`NotificationsSection.tsx`). |
| Outbox sweeper | **working** | cron `email-outbox-sweep`, every 3 min |
| Attachments on email | **working** | `multipart/mixed` in `send-email`, files fetched from Storage with the service role |
| A report that mails itself daily | **working** | cron `master-report-daily`, 02:30 UTC = 08:00 IST, with a send log that makes a re-run harmless. A pattern to copy, not invent. |
| Cron → Edge Function | **working** | `masters_sync_tick` over `pg_net`, secret in the `private` schema |
| Salesperson → person → address | **available** | `profiles.receivables_salespersons` + `profiles.email` |
| Storage for generated files | **missing** | `report-exports` bucket never created |
| Email switch for this app | **missing** | every module has a row in `email_module_settings`; `outstanding-dashboard` has none, so a send today is a **silent no-op** with no error anywhere |
| Building the report with nobody logged in | **missing** | all of the work below |

The first two gaps are in `supabase/migrations/20260829120000_add_report_exports_and_receivables_email.sql`
— written, deliberately never applied.

---

## 2. The one real problem

**The PDF and workbook are built in the browser, from a Supabase project the scheduler cannot
reach. At 08:00 there is no browser.**

Scheduling an email is solved twice over in this codebase. Producing the report is not.

And it is not only the attachments. Every figure on that report — each KPI card, each customer's
overdue, the sale-type split — is computed by the app from raw ledgers and invoices. None of it is
sitting in a table waiting to be selected. So the report engine has to run server-side no matter how
much of the report we mail. Only a bare "click here to open the report" link avoids that, and that
is not what was asked for.

**The renderer itself is not browser-bound** — proven on 14-Aug by bundling `buildCollectionsPdf`
and `collectionsWorkbookBlob` with esbuild and producing real 59-page PDFs and real `.xlsx` files
headless under Node, fonts read from disk. What has to move is the layer beneath it: the report's
*definition*, which currently lives inside the 2,487-line `CollectionPerformanceReport.tsx`.

---

## 3. The work, in order

Each phase is gated on the one before. **Phase 1 is worth shipping alone** even if the timer is
never built — it gives a working "email this to these people now" button.

### Phase 0 — Prove the report can be built on a server *(half a day, throwaway)*

A scratch Edge Function that pulls a slice of receivables data, runs the engine, and writes a PDF
and an `.xlsx` to Storage. Answers three things:

- does jsPDF run on Supabase's Deno runtime (`npm:` specifier)?
- can `loadBrandAssets` fetch the Poppins TTFs without a page-relative URL? (needs a base-URL
  parameter, or the fonts moved into Storage)
- does a whole book fit inside the function's memory and wall-clock budget?

**If it fails:** fall back to a scheduled job on Vercel — a Node runtime this exact code already ran
on. Everything from phase 2 onward is unchanged; only the host differs.

**Gate:** a PDF lands in Storage that opens correctly, built by a server, no browser involved.

### Phase 1 — Turn on emailing by hand *(~1 day, mostly already written)*

- Apply `20260829120000`: the `report-exports` bucket (insert-only, own-uid prefix, **no client
  select** — the sender reads with the service role), `queue_report_email`, and the missing
  `outstanding-dashboard` module row seeded **off**.
- Deploy `send-email` — the `receivables_collections_report` branch is already in the working copy.
- Restore the two menu items in `ExportMenu.tsx` (a comment there records how) and add the
  Notifications switch to the hub's Settings.

**Gate:** pick three salespeople, hit Email, each receives their own two files and nobody else's.

### Phase 2 — Lift the report's definition out of the screen *(2–3 days, the bulk of the job)*

The page currently holds: who counts as a zero-collection customer, the `eligible` pool, what each
KPI card means (`computeKpis` / `cardsFor`), and `filterSummary`. The server needs all of it and
cannot import a React page.

Move it into one plain module both sides call, so the mailed report and the on-screen report cannot
drift into disagreeing. The engine underneath (`collections.ts`, `groupTree.ts`, `appDataCore.ts`,
`supabaseFetcher.ts`) is already plain TypeScript and moves as-is.

**Gate:** the screen behaves identically — same numbers, same cards, same exports.

### Phase 3 — The report builder *(2 days)*

One Edge Function: read the receivables project (its URL and key as Edge secrets), apply the saved
period and filters, build the consolidated report plus one extract per salesperson, upload, and
enqueue one outbox row per recipient. Manually triggerable — that is how it gets tested and how a
bad day gets re-sent.

**Gate:** one manual trigger produces the full file set and a queued email per recipient, figures
matching the screen.

### Phase 4 — The timer and the recipient list *(2 days)*

- Admin screen in the hub: on/off, hour (IST), daily / weekly (day) / monthly (date), the period the
  report covers, and the recipients.
- **Capture the filters from the screen** — a "use this view for the scheduled send" action — so
  what arrives by email is a view someone deliberately set and can be audited against later.
- Send log keyed on `(report, date)` so a retry or manual catch-up cannot double-send. A run that
  reaches nobody **deliberately does not log** — otherwise adding the first recipient at 09:00 costs
  the whole day. (Copied from `master_report_enqueue_daily`.)
- Three independent switches: schedule enabled / `email_module_enabled('outstanding-dashboard')` /
  per-recipient enabled.
- `cron.schedule` is UTC. Convert by hand and state the conversion in the migration.

**Gate:** set it for tomorrow 08:00, walk away, the right mail arrives.

### Phase 5 — Prove it, then leave it running *(1 day)*

- Reconcile one salesperson's mailed PDF against the same salesperson on screen, figure by figure.
- Confirm a rep's mail contains no customer outside their own book.
- Watch one full unattended run, then add the cleanup job that clears generated files after 30 days.

---

## 4. Who gets what

Two kinds of recipient, kept apart on purpose. A salesperson's report is **built from their rows
only** (`rowsForSalesperson`), never the whole book filtered at the last moment — so there is no
state in which the wrong customers could appear in it.

- **The book** — named people (directors, credit control), listed by hand. The consolidated report:
  every salesperson, the league table, both appendices.
- **Their own book** — resolved from `profiles.receivables_salespersons`. Tagging a user in the
  admin screen is what enrols them; nobody maintains a second list.

| Case | Decision |
|---|---|
| A user tagged with more than one salesperson | One email, one report per name. They run several books; merging them would print a total that appears nowhere else. |
| A salesperson in the data with no portal user | Listed in the admin screen as **unclaimed**, never skipped quietly. A report with no reader should be visible. |
| A customer worked by two salespeople | Appears in **both** extracts — a shared customer is the one most likely to be nobody's job. The extracts therefore sum to more than the book, which is why the consolidated report keeps counting them once. See the header of `collectionsExport.ts`. |
| Could a rep ever receive the whole book? | No. The two paths build from different row sets. Not a permission check that could be got wrong — there is nothing in their file to leak. |

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| jsPDF will not run on Supabase's Deno runtime | Most likely single failure. Phase 0 finds out in half a day. Fallback: Vercel, where this code is proven. |
| The whole book will not fit in one invocation | Every invoice for every customer is a lot to hold. If it does not fit, split per salesperson across invocations — slower, same output. |
| Files pile up in Storage | A PDF + workbook per recipient per day. Cleanup job goes in during phase 5, not "later". |
| A big month makes the attachment too large | Over the limit, drop attachments and carry a time-limited signed link instead. Degrade, do not fail. |
| The send is off and looks like it worked | Exactly what the missing module row causes today. Seed it off, surface it in Settings, and make the manual path **raise** rather than return quietly. |

---

## 6. Deploy order

The frontend calls things that must already exist. Shipping it first breaks it at runtime.

1. migration — bucket, `queue_report_email`, module switch (seeded **off**)
2. deploy `send-email`
3. deploy the report builder
4. merge the frontend
5. switch the module on, add recipients
6. enable the schedule — **last**, so nothing sends before it has been seen

---

Roughly 8–9 working days end to end, with phase 1 usable on its own after the first. Nothing in
phases 0–2 touches live data or sends anything. The first mail that can reach a real inbox is at the
end of phase 1, and only after the switch is turned on.
