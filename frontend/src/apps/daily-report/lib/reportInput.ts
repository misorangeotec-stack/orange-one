/**
 * The Daily Report's input, assembled ONCE.
 *
 * ⚠ THIS FILE EXISTS BECAUSE THE SCREEN AND THE EVENING EMAIL MUST NOT BE ABLE
 *   TO DISAGREE, AND UNTIL DR-3 THEY COULD.
 *
 *   `DailyXlsxInput` used to be built inside `pages/DailyReport.tsx`: the
 *   location filtering, the bank columns, the seven-day window and the
 *   month-to-date figure were all derived in the component, from React memos,
 *   and handed to the two exporters. That was fine while a human pressed Export
 *   — the file and the page were built from the same memos in the same render.
 *
 *   The scheduled send has no component. A server job that re-derived any of it
 *   would be a SECOND definition of "what the Daily Report is for this day and
 *   this location", and two definitions of one rule drift: the mail would
 *   eventually quote a figure the screen does not show, with nobody able to say
 *   which was right. That is the exact failure the Collection report's design
 *   was arranged to avoid (see `supabase/collectionsreport/build.mjs`, which
 *   bundles the app's own TypeScript rather than re-implementing it).
 *
 *   So the derivation moved here, whole, and BOTH callers use it:
 *     · `pages/DailyReport.tsx` — renders from the same object it exports
 *     · `supabase/dailyreport/entry.ts` — the evening send
 *
 *   Nothing in this file may touch React, the DOM or a Supabase client. It is
 *   pure: sources in, one input object out. The server bundle's purity guard
 *   fails the build if that stops being true.
 */

import type { BankAccount } from "../types";
import type { DailyReportData } from "../data/dailyReport";
import type { BalanceMap } from "../data/bankBalances";
import type { CcLimitMap } from "../data/ccLimits";
import type { DailyXlsxInput } from "./exportDailyXlsx";
import { addDays, daysBetween } from "./format";
import { bankColumns, inLocation, type LocationFilter } from "./aggregate";

/**
 * How many days of balance history the bank grid shows.
 *
 * Lived in `DailyReport.tsx` until DR-3. It belongs beside the window it
 * defines: the report's `dates` array, the balance query's range and the grid's
 * "7 days to …" caption are one decision, and the server job needs it too.
 */
export const HISTORY_DAYS = 7;

/** The first day of the balance history window ending on `dateIso`. */
export const historyFrom = (dateIso: string): string => addDays(dateIso, -(HISTORY_DAYS - 1));

/** Everything the report is built from, before any scoping is applied. */
export interface DailyReportSources {
  date: string;
  loc: LocationFilter;
  /** What `loadDailyReport(date)` returned. */
  data: DailyReportData;
  /** Every configured bank account, unfiltered. `bankColumns` does the choosing. */
  accounts: BankAccount[];
  /** Sparse, covering at least `historyFrom(date) … date`. A missing day is NOT a zero. */
  balances: BalanceMap;
  /** Sparse, the day's credit-limit blocks. */
  ccLimits: CcLimitMap;
}

/**
 * One day of the business, scoped to one location, ready for the screen, the
 * workbook and the document.
 *
 * ⚠ `facilityAccounts` IS DELIBERATELY NOT SCOPED TO `loc`. A credit facility is
 *   sanctioned to a COMPANY, so its available balance is that company's whole
 *   cash position. Under a Surat filter, reusing the scoped `accounts` would
 *   print Orange O Tec's Surat cash as the company's available balance — a real
 *   figure, attributed to the wrong thing.
 */
export function buildDailyReportInput(s: DailyReportSources): DailyXlsxInput {
  const { date, loc, data, accounts, balances, ccLimits } = s;

  const dates = daysBetween(historyFrom(date), date);

  // ⚠ MONEY FOLLOWS THE LOCATION FILTER TOO, since 17-09-2026. Each row carries
  //   the location of its own book (see `toMoneyRows`), so a Surat filter shows
  //   Surat's receipts rather than all five books' under a Surat heading. Delhi
  //   has no book, so it empties by construction, exactly like sales.
  return {
    date,
    loc,
    sales: data.sales.filter((l) => inLocation(loc, l.location)),
    money: data.money.filter((m) => inLocation(loc, m.location)),
    purchases: data.purchases.filter((p) => inLocation(loc, p.location)),
    accounts: bankColumns(accounts, balances, dates, loc),
    balances,
    facilityAccounts: bankColumns(accounts, balances, [date], "all"),
    ccLimits,
    dates,
    mtdSalesLacs: data.mtd.salesLacs,
    rulesLoaded: data.rulesLoaded,
  };
}
