import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useImportStore } from "../../store";
import QueueTable from "@/shared/components/ui/QueueTable";
import { buildRequestColumns, companyNameOf } from "./requestColumns";

/** Purchase Requests list — same queue-style per-column filters, grouped by company. */
export default function RequestsList() {
  const s = useImportStore();

  const rows = useMemo(() => [...s.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [s.requests]);

  const companyName = (id: string) => companyNameOf(s, id);
  const columns = buildRequestColumns(s, { showRequester: true });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Purchase Requests</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">Every request and where its items are in the pipeline.</p>
        </div>
        <Link to="/import/requests/new">
          <Button size="sm">+ New Request</Button>
        </Link>
      </div>

      <Card className="p-4">
        <QueueTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          rowsLabel="requests"
          emptyTitle="No requests"
          emptyMessage="Raise a purchase request to get started."
          // Cancel is deliberately NOT here: cancelling a whole multi-line
          // request from a list row, without seeing the lines it takes with it,
          // is a footgun. It lives on the detail page behind a reason prompt.
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
