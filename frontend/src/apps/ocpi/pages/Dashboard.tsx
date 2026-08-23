import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { dueState } from "@/shared/lib/workingDays";
import { QuotationSeriesWarning } from "../components/SetupWarnings";
import { useOcpiStore } from "../store";
import { QUEUE_PATH } from "../nav";
import { STEPS } from "../lib/steps";
import { dealRef, type QueueStep } from "../lib/queues";
import { STATUS_LABEL, dmy, fmtDealValue } from "../lib/format";
import type { OcpiDeal } from "../types";

/**
 * The OCPI home.
 *
 * ⚠ IT ANSWERS "WHAT NEEDS ME", NOT "HOW ARE WE DOING". There is no throughput
 *   chart and no conversion rate here, deliberately: this module handles a few
 *   dozen deals a year, and a trend line over that is noise dressed as insight.
 *   What a salesperson or a director actually opens this for is which deals are
 *   stuck and which are late, so those are the two lists.
 *
 * ⚠ A STEP TILE IS A COUNT, NOT ALWAYS A LINK. A queue is permission-gated, so
 *   linking a non-owner's tile would hand them Access Denied from their own
 *   dashboard. Only tiles whose queue this person may open carry an `href`.
 *
 * ⚠ THE LISTS SHOW WHAT THIS PERSON CAN SEE, and nothing more. `s.deals` is
 *   already RLS-scoped, so a salesperson's "needs attention" is their own work
 *   and a coordinator's is everyone's. No extra filter is applied here, because
 *   a second opinion about visibility is a second thing to get wrong.
 */
export default function Dashboard() {
  const s = useOcpiStore();

  const tiles = useMemo<KpiTile[]>(() => {
    const drafts = s.deals.filter((d) => d.status === "draft" && d.raisedBy === s.userId).length;
    const open = s.entries.length;
    const closed = s.deals.filter((d) => d.status === "closed").length;

    const stepTiles: KpiTile[] = STEPS.filter((st) => !st.noQueue).map((st) => {
      const step = st.key as QueueStep;
      const count = s.entries.filter((e) => e.stepKey === step).length;
      return {
        key: step,
        label: st.short,
        value: count,
        size: "sm",
        href: s.canSeeQueue(step) ? `/ocpi/queues/${QUEUE_PATH[step]}` : undefined,
      };
    });

    return [
      { key: "drafts", label: "My drafts", value: drafts, hint: "Only you can see these", href: "/ocpi/drafts" },
      { key: "open", label: "In progress", value: open, hint: "Waiting on someone" },
      { key: "closed", label: "Completed", value: closed, hint: "Signed by both sides" },
      ...stepTiles,
    ];
  }, [s]);

  /**
   * Late work, worst first.
   *
   * Read off the SAME queue entries every other surface reads, so this list and
   * the queue pages cannot disagree about what is overdue.
   */
  const late = useMemo(() => {
    const byId = new Map(s.deals.map((d) => [d.id, d]));
    return s.entries
      .filter((e) => e.dueIso && dueState(new Date(e.dueIso)).overdue)
      .map((e) => ({
        entry: e,
        deal: byId.get(e.dealId),
        days: -dueState(new Date(e.dueIso as string)).days,
      }))
      .filter((r): r is { entry: typeof r.entry; deal: OcpiDeal; days: number } => !!r.deal)
      .sort((a, b) => b.days - a.days)
      .slice(0, 8);
  }, [s.entries, s.deals]);

  /**
   * Stalled, but not late: on hold, or sent back and waiting to be picked up
   * again. These never appear in an overdue count — a held deal has left every
   * queue on purpose — which is exactly why they need their own list, or they
   * are never looked at again.
   */
  const stalled = useMemo(
    () =>
      s.deals
        .filter((d) => d.status === "on_hold" || d.status === "rework")
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 8),
    [s.deals],
  );

  const stepTitle = (key: string) => STEPS.find((x) => x.key === key)?.title ?? key;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">OCPI</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Quotations and order confirmations, from the first draft to the signed copy.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      {/*
        Shown to the people who can raise one, and to admins who can fix it. A
        viewer cannot mint a number and cannot set the series, so telling them
        would only be noise on a screen they read every morning.
      */}
      {(s.canRaise || s.isAdmin) && <QuotationSeriesWarning />}

      {s.machines.length === 0 && (
        <Card className="p-5">
          <h2 className="text-[15px] font-bold text-navy">No machines set up yet</h2>
          <p className="mt-1 text-[13.5px] text-grey">
            A quotation is raised against a machine, and the order confirmation is built from that
            machine&rsquo;s template. Until the machine list is loaded, a quotation cannot be raised.
            {s.canSetup ? " Add them under Administration → Machines." : " An admin sets these up."}
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-bold text-navy">Past its due date</h2>
            <p className="mt-0.5 text-[12.5px] text-grey-2">
              Worst first. The target for each step is set in Settings → Due dates.
            </p>
          </div>
          {late.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-grey-2">Nothing is late.</p>
          ) : (
            <ul className="divide-y divide-line">
              {late.map(({ entry, deal, days }) => (
                <li key={entry.entityId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link
                      to={`/ocpi/deals/${deal.id}`}
                      className="text-[13.5px] font-semibold text-navy hover:text-orange hover:underline"
                    >
                      {dealRef(deal)}
                    </Link>
                    <div className="truncate text-[12px] text-grey-2">
                      {deal.customerName} · {stepTitle(entry.stepKey)}
                      {deal.dealValueAmount !== null &&
                        ` · ${fmtDealValue(deal.dealValueAmount, deal.dealValueCurrency)}`}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#FDECEC] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-ryg-red">
                    {days}d overdue
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-0">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-bold text-navy">Stalled</h2>
            <p className="mt-0.5 text-[12.5px] text-grey-2">
              On hold or sent back. These are in nobody&rsquo;s queue, which is why they are here.
            </p>
          </div>
          {stalled.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-grey-2">Nothing is stalled.</p>
          ) : (
            <ul className="divide-y divide-line">
              {stalled.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <Link
                      to={`/ocpi/deals/${d.id}`}
                      className="text-[13.5px] font-semibold text-navy hover:text-orange hover:underline"
                    >
                      {dealRef(d)}
                    </Link>
                    <div className="truncate text-[12px] text-grey-2">
                      {d.holdReason || d.reworkReason || d.customerName}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11.5px] text-grey-2">
                    {STATUS_LABEL[d.status]} · {dmy(d.holdAt ?? d.reworkAt ?? d.updatedAt)}
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
