import { useMemo } from "react";
import { useOcpiStore } from "../../store";
import DealsTable from "./DealsTable";

/**
 * Every quotation this person may see.
 *
 * ⚠ UNSTARTED DRAFTS ARE EXCLUDED — not merely for tidiness: a draft is private
 *   to its author, so this list would show a coordinator or an admin somebody
 *   else's unfinished thinking alongside real quotations. Drafts have their own
 *   screen.
 *
 * 🔴 BUT "DRAFT" NO LONGER MEANS "UNFINISHED". This filter read
 *    `status !== "draft"`, and since OCPI-36 a deal keeps that status after
 *    Generate — so a quotation carrying `QT-M0055`, `OTPL/OC/10/26-27` and three
 *    PDFs already sent to the customer was absent from ALL DEALS entirely. A
 *    coordinator asked "what did we send Shree Ram?" could not find it. The test
 *    is now whether a number was issued, which is what "unfinished" actually
 *    means. Found by the OCPI-40 re-audit.
 *
 * ⚠ NOTHING LEAKS. RLS already hides another person's drafts, so widening the
 *   filter cannot show a row the reader was not entitled to.
 */
export default function DealsList() {
  const s = useOcpiStore();
  const rows = useMemo(
    () => s.deals.filter((d) => d.status !== "draft" || !!d.quotationNo),
    [s.deals],
  );

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
        emptyMessage="A quotation appears here once it has been generated. Drafts you have not generated yet stay on the Drafts screen."
      />
    </div>
  );
}
