/**
 * What a scheduled Daily Report is built on.
 *
 * ⚠ SHORTER THAN THE COLLECTION REPORT'S EQUIVALENT, AND THAT IS THE INTERESTING PART.
 *   `supabase/collectionsreport/reportSpec.ts` has to MIRROR the screen's period, because on that
 *   page the period is eight `useMemo`s woven through a date picker's own state, and it says at
 *   length that the mirror is a known cost.
 *
 *   This file has almost nothing in it because DR-3 refused to repeat that. The one thing a
 *   scheduled Daily Report needs beyond a date is the input object, and that now comes from
 *   `lib/reportInput.ts` — the SAME function `pages/DailyReport.tsx` renders from. There is no
 *   second definition of the report to keep in step, so there is nothing here to go stale.
 *
 *   If you find yourself adding a rule to this file, that is the signal it belongs in
 *   `reportInput.ts` instead, where the screen will use it too.
 */

import type { LocationFilter } from "@/apps/daily-report/lib/aggregate";

/**
 * The report this job sends. One key, because one report is scheduled.
 *
 * Per-location copies, if they are ever wanted, are separate KEYS — 'daily-report:surat' — each
 * with its own row in `report_email_schedule` and its own distribution list, and each passing its
 * own `LOCATION` below. Nothing in the database needs changing for that; see the migration header.
 */
export const REPORT_KEY = "daily-report";

/**
 * All locations, decided on 28-09-2026: one report covering the whole business rather than
 * separate Surat and Noida copies as the old hand-made sheets were.
 *
 * ⚠ NOT COSMETIC. `loc` scopes the sales, the money, the purchases AND the bank columns
 *   (`buildDailyReportInput`), and `isBankOnlyLocation` blanks the business tiles for a location
 *   with no Tally book. A wrong value here produces a report that is internally consistent and
 *   describes a different business.
 */
export const LOCATION: LocationFilter = "all";

/**
 * The IST calendar day the report is FOR.
 *
 * ⚠ A RUNNER IS UTC, AND THE SLOT IS 20:30 IST. Using the runner's own date would be right by
 *   luck — 20:30 IST is 15:00 UTC, the same day — and wrong the moment the slot is moved past
 *   05:30 IST. The database labels the send log with the Asia/Kolkata date, so this computes the
 *   same thing the same way; if the two ever disagree, the dedup key stops meaning anything.
 */
export const istDate = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** The file a recipient sees attached. */
export const pdfFilename = (dateIso: string): string => {
  const [y, m, d] = dateIso.split("-");
  return `Daily_Report_${d}-${m}-${y}.pdf`;
};
