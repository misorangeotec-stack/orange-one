import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../../store";
import { dealRef, dueIsoFor } from "../../lib/queues";
import { dmy, fmtDealValue } from "../../lib/format";
import type { OcpiDeal } from "../../types";

/**
 * Handed over, and waiting for Finance to say they have it.
 *
 * ⚠ "HANDED OVER BY" IS A COLUMN, not a detail on the deal page. This queue is
 *   read by the person who has to go and find a contract that has not turned up,
 *   and the first question they ask is who last had it.
 */
export default function FinanceReceiptQueue() {
  const s = useOcpiStore();
  const nav = useNavigate();
  const personById = useOrgPersonById();

  const rows = useMemo(() => {
    const ids = new Set(
      s.entries.filter((e) => e.stepKey === "finance_receipt").map((e) => e.dealId),
    );
    return s.deals.filter((d) => ids.has(d.id));
  }, [s.entries, s.deals]);

  const machineName = (id: string | null) => (id ? s.machineById(id)?.name ?? "" : "");
  const due = (d: OcpiDeal) => dueIsoFor(d, "finance_receipt", s.stepSla);
  const handedBy = (d: OcpiDeal) => (d.fhBy ? personById(d.fhBy)?.name ?? "Someone" : "");

  const columns = useMemo<QueueColumn<OcpiDeal>[]>(
    () => [
      {
        key: "ref",
        header: "Order confirmation",
        cell: (d) => (
          <Link to={`/ocpi/deals/${d.id}`} className="font-semibold text-navy hover:text-orange hover:underline">
            {dealRef(d)}
          </Link>
        ),
        sortValue: (d) => dealRef(d),
        filter: { kind: "text", get: (d) => dealRef(d) },
      },
      {
        key: "customer",
        header: "Customer",
        cell: (d) => d.customerName ?? "",
        filter: { kind: "select", get: (d) => d.customerName ?? "" },
      },
      {
        key: "machine",
        header: "Machine",
        cell: (d) => machineName(d.machineId),
        filter: { kind: "select", get: (d) => machineName(d.machineId) },
      },
      {
        key: "salesperson",
        header: "Salesperson",
        cell: (d) => d.salespersonName ?? "",
        filter: { kind: "select", get: (d) => d.salespersonName ?? "" },
      },
      {
        key: "value",
        header: "Deal value",
        align: "right",
        cell: (d) => fmtDealValue(d.dealValueAmount, d.dealValueCurrency),
        sortValue: (d) => d.dealValueAmount ?? -1,
        filter: { kind: "number", get: (d) => d.dealValueAmount ?? 0 },
        exportValue: (d) => d.dealValueAmount ?? "",
      },
      {
        key: "handedBy",
        header: "Handed over by",
        cell: (d) => handedBy(d),
        sortValue: (d) => handedBy(d),
        filter: { kind: "select", get: (d) => handedBy(d) },
      },
      {
        key: "handedOn",
        header: "Handed over on",
        cell: (d) => dmy(d.fhAt),
        sortValue: (d) => d.fhAt ?? "",
        filter: { kind: "date", get: (d) => (d.fhAt ?? "").slice(0, 10) },
      },
      {
        key: "due",
        header: "Due",
        cell: (d) => <DueCell dueIso={due(d)} />,
        sortValue: (d) => due(d) ?? "",
        filter: { kind: "date", get: (d) => due(d) ?? "" },
        exportValue: (d) => due(d) ?? "",
      },
    ],
    // `personById` is rebuilt every render by design, so it is deliberately not
    // a dependency — including it would rebuild these columns on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.machines, s.stepSla, s.deals],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Confirm Finance has it</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Signed contracts handed over and not yet confirmed. Confirming receipt completes the deal —
          and the person who handed one over cannot confirm it themselves.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="contracts"
        emptyTitle="Nothing waiting on Finance"
        emptyMessage="A contract appears here once somebody records handing it over."
        initialSort={{ key: "handedOn", dir: "asc" }}
        exportName="ocpi-awaiting-finance-receipt"
        exportTitle="Awaiting Finance receipt"
        actions={(d) => (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => nav(`/ocpi/deals/${d.id}`)}>
              Open
            </Button>
          </div>
        )}
      />
    </div>
  );
}
