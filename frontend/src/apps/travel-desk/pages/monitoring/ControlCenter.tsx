import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import StepPipeline from "@/shared/components/ui/StepPipeline";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { queueRollup } from "@/shared/lib/fmsDashboard";

import { useTravelStore } from "../../store";
import { STAGES, STEPS, stepByKey } from "../../lib/steps";
import type { QueueEntry, QueueStep } from "../../lib/queues";
import { STATUS_LABEL } from "../../lib/format";

/**
 * The coordinator's board: every open trip, banded by how late it is, with the
 * step rail saying where the queue is jammed.
 *
 * ⚠ IT READS `store.entries` — the SAME builder the eight queues, the dashboard
 *   and the cross-FMS scoreboard read. That is the only reason this page can
 *   never disagree with them about how much work is outstanding. Recomputing
 *   membership here, however slightly differently, is how a board ends up
 *   showing eleven when the queues add up to nine.
 */
export default function ControlCenter() {
  const s = useTravelStore();

  const today = todayLocalIso();

  const [selected, setSelected] = useState<QueueStep[]>([]);

  // Only steps that can hold work. `request` is a structural anchor and would
  // render as a permanently empty node.
  const pipelineSteps = useMemo(
    () => STEPS.filter((st) => !st.noQueue).map((st) => ({ key: st.key as QueueStep, index: st.index, short: st.short })),
    [],
  );

  const { counts, nodes } = useMemo(
    () => queueRollup(s.entries, pipelineSteps, today),
    [s.entries, pipelineSteps, today],
  );

  // An empty selection means NO filter — the same contract MultiSelect uses.
  const rows = useMemo(
    () => (selected.length ? s.entries.filter((e) => selected.includes(e.stepKey)) : s.entries),
    [s.entries, selected],
  );

  const tiles: KpiTile[] = [
    { key: "delayed", label: "Past its due date", value: counts.delayed, tone: counts.delayed ? "red" : undefined },
    { key: "today", label: "Due today", value: counts.today },
    { key: "tomorrow", label: "Due tomorrow", value: counts.tomorrow },
    { key: "dayAfter", label: "Due day after", value: counts.dayAfter },
    { key: "noDate", label: "No date yet", value: counts.noDate, hint: "Waiting on an event that has not happened" },
  ];

  const columns: QueueColumn<QueueEntry>[] = [
    {
      key: "ref",
      header: "Trip",
      cell: (e) => (
        <Link to={`/travel-desk/trips/${e.tripId}`} className="font-semibold text-navy hover:text-orange">
          {e.ref}
        </Link>
      ),
      sortValue: (e) => e.ref,
      filter: { kind: "text", get: (e) => e.ref },
    },
    {
      key: "traveller",
      header: "Traveller",
      cell: (e) => e.travellerName,
      sortValue: (e) => e.travellerName,
      filter: { kind: "select", get: (e) => e.travellerName },
    },
    {
      key: "step",
      header: "Waiting on",
      cell: (e) => stepByKey(e.stepKey)?.title ?? e.stepKey,
      sortValue: (e) => stepByKey(e.stepKey)?.index ?? 0,
      filter: { kind: "select", get: (e) => stepByKey(e.stepKey)?.title ?? e.stepKey },
    },
    {
      key: "status",
      header: "Status",
      cell: (e) => STATUS_LABEL[e.status],
      sortValue: (e) => STATUS_LABEL[e.status],
      filter: { kind: "select", get: (e) => STATUS_LABEL[e.status] },
    },
    {
      key: "departure",
      header: "Departs",
      cell: (e) => e.departureIso ?? "—",
      sortValue: (e) => e.departureIso ?? "",
      filter: { kind: "date", get: (e) => e.departureIso ?? "" },
    },
    {
      key: "due",
      header: "Due",
      cell: (e) => <DueCell dueIso={e.dueIso} />,
      // Sorted by the RAW date, not by the rendered "3d overdue" text, or the
      // column would order alphabetically and put 3 days before 30.
      sortValue: (e) => e.dueIso ?? "9999-12-31",
      filter: { kind: "date", get: (e) => e.dueIso ?? "" },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Travel Desk — Control Center</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Every open trip, where it is waiting, and how late it is.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      <Card className="p-4">
        <StepPipeline
          nodes={nodes}
          selectedKeys={selected}
          onChange={setSelected}
          groups={STAGES.map((st) => ({ label: st.label, keys: st.keys as QueueStep[] }))}
        />
      </Card>

      <QueueTable<QueueEntry>
        rows={rows}
        rowKey={(e) => `${e.tripId}:${e.stepKey}`}
        columns={columns}
        rowClassName={(e) => overdueRowClass(e.dueIso)}
        rowsLabel="open trips"
        emptyTitle="Nothing is open"
        emptyMessage="No trip is waiting on anybody right now."
        // ⚠ ALWAYS PASS isLoading — an empty table during the first fetch reads
        //   as "nothing outstanding", which on a money screen is a lie.
        loading={s.isLoading}
        initialSort={{ key: "due", dir: "asc" }}
        exportName="travel-open-trips"
        exportTitle="Travel Desk — open trips"
      />

      {s.parked.length > 0 && (
        <Card className="p-4">
          <h2 className="text-[15px] font-bold text-navy">Parked</h2>
          <p className="mt-1 text-[13px] text-grey-2">
            On hold, so owing nobody an action today — but still open, and still somebody&rsquo;s to
            restart. They are counted nowhere above, which is exactly why they are listed here.
          </p>
          <ul className="mt-3 space-y-1.5">
            {s.parked.map((t) => (
              <li key={t.id} className="text-[13.5px]">
                <Link to={`/travel-desk/trips/${t.id}`} className="font-semibold text-navy hover:text-orange">
                  {t.tripNo ?? t.travellerName}
                </Link>
                <span className="text-grey-2">
                  {" "}· {t.travellerName}
                  {t.holdReason ? ` · ${t.holdReason}` : ""}
                  
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
