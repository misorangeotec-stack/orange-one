# Budgeted Fund Flow — Reports → Finance

The monthly fund flow budget, kept in Hub instead of `0F_<MON> <YYYY> Cashflow.xlsx`. It has the same
lines, blocks and formulas as `Budgeted Fund Flow Summary.xlsx` (12 sheets). The team enters it, the
CFO approves it, a Director gives the final approval, and it is tracked to paid through the month.

- Route: `/reports/finance-fund-flow`, with catalogue id `finance-fund-flow`.
- Code:
  - page: `frontend/src/apps/receivables-hub/pages/FundFlowReport.tsx`
  - grid: `components/fundflow/FfGrid.tsx`
  - libraries: `lib/fundFlow*.ts`, `lib/exportFundFlow.ts`, `lib/collectionMonthTotals.ts`
- Database: `supabase/migrations/20270219120000_fund_flow.sql`, plus its rollback.

Agreed with the user (Ritesh) on 24-Oct-2026. Every rule below is enforced in the database; the page
only hides what a user cannot do.

---

## 1. People and rights

| Role (`profiles.fund_flow_role`) | Can do |
|---|---|
| `editor` (Dimple, Vishal, Samin) | Add, edit and delete lines while the month is open; change the collection %. After the plan is approved, every change waits for the CFO. Deleting an approved line is only a request. |
| `cfo` (admins count as CFO) | Everything an editor can, plus approve or un-approve lines, mark lines Not approved, approve the plan, enter the std rate (once), override the opening balance, open or close a month early, and reopen a closed month (a reason is required). |
| `director` | Reads everything. Gives the **final approval** after the CFO. Edits nothing. |
| viewer (report grant `finance-fund-flow`) | Reads only. |

`profiles.fund_flow_bank_alert = true` marks who also receives the bank-balance alerts (Dimple).

## 2. The month

- **Opens** 2 days before the previous month ends. For example, November opens on 29-Oct.
- **Closes** on the 2nd of the next month, or the 3rd if the 2nd is a Sunday. For example, Apr-27 closes on Mon 3-May.
- Opening and closing are done by the scheduler at 00:05 IST, even if nobody visits the page.
- **CFO rights:**
  - open the next month early, or close a month early;
  - reopen a closed month, with a reason (the Directors are told at once);
  - close a reopened month again.
- **Carry forward:** unpaid **Import Due, Advances and Customs Duty** lines carry to the next month at their balance.
  - A USD line carries in USD.
  - A carried line follows last month's line until last month closes, so a late payment there reduces it.
  - At close the carried lines are frozen.
  - If last month was already closed when the new month opened, they come in frozen and editable.
- Every other head is **copied** with the same lines and budgets. Approval and paid are cleared.
- **Std rate (INR per USD):**
  - It starts as last month's rate, marked *provisional*.
  - The CFO enters it once; after that it is **fixed for the month** and cannot change, even after a reopen.
  - The plan cannot be approved until the rate is fixed.

## 3. Lines, columns and formulas

- Each grid follows the Excel sheet's own column order.
- Type and Vendor are frozen on the left. On Advances it is Block and Party; on Customs Duty everything up to Item.
- Long text wraps.
- **Formula columns are tinted blue and are never editable.**
- Every column sorts and filters, as the Hub rule requires.
- **Formulas:**
  - INR = USD × std rate.
  - Approved = the CFO's figure. Before the plan is approved, it follows Budgeted.
  - Balance = Approved − Paid.
  - Achieved = Paid ÷ Approved.
  - Customs Duty has three modes: freight in base `(inv×rate + freight)×duty%`, freight added `inv×rate×duty% + freight`, or duty typed as an amount. It also takes an extra amount, a Not-this-month tick, and Paid in full.
- **Advances blocks:** MACH, INK, HEAD, PAPER and Parts.
- The Capex/Loan/INV tab is the template's Investment-Loan sheet.

## 4. Approval

| Code | Colour | Meaning |
|---|---|---|
| A | green | Approved |
| NA | red | Not approved: kept in the month, **counts 0**, never deleted |
| E | amber | Edited after approval, waiting for the CFO |
| AE | blue | Approved again after an edit, or added after the plan and approved |
| DEL | dark red | Removal asked, waiting for the CFO |

- The CFO clicks the code to approve, or types a different amount first. **×** marks a line Not approved.
- Clicking a green **A** takes the approval back (**un-approve**), which turns the line NA.
- **Approve plan** fixes the month's plan. It approves every undecided line as budgeted; lines marked NA stay NA, with a plan figure of 0. The Directors are then asked for the final approval.
- After the plan is approved:
  - a new line counts 0 until approved;
  - an edit leaves Approved where it was;
  - an editor's delete is a request.
  - **Changes after plan** reports what was added and removed against the plan.
- **Not approved** tab: every NA line, with an Approve button for the CFO. An unpaid NA import or duty line still carries to the next month at its budget.
- **Directors' final approval:** any one Director, after the CFO. Later changes still go to the CFO, and the Directors are told about them.
- **Changes** tab: every change, with **who made it (by name)**, when, before → after, and the reason.

## 5. Where the figures come from

- **Opening balance:** the Daily Report bank total for the last day of the previous month, or the CFO's override with a reason. An account that wasn't entered is named, never counted as 0.
- **Balance as on today:** the Daily Report bank balances. They are entered in **Daily Report → Bank balances** by Dimple or the CFO.
- **Customer Collections** use the **Customer Collection (Salesperson Collection Report)** figures only; nothing is typed.
  - **Target = 55% of Total Due.** The % can be changed by an editor or the CFO; it is logged, and the next month starts with the same %.
  - **Received** and **Due** are as the report has them.
  - The figures are saved automatically while the month is open. A closed month keeps the figures it closed with.
- **Total Collection:**
  - **Target** = Customer Collections target + **Machine Advances** projected + Refunds.
  - **Received** = Customer Collections received + Refunds. It does *not* add Machine Advances received, because those are already inside Customer Collections.
- **Other Vendor: Pull vendors due from Tally.** This reads the nightly payables snapshot from ConnectWave, across all 5 companies.
  - Left out entirely: our own **Orange O Tec / Enterprises, Colorix and branch / division accounts**.
  - Ticked by default: vendors with bills **more than 30 days past due**. Each becomes a line budgeted at that over-30-days amount.
  - Unticked by default: dues of 30 days or less, bills over 180 days, and suppliers already on Import, Advances or Duty.
  - **Refresh Tally due & paid** shows each pulled vendor's payments this month from Tally. **Use** copies the figure into Paid.

## 6. Management Summary

The table at the top, in the user's own layout:

| | Budgeted (approved) | Paid / Received | Balance | % |
|---|---|---|---|---|
| Opening Balance | opening | opening | opening | |
| Total Payment | approved | paid | balance | paid ÷ approved |
| Total Collection | target | received | balance | received ÷ target |
| **Closing Balance** | opening + collection − payment | the same on paid figures | opening + collection balance − payment balance | |
| Balance as on today | | Daily Report bank total | | |
| Difference | | paid-basis closing − bank (**red** if not 0) | | |

- The bank cell is **red** when it is zero or not entered, and names the missing accounts.
- Below the table:
  - top 10 unpaid lines;
  - lines paid over their approved amount;
  - carried part-paid lines;
  - changes after approval;
  - the plan bridge;
  - the head-by-head summary.
- **Excel download:** the 12 sheets with **live formulas**, the POSITION block, and Changes after Plan.
- **PDF:** a one-page summary that starts with the position table.

## 7. Reminders and alerts (Hub bell + email)

| When (IST) | What | To |
|---|---|---|
| 00:05 daily | Opens and closes months on their day | — |
| 09:30, opening day | "Mon-YY is open — please get Dimple, Vishal and Samin to update it; enter the rate" | CFO |
| 09:30, day before and day of closing | "Closes tomorrow / closes TODAY", with status | CFO |
| 09:30, after closing | "Closed", with the final position | CFO + Directors |
| 09:30, every **Saturday** (the working day before if Saturday is a holiday) | Weekly follow-up of the editors, with status; also "waiting for your final approval" | CFO; Directors if their approval is pending |
| 09:30 daily | **Bank check** on yesterday's Daily Report: zero, accounts not entered, or a difference from the paid-basis closing | CFO + Dimple |
| **10:30**, then **every 15 min** until 19:15, Mon–Sat, holidays skipped | **Daily Report bank balances not entered** for the last working day. A **pop-up** appears on opening the Hub until done. | Daily Report team (edit access) + CFO + Dimple; **from the 4th reminder also the Directors** (marked ESCALATED) |
| **16:00** and **19:00** | Change summary: who changed what, old → new. Changes after closing or after the Directors' approval are marked. | CFO; those marked changes also go to the Directors |
| At once | CFO approves the plan → Directors. Directors approve → CFO. Month reopened → CFO + Directors. | |

- Bell rows use `notifications.type = 'fund_flow'`, with their own `message` and `link`.
- Email uses `email_outbox` kind `fund_flow_notice`, and is sent only while the **fund-flow** email switch is on.
- There is a record of what has been sent (`fund_flow_notice_sent`), so a re-run never sends twice.

## 8. Saving

- Edits are a draft until **Save changes** is clicked.
- While anything is unsaved, a reminder bar stays at the bottom of the screen.
- Switching tab or month, clicking a Hub link, or closing the browser tab asks first: **Stay and save**, or **Discard and leave**.

## 9. Go-live (in this order)

1. Apply `supabase/migrations/20270219120000_fund_flow.sql` to the Hub DB (`icutjkrqkbzwvmnfbzpr`).
   - It is additive and ends with asserts.
   - It adds the label `fund_flow` to `notification_type`, and the nullable columns `message` and `link` to `notifications`.
   - It schedules 5 pg_cron jobs named `fund-flow-*`.
2. Merge the PR. Vercel deploys.
3. `supabase functions deploy send-email --project-ref icutjkrqkbzwvmnfbzpr` (adds the `fund_flow_notice` email).
4. Set the roles:
   - CFO → `cfo`;
   - Dimple, Vishal and Samin → `editor`;
   - Directors → `director`;
   - Dimple → `fund_flow_bank_alert = true`.
   - Grant report `finance-fund-flow` to viewers.
5. Turn on the email switch for module `fund-flow`.
6. The CFO imports the open month's Excel pack, or starts the month, enters the std rate, and checks the Collections tab.
7. Run the Excel and Hub side by side for one month, then retire the Excel.

## 10. Tested

- 139 SQL tests on a throwaway Postgres. They cover:
  - roles, window dates and Sunday closing, carry forward and close or reopen;
  - the rate lock;
  - plan approval, Not approved, un-approve, delete requests and Directors;
  - opening, closing and Saturday reminders, holiday preponing, change summaries, the bank check, and the 10:30 / 15-minute / escalation chase;
  - the collection % and the rollback.
- October tie-out against the Excel template, to the rupee.
- The exported workbook recalculated with the `formulas` engine, matching the page, including the POSITION block.
- `tsc` and `npm run build` are clean on the latest master. It was also run locally against a test database.

## 11. Later

- Matching Tally paid for lines that were not pulled from Tally: import advances by PI number, EMIs, salary.
- Moving the Collections save from the Collections tab to every page open.
