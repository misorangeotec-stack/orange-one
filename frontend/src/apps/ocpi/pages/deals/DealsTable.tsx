import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { useOcpiStore } from "../../store";
import { deleteDraft as deleteDraftWrite } from "../../data/ocpiWrites";
import { dealRef } from "../../lib/queues";
import { STATUS_LABEL } from "../../lib/format";
import type { OcpiDeal } from "../../types";

/**
 * One table, three lists. All Deals, My Deals and Drafts differ only in which
 * rows they are handed, so they share this and cannot drift apart in their
 * columns, sorting or export.
 *
 * ⚠ EVERY COLUMN SORTS AND FILTERS. That is the house rule for any grid in this
 *   portal, not a per-screen decision, and QueueTable gives both from the
 *   declarations below. `sortValue` is set wherever the rendered text is the
 *   wrong thing to order by — a formatted amount, a date, a status badge.
 *
 * ⚠ FLAT, NO `groupBy`. Grouping would make the group name the primary sort, so
 *   a list ordered by value would only be ordered WITHIN each band and the
 *   biggest deal could hide mid-page. Status and salesperson are ordinary
 *   filterable columns instead.
 */
export default function DealsTable({
  rows,
  emptyTitle,
  emptyMessage,
  showDelete,
}: {
  rows: OcpiDeal[];
  emptyTitle: string;
  emptyMessage: string;
  /** Drafts can be binned; nothing else can — a submitted quotation is cancelled. */
  showDelete?: boolean;
}) {
  const s = useOcpiStore();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState<OcpiDeal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const machineName = (id: string | null) => (id ? s.machineById(id)?.name ?? "" : "");

  const money = (d: OcpiDeal): string => {
    if (d.dealValueAmount === null) return "";
    const n = d.dealValueAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    return `${d.dealValueCurrency === "USD" ? "$" : "₹"} ${n}`;
  };

  const columns = useMemo<QueueColumn<OcpiDeal>[]>(
    () => [
      {
        key: "ref",
        header: "Reference",
        cell: (d) => (
          <Link
            to={d.status === "draft" ? `/ocpi/deals/${d.id}/edit` : `/ocpi/deals/${d.id}`}
            className="font-semibold text-navy hover:text-orange hover:underline"
          >
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
        cell: (d) => money(d),
        // Ordered by the NUMBER, not by the rendered string — otherwise "₹ 9" sorts
        // above "₹ 10" and a currency symbol decides the ranking.
        sortValue: (d) => d.dealValueAmount ?? -1,
        filter: { kind: "number", get: (d) => d.dealValueAmount ?? 0 },
        exportValue: (d) => d.dealValueAmount ?? "",
      },
      {
        key: "currency",
        header: "Ccy",
        cell: (d) => d.dealValueCurrency ?? "",
        filter: { kind: "select", get: (d) => d.dealValueCurrency ?? "" },
        defaultHidden: true,
      },
      {
        key: "status",
        header: "Status",
        cell: (d) => STATUS_LABEL[d.status],
        sortValue: (d) => STATUS_LABEL[d.status],
        filter: { kind: "select", get: (d) => STATUS_LABEL[d.status] },
      },
      {
        key: "created",
        header: "Raised",
        cell: (d) => new Date(d.createdAt).toLocaleDateString("en-IN"),
        sortValue: (d) => d.createdAt,
        filter: { kind: "date", get: (d) => d.createdAt.slice(0, 10) },
      },
    ],
    [s.machines],
  );

  async function doDelete() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDraftWrite(confirm.id);
      await s.refresh();
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <QueueTable
        rows={rows}
        rowKey={(d) => d.id}
        columns={columns}
        loading={s.isLoading}
        rowsLabel="quotations"
        emptyTitle={emptyTitle}
        emptyMessage={emptyMessage}
        initialSort={{ key: "created", dir: "desc" }}
        exportName="ocpi-deals"
        exportTitle="OCPI deals"
        actions={
          showDelete
            ? (d) => (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => nav(`/ocpi/deals/${d.id}/edit`)}>
                    Open
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(d)}>
                    Delete
                  </Button>
                </div>
              )
            : undefined
        }
      />

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete this draft?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
              Keep it
            </Button>
            <Button onClick={() => void doDelete()} disabled={busy}>
              {busy ? "Deleting…" : "Delete draft"}
            </Button>
          </div>
        }
      >
        <p className="text-[13.5px] text-grey">
          {confirm ? `“${dealRef(confirm)}” will be removed. ` : ""}
          Nothing was issued to the customer — a draft carries no quotation number — so there is
          nothing to withdraw. This cannot be undone.
        </p>
        {error && <p className="mt-2 text-[13px] text-ryg-red">{error}</p>}
      </Modal>
    </>
  );
}
