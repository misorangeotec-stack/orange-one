import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Kpi from "@/shared/components/ui/Kpi";
import StepPipeline from "@/shared/components/ui/StepPipeline";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell from "@/shared/components/ui/DueCell";
import { todayLocalIso, type Bucket } from "@/shared/lib/dueBuckets";
import { queueRollup } from "@/shared/lib/fmsDashboard";
import { appName } from "@/apps/appInfo";
import { useOcpiStore } from "../../store";
import { STEPS, STAGES, stepByKey, type StepKey } from "../../lib/steps";
import { dealRef, type QueueEntry } from "../../lib/queues";
import { STATUS_LABEL, dmy, fmtDealValue } from "../../lib/format";

const B = "/ocpi";

const BUCKETS: { key: Bucket; label: string; tone?: "red" }[] = [
  { key: "delayed", label: "Delayed", tone: "red" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "dayAfter", label: "Day after" },
  { key: "noDate", label: "No date" },
];

/**
 * The OCPI Control Center — where every open deal is, and how close it is to its
 * due date.
 *
 * ⚠ IT READS `store.entries`, the SAME `buildQueueEntries` the five step queues,
 *   the dashboard and the cross-FMS scoreboard read. That is the whole reason
 *   this page can be trusted: four surfaces, one builder, so they cannot report
 *   different numbers for the same step. Every other module's control centre is
 *   built the same way, which is why this one deliberately looks familiar.
 *
 * ⚠ THE RAIL FILTERS THE TABLE. Clicking "OC Appr" narrows the list below rather
 *   than navigating away, because the question being asked here — "what is stuck
 *   and who has it" — is answered by looking at the rows, not by jumping to a
 *   queue whose own page assumes you own that step.
 *
 * ⚠ HELD AND SENT-BACK DEALS GET THEIR OWN STRIP, because they are in NOBODY's
 *   queue. A held deal has left every count on this page by design; without the
 *   strip it would simply never be looked at again — which is exactly what the
 *   paper process did to them.
 */
export default function ControlCenter() {
  const s = useOcpiStore();
  const today = todayLocalIso();
  const [selected, setSelected] = useState<StepKey[]>([]);

  const pipelineSteps = useMemo(() => STEPS.filter((st) => !st.noQueue), []);
  const { counts, nodes } = useMemo(
    () => queueRollup(s.entries, pipelineSteps, today),
    [s.entries, pipelineSteps, today],
  );

  const rows = useMemo(() => {
    const wanted = new Set<string>(selected);
    return s.entries.filter((e) => selected.length === 0 || wanted.has(e.stepKey));
  }, [s.entries, selected]);

  /** Deals that owe nobody but are not finished: on hold, or sent back. */
  const stalled = useMemo(
    () =>
      s.deals
        .filter((d) => d.status === "on_hold" || d.status === "rework")
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [s.deals],
  );

  const dealOf = (e: QueueEntry) => s.deals.find((d) => d.id === e.dealId);

  const ownersOf = (e: QueueEntry): string => {
    const ids = s.ownersOf(e.stepKey as StepKey);
    return ids.length === 0 ? "Unassigned" : `${ids.length} assigned`;
  };

  const columns = useMemo<QueueColumn<QueueEntry>[]>(
    () => [
      {
        key: "ref",
        header: "Deal",
        cell: (e) => (
          <Link to={`${B}/deals/${e.dealId}`} className="font-semibold text-navy hover:text-orange hover:underline">
            {e.ref}
          </Link>
        ),
        sortValue: (e) => e.ref,
        filter: { kind: "text", get: (e) => e.ref },
      },
      {
        key: "step",
        header: "Step",
        cell: (e) => stepByKey(e.stepKey)?.title ?? e.stepKey,
        // Ordered by the step's position in the chain, never alphabetically —
        // "Approve Quotation" would otherwise sort after "Approve Order
        // Confirmation" and the list would read as though the process ran
        // backwards.
        sortValue: (e) => stepByKey(e.stepKey)?.index ?? 0,
        filter: { kind: "select", get: (e) => stepByKey(e.stepKey)?.title ?? e.stepKey },
      },
      {
        key: "owner",
        header: "Owners",
        cell: (e) => <span className="text-grey">{ownersOf(e)}</span>,
        sortValue: (e) => ownersOf(e),
        filter: { kind: "select", get: (e) => ownersOf(e) },
      },
      {
        key: "customer",
        header: "Customer",
        cell: (e) => e.customerName,
        filter: { kind: "select", get: (e) => e.customerName },
      },
      {
        key: "machine",
        header: "Machine",
        cell: (e) => (e.machineId ? s.machineById(e.machineId)?.name ?? "" : ""),
        filter: { kind: "select", get: (e) => (e.machineId ? s.machineById(e.machineId)?.name ?? "" : "") },
      },
      {
        key: "salesperson",
        header: "Salesperson",
        cell: (e) => e.salespersonName ?? "",
        filter: { kind: "select", get: (e) => e.salespersonName ?? "" },
      },
      {
        key: "value",
        header: "Deal value",
        align: "right",
        cell: (e) => {
          const d = dealOf(e);
          return d ? fmtDealValue(d.dealValueAmount, d.dealValueCurrency) : "";
        },
        sortValue: (e) => dealOf(e)?.dealValueAmount ?? -1,
        filter: { kind: "number", get: (e) => dealOf(e)?.dealValueAmount ?? 0 },
        exportValue: (e) => dealOf(e)?.dealValueAmount ?? "",
      },
      {
        key: "due",
        header: "Due",
        cell: (e) => <DueCell dueIso={e.dueIso} />,
        sortValue: (e) => e.dueIso ?? "",
        filter: { kind: "date", get: (e) => e.dueIso ?? "" },
        exportValue: (e) => e.dueIso ?? "",
      },
    ],
    [s.deals, s.machines, s.stepOwners],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{appName("ocpi")} Control Center</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Every open deal, by how close it is to its due date. The same numbers the step queues
          and the cross-process scoreboard show.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {BUCKETS.map((b) => (
          <Kpi key={b.key} label={b.label} value={counts[b.key]} tone={b.tone} />
        ))}
      </div>

      <StepPipeline nodes={nodes} selectedKeys={selected} onChange={setSelected} groups={STAGES.map((st) => ({ label: st.label, keys: st.keys as StepKey[] }))} />

      <QueueTable
        rows={rows}
        rowKey={(e) => `${e.dealId}:${e.stepKey}`}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="open deals"
        emptyTitle="Nothing is open"
        emptyMessage="Every deal is either still a draft, finished, or parked."
        initialSort={{ key: "due", dir: "asc" }}
        exportName="ocpi-open-work"
        exportTitle="OCPI — open work"
      />

      <Card className="p-0">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-bold text-navy">Parked</h2>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            On hold or sent back for changes. These are in nobody&rsquo;s queue and in none of the
            counts above — which is why they are listed separately.
          </p>
        </div>
        {stalled.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-grey-2">Nothing is parked.</p>
        ) : (
          <ul className="divide-y divide-line">
            {stalled.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <Link
                    to={`${B}/deals/${d.id}`}
                    className="text-[13.5px] font-semibold text-navy hover:text-orange hover:underline"
                  >
                    {dealRef(d)}
                  </Link>
                  <div className="truncate text-[12px] text-grey-2">
                    {d.customerName} — {d.holdReason || d.reworkReason || "no reason recorded"}
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
  );
}
