import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useImportStore } from "../../store";
import QueueTable from "@/shared/components/ui/QueueTable";
import { buildRequestColumns, companyNameOf } from "./requestColumns";

/** The purchase requests I raised — same table as the all-list, minus Requester. */
export default function MyRequests() {
  const s = useImportStore();

  const rows = useMemo(() => [...s.myRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [s.myRequests]);

  const companyName = (id: string) => companyNameOf(s, id);
  const columns = buildRequestColumns(s, { showRequester: false });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-navy">My Purchase Requests</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">Purchase requests you raised.</p>
        </div>
        {s.canEdit && (
          <Link to="/import/requests/new">
            <Button size="sm">+ New Request</Button>
          </Link>
        )}
      </div>

      <Card className="p-4">
        <QueueTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          initialSort={{ key: "created", dir: "desc" }}
          rowsLabel="requests"
          exportName="My_Import_Purchase_Requests"
          emptyTitle="No requests yet"
          emptyMessage="You haven't raised any purchase requests."
          // Edit stays gated on canEditRequest, NOT on "it's mine": the request
          // must also still be open with nothing sourced, and the RPC authorises
          // against the real auth.uid().
          actions={(r) => (
            <>
              <Link to={`/import/requests/${r.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">View</Link>
              {s.canEditRequest(r) && (
                <Link to={`/import/requests/${r.id}/edit`} className="text-[12.5px] font-semibold text-grey hover:text-navy ml-3">Edit</Link>
              )}
            </>
          )}
        />
      </Card>
    </div>
  );
}
