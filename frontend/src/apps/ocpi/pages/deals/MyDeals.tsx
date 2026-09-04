import { useMemo } from "react";
import { useOcpiStore } from "../../store";
import DealsTable from "./DealsTable";

/**
 * The quotations that are this person's.
 *
 * ⚠ "MINE" MEANS THREE THINGS, AND ALL THREE COUNT. A deal is yours if you
 *   RAISED it, if you are the USER named as its salesperson, or — for deals
 *   raised before the salesperson became a user — if it carries the Tally
 *   salesperson name you are tagged with. A sales coordinator often raises the
 *   quotation while the deal belongs to the rep, so reading only `raised_by`
 *   would empty the rep's list and double-count the coordinator's.
 *
 * ⚠ THE TAG ARM IS A LEGACY FALLBACK AND MATCHES NOTHING TODAY, which is the
 *   reason the user arm exists. `receivables_salespersons` holds Tally strings
 *   ("UMESH JI", "NAKUL JI"); `salesperson_name` holds portal names
 *   ("UMESHKUMAR SOLANKI"). The two vocabularies never met, so this screen was
 *   empty for everyone whose deals they had not personally raised. It is kept
 *   because a deal typed with a tag string would still be theirs, and removing
 *   it could only take rows away.
 */
export default function MyDeals() {
  const s = useOcpiStore();
  const rows = useMemo(() => {
    const tags = new Set(s.salespersonTags);
    /*
      🔴 "HAS A NUMBER", NOT "IS NOT A DRAFT". This read `d.status !== "draft"`,
         and since OCPI-36 a deal keeps that status until it is SENT for approval
         — so a salesperson's own generated quotations, numbered and PDF'd and
         possibly already with the customer, were missing from their own list. A
         rep with three live quotations read "Nothing of yours yet". Found by the
         OCPI-40 re-audit, on the three deals typed in that day.

      ⚠ A NEVER-GENERATED DRAFT STILL STAYS OUT, and belongs only on Drafts —
        that is what `quotationNo` being null means and why it is the test.
    */
    return s.deals.filter(
      (d) =>
        (d.status !== "draft" || !!d.quotationNo) &&
        (d.raisedBy === s.userId ||
          (d.salespersonUserId ? d.salespersonUserId === s.userId : false) ||
          (d.salespersonName ? tags.has(d.salespersonName) : false)),
    );
  }, [s.deals, s.salespersonTags, s.userId]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">My deals</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Quotations you raised, plus any carrying your salesperson name — from the moment they
          are generated.
        </p>
      </div>
      <DealsTable
        rows={rows}
        emptyTitle="Nothing of yours yet"
        emptyMessage="Quotations you raise — or that carry your salesperson name — appear here once generated."
      />
    </div>
  );
}
