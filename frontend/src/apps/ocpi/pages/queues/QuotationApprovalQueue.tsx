import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { useOcpiStore } from "../../store";
import ApprovalPanel from "../../components/ApprovalPanel";
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
export default function QuotationApprovalQueue() {
  const s = useOcpiStore();
  const [deciding, setDeciding] = useState<OcpiDeal | null>(null);

  const rows = useMemo(() => {
    const ids = new Set(s.entries.filter((e) => e.stepKey === "quotation_approval").map((e) => e.dealId));
    return s.deals.filter((d) => ids.has(d.id));
  }, [s.entries, s.deals]);

  const machineName = (id: string | null) => (id ? s.machineById(id)?.name ?? "" : "");

  // The admin-configured target for THIS step, from the anchor step's own
  // timestamp. Null when it cannot be known, which renders as a dash — never as
  // a date the module cannot stand behind.
  const due = (d: OcpiDeal) => dueIsoFor(d, "quotation_approval", s.stepSla);

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
        key: "rev",
        header: "Version",
        cell: (d) => (d.quotationVersionNo > 1 ? `Rev ${d.quotationVersionNo - 1}` : "Original"),
        sortValue: (d) => d.quotationVersionNo,
        filter: { kind: "select", get: (d) => (d.quotationVersionNo > 1 ? `Rev ${d.quotationVersionNo - 1}` : "Original") },
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
        <h1 className="text-[20px] font-bold text-navy">Approve quotations</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Quotations the salesperson has marked final. Approving turns the papers this deal
          already carries into the order confirmation, and sends it for the customer&rsquo;s
          signature.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="quotations"
        emptyTitle="Nothing waiting"
        emptyMessage="Quotations appear here once a salesperson has generated one and marked it final."
        initialSort={{ key: "raised", dir: "asc" }}
        exportName="ocpi-quotations-awaiting-approval"
        exportTitle="Quotations awaiting approval"
        actions={(d) => (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setDeciding(d)}>
              Review
            </Button>
          </div>
        )}
      />

      {/*
        ⚠ THE WIDEST DIALOG THERE IS, because this one holds a CONTRACT. At the
          default width the papers were read through a column narrower than the
          page they render — the reviewer scrolled a portrait document inside a
          portrait dialog inside a portrait scroll, and could not take in a
          table row without panning. Approving is the decision this module
          exists for; it does not get the same dialog as a confirm prompt.
      */}
      <Modal
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title={deciding ? dealRef(deciding) : ""}
        size="2xl"
        mobileFull
      >
        {deciding && (
          <div className="space-y-3">
            <p className="text-[13.5px] text-grey">
              {deciding.customerName} · {machineName(deciding.machineId)} ·{" "}
              {fmtDealValue(deciding.dealValueAmount, deciding.dealValueCurrency)}
            </p>
            <p className="text-[13px] text-grey-2">
              <Link
                to={`/ocpi/deals/${deciding.id}`}
                className="font-semibold text-orange hover:underline"
              >
                Open the full quotation
              </Link>{" "}
              to read every answer before deciding.
            </p>
            <ApprovalPanel deal={deciding} inDialog />
          </div>
        )}
      </Modal>
    </div>
  );
}
