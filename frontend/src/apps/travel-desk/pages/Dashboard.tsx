import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { todayLocalIso, bucketOf } from "@/shared/lib/dueBuckets";
import { useTravelStore } from "../store";
import { upcomingTrips } from "../lib/queues";
import { tripsWithOutstandingAdvance, stillOwed } from "../lib/advance";
import { stepByKey } from "../lib/steps";
import { STATUS_LABEL, money } from "../lib/format";

/**
 * The Travel Desk home.
 *
 * Deliberately NOT a copy of the Control Center. That board answers "what does
 * the business owe, and where is it stuck"; this answers "what should I do
 * next", so it leads with the two things a person actually acts on — work that
 * is late, and travel that is about to happen — and keeps the totals small.
 *
 * ⚠ NO THROUGHPUT CHART. At the volume this module will see, a trend line over
 *   a handful of trips a week is noise dressed as insight. It earns its place
 *   when there is a year of data to draw, not before.
 */
export default function Dashboard() {
  const s = useTravelStore();
  const today = todayLocalIso();

  const late = useMemo(
    () => s.entries.filter((e) => bucketOf(e.dueIso, today) === "delayed"),
    [s.entries, today],
  );

  const dueToday = useMemo(
    () => s.entries.filter((e) => bucketOf(e.dueIso, today) === "today"),
    [s.entries, today],
  );

  const upcoming = useMemo(() => upcomingTrips(s.trips, today), [s.trips, today]);

  const mine = useMemo(
    () => s.trips.filter((t) => t.travellerId === s.userId || t.raisedBy === s.userId),
    [s.trips, s.userId],
  );

  /**
   * Advances drawn and not yet settled — the figure Policy §11.2 hangs its
   * hardest rule on ("no second travel advance to an employee who has an
   * outstanding unreconciled advance").
   *
   * Shown on the home screen rather than buried in a report because it is the
   * one number that stops somebody being refused at the counter without warning.
   *
   * ⚠ IT READS `lib/advance.ts`, WHICH IS THE MODULE'S ONE ANSWER. This tile
   *   used to compute its own — gross paid, filtered on status — and so
   *   disagreed with the Outstanding Advances report in two ways: it ignored
   *   `advanceRecoveredAmount` (a cancelled trip whose money came back in cash
   *   still counted), and it keyed on the STATUS rather than on whether the trip
   *   had actually been SETTLED. Two answers to "who owes what" on one screen is
   *   how the rule stops being trusted.
   */
  const outstandingAdvance = useMemo(
    () => tripsWithOutstandingAdvance(s.trips).reduce((sum, t) => sum + stillOwed(t), 0),
    [s.trips],
  );

  /**
   * Open, owed by somebody, and with no due date at all.
   *
   * ⚠ THIS IS THE ONE BUCKET NOTHING ELSE CHASES. A row with no due date is
   *   never late, so it never turns red and never reaches the "past its due
   *   date" list — it simply sits. Usually it is waiting on an event that has
   *   not happened (a trip whose return date is still ahead), which is fine; but
   *   a trip that has lost its anchor stays here for ever and is invisible
   *   everywhere else.
   */
  const stalled = useMemo(() => s.entries.filter((e) => !e.dueIso), [s.entries]);

  /**
   * What travel cost this calendar month.
   *
   * ⚠ WHAT THE COMPANY PARTED WITH, NOT WHAT WAS CLAIMED — bookings the desk
   *   paid for, plus allowed claim lines, plus the allowance. Reporting the
   *   claim alone would omit the flights and hotels, which are the biggest line
   *   on most trips and the one the traveller never sees.
   *
   * ⚠ DATED ON DEPARTURE, not on when the money moved. "August travel" is the
   *   question people ask; a September settlement of an August trip belongs to
   *   August.
   */
  const monthSpend = useMemo(() => {
    const month = today.slice(0, 7);
    return s.trips
      .filter((t) => t.status !== "draft")
      .filter((t) => (t.actualDepartureDate ?? t.plannedDepartureDate ?? "").startsWith(month))
      .reduce(
        (sum, t) =>
          sum + (t.bookingTotal ?? 0) + ((t.claimTotal ?? 0) - (t.disallowedTotal ?? 0)) + (t.daTotal ?? 0),
        0,
      );
  }, [s.trips, today]);

  const tiles: KpiTile[] = [
    {
      key: "late",
      label: "Past its due date",
      value: late.length,
      tone: late.length ? "red" : undefined,
      href: "/travel-desk/monitoring",
    },
    { key: "today", label: "Due today", value: dueToday.length, href: "/travel-desk/monitoring" },
    { key: "open", label: "Open trips", value: s.entries.length, href: "/travel-desk/trips" },
    { key: "mine", label: "My trips", value: mine.length, href: "/travel-desk/mine" },
    {
      key: "advance",
      label: "Advance outstanding",
      value: money(outstandingAdvance),
      hint: "Drawn and not yet reconciled",
      href: "/travel-desk/reports/outstanding-advances",
    },
    {
      key: "month",
      label: "This month",
      value: money(monthSpend),
      hint: "Booked, allowed and allowance, on trips departing this month",
      href: "/travel-desk/reports/spend",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Travel Desk</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Request a trip, get it approved, book it, and claim what it cost.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-[15px] font-bold text-navy">Past its due date</h2>
          {late.length === 0 ? (
            <p className="mt-2 text-[13px] text-grey-2">Nothing is late.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {late.slice(0, 8).map((e) => (
                <li key={`${e.tripId}:${e.stepKey}`} className="text-[13.5px]">
                  <Link to={`/travel-desk/trips/${e.tripId}`} className="font-semibold text-navy hover:text-orange">
                    {e.ref}
                  </Link>
                  <span className="text-grey-2">
                    {" "}· {e.travellerName} · {stepByKey(e.stepKey)?.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-[15px] font-bold text-navy">Waiting on nothing dated</h2>
          <p className="mt-1 text-[13px] text-grey-2">
            Open, owed by somebody, and with no due date — so never red, and never on the late list.
          </p>
          {stalled.length === 0 ? (
            <p className="mt-2 text-[13px] text-grey-2">Everything open has a date on it.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {stalled.slice(0, 8).map((e) => (
                <li key={`${e.tripId}:${e.stepKey}`} className="text-[13.5px]">
                  <Link
                    to={`/travel-desk/trips/${e.tripId}`}
                    className="font-semibold text-navy hover:text-orange"
                  >
                    {e.ref}
                  </Link>
                  <span className="text-grey-2">
                    {" "}· {e.travellerName} · {stepByKey(e.stepKey)?.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-[15px] font-bold text-navy">Upcoming travel</h2>
          <p className="mt-1 text-[13px] text-grey-2">Booked, and not departed yet.</p>
          {upcoming.length === 0 ? (
            <p className="mt-2 text-[13px] text-grey-2">Nobody is travelling in the near future.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {upcoming.slice(0, 8).map((t) => (
                <li key={t.id} className="text-[13.5px]">
                  <Link to={`/travel-desk/trips/${t.id}`} className="font-semibold text-navy hover:text-orange">
                    {t.tripNo ?? t.travellerName}
                  </Link>
                  <span className="text-grey-2">
                    {" "}· {t.travellerName} · departs {t.plannedDepartureDate} · {STATUS_LABEL[t.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
