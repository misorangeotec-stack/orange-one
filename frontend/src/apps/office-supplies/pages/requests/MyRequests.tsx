import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { formatDate } from "@/shared/lib/time";
import StatusPill from "../../components/StatusPill";
import { requestTypeLabel } from "../../lib/format";
import { useSuppliesStore } from "../../store";

/** The requests I raised or am the beneficiary of. */
export default function MyRequests() {
  const s = useSuppliesStore();
  const rows = [...s.myRequests].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const pg = usePagination(rows, {});

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">My Requests</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">Requests you raised, or that were raised for you.</p>
        </div>
        <Link to="/office-supplies/requests/new">
          <Button size="sm">Raise a request</Button>
        </Link>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title="No requests yet"
            message="You haven't raised any supply requests."
            actionLabel="Raise a request"
            onAction={() => {
              window.location.assign("/office-supplies/requests/new");
            }}
          />
        ) : (
          <>
            <ScrollableTable>
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-left text-grey-2 border-b border-line">
                    <th className="font-medium px-4 py-3">Request</th>
                    <th className="font-medium px-4 py-3">Item / Service</th>
                    <th className="font-medium px-4 py-3">Type</th>
                    <th className="font-medium px-4 py-3">Qty</th>
                    <th className="font-medium px-4 py-3">Status</th>
                    <th className="font-medium px-4 py-3">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((r) => (
                    <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link to={`/office-supplies/requests/${r.id}`} className="font-semibold text-navy hover:text-orange">
                          {r.reqNo}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-navy">{r.itemName ?? "—"}</td>
                      <td className="px-4 py-3 text-grey-2">{requestTypeLabel(r.requestType)}</td>
                      <td className="px-4 py-3 text-grey-2">{r.quantity}</td>
                      <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                      <td className="px-4 py-3 text-grey-2 whitespace-nowrap">{formatDate(r.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
            <Pagination state={pg} rowsLabel="requests" />
          </>
        )}
      </Card>
    </div>
  );
}
