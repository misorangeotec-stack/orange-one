# Ritesh — Work List

Ritesh's own running list, kept separately from the shared
[WORKLIST.md](WORKLIST.md). Everything asked for in this working thread lands here
**first, before any of it is executed**, and the same entry is updated the moment the
work is finished. Ask *"what's on Ritesh's list?"* and this file is the answer.

The shared list stays the record for the product as a whole; this one is the record of
what was asked here, in the order it was asked, and what came of it.

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked
**Priority:** 🔴 hurting live work, jumps the queue · 🟢 low priority, depends on nothing

**How this file is kept — the two rules that make it worth reading:**

1. **The task is written down before it is done.** A new instruction becomes an entry
   under **Open**, with its ID, the date it was raised, and what was actually asked —
   in the words it was asked in. Only then does the work start.
2. **The entry is closed in the same session it ships.** It moves to **[Done](#done)**
   with the date, what a reader will now see, and anything learned on the way. A task
   listed as open after it shipped is a task nobody trusts.

IDs run `RW-n` and never get reused, so a reference to **RW-1** still resolves after it
has moved to Done.

**Last updated:** 2026-09-02

---

## Open

*Nothing open.*

---

## Done

Finished work, **newest first**.

### RW-2 · The debtor analysis report, for every customer  `[x]`
*Raised and done **02-Sep-2026***

**Asked for:** refer to the Rajlakshmi digital PDF in the MISC folder and create the report. All
the data on it is data we already capture for that customer, and we want this kind of report for
*each* customer — so the right home is the individual customer detail page. Add an analysis
dashboard button there; clicking it shows this report for that customer. Analyse the PDF against
the data we actually hold and produce an action plan first.

**What there is now.** A **Debtor Analysis** button beside Export on every customer page, opening
`customer/:id/analysis` (and `group/:id/analysis`): the account-status and period-summary chip
bands, a fiscal-quarter rollup, the month-by-month table, a reconciliation line, and the action
note saying what must be collected to come back inside the limit. Downloadable as a branded
vector PDF and as a three-sheet workbook. Five new files, two touched:

- `lib/debtorAnalysis.ts` — the whole calculation, pure and React-free
- `lib/useDebtorLedgerData.ts` — the fetch/resolve half, lifted out of Customer Detail
- `pages/DebtorAnalysis.tsx`, `lib/exportDebtorAnalysisPdf.ts`, `lib/exportDebtorAnalysisXlsx.ts`
- `ReceivablesHubApp.tsx` (two routes), `pages/CustomerDetail.tsx` (the button)

The screen, the PDF and the workbook all render the **same** report object, so a figure cannot be
three different numbers across the three.

**Verified against the source PDF, not by eye.** The engine is pure, so RAJLAXMI's own figures
were run straight through it. Every quarterly rollup, the summary row, all twelve chips, the
labels and the reconciliation match the document — including the two the fiscal arithmetic is
usually got wrong on (Q4 FY25 spans `Jan-Mar 26`, Q1 FY26 spans `Apr-Jun 26`), and the partial
row labelled `Jul-26`, not `Q2 FY26`. Separately checked: narrowed FY, the ₹1 credit-limit
sentinel, a credit balance, under one quarter of history, and a gap month. `npm run build` clean.

**Then driven in the running app with Playwright**, logged in as admin against Live (Tally) — and
that is what earned its keep, because the engine tests could not have caught any of this:

- **Cheque Returns were under-reported by ₹6.19 L.** The first cut counted only vouchers Tally
  named `CHQ.R`, so the column would agree with the Cheque Returns card on the customer page.
  Live, that silently dropped Oct-25 (3.50 L) and Feb-26 (2.69 L) — the exact two months the
  source PDF shows in this very column, and exactly the 6.19 L the report's own caveat had
  flagged as excluded. `collections.ts:isChequeReturn` already folds both for the same reason.
  Now folded, cross-checked against `checkReturns + paymentsOut`, and the split is stated. Oct-25
  and Feb-26 now read 3.50 and 2.69, tying to the PDF.
- **Historical Overdue is not populated in the mirror.** 13 of 17 past months read nil against a
  non-nil balance — Apr-25 shows nil where the PDF says 57.63 L. Printed plainly it reads as
  "nothing was late", the opposite of the truth. The report now detects the pattern and says so.
  See [[receivables-overdue-history-gap]]; a real fix belongs in the ConnectWave connector repo.
- Two cosmetic fixes: the partial row printed `Sep-26 (Sep 26) (Partial)`, saying the same thing
  three times; and a journal residual of a fraction of a paisa printed as `− ₹0.00 L`, inviting a
  hunt for an entry that is not there.

PDF and Excel both download and were opened and read back: the PDF is two pages of real vector
text, the workbook four sheets of real numbers with the caveats carried on the About sheet.

**Avg Collection Days now produces figures, and they are plausible but not the PDF's** — 121.2 /
140.0 / 121.4 / 125.7 against the PDF's 131.0 / 134.3 / 146.7 / 120.4, same 120-147 range, and
blank for Apr-25…Jul-25 where no receipt resolves to a dated bill. So the shape is right and the
basis differs. It sits behind a one-function seam (`CollectionDaysFn`); **worth asking finance
what basis they used** before assuming either is wrong.

**One thing to confirm, not a bug:** Credit Period reads 100 days live against the PDF's 60. That
is master data straight from Tally, so it has most likely been changed since July — worth a look.

**What the analysis found.** The source artefact
(`MISC/RAJLAXMI DIGITAL Final (1).pdf`) is a one-page debtor dashboard: two six-chip bands
(Account Status, Period Summary), a quarterly summary, a sixteen-month table, and an action note.
Held against the code, it is **mostly re-presentation, not new plumbing** —

- All twelve chips already exist on Customer Detail as `summaryItems`.
- The monthly table already exists too, with every column **except Avg Collection Days**. Four of
  its columns (Cr Notes, Dr Notes, Journal, Chq Returns) are merely *hidden* on Live by
  `LIVE_UNAVAILABLE_MONTHLY`, because the snapshot's `monthly` jsonb never carried them. But the
  page separately lazy-loads the customer's full dated voucher history, and already buckets
  exactly those four by month when a sale-type filter is on. So they are recoverable **exactly,
  with zero extra queries** — the bucketing simply needs to stop being conditional.
- Genuinely new: the **quarterly rollup**, and **Avg Collection Days**, which exists nowhere in
  the codebase.

Three measurements off the PDF that shaped the design:

- **Quarterly Avg Coll Days is not the mean of its months.** Q1 FY25 prints 131.0 d while its
  months read 121.1 / 140.2 / 124.0 (mean 128.4). Each bucket is computed independently over its
  own date range, so the metric takes a *date range*, not a list of month values.
- **The Period Summary chips are the monthly column sums**, so the band is derived from the table
  and the two cannot disagree.
- **The report foots**: `99.19 + 260.68 − 238.45 − 21.02 + 1.96 + 8.49 = 110.85` against a closing
  `111.00`. That identity ships as a reconciliation line — the cheapest possible guard against a
  silent unit or filter bug.

**Decisions taken:** Avg Coll Days = actual settlement lag, the amount-weighted mean of
(receipt date − bill date) over receipt allocations — chosen because Tally's receipt rows already
arrive split one per settled bill, carrying the allocation amount and a normalised bill ref, so
the figure is computable from data the page has already fetched. A new page at
`customer/:id/analysis` reached by a button beside Export, rather than an eleventh section on an
already 3,000-line page. The report follows the topbar FY selector, whose default is already
*Both FYs* — so it reproduces the PDF with no user action. Output is the screen plus a branded
vector PDF and an Excel workbook.

**One thing the audit caught that would have been a silent wrong number.** FY scoping is
**asymmetric** across the `Customer` object: under a narrowed financial year the monthly trend,
the voucher fetch and `sales`/`receipts` are all re-scoped, but `creditNotes`, `debitNotes`,
`checkReturns`, `journalDr`/`journalCr` and `openingBalance` are raw all-period snapshot columns.
So the cross-check against those fields may only run at *Both FYs*, and the opening balance has to
be derived by rolling the first month back through its own flows — otherwise the reconciliation
identity quietly breaks the moment anyone touches the FY selector.

---

### RW-1 · A branch of its own for the data analysis dashboard  `[x]`
*Raised and done **02-Sep-2026***

**Asked for:** start the data analysis dashboard work on a new branch of its own, and keep
this worklist alongside it.

**What there is now.** A branch **`data-analysis-dashboard`**, cut from `rites-outstanding`
at `fe38064` and checked out. `rites-outstanding` and `master` were level with each other at
that commit — no commits either way — so the branch starts from the same tree as `master` and
inherited nothing unmerged.

Two notes worth keeping:

- **The name is hyphenated, not spaced.** Asked for as *"the data analysis dashboard"*; git
  refuses spaces in a ref, so it is `data-analysis-dashboard` — the form the rest of the repo
  uses (`daily-reports`, `feature/receivables-hub-port`).
- **It is local only.** Nothing pushed to `origin`, so nothing is visible to anyone else and
  no Vercel build was triggered. Pushing is a separate call, to be made when there is
  something on the branch worth backing up.

The one uncommitted change in the tree (`.mcp.json`) came across with the checkout, as it
would with any branch switch, and is untouched. This file itself is new and uncommitted.
