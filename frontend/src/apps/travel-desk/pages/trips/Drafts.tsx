import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import { useTravelStore } from "../../store";
import TripTable from "../../components/TripTable";

/**
 * Requests started and not yet submitted.
 *
 * ⚠ A DRAFT IS PRIVATE TO ITS AUTHOR AT THE DATABASE, not merely on this screen:
 *   the `fms_travel_trips` SELECT policy hides a draft from everyone but the
 *   person who raised it and an administrator. Somebody's unfinished thinking
 *   about a trip they may not take is not the business's to read.
 *
 * ⚠ AND IT CARRIES NO TRIP NUMBER. Numbers are minted on submit, so an abandoned
 *   draft cannot burn one and the FY sequence has no holes in it.
 */
export default function Drafts() {
  const s = useTravelStore();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-bold text-navy">Drafts</h1>
          <p className="text-[13px] text-grey">
            Yours alone until you submit. No trip number is issued until then, so nothing here has
            reserved one.
          </p>
        </div>
        {s.canRaise && (
          <Link to="/travel-desk/new">
            <Button>New trip request</Button>
          </Link>
        )}
      </div>

      <TripTable
        trips={s.myDrafts}
        rowsLabel="drafts"
        showDue={false}
        emptyTitle="No drafts"
        emptyMessage="A request you save without submitting waits here for you to finish it."
        exportName="Travel_Drafts"
      />
    </div>
  );
}
