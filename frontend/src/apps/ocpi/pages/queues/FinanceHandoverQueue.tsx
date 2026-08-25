import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import { useOcpiStore } from "../../store";
import { dealRef, dueIsoFor } from "../../lib/queues";
import { signedPages } from "../../lib/signatures";
import { dmy, fmtDealValue } from "../../lib/format";
import type { OcpiDeal } from "../../types";

/**
 * Countersigned, and waiting to reach the Finance desk.
 *
 * ⚠ THIS QUEUE IS THE POINT OF THE WHOLE STAGE. Before it, a countersigned
 *   contract closed the deal and vanished from every list, so nobody could
 *   answer "which signed contracts has Finance not got yet?" — which is the
 *   question the paper going missing actually raises.
 *
 * ⚠ THE PAGE COUNT IS A COLUMN, and it earns its place here as it does on the
 *   countersignature queue: a row showing three pages against a five-page
 *   contract is the fastest way to spot a scan that was cut short before
 *   anybody carries it anywhere.
 */
export default function FinanceHandoverQueue() {
  const s = useOcpiStore();
  const nav = useNavigate();

  const rows = useMemo(() => {
    const ids = new Set(
      s.entries.filter((e) => e.stepKey === "finance_handover").map((e) => e.dealId),
    );
    return s.deals.filter((d) => ids.has(d.id));
  }, [s.entries, s.deals]);

  const machineName = (id: string | null) => (id ? s.machineById(id)?.name ?? "" : "");
  const due = (d: OcpiDeal) => dueIsoFor(d, "finance_handover", s.stepSla);
  const pageCount = (d: OcpiDeal) => signedPages(d, "management-signed").length;

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
        key: "countersigned",
        header: "Countersigned on",
        cell: (d) => dmy(d.msAt),
        sortValue: (d) => d.msAt ?? "",
        filter: { kind: "date", get: (d) => (d.msAt ?? "").slice(0, 10) },
      },
      {
        key: "pages",
        header: "Pages",
        align: "right",
        cell: (d) => String(pageCount(d)),
        sortValue: (d) => pageCount(d),
        filter: { kind: "number", get: (d) => pageCount(d) },
      },
      {
        key: "due",
        header: "Due",
        // ⚠ SORTED AND FILTERED ON THE DATE, never on the rendered cell — that
        //   carries an "overdue" chip, and ordering by its text would sort the
        //   late rows by how late they read rather than by when they were due.
        cell: (d) => <DueCell dueIso={due(d)} />,
        sortValue: (d) => due(d) ?? "",
        filter: { kind: "date", get: (d) => due(d) ?? "" },
        exportValue: (d) => due(d) ?? "",
      },
    ],
    [s.machines, s.stepSla],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Hand over to Finance</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Countersigned contracts that have not yet reached the Finance desk. Recording the handover
          asks Finance to confirm they have it.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="contracts"
        emptyTitle="Nothing waiting to be handed over"
        emptyMessage="A contract appears here once management has countersigned it."
        initialSort={{ key: "countersigned", dir: "asc" }}
        exportName="ocpi-awaiting-finance-handover"
        exportTitle="Awaiting handover to Finance"
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
