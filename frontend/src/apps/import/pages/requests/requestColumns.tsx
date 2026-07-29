import { formatDate } from "@/shared/lib/time";
import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import { lineBadge, LINE_STATUS_LABEL } from "../../lib/format";
import type { useImportStore } from "../../store";
import { shipmentLabel } from "../../types";
import type { LineStatus, PurchaseRequest, RequestItem } from "../../types";

/**
 * Shared column set for the two request lists — "All Purchase Requests" and
 * "My Requests". They differ only by the Requester column, so they share one
 * definition rather than a copy: the multi-category rollup below is exactly the
 * kind of logic that goes quietly stale when it lives in two files.
 */

/**
 * A request rolls up to one representative status = its least-advanced / most
 * attention-needing line (the bottleneck). For the common single-line request
 * this is just that line's status.
 */
export const STATUS_PRIORITY: LineStatus[] = ["sourcing", "on_hold", "approval", "approved_pending_po", "po", "rejected", "cancelled"];
export const rollupStatus = (lines: RequestItem[]): LineStatus | null => {
  for (const st of STATUS_PRIORITY) if (lines.some((l) => l.status === st)) return st;
  return null;
};

/** The store interface is not exported; this keeps it that way. */
type Store = ReturnType<typeof useImportStore>;

/** Company label, also used as the group name by both lists. */
export const companyNameOf = (s: Store, id: string) => {
  const co = s.companyById(id);
  return co ? (co.location ? `${co.name} — ${co.location}` : co.name) : "—";
};

export function buildRequestColumns(s: Store, opts: { showRequester: boolean }): QueueColumn<PurchaseRequest>[] {
  const companyName = (id: string) => companyNameOf(s, id);

  /**
   * A request may now span categories, so the header's category (which is just
   * the first line's) is no longer the whole truth. Collect every distinct one
   * its lines carry; lines predating per-line category fall back to the header.
   */
  const categoryNames = (r: PurchaseRequest): string[] => {
    const names = new Set(
      s.itemsForRequest(r.id).map((l) => s.categoryById(l.categoryId ?? r.categoryId)?.name ?? "")
    );
    names.delete("");
    if (names.size === 0) {
      const own = s.categoryById(r.categoryId)?.name;
      if (own) names.add(own);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  };
  /** Compact display: "INK" for one, "INK +2" for a mixed request. */
  const categoryName = (r: PurchaseRequest) => {
    const names = categoryNames(r);
    if (names.length === 0) return "—";
    return names.length === 1 ? names[0]! : `${names[0]} +${names.length - 1}`;
  };
  const requesterName = (r: PurchaseRequest) => s.profileById(r.requesterId)?.name ?? "—";
  const statusOf = (r: PurchaseRequest) => rollupStatus(s.itemsForRequest(r.id));
  const statusLabel = (r: PurchaseRequest) => { const st = statusOf(r); return st ? LINE_STATUS_LABEL[st] : "—"; };

  /** Per-stage breakdown, shown as the Status badge tooltip (useful for multi-line requests). */
  const lineSummary = (requestId: string) => {
    const lines = s.itemsForRequest(requestId);
    const n = (st: string) => lines.filter((l) => l.status === st).length;
    const parts: string[] = [];
    if (n("sourcing")) parts.push(`${n("sourcing")} sourcing`);
    if (n("approval") + n("on_hold")) parts.push(`${n("approval") + n("on_hold")} approval`);
    if (n("approved_pending_po")) parts.push(`${n("approved_pending_po")} pool`);
    if (n("po")) parts.push(`${n("po")} on PO`);
    if (n("rejected")) parts.push(`${n("rejected")} rejected`);
    if (n("cancelled")) parts.push(`${n("cancelled")} cancelled`);
    return parts.join(" · ") || "—";
  };

  return [
    { key: "company", header: "Company", cell: (r) => companyName(r.companyId), sortValue: (r) => companyName(r.companyId), filter: { kind: "select", get: (r) => companyName(r.companyId) }, tdClassName: "whitespace-nowrap" },
    { key: "request", header: "Request No.", cell: (r) => <span className="font-semibold text-navy">{r.requestNo}</span>, sortValue: (r) => r.requestNo, filter: { kind: "text", get: (r) => r.requestNo }, tdClassName: "whitespace-nowrap" },
    // Filter on the FULL list, not the compact label — typing "SPARES" must still
    // find a request where SPARES is only the second category.
    { key: "category", header: "Category", cell: (r) => <span title={categoryNames(r).join(", ")}>{categoryName(r)}</span>, sortValue: (r) => categoryName(r), filter: { kind: "text", get: (r) => categoryNames(r).join(", ") }, tdClassName: "whitespace-nowrap" },
    { key: "items", header: "Items", cell: (r) => s.itemsForRequest(r.id).length, sortValue: (r) => s.itemsForRequest(r.id).length, filter: { kind: "number", get: (r) => s.itemsForRequest(r.id).length } },
    { key: "shipment", header: "Shipment", cell: (r) => shipmentLabel(r.shipmentType), sortValue: (r) => shipmentLabel(r.shipmentType), filter: { kind: "select", get: (r) => shipmentLabel(r.shipmentType) }, tdClassName: "whitespace-nowrap" },
    // On "My Requests" every row is the signed-in user, so the column is dead weight.
    ...(opts.showRequester
      ? [{ key: "requester", header: "Requester", cell: (r: PurchaseRequest) => requesterName(r), sortValue: (r: PurchaseRequest) => requesterName(r), filter: { kind: "select" as const, get: (r: PurchaseRequest) => requesterName(r) }, tdClassName: "whitespace-nowrap" }]
      : []),
    // The date filter wants the sortable ISO day; Excel wants the house dd-mm-yyyy.
    // Without exportValue the export falls back to the filter accessor and ships ISO.
    { key: "created", header: "Created", cell: (r) => formatDate(r.createdAt), sortValue: (r) => r.createdAt, filter: { kind: "date", get: (r) => r.createdAt.slice(0, 10) }, exportValue: (r) => formatDate(r.createdAt), tdClassName: "whitespace-nowrap" },
    {
      key: "status",
      header: "Status",
      cell: (r) => {
        const st = statusOf(r);
        return (
          <span title={lineSummary(r.id)}>
            {st ? <span className={lineBadge(st)}>{LINE_STATUS_LABEL[st]}</span> : <span className="text-grey-2">—</span>}
          </span>
        );
      },
      sortValue: (r) => statusLabel(r),
      filter: { kind: "select", get: (r) => statusLabel(r), options: STATUS_PRIORITY.map((st) => LINE_STATUS_LABEL[st]) },
      tdClassName: "whitespace-nowrap",
    },
  ];
}
