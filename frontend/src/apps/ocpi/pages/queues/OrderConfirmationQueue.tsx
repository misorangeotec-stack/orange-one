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
 * Approved quotations waiting for their order confirmation to be filled in.
 *
 * ⚠ A MISSING TEMPLATE IS SHOWN IN THE QUEUE, not discovered at submit time.
 *   Fifteen of the old form's models have no order-confirmation template; a deal
 *   against one can sit here looking ready and then refuse to submit. Saying so
 *   in the row turns that into a visible task for an admin instead of a
 *   salesperson's dead end.
 */
export default function OrderConfirmationQueue() {
  const s = useOcpiStore();
  const nav = useNavigate();

  const rows = useMemo(() => {
    const ids = new Set(s.entries.filter((e) => e.stepKey === "order_confirmation").map((e) => e.dealId));
    return s.deals.filter((d) => ids.has(d.id));
  }, [s.entries, s.deals]);

  const machineOf = (d: OcpiDeal) => s.machineById(d.machineId);

  // The admin-configured target for THIS step, from the anchor step's own
  // timestamp. Null when it cannot be known, which renders as a dash — never as
  // a date the module cannot stand behind.
  const due = (d: OcpiDeal) => dueIsoFor(d, "order_confirmation", s.stepSla);

  const columns = useMemo<QueueColumn<OcpiDeal>[]>(
    () => [
      {
        key: "ref",
        header: "Quotation",
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
        cell: (d) => machineOf(d)?.name ?? "",
        filter: { kind: "select", get: (d) => machineOf(d)?.name ?? "" },
      },
      {
        key: "template",
        header: "Template",
        cell: (d) =>
          machineOf(d)?.hasTemplate ? (
            "Ready"
          ) : (
            <span className="font-medium text-ryg-red">none yet</span>
          ),
        sortValue: (d) => (machineOf(d)?.hasTemplate ? 1 : 0),
        filter: { kind: "select", get: (d) => (machineOf(d)?.hasTemplate ? "Ready" : "None yet") },
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
        key: "approved",
        header: "Quotation approved",
        cell: (d) => dmy(d.qaAt),
        sortValue: (d) => d.qaAt ?? "",
        filter: { kind: "date", get: (d) => (d.qaAt ?? "").slice(0, 10) },
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
        <h1 className="text-[20px] font-bold text-navy">Order confirmations to complete</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Quotations management has approved. Everything already agreed carries over — only the
          confirmation's own details are asked for.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="deals"
        emptyTitle="Nothing waiting"
        emptyMessage="A deal lands here once its quotation has been approved."
        initialSort={{ key: "approved", dir: "asc" }}
        exportName="ocpi-order-confirmations-to-complete"
        exportTitle="Order confirmations to complete"
        actions={(d) => (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => nav(`/ocpi/deals/${d.id}/order-confirmation`)}>
              Fill in
            </Button>
          </div>
        )}
      />
    </div>
  );
}
