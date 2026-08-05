# AI-First Roadmap — Outstanding Dashboard (and beyond)

**Prepared:** 01-08-2026 · **Scope:** Receivables Hub (`outstanding-dashboard`) first, then the rest of the warehouse
**Status:** ideas + architecture. Nothing below is built yet except where marked *SHIPPED*.

---

## 0. What we are standing on

Every idea in this document is sized against data that already exists and refreshes on its own. Figures below
are live as of **01-08-2026**, read from the ConnectWave project (`ieeefdnyhzgrroifiqbb`).

### The book today

| Figure | Value |
|---|---|
| Total outstanding | **₹63.25 Cr** |
| Overdue (gross, bill-wise) | **₹47.19 Cr** |
| Overdue (net of On Account) | **₹35.35 Cr** |
| On Account (unapplied credit) | **₹11.84 Cr** |
| Customers >180 days | **172**, holding **₹24.69 Cr** — 52% of all gross overdue |
| Customers 121–180 days | 65 |
| Customers over credit limit | 46 |
| Customers with any overdue | 559 of 1,291 |
| Open bills | 5,631 |
| Ledger rows / distinct customers | 1,817 / 1,291 |
| Salespeople / companies | 12 / 5 |

### The raw material AI can work on

| Asset | Where | Depth |
|---|---|---|
| Per-customer monthly series — sales, receipts, outstanding, overdue, on-account, GST, each split by sale type | `collection_customer_snapshot.monthly` (jsonb) | **44 months**, all 1,817 rows |
| Bill-level open items — date, due date, overdue days, amount, pending, sale type | `collection_invoice_snapshot` | 5,631 rows |
| Voucher-level day book — party, voucher type, kind, amount | `rpt_day_book_voucher` | 17,318 vouchers FY26-27, 1,123 parties, 49 voucher types |
| Sales lines / items / gain | `rpt_sales_register`, `rpt_sales_item`, `rpt_sales_gain_item` | 18,406 / 62,796 / 67,501 rows |
| Payables | `rpt_payables_bill`, `rpt_payables_ledger` | 1,279 bills / 581 vendors |
| Income / expense | `rpt_income_line`, `rpt_expense_line` | 61,361 / 39,718 lines |
| Stock | `rpt_stock_analysis_item` | 17,361 items |
| Customer profile by year | `rpt_customer_profile_year` | 1,543 rows |
| **Follow-up log — free-text remarks, outcome, promise amount + date** | `receivables_followups` | **~empty. See §7.** |
| Masters — credit limit, credit period, category A–E, salesperson, Tally group, Red Mark | snapshot columns | live |

### Plumbing already proven

- **`analyze-receivables` Edge Function** — Top-50 Exposure → *Generate AI Insights*. Claude Sonnet, server-side,
  `verify_jwt=true`, strict-JSON out. *This is the template every AI feature below reuses.* **SHIPPED**
- **`email_outbox` + `send-email`** — durable outbox, insert-trigger for instant send, pg_cron drain every 3 min,
  Gmail OAuth from `support@orangeotec.com`, per-module ON/OFF via `email_module_settings`. **SHIPPED**
- **pg_cron backbone** — `collection_refresh_nightly` at **07:00 IST**, `collection_refresh_if_stale` every 30 min,
  all `rpt_*` refreshes **20:00–23:00 IST**. A daily brief at **08:00 IST** lands on fresh numbers.
- **Cross-project writes** — `followups-write` proves an identity-project function can write ConnectWave.
- **`transcribe-voice` Edge Function** — already exists. Unlocks §4.4 with almost no new work.
- **Per-salesperson scoping** — `profiles.receivables_salespersons` + `useAppData` chokepoint. Personalised
  emails need no new permission model.

---

## 1. The thesis: what the dashboard cannot do today

The Outstanding Dashboard is an excellent **numbers machine**. Twenty-plus reports answer *"what is the figure?"*
with Tally-true precision. Five things it structurally cannot do — and each is an AI capability class:

| # | Capability | The question it answers | Why code alone can't |
|---|---|---|---|
| 1 | **Narrate** | "What changed and does it matter?" | Requires judgement about salience — which of 1,291 customers is worth a sentence today |
| 2 | **Prioritise** | "Who do I call first, and what do I say?" | Multi-objective ranking (₹ × recoverability × relationship × effort), not a sort |
| 3 | **Predict** | "How much cash lands next month?" | Per-customer behaviour baselines over 44 months, not a global rule |
| 4 | **Detect** | "What's wrong that nobody asked about?" | Unknown-unknowns; a report only finds what it was written to find |
| 5 | **Converse & compose** | "Show me X" / "Draft the letter" | Free-text in, free-text out |

**The honest cut.** Not everything worth building is AI. Every idea below carries one of three stamps:

- **`AI-ONLY`** — impossible without a language model (free text, synthesis, judgement, generation)
- **`AI+STATS`** — a statistical core the model narrates and explains; the maths is conventional
- **`RULES`** — plain SQL. Listed because it *feeds* the AI layer. **Do not market these as AI.**

---

## 2. The flagship — Daily AI Morning Brief `AI-ONLY`

The thing asked for: an automatic daily email that makes a decision maker smarter before their first meeting.

### Shape

- **Fires 08:00 IST**, one hour after `collection_refresh_nightly`. pg_cron → Edge Function → `email_outbox`.
- **One generation per audience scope, not per recipient.** Three scopes:

| Audience | Sees | Roughly |
|---|---|---|
| **Board / MD / CFO** | the whole book, ₹ Cr, concentration, cash forecast | 1 email |
| **Sales head / HOD** | their team's book, salesperson league table | ~2–3 emails |
| **Salesperson** | their own accounts only, today's 10 calls | 12 emails |

  Scoping reuses `receivables_salespersons` — no new permission model.

### Sections

1. **Headline** — three sentences. Where the book stands, what moved overnight, the single thing to do today.
2. **Overnight movers** — biggest ↑/↓ per customer *with the cause attached*: new bill, receipt, credit note,
   cheque bounce (`CHQ.R`), journal. Today nobody sees the cause without opening four screens.
3. **Newly overdue** — bills that crossed their due date last night. ₹ and who.
4. **Bucket migration** — money that slipped 90→120, 120→180, **180+** overnight. *This is the silent killer:
   ₹24.69 Cr already sits past 180 days and no screen shows the moment it crosses.*
5. **Today's call list** — top 8 by **recoverable** risk (big + very overdue + over limit beats big-but-current),
   each with a one-line reason citing that account's own figures, and a suggested opening line.
6. **Promises due today** — from the follow-up log, with kept/broken history.
7. **Watch-outs** — the anomalies from §5 that cleared the noise floor.

### The non-negotiable engineering rule — the fact pack

> **SQL computes every number. The model writes only prose. A verifier then checks that every ₹ figure in the
> output appears in the fact pack — if any doesn't, the email falls back to a plain deterministic template.**

This is what makes a daily email to a director trustworthy. A model that does arithmetic on rupees will
eventually be wrong on a Tuesday and lose the audience permanently. `analyze-receivables` already follows the
first half of this rule; the verifier is the addition.

### Cost

A fact pack is 10–20 KB. ~16 generations/day on Sonnet ≈ **a few rupees a day**. Cost is not a constraint here;
trust is.

### Build notes

- Store each run in a new `ai_brief_runs` table (scope, date, fact pack, prose, model, verifier result).
  The in-app "Morning Brief" page then renders the *same* text the email carried — one source of truth,
  and a free audit trail.
- Gate behind `email_module_settings` module `outstanding-dashboard`, default OFF, plus per-user opt-in.
- Deliverability, footer, CTA deep-links: reuse `send-email` verbatim.

---

## 3. AI insights & reports

### 3.1 Movement Explainer — "why did the book move?" `AI+STATS`
Deterministic bridge (Opening → +Sales → −Receipts → ±CN/DN/Journals → −Bounces → Closing) for day / week / month,
then AI narrates **which customers and which sale types drove each leg**. The bridge is arithmetic; deciding that
three of 1,291 customers explain 80% of the move, and saying so in one paragraph, is not.

### 3.2 Collection Forecast — cash-in next 30 / 60 / 90 days `AI+STATS`
Per-bill probability of payment × expected date, learned from each customer's **own** 44-month history plus
bill-level days-to-pay plus outstanding promises. Output: a weekly cash-in curve with a confidence band, and a
narrated "what would have to go wrong" note. **Highest-value single item in this document for a CFO** — it turns
a receivables ledger into a treasury input.

### 3.3 Payment Behaviour DNA `AI-ONLY`
A plain-English profile at the top of every Customer Detail page:
> *"Pays 18 days past due on average, almost always in the last week of the month. Never part-pays. Bounced once
> in March both years. Responds to escalation, not to reminders. Slipping: 12 days late last year, 18 this year."*

Generated from the monthly series + bill history + follow-up notes. This is the single feature that will make the
sales team feel the dashboard understands their customers.

### 3.4 Dispute & Deduction Detector `AI-ONLY`
₹5.64 Cr of credit notes and ₹74.31 Cr of journals move each year carrying **narrations nobody reads**. Mine those
narrations plus follow-up remarks for *why* money isn't coming — quality complaint, rate difference, short supply,
GST mismatch, missing PO, freight — cluster them, and rank the clusters by ₹. Impossible without language
understanding; genuinely valuable because a dispute is recoverable revenue that no aging report can see.

### 3.5 Silent Deterioration Report `AI+STATS`
Customers whose **behaviour** worsened before the numbers did: DSO creeping, part-payments replacing full payments,
receipt gaps lengthening, order size shrinking, sale-type mix moving from machine to consumables. Fires 60–90 days
before a customer reaches "critical" under today's rules.

### 3.6 Credit Limit Review Board `AI+STATS`
`proposed_ai` already exists — but it is a **deterministic formula**, not a model (worth renaming honestly).
The AI layer on top: per customer, argue **Increase / Hold / Reduce / Freeze** with the evidence, ranked by ₹ at
stake. Ships as a monthly review pack. 46 customers are over limit right now.

### 3.7 Concentration & Contagion `AI-ONLY`
Group-level exposure using the existing muster, **plus** AI reading whether several ledgers share a real-world
parent the muster missed — name similarity, shared location, GSTIN prefix, correlated payment timing. Fuzzy entity
resolution over 1,291 names is exactly what a model is for; a `LIKE` query is not.

### 3.8 Recovery Playbook `AI-ONLY`
For the ₹24.69 Cr stuck past 180 days: what actually worked on comparable accounts historically (mined from
follow-up outcomes), a recommended next action, an escalation ladder, and a suggested settlement / legal threshold
per account. *Depends on §7 — the follow-up log must have history first.*

### 3.9 True Customer Value `AI+STATS`
`rpt_sales_gain_item` carries margin. Combine it with credit consumed:
> **value = gross margin − (outstanding × days outstanding × cost of capital)**

A customer at 22% margin who takes 180 days can be worth **less** than one at 15% who pays in 30. Nobody computes
this today. The formula is simple; the ranked narrative naming the customers we should be *less* eager to serve is
the AI part — and it is a genuinely uncomfortable, genuinely useful report.

---

## 4. Conversational & generative

### 4.1 Ask the Book `AI-ONLY`
Natural-language Q&A over receivables. *"Surat customers over 90 days who bought machines last year but nothing
this year."* No report needed, no ticket raised.

**Guardrails, all mandatory:** whitelisted read-only views only · caller's salesperson scope injected into every
query · hard row limit · the generated SQL always shown · every answer exportable to Excel · read-only DB role.

This is the feature that makes the whole product *feel* AI-first, and it retires the long tail of one-off report
requests.

### 4.2 Draft the chase `AI-ONLY`
One click from Customer Detail: a dunning email or WhatsApp message pitched at the right stage
(reminder → firm → final notice → pre-legal), in the customer's language (English / Hindi / Gujarati), with the
open bill list rendered in. **Human approves before anything sends** — never auto-send to a customer.

### 4.3 Meeting-ready pack `AI-ONLY`
*"Generate the monthly collection review for Salesperson X"* → narrative + the three charts + the ten accounts to
discuss + last month's promises vs. what landed.

### 4.4 Voice → structured follow-up `AI-ONLY` **← build early**
Salesperson dictates: *"Spoke to Rakesh, he'll pay 5 lakh on the 12th, disputes 40 thousand on freight."*
AI fills the form: remark, `outcome=promised_payment`, `promised_amount=500000`, `promised_date=2026-08-12`,
and raises a dispute flag.

The `transcribe-voice` Edge Function **already exists**. This is small — and it is the unlock for everything in
§3.3, §3.4, §3.8 and §5.2, because the reason the follow-up log is empty is that typing a form is work and talking
is not.

### 4.5 Inbound reply ingestion `AI-ONLY`
Customer replies *"payment released 12th, UTR xxxx"* → auto-creates a promise, then matches the UTR to the receipt
when it lands and closes the loop. Later phase; needs a monitored mailbox.

---

## 5. AI alerts

Today's five alert types (`critical_customer`, `overdue_180`, `credit_breach`, `rising_trend`, `unapplied_receipt`)
are static global rules. AI-first alerting differs in three ways: **personal baselines** instead of global
thresholds, **ranking and routing** instead of firing everything, and **digest-first** delivery.

| # | Alert | Stamp | Why it beats a rule |
|---|---|---|---|
| 5.1 | **Break of pattern** — "they always pay by the 5th; it's the 9th" | `AI+STATS` | Fires ~3 weeks before a 90-day global rule would |
| 5.2 | **Promise broken** — auto-escalates to HOD after N misses | `RULES` | Needs §4.4 first |
| 5.3 | **Bounce cascade** — a `CHQ.R` plus another in the same group/region | `AI+STATS` | Group inference, not a single-row trigger |
| 5.4 | **Exposure sprint** — exposure up >X% in a week *while* overdue also grew | `RULES` | We're shipping into a hole; caught in-week, not at month-end |
| 5.5 | **Silent big account** — top-50 exposure, no follow-up logged in 30 days | `RULES` | Coverage gap, invisible today |
| 5.6 | **New bill to a bad account** — sale booked to a customer >120 days / over limit / Red Mark | `RULES` | Caught the morning after the invoice |
| 5.7 | **On-account pile-up** — unapplied cash exceeds a bill it could clear | `RULES` | ₹11.84 Cr sits on account. Free collections, zero phone calls |
| 5.8 | **AI triage layer** over all of the above | `AI-ONLY` | Ranks by ₹-at-risk × recoverability, routes to the right person, **dedupes "same story, one alert"**, writes the one-line why |

**Delivery discipline.** One digest per person per day, not per-event mail. Every alert carries a
*"why am I getting this"* line and a one-click **mute / snooze / not useful**. Email fatigue kills alerting faster
than bad alerts do.

---

## 6. Beyond receivables

The same five capability classes applied to warehouse data that is already loading nightly.

### 6.1 Payables mirror + 13-week cash flow `AI+STATS` **← biggest CFO win**
1,279 open payables bills across 581 vendors. A daily *"what to pay"* brief: due, discountable, stretchable.
Then pair AR forecast (§3.2) with AP due dates into a **rolling 13-week cash view that is derived, not guessed**.
Receivables and payables are already in the same database; nothing joins them today.

### 6.2 Sales intelligence `AI+STATS`
- **Reorder prediction** — ink and consumables have a natural cycle. Predict who is due and tell the salesperson
  *before* they buy elsewhere. High value in a razor-and-blades business.
- **Churn radar** — `rpt_customer_profile_year` already classifies new / returning / gone quiet. Add the ₹ at risk
  and the narrated reason.
- **Cross-sell** — machine owners who never bought heads or spares.
- **Price & margin erosion** — same item, same customer, falling realisation over time.

### 6.3 Margin narration `AI+STATS`
67,501 gain rows exist and are barely read. Which customers, items and salespeople are eroding gross margin, and
whether it's discounting, mix, freight or credit notes.

### 6.4 Inventory `AI+STATS`
17,361 stock items. Dead and slow stock with ₹ attached, reorder points, shelf-life risk on ink, and — now that
Order-to-Dispatch exists — **stock against committed orders**.

### 6.5 Expense anomaly `AI+STATS`
39,718 expense lines, 268 groups. *"Freight is 40% above the 12-month norm; six vouchers drive it."*
Classic anomaly detection, and the narration is what makes anyone act on it.

### 6.6 Compliance as a credit signal `AI-ONLY`
The GSTIN lookup integration already exists. A customer who **stops filing GSTR** is a red flag *before* they stop
paying. Fold filing status into the risk score — a credit signal no aging report can ever contain.

### 6.7 Cross-FMS operational AI `AI+STATS`
Ten FMS apps now generate step-level history:
- **SLA breach prediction** — which requests will miss step due dates, from how similar requests actually flowed
- **Bottleneck narration** across the flow rail
- **Vendor scorecard** — on-time %, price drift, QC rejection rate, AI-ranked
- **Order-to-Dispatch** — predict late shipments and auto-draft the customer update

### 6.8 The Company Brief `AI-ONLY`
The end state. One daily/weekly email to the MD spanning cash, collections, sales vs. target, margin, big orders,
production and exceptions. **The receivables brief in §2 is version one of this** — build it so the fact-pack
pattern generalises.

---

## 7. Honest caveats — read before committing

1. **The follow-up log is effectively empty (~1 row).** Every idea that mines conversation history — promise-kept
   rate (§5.2), dispute mining (§3.4), recovery playbooks (§3.8), behaviour DNA's qualitative half (§3.3) —
   needs 2–3 months of real logging first. **This makes §4.4 voice capture a prerequisite, not a nice-to-have.**
2. **`proposed_ai` is not AI.** It is a documented deterministic formula with a reason breakdown. Fine as a
   heuristic; it should not be described as a model, and a real model needs labelled outcomes we don't have yet.
3. **44 months is enough for seasonality and per-customer baselines. It is not enough for a deep credit model.**
   Ceiling is gradient-boosted scoring; anything more is theatre.
4. **Roughly a third of the ideas here are SQL, not AI** — marked `RULES`. Build them (they feed the brief), but
   don't sell them as AI. The credibility of the AI features depends on that line being drawn honestly.
5. **Never let the model do arithmetic on rupees.** Fact pack + verifier, every time. See §2.
6. **Never auto-send anything to a customer.** Draft, human approves, then send.
7. **Security, pre-existing and now doubly relevant.** 49 tables in the ConnectWave project have **RLS disabled**
   and the anon key ships in the browser bundle — the entire financial warehouse is readable, and writable, by
   anyone who opens devtools. The tracked `receivables-serverside-isolation-todo` should be closed **before**
   AI surfaces widen who touches this data. *This is not caused by anything in this document; it is a live issue.*

---

## 8. Architecture

```
pg_cron (identity project, 08:00 IST)
   └─▶ Edge Function  receivables-brief
          ├─ read  ConnectWave anon client   → collection_* + rpt_*   (numbers)
          ├─ read  receivables_followups     → promises, remarks
          ├─ build FACT PACK in SQL          → every ₹ pre-computed
          ├─ call  Claude (Sonnet 5)         → prose only, strict JSON
          ├─ VERIFY every ₹ appears in pack  → else deterministic fallback
          ├─ write ai_brief_runs             → audit + the in-app page
          └─ insert email_outbox × recipients
                 └─▶ send-email (existing trigger + 3-min cron drain) ─▶ Gmail
```

**Placement.** Identity project (`coshondiqdhorwvibrwu`) owns the function — that is where `ANTHROPIC_API_KEY`,
`email_outbox` and `send-email` already live. It reads ConnectWave over the anon client, exactly as
`followups-write` already writes it.

**Models.** Sonnet 5 for narrative and judgement (already the `analyze-receivables` default) · Haiku 4.5 for
high-volume classification such as mining thousands of narrations · Opus only for the monthly deep review.

**Evaluation — do not skip.** A thumbs up/down on every AI output, plus a weekly automated check of *"did the call
list actually get collected?"*. Without a feedback signal, trust in AI output decays quietly and the feature dies
of neglect rather than of failure.

---

## 9. Suggested sequence

| Phase | Ships | Why here |
|---|---|---|
| **0 — Foundations** | Fact-pack SQL · `ai_brief_runs` · verifier · module gate | Everything else depends on it |
| **1 — Flagship** | **Daily AI Morning Brief**, 3 audiences (§2) | The stated ask; proves the pattern |
| **2 — Data flywheel** | **Voice follow-ups (§4.4)** · Ask the Book (§4.1) · Draft the chase (§4.2) | §4.4 starts the log filling from day one |
| **3 — Prediction** | Collection Forecast (§3.2) · Behaviour DNA (§3.3) · Break-of-pattern alerts (§5.1) | Needs phase 1's fact packs |
| **4 — Judgement** | Dispute mining (§3.4) · Credit Review Board (§3.6) · Recovery Playbooks (§3.8) · True Customer Value (§3.9) | Needs 2–3 months of §4.4 data |
| **5 — Enterprise** | Payables + 13-week cash (§6.1) · Sales & margin (§6.2–6.3) · **Company Brief (§6.8)** | Generalises the receivables pattern |

**If only one thing gets built:** §2, the Daily AI Morning Brief.
**If only two:** add §4.4, voice follow-ups — it is the fuel for phases 3 and 4, and it is cheap.
