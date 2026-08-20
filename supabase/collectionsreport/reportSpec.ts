/**
 * The period and the settings a scheduled Collection report is built on.
 *
 * ⚠ THIS IS THE ONE PIECE OF THE PAGE THAT IS MIRRORED RATHER THAN SHARED, AND THAT IS ON PURPOSE.
 *   Everything else the mailed report needs — who is eligible, who is listed, the KPI numbers, the
 *   card wording, the filter record — was lifted OUT of `CollectionPerformanceReport.tsx` into
 *   `collectionScope.ts` / `collectionCards.ts`, so both sides call one implementation. The period
 *   could not follow it, because on the page the period is not a function: it is eight `useMemo`s
 *   woven through the date picker's own state (`preset`, `customFrom`, `customTo`), and the two
 *   modules that would have to be joined to unpick it are the pure rules module and the module
 *   that opens a network connection. Dragging the fetcher into the rules module to save twenty
 *   lines would cost more than it saved.
 *
 *   What makes the mirror safe is that it only ever walks the DEFAULT path — no picker, no custom
 *   range — and every primitive it uses is the page's own: `defaultPresetFor`, `DATE_RANGE_PRESETS`,
 *   `lastNDays`, `priorRange`, `resolveWindow`, `priorWindow`. It was checked against the screen on
 *   20-Aug-2026 and reproduced it figure for figure: 247 of 362 customers, ₹30.58 Cr outstanding,
 *   ₹17.53 Cr overdue, 34 blocked, 116 above target, ₹3.98 Cr collected.
 *
 *   If the page's default period ever changes, THIS FILE DOES NOT FOLLOW AUTOMATICALLY. That is
 *   the known cost. `defaultPresetFor` is shared, so the preset itself does travel; what would not
 *   travel is a change to how a preset becomes a date range.
 *
 * ⚠ AND THE PERIOD IS NEVER GUESSED. Guessing it is the one way to produce a report that looks
 *   entirely plausible and answers a different question — a 15-month window against a screen set
 *   to 15 days lists 359 customers where the screen lists 247, with no error anywhere.
 */

import { defaultPresetFor, defaultFilters, defaultTarget } from "@hub/lib/collectionScope";
import { fetchRangeFacts, lastNDays, priorRange } from "@hub/lib/collectionsRange";
import {
  DATE_RANGE_PRESETS, PERIOD_LABELS, defaultColumnsFor, defaultGroupByFor, priorWindow,
  resolveWindow,
} from "@hub/lib/collections";
import { monthStartISO, monthEndISO } from "@hub/lib/months";
import { formatDateDMY } from "@hub/lib/utils";
import type { CollectionsReportRequest } from "@hub/lib/collectionsReportBuild";
import type { RawCollectionsData } from "@hub/lib/collectionsAppData";

/** The report this job sends. One key, because one report is scheduled; widen when a second is. */
export const REPORT_KEY = "zero-collections";
const MODE = "zero" as const;

export interface ReportSpec {
  req: CollectionsReportRequest;
  /** Printed in the subject line, as dd-mm-yyyy. Never the raw ISO — see EmailReportDialog. */
  asOfLabel: string;
  /** For the log line: the actual dates the window resolved to. */
  fromIso: string | null;
  toIso: string | null;
}

/**
 * Read the book's own horizon, then build the request the screen would build with nothing touched.
 *
 * Asynchronous because the 15-day window is measured at DAY level, and day-level facts are a
 * second query — the same one the page fires when its preset is a date range rather than months.
 */
export async function buildReportSpec(raw: RawCollectionsData): Promise<ReportSpec> {
  const months = (raw.dash?.trend ?? []).map((t) => t.month);
  const asOfDate = raw.dash?.asOfDate ?? "";
  const horizonIso = months.length ? monthStartISO(months[0]) : "";
  const horizonEndIso = months.length ? monthEndISO(months[months.length - 1]) : "";

  const preset = defaultPresetFor(MODE);
  const days = DATE_RANGE_PRESETS[preset as keyof typeof DATE_RANGE_PRESETS];
  const dateRange = days && asOfDate ? lastNDays(asOfDate, days, horizonIso) : null;
  const prev = dateRange ? priorRange(dateRange.fromIso, dateRange.toIso, horizonIso) : null;

  const range = dateRange
    ? await fetchRangeFacts(dateRange.fromIso, dateRange.toIso, prev?.fromIso ?? null, horizonEndIso)
    : null;

  // `resolveWindow` on a date-range preset returns the months the range touches, which is what the
  // roll-up and the prior-period comparison are keyed on. The day-level facts above are what make
  // the counting exact inside those months.
  const windowMonths = resolveWindow(months, dateRange ? "custom" : preset) ?? months.slice(-1);

  const dmy = (iso: string) => formatDateDMY(iso);
  const periodLabel = dateRange
    ? `${PERIOD_LABELS[preset]} (${dmy(dateRange.fromIso)} – ${dmy(dateRange.toIso)})`
    : PERIOD_LABELS[preset];

  return {
    asOfLabel: formatDateDMY(asOfDate),
    fromIso: dateRange?.fromIso ?? null,
    toIso: dateRange?.toIso ?? null,
    req: {
      mode: MODE,
      threshold: 0,
      target: defaultTarget(0),
      filters: defaultFilters(),
      groupBy: defaultGroupByFor(MODE) as unknown as string[],
      columnKeys: defaultColumnsFor(MODE) as unknown as string[],
      windowMonths,
      prevMonths: priorWindow(months, windowMonths),
      usingDateRange: !!range,
      range: range as never,
      countJournalSettlements: true,
      periodLabel,
      viewLabel: "Salesperson → Customer Group",
      title: "Customers with Zero Collections",
      subtitle: "Customers who owe money and paid nothing in the period.",
      priorLabel: prev ? `${dmy(prev.fromIso)} – ${dmy(prev.toIso)}` : "",
    },
  };
}
