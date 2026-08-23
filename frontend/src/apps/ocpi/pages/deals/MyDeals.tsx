import { useMemo } from "react";
import { useOcpiStore } from "../../store";
import DealsTable from "./DealsTable";

/**
 * The quotations that are this person's.
 *
 * ⚠ "MINE" MEANS TWO THINGS, AND BOTH COUNT. A deal is yours if you RAISED it,
 *   or if it carries the Tally salesperson name you are tagged with. A sales
 *   coordinator often raises the quotation while the deal belongs to the rep, so
 *   reading only `raised_by` would empty the rep's list and double-count the
 *   coordinator's.
 */
export default function MyDeals() {
  const s = useOcpiStore();
  const rows = useMemo(() => {
    const tags = new Set(s.salespersonTags);
    return s.deals.filter(
      (d) =>
        d.status !== "draft" &&
        (d.raisedBy === s.userId || (d.salespersonName ? tags.has(d.salespersonName) : false)),
    );
  }, [s.deals, s.salespersonTags, s.userId]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">My deals</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Quotations you raised, plus any carrying your salesperson name.
        </p>
      </div>
      <DealsTable
        rows={rows}
        emptyTitle="Nothing of yours yet"
        emptyMessage="Quotations you raise — or that carry your salesperson name — appear here once finalised."
      />
    </div>
  );
}
