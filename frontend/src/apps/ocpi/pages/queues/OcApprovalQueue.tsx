import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import { useOcpiStore } from "../../store";
import DueCell from "@/shared/components/ui/DueCell";
import { dealRef, dueIsoFor } from "../../lib/queues";
import { dmy, fmtDealValue } from "../../lib/format";
import type { OcpiDeal } from "../../types";

/**
 * Quotations waiting on an approver.
 *
 * ⚠ THE ROWS COME FROM THE SHARED QUEUE BUILDER, not from a filter written here.
 *   The dashboard tile, this page and the cross-FMS scoreboard all read
 *   `buildQueueEntries`, which is what stops the three of them disagreeing about
 *   how much work is outstanding.
 *
 * ⚠ EVERY COLUMN SORTS AND FILTERS, and the grid is flat. Value is ordered by
 *   the number, not by the rendered string with its currency symbol.
 */
export default function OcApprovalQueue() {
  const s = useOcpiStore();
  const nav = useNavigate();

  const rows = useMemo(() => {
    const ids = new Set(s.entries.filter((e) => e.stepKey === "oc_approval").map((e) => e.dealId));
    return s.deals.filter((d) => ids.has(d.id));
  }, [s.entries, s.deals]);

  const machineName = (id: string | null) => (id ? s.machineById(id)?.name ?? "" : "");

  // The admin-configured target for THIS step, from the anchor step's own
  // timestamp. Null when it cannot be known, which renders as a dash — never as
  // a date the module cannot stand behind.
  const due = (d: OcpiDeal) => dueIsoFor(d, "oc_approval", s.stepSla);

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
        key: "quotation",
        header: "Quotation",
        cell: (d) => d.quotationNo ?? "",
        sortValue: (d) => d.quotationNo ?? "",
        filter: { kind: "text", get: (d) => d.quotationNo ?? "" },
      },
      {
        key: "returned",
        header: "Sent back before",
        cell: (d) => (d.reworkCount > 0 ? `${d.reworkCount}×` : "—"),
        sortValue: (d) => d.reworkCount,
        filter: { kind: "select", get: (d) => (d.reworkCount > 0 ? `${d.reworkCount}×` : "No") },
      },
      {
        key: "raised",
        header: "Raised",
        cell: (d) => dmy(d.createdAt),
        sortValue: (d) => d.createdAt,
        filter: { kind: "date", get: (d) => d.createdAt.slice(0, 10) },
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
        <h1 className="text-[20px] font-bold text-navy">Approve order confirmations</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Order confirmations the salesperson has completed. Confirming sends it back to them to print
          and get signed by the customer.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="order confirmations"
        emptyTitle="Nothing waiting"
        emptyMessage="An order confirmation appears here once a salesperson has completed and submitted it."
        initialSort={{ key: "raised", dir: "asc" }}
        exportName="ocpi-ocs-awaiting-approval"
        exportTitle="Order confirmations awaiting approval"
        actions={(d) => (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => nav(`/ocpi/deals/${d.id}`)}>
              Review
            </Button>
          </div>
        )}
      />

    </div>
  );
}
