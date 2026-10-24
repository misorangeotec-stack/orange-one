# Plan (audit v4): CFO Expense Report in Orange Hub, zero-error, tied to Tally TB, with graphs

## Context
Today the CFO expense analysis is `PL and BS\Files\EXPENSES REFERESH\Expense Sheet 2026-10-10 12-40-56.xlsx`.
- Covers Apr–Sep 26, all 5 companies.
- 10,004 lines, ₹24,73,98,896.
- Built by the `refresh-expenses` skill straight from Tally.

**The user wants it as a page in Orange Hub, run locally at localhost:5173.** The report must:
- use the same format;
- cover FY 26-27 with a month picker;
- match the Trial Balance with **no error accepted**;
- show MoM variance and its nature;
- have one analytics page;
- include **graphs on screen and in the PDF**;
- download as a **linked PDF** plus Excel. The Excel holds tables only, with no charts (user's choice).

The user has asked me to **run the SQL myself**.

**Hub:** `00 Claude Project\Orange Hub - Yash Agarwal\Orange Hub\` (written `<HUB>` below).
- Stack: React, Vite and TypeScript, with `jspdf`, `xlsx-js-style` and `recharts`.
- New branch `RT-Expense-CFO`, cut from `RT-Inventory`. The user's `.mcp.json` is not touched.

## Credentials: what exists (checked 23-Oct, values never printed)
| Database | What we hold | Can I run SQL there? |
|---|---|---|
| Hub's own database `icutjkrqkbzwvmnfbzpr` (login and app data) | **DB password**: `PL and BS\.env` `SUPABASE_DB_URL` (session pooler) | **Yes.** New tables and functions go here. |
| ConnectWave Tally mirror `ieeefdnyhzgrroifiqbb` | Read-only anon key (`PL and BS\Supabase\.env`); the connector's **service key** (`connectwave-deploy-1\connectwave-deploy\.env`) | **No DB password exists.** A service key can read every table but cannot create tables or functions. |

**Design that follows from this:**
- ConnectWave stays untouched.
- I create the report tables in the **hub database** and fill them with a local loader script.
- **Party name and narration** live in `tally_voucher_line`, which is blocked to the anon key. Reading them needs the connector's service key.
- **Your explicit OK is needed to use that key, read-only.** The system blocked my first test read, correctly, because the key belongs to the connector.
- Without it, everything works except vendor-wise sheets and REMARKS.

## Audit evidence: live tests on 23-Oct (Supabase lines against Tally's own TB, both cut 1-Apr to 23-Oct)
| Company | Direct gap | Indirect gap | Verdict |
|---|---|---|---|
| Ent-Surat | 0.00 | 0.00 | Ties to the paisa |
| Ent-Noida | 0.00 | 0.00 | Ties to the paisa |
| Colorix | 0.00 | **1,35,003.53** | Mirror missing data (A1) |
| Otec-Noida | 11,200.00 | 4,48,522.00 | Not proven, likely timing (A3) |
| Otec-Surat | 17,430.25 | 23,07,834.95 | Not proven, likely timing (A3) |

Against the 10-Oct Excel for Apr–Sep: 426 GLs compared, 124 differ, ₹1.14 cr gross, ₹30 lakh net.

**Findings. Each one is handled in the build.**
- **A1. Colorix:** TB sub-group *Other Expenses* = ₹1,35,003.53. Its two ledgers (FREIGHT CHARGE-12%, COMMISSION & BROKERAGE ACCOUNTS) show nil in the mirror, but the 10-Oct Tally Excel has them. This is a ConnectWave sync defect. Report it to the ConnectWave owner, with evidence. It must be fixed before go-live.
- **A2. Future-dated vouchers:** Nov-26 to Mar-27, ₹26.2 lakh in Otec-Surat (109 journals). Always cut at the "to" date.
- **A3. Timing:** the old lines are built nightly, while the TB is captured hourly. The loader reads the TB **in the same run** and records both timestamps. If there is a gap and the TB is older than the latest voucher, it re-reads before failing.
- **A4. Ledger renames since 10-Oct:** for example "TRAVELLING EXP-5%" became "TRAVELLING EXP - 5%". Match by **ledger ID**.
- **A5. The old Excel drops Sales-voucher lines:** for example Exchange Rate Diff (Sales) at −₹11.29 lakh. The new report includes everything, so it equals the TB, and shows the old exclusions as a bridge.
- **A6.** Filter out Purchase Accounts (₹12.2 cr in Colorix alone).
- **A7.** The Surat book spans 2 years: clamp to 1-Apr-26.
- **A8. 1,000-row API cap:** page every read and check against `count=exact`.
- **A9. Negative months** (Ent-Surat Jun −₹1.38 cr): variance % shows "n/m" when the base month is ≤ 0.

## Step 0: Data proof (gate)
1. Send the A1 evidence to the ConnectWave owner and get a re-sync.
2. Same-moment three-way tie for every company × GL × month, Apr–Sep:
   - **Tally direct** (`refresh-expenses` plus the `fetch-pandl` monthly GL CSVs);
   - the loader's lines;
   - Tally TB.

   Every difference is classified: Sales voucher, future-dated, rename, or **unexplained**. **The pass mark is zero unexplained.**
3. Evidence goes to `Files\EXPENSES REFERESH\Hub_vs_Tally_Audit_<ts>.xlsx`.

## Step 1: SQL, run by me on the hub database (`SUPABASE_DB_URL`, via `psql` or Python `psycopg`)
**File:** `<HUB>\supabase\migrations\<ts>_expense_cfo.sql`. It is committed to the repo too, so it is traceable.

**Tables:**
- `expense_cfo_line`: tenant, company, date, voucher type, voucher number, expense ledger ID and name, top group, group chain, amount, party name, party source, narration, `is_sales_vch`, `load_id`.
- `expense_cfo_tb`: tenant, group or sub-group or ledger, TB closing, `captured_at`, `load_id`.
- `expense_cfo_load`: `load_id`, started, finished, row counts per company, gap per company, status.

**Access:**
- RLS on, with read access for logged-in hub users who have report access, following the hub's existing pattern.
- Writes by the loader only.

**Rules:**
- Additive only. Nothing existing is altered or dropped.
- Run it in a transaction, with a rollback script beside it.

## Step 2: Loader (local, on this computer)
**File:** `<HUB>\tools\expense_cfo_loader.py`.
- Reads ConnectWave: lines, group chain, TB, ledger detail.
- Applies A2, A4, A6, A7 and A8, plus the party and sign rules from `refresh-expenses\scripts\fetch_tally_expenses.py:473-531` and line 1045.
- Writes one `load_id` atomically.
- Computes the group, sub-group and ledger tie (A3) and stores the status.
- **Runs:** on demand with `python tools\expense_cfo_loader.py`, and nightly through Windows Task Scheduler. The page shows when the last load ran.

## Step 3: Hub page "Expense Analysis (CFO)"
**New files** under `frontend\src\apps\receivables-hub\`:
- `lib\expenseCfo.ts`: reads the latest good load.
- `lib\expenseCfoRules.ts` ports from `build_analysis_sheets.py` and `remark_logic.py`:
  - AUDIT FLAG (890–946)
  - Must Review (183–201)
  - Pareto (217–284)
  - REMARKS
- `lib\expenseCfoVariance.ts`
- `pages\ExpenseCfoReport.tsx`

**Tabs:**
1. Analytics
2. Index
3. Summary
4. COMPANY WISE
5. Direct
6. Direct by Component
7. Indirect Exp
8. One tab per indirect main group
9. MoM Variance
10. TB Reconciliation
11. RAW DATA

**Wiring:**
- Route at `ReceivablesHubApp.tsx:199`.
- Menu entry in `lib\reportCatalog.ts:353`.
- Frame from `components\TallyReportFrame.tsx`.

## Step 4: TB control (hard gate)
Group, sub-group and ledger level, for each company.
- **Tolerance: ₹0.99.**
- **Nil:** a green banner "Tied to Tally TB as at <time>".
- **Any gap:** a red banner listing each GL, and every PDF and Excel page stamped **DRAFT – NOT TIED TO TB**.
- **Bridge:** report total → Sales-voucher lines → the old Excel's basis.

## Step 5: MoM variance with nature
For each month against the previous month, for main group and GL, the tab shows:
- Prev month and This month
- Change ₹ and Change %
- Increase or Decrease
- **Nature**
- **Drivers:** top 3 vendors or vouchers, with narration

**Nature, decided in this order:**
1. New cost
2. Stopped
3. One-off voucher (one voucher is 50% or more of the change)
4. New vendor (not seen in the previous 3 months)
5. Reversal or credit
6. Provision or journal entry
7. Quarterly or annual bill
8. Volume change

**Materiality:** ≥ ₹50,000 or ≥ 20%, both editable on screen. The tab also shows Q2 against Q1 and year to date.

**Control:** the sum of Change ₹ equals the change in the month totals, exactly.

## Step 6: Graphs, on screen and in the PDF
On screen they use `recharts`. In the PDF they are the same charts, captured as images with `html2canvas`, which is already installed.

| Where | Graphs |
|---|---|
| Analytics page | Monthly trend (Direct and Indirect stacked); company split; top 10 main groups; top 5 increases and top 5 decreases; vendor Pareto curve; KPI cards (total, MoM %, expense % of sales, HIGH count, TB status); 5 auto CFO notes |
| Summary and COMPANY WISE | Small monthly trend line per company |
| MoM Variance | Waterfall from last month's total to this month's, by main group |
| Each indirect main-group tab | Monthly bars plus a top-5 vendor bar |
| TB Reconciliation | Bar chart of report against TB per company (all zero gap once tied) |

## Step 7: Download (linked PDF plus Excel, same file stem)
**PDF** (`lib\exportExpenseCfoPdf.ts`, using `jspdf`):
- Follows `src\apps\daily-report\lib\exportDailyPdf.ts`, in landscape A4.
- Contents page with **clickable links** to every section, plus PDF bookmarks.
- "Back to contents" on every page.
- Footer on every page: TB status and data timestamp.
- Graphs placed in each section.
- RAW DATA is in the Excel only.

**Excel** (`lib\exportExpenseCfo.ts`):
- Tables only.
- The same sheets, colours and Index links as today, plus MoM Variance and TB Reconciliation.
- The Index names the matching PDF.

## Verification (all must pass; any failure means not done)
1. The SQL runs cleanly. Tables, RLS and grants are checked from SQL, and the rollback is tested on a scratch schema first.
2. Loader row counts equal `count=exact` for each company.
3. `npm run build` passes, and `npm run dev` loads all 5 companies.
4. The TB Reconciliation is **nil** at group, sub-group and ledger level for all 5 companies, including Colorix after the A1 fix.
5. A re-run of the Step 0 three-way tie against the hub's own export has zero unexplained differences at company × GL × month level.
6. Variance ties to the month totals, and 5 rows are spot-checked against vouchers.
7. Graph totals equal the table totals. Every PDF link and bookmark lands correctly. PDF, Excel and screen totals are identical.
8. Excel opens without repair, and the Index links work.

## Out of scope
- The ConnectWave database itself (no DDL there).
- The existing Expense page.
- No commit or Vercel deploy without the user's approval.

## Revisions requested by the user after the first review (23-Oct-2026) - DONE
1. **Filters on every page** - one filter bar above every sheet: month from/to, company, Direct/Indirect/Other, main group, ledger, party, search (voucher no / narration). Downloads follow the same filters and print them in the header.
2. **Quarter columns first** - tables open on Q1/Q2/Q3 + Grand Total; clicking a quarter header opens its months.
3. **Rows as collapsible groups** - e.g. Company > Direct/Indirect > main group > ledger; everything starts closed; Open all / Close all.
4. **Drill to transactions** - any row's list icon (or a click on a bottom-level row) drops down the voucher lines behind it (same lines as RAW DATA; first 300 shown). MoM Variance rows drop down both months' vouchers.
5. **Download asks first** - units (Rs Crore / Rs Lakh / full rupees; default Lakh, so figures fit), columns (quarters only / quarters with months), rows (grouped / full detail). Excel rows are a real outline (summary above, + to open); PDF "grouped" prints group levels only. TB Reconciliation and RAW DATA always stay in full rupees.
6. **Inventory valuation and exchange-rate gain/loss are NOT direct cost** - main groups INVENTORY VALUTION and EXCHANGE RATE Gain/(Loss) move to a third type OTHER, sheet "Other (Valuation & Exchange)" (named so as not to clash with Colorix's real Tally group "OTHER EXPENSES"). They stay in every total; the TB tie keeps Tally's own grouping.
7. **Analytics** - Vendor Pareto chart removed; Top 10 main groups, Top movers and the CFO-note movers exclude valuation and exchange; new graphs "Direct expenses - by main group" and "Indirect expenses - by main group"; trend shows Direct / Indirect / Other.
8. **Sheet list order** - HIGH first, then MEDIUM, then LOW (order kept within each band), on screen, in the PDF contents and in the Excel.

## Board-readiness re-audit (23-Oct-2026, evening) - DONE
- Review rules: "Sharp rise" flag (last complete quarter >= 2x previous and >= Rs 25 L higher -> HIGH; Advertising Q2 72.76 L vs Q1 10.64 L); Other never takes a Top-5 place; concentration vs gross spend, "one party", only groups >= Rs 10 L (23 flags -> 10).
- Part month: report opens on complete months only; the load's own month is labelled "part month" on screen, PDF and Excel.
- Every TB gap traced to ConnectWave missing vouchers (Otec-Noida: Employee Incentives 4,48,522, HE/26-27/007, HE/26-27/0021; Otec-Surat: BOM042868, DEL048501, IMP0024758-26-27, Discount Rs 1.08). PR #128 asks for a full reload of both Otec books.

## Rename and new home (24-Oct-2026) - DONE
- The report is called **CFO EXP** (menu, page heading, PDF, Excel; downloads named `CFO_EXP_...`). It sits under **Reports > Finance**, next to the CFO Pack.
- `master` moved every report route into the new Reports app, so the route now lives in `frontend/src/apps/reports/ReportsApp.tsx` (`finance-expense-cfo`), not in `ReceivablesHubApp.tsx`. Local URL: `http://localhost:5173/reports/finance-expense-cfo`.
- This plan is kept in the repo at `docs/expense-cfo/PLAN.md`.

## Still open before the CFO / Board presentation
- ConnectWave full reload of **Otec-Noida** (Employee Incentives Rs 4,48,522; HE/26-27/007 Rs 6,000; HE/26-27/0021 Rs 5,200) and **Otec-Surat** (BOM042868, DEL048501, IMP0024758-26-27). Until then the TB banner is red and downloads are stamped DRAFT.
- Review and merge PR #128.
