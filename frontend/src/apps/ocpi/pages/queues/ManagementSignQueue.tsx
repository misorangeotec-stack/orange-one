import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import { useOcpiStore } from "../../store";
import DueCell from "@/shared/components/ui/DueCell";
import { dealRef, dueIsoFor } from "../../lib/queues";
import { signedPages } from "../../lib/signatures";
import { dmy, fmtDealValue } from "../../lib/format";
import type { OcpiDeal } from "../../types";

/**
 * Signed by the customer, waiting to be countersigned.
 *
 * ⚠ THE PAGE COUNT IS A COLUMN, and it earns its place. The order confirmation
 *   runs to several pages; a row showing one page against a five-page contract
 *   is the fastest way to spot a scan that was cut short, before anybody
 *   countersigns it.
 */
export default function ManagementSignQueue() {
  const s = useOcpiStore();
  const nav = useNavigate();

  const rows = useMemo(() => {
    const ids = new Set(
      s.entries.filter((e) => e.stepKey === "management_signoff").map((e) => e.dealId),
    );
    return s.deals.filter((d) => ids.has(d.id));
  }, [s.entries, s.deals]);

  const machineName = (id: string | null) => (id ? s.machineById(id)?.name ?? "" : "");

  // The admin-configured target for THIS step, from the anchor step's own
  // timestamp. Null when it cannot be known, which renders as a dash — never as
  // a date the module cannot stand behind.
  const due = (d: OcpiDeal) => dueIsoFor(d, "management_signoff", s.stepSla);
  const pageCount = (d: OcpiDeal) => signedPages(d, "customer-signed").length;

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
        key: "signed",
        header: "Signed on",
        cell: (d) => dmy(d.csAt),
        sortValue: (d) => d.csAt ?? "",
        filter: { kind: "date", get: (d) => (d.csAt ?? "").slice(0, 10) },
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
        key: "returned",
        header: "Sent back before",
        cell: (d) => (d.reworkCount > 0 ? `${d.reworkCount}×` : "—"),
        sortValue: (d) => d.reworkCount,
        filter: { kind: "select", get: (d) => (d.reworkCount > 0 ? `${d.reworkCount}×` : "No") },
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
        <h1 className="text-[20px] font-bold text-navy">Countersign order confirmations</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Signed by the customer and waiting on management. Countersigning completes the deal.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="order confirmations"
        emptyTitle="Nothing to countersign"
        emptyMessage="An order confirmation appears here once the salesperson files the customer-signed copy."
        initialSort={{ key: "signed", dir: "asc" }}
        exportName="ocpi-awaiting-countersignature"
        exportTitle="Awaiting countersignature"
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
