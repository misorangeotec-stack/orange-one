import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import PillToggle from "@/shared/components/ui/PillToggle";
import { useAssetStore } from "../../store";
import StatusPill from "../../components/StatusPill";
import { dmy, duePhrase, inr, SOURCE_LABEL } from "../../lib/format";
import { isOverdue } from "../../lib/queues";
import type { ServiceJob } from "../../types";

type Scope = "open" | "overdue" | "closed" | "all";

/** Every service job ever raised — the audit view behind the queues. */
export default function JobsList() {
  const s = useAssetStore();
  const [scope, setScope] = useState<Scope>("open");

  const rows = useMemo(() => {
    if (scope === "open") return s.openJobs;
    if (scope === "overdue") return s.overdueJobs;
    if (scope === "closed") return s.jobs.filter((j) => j.status === "closed");
    return s.jobs;
  }, [s.jobs, s.openJobs, s.overdueJobs, scope]);

  const columns: QueueColumn<ServiceJob>[] = [
    {
      key: "jobNo",
      header: "Job",
      cell: (j) => (
        <Link to={`/asset-maintenance/jobs/${j.id}`} className="font-semibold text-navy hover:text-orange">
          {j.jobNo}
        </Link>
      ),
      sortValue: (j) => j.jobNo,
      filter: { kind: "text", get: (j) => j.jobNo },
    },
    {
      key: "asset",
      header: "Asset",
      cell: (j) => (
        <Link to={`/asset-maintenance/assets/${j.assetId}`} className="text-navy hover:text-orange">
          {s.assetLabel(j.assetId)}
        </Link>
      ),
      sortValue: (j) => s.assetLabel(j.assetId),
      filter: { kind: "text", get: (j) => s.assetLabel(j.assetId) },
    },
    {
      key: "what",
      header: "What",
      cell: (j) => <span className="text-grey">{s.scheduleTypeName(j.scheduleTypeId)}</span>,
      sortValue: (j) => s.scheduleTypeName(j.scheduleTypeId),
      filter: { kind: "select", get: (j) => s.scheduleTypeName(j.scheduleTypeId) },
    },
    {
      key: "due",
      header: "Service due",
      cell: (j) => (
        <div className="min-w-0">
          <div className={`whitespace-nowrap ${isOverdue(j, s.todayIso) ? "font-semibold text-ryg-red" : "text-navy"}`}>
            {dmy(j.dueDate)}
          </div>
          {!!j.dueDate && j.status !== "closed" && (
            <div className="text-[12px] text-grey-2">{duePhrase(j.dueDate, s.todayIso)}</div>
          )}
        </div>
      ),
      sortValue: (j) => j.dueDate ?? "9999-12-31",
      filter: { kind: "date", get: (j) => j.dueDate ?? "" },
      exportValue: (j) => (j.dueDate ? dmy(j.dueDate) : ""),
    },
    {
      key: "done",
      header: "Done on",
      cell: (j) => <span className="text-grey whitespace-nowrap">{dmy(j.sdActualDate)}</span>,
      sortValue: (j) => j.sdActualDate ?? "",
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      cell: (j) => <span className="text-grey whitespace-nowrap">{inr(j.sdCost)}</span>,
      sortValue: (j) => j.sdCost ?? 0,
    },
    {
      key: "source",
      header: "Raised",
      cell: (j) => <span className="text-grey-2">{SOURCE_LABEL[j.raisedSource]}</span>,
      sortValue: (j) => j.raisedSource,
      filter: { kind: "select", get: (j) => SOURCE_LABEL[j.raisedSource] },
    },
    {
      key: "status",
      header: "Status",
      cell: (j) => <StatusPill status={j.status} />,
      sortValue: (j) => j.status,
      filter: { kind: "select", get: (j) => j.status },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Service jobs</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Every job the engine has raised, and what happened to it.
        </p>
      </div>

      <PillToggle
        value={scope}
        onChange={setScope}
        options={[
          { value: "open" as Scope, label: `Open (${s.openJobs.length})` },
          { value: "overdue" as Scope, label: `Overdue (${s.overdueJobs.length})` },
          { value: "closed" as Scope, label: `Closed (${s.jobs.filter((j) => j.status === "closed").length})` },
          { value: "all" as Scope, label: `All (${s.jobs.length})` },
        ]}
      />

      <QueueTable<ServiceJob>
        rows={rows}
        rowKey={(j) => j.id}
        columns={columns}
        groupBy={{
          idOf: (j) => j.scheduleTypeId ?? "",
          nameOf: (id) => s.scheduleTypeName(id || null),
          allLabel: "All types",
          label: "What",
        }}
        rowsLabel="jobs"
        initialSort={{ key: "due", dir: "asc" }}
        emptyTitle="No service jobs"
        emptyMessage="Jobs are opened automatically when a track enters its reminder window."
        exportName="Asset_Service_Jobs"
      />
    </div>
  );
}
