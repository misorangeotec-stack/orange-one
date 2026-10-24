import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import { useOcpiStore } from "../../store";
import { dealRef, dealRefSort, dueIsoFor } from "../../lib/queues";
import { STATUS_LABEL, dmy } from "../../lib/format";
import type { OcpiDeal } from "../../types";

/**
 * Countersigned deals waiting for the service team's Service Check.
 *
 * ⚠ NO MONEY ON THIS PAGE. The service team is not shown the deal value, and
 *   Open lands on the service-only view (ServiceCheckView), not the deal page.
 *
 * ⚠ PARALLEL TO FINANCE. A deal lands here at the same moment it lands in
 *   "Hand Over to Finance", and the two never wait on each other — so the
 *   Finance stage is a column here, for information only.
 */
export default function ServiceCheckQueue() {
  const s = useOcpiStore();
  const nav = useNavigate();

  const [tab, setTab] = useState<"pending" | "completed">("pending");

  const pending = useMemo(() => {
    const ids = new Set(
      s.entries.filter((e) => e.stepKey === "service_check").map((e) => e.dealId),
    );
    return s.deals.filter((d) => ids.has(d.id));
  }, [s.entries, s.deals]);

  // The bucket's history: every check the service team has submitted.
  const completed = useMemo(() => s.deals.filter((d) => !!d.svcAt), [s.deals]);
  const rows = tab === "pending" ? pending : completed;

  const machineName = (id: string | null) => (id ? s.machineById(id)?.name ?? "" : "");
  const due = (d: OcpiDeal) => dueIsoFor(d, "service_check", s.stepSla);
  const finance = (d: OcpiDeal) => STATUS_LABEL[d.status] ?? d.status;

  const columns = useMemo<QueueColumn<OcpiDeal>[]>(
    () => [
      {
        key: "ref",
        header: "Order confirmation",
        cell: (d) => (
          <Link to={`/ocpi/queues/service-check/${d.id}`} className="font-semibold text-navy hover:text-orange hover:underline">
            {dealRef(d)}
          </Link>
        ),
        sortValue: (d) => dealRefSort(d),
        filter: { kind: "text", get: (d) => dealRef(d) },
      },
      {
        key: "customer",
        header: "Customer",
        cell: (d) => d.customerName ?? "",
        sortValue: (d) => d.customerName ?? "",
        filter: { kind: "select", get: (d) => d.customerName ?? "" },
      },
      {
        key: "machine",
        header: "Machine",
        cell: (d) => machineName(d.machineId),
        sortValue: (d) => machineName(d.machineId),
        filter: { kind: "select", get: (d) => machineName(d.machineId) },
      },
      {
        key: "salesperson",
        header: "Salesperson",
        cell: (d) => d.salespersonName ?? "",
        sortValue: (d) => d.salespersonName ?? "",
        filter: { kind: "select", get: (d) => d.salespersonName ?? "" },
      },
      {
        key: "sent",
        header: "Sent to Service",
        cell: (d) => dmy(d.svcOpenedAt),
        sortValue: (d) => d.svcOpenedAt ?? "",
        filter: { kind: "date", get: (d) => (d.svcOpenedAt ?? "").slice(0, 10) },
      },
      {
        key: "finance",
        header: "Finance stage",
        cell: (d) => <span className="text-grey-2">{finance(d)}</span>,
        sortValue: (d) => finance(d),
        filter: { kind: "select", get: (d) => finance(d) },
      },
      ...(tab === "pending"
        ? ([
          {
            key: "due",
            header: "Due",
            cell: (d) => <DueCell dueIso={due(d)} />,
            sortValue: (d) => due(d) ?? "",
            filter: { kind: "date", get: (d) => due(d) ?? "" },
            exportValue: (d) => due(d) ?? "",
          },
          ] as QueueColumn<OcpiDeal>[])
        : ([
            {
              key: "installation",
              header: "Installation date",
              cell: (d: OcpiDeal) => dmy(d.svcInstallationDate),
              sortValue: (d: OcpiDeal) => d.svcInstallationDate ?? "",
              filter: { kind: "date", get: (d: OcpiDeal) => d.svcInstallationDate ?? "" },
            },
            {
              key: "engineer",
              header: "Engineer",
              cell: (d: OcpiDeal) => d.svcEngineer ?? "",
              sortValue: (d: OcpiDeal) => d.svcEngineer ?? "",
              filter: { kind: "select", get: (d: OcpiDeal) => d.svcEngineer ?? "" },
            },
            {
              key: "done",
              header: "Completed on",
              cell: (d: OcpiDeal) => dmy(d.svcAt),
              sortValue: (d: OcpiDeal) => d.svcAt ?? "",
              filter: { kind: "date", get: (d: OcpiDeal) => (d.svcAt ?? "").slice(0, 10) },
            },
          ] as QueueColumn<OcpiDeal>[])),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.machines, s.stepSla, tab],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Service Check</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Countersigned deals for the service team. Confirm the installation date, engineer, site
          contact, site readiness and the check points. This runs alongside the Finance handover —
          neither waits for the other.
        </p>
      </div>

      <div className="flex gap-1 border-b border-line">
        {([
          ["pending", `Pending (${pending.length})`],
          ["completed", `Completed (${completed.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold ${
              tab === key ? "border-orange text-navy" : "border-transparent text-grey-2 hover:text-navy"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <QueueTable
        key={tab}
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="deals"
        emptyTitle={tab === "pending" ? "Nothing waiting for the service team" : "No Service Check completed yet"}
        emptyMessage={
          tab === "pending"
            ? "A deal appears here as soon as management has countersigned it."
            : "Each submitted Service Check is listed here."
        }
        initialSort={tab === "pending" ? { key: "sent", dir: "asc" } : { key: "done", dir: "desc" }}
        exportName="ocpi-service-check"
        exportTitle="Awaiting Service Check"
        actions={(d) => (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => nav(`/ocpi/queues/service-check/${d.id}`)}>
              Open
            </Button>
          </div>
        )}
      />
    </div>
  );
}
