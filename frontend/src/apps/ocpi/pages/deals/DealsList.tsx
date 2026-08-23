import { useMemo } from "react";
import { useOcpiStore } from "../../store";
import DealsTable from "./DealsTable";

/**
 * Every quotation this person may see.
 *
 * ⚠ DRAFTS ARE EXCLUDED, and not merely for tidiness: a draft is private to its
 *   author, so this list would show a coordinator or an admin somebody else's
 *   unfinished thinking alongside real quotations. Drafts have their own screen.
 */
export default function DealsList() {
  const s = useOcpiStore();
  const rows = useMemo(() => s.deals.filter((d) => d.status !== "draft"), [s.deals]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">All deals</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Every quotation and order confirmation you can see.
        </p>
      </div>
      <DealsTable
        rows={rows}
        emptyTitle="No quotations yet"
        emptyMessage="A quotation appears here once it has been finalised. Drafts stay on the Drafts screen until then."
      />
    </div>
  );
}
