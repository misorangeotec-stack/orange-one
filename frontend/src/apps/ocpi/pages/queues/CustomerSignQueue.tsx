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
 * Confirmed order confirmations that are out with the customer.
 *
 * ⚠ THIS QUEUE IS THE ONE THING THE PAPER PROCESS HAD NO ANSWER FOR. A
 *   confirmation printed and carried out of the building simply left the system;
 *   whether it came back signed was somebody's memory. So the column that
 *   matters most is how long it has been out, and it sorts oldest first.
 *
 * ⚠ THE ROWS COME FROM THE SHARED QUEUE BUILDER, not from a filter written here,
 *   so this page, the dashboard tile and the cross-FMS scoreboard cannot
 *   disagree about how much is outstanding.
 */
export default function CustomerSignQueue() {
  const s = useOcpiStore();
  const nav = useNavigate();

  const rows = useMemo(() => {
    const ids = new Set(
      s.entries.filter((e) => e.stepKey === "customer_signoff").map((e) => e.dealId),
    );
    return s.deals.filter((d) => ids.has(d.id));
  }, [s.entries, s.deals]);

  const machineName = (id: string | null) => (id ? s.machineById(id)?.name ?? "" : "");

  // The admin-configured target for THIS step, from the anchor step's own
  // timestamp. Null when it cannot be known, which renders as a dash — never as
  // a date the module cannot stand behind.
  const due = (d: OcpiDeal) => dueIsoFor(d, "customer_signoff", s.stepSla);

  /** Whole days since management confirmed it. Null when the stamp is missing. */
  const daysOut = (d: OcpiDeal): number | null => {
    if (!d.ocaAt) return null;
    const ms = Date.now() - new Date(d.ocaAt).getTime();
    return Number.isNaN(ms) ? null : Math.max(0, Math.floor(ms / 86_400_000));
  };

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
        key: "confirmed",
        header: "Confirmed",
        cell: (d) => dmy(d.ocaAt),
        sortValue: (d) => d.ocaAt ?? "",
        filter: { kind: "date", get: (d) => (d.ocaAt ?? "").slice(0, 10) },
      },
      {
        key: "waiting",
        header: "Out for",
        align: "right",
        // Ordered by the number of days, never by the rendered string — "9 days"
        // sorts after "10 days" as text.
        cell: (d) => {
          const n = daysOut(d);
          return n === null ? "—" : n === 0 ? "today" : `${n} ${n === 1 ? "day" : "days"}`;
        },
        sortValue: (d) => daysOut(d) ?? -1,
        filter: { kind: "number", get: (d) => daysOut(d) ?? 0 },
        exportValue: (d) => daysOut(d) ?? "",
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
        <h1 className="text-[20px] font-bold text-navy">Out for customer signature</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Confirmed order confirmations waiting to come back signed. Open one to print it, or to
          file the signed copy.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="order confirmations"
        emptyTitle="Nothing out with a customer"
        emptyMessage="An order confirmation appears here once management has confirmed it."
        initialSort={{ key: "waiting", dir: "desc" }}
        exportName="ocpi-awaiting-customer-signature"
        exportTitle="Awaiting customer signature"
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
