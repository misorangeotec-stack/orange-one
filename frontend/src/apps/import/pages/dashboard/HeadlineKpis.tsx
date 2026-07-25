import Kpi from "@/shared/components/ui/Kpi";

/**
 * The five headline tiles. These are TOTALS (open requisitions, live POs, …),
 * so they stay informative even when nothing is due — a real `0` reads as "none
 * open", not as a blank screen.
 */
export default function HeadlineKpis({
  openRequests,
  livePos,
  pendingToday,
  delayed,
  closed30,
}: {
  openRequests: number;
  livePos: number;
  pendingToday: number;
  delayed: number;
  closed30: number;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Kpi
        label="Pending today"
        value={pendingToday}
        hint="delayed + due today"
        size="hero"
        tone={pendingToday > 0 ? "red" : undefined}
      />
      <Kpi label="Open requisitions" value={openRequests} hint="not yet closed" size="lg" />
      <Kpi label="Live POs" value={livePos} hint="in progress" size="lg" />
      <Kpi label="Delayed" value={delayed} hint="past due" size="lg" tone={delayed > 0 ? "red" : undefined} />
      <Kpi label="Closed (30d)" value={closed30} hint="booked in Tally" size="lg" />
    </div>
  );
}
