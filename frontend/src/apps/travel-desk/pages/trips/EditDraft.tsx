import { useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { useTravelStore } from "../../store";
import TripForm from "../../components/TripForm";
import NotFound from "../system/NotFound";

/**
 * Finish a saved draft.
 *
 * ⚠ A DRAFT IS ITS AUTHOR'S. `fms_travel_save_draft` refuses an edit from anyone
 *   but the person who raised it (or a coordinator), and the SELECT policy hides
 *   it from everybody else entirely — so this guard is a courtesy that explains
 *   the refusal rather than the refusal itself.
 *
 * ⚠ A DRAFT **OR A RETURNED TRIP**. Once a trip is submitted its request fields
 *   are locked: the approver is deciding on what they were shown, and letting
 *   the author quietly raise the estimate underneath them would make the
 *   approval meaningless. Returning it is the sanctioned way back in — the trip
 *   keeps its number, the reason rides along, and `fms_travel_decide` cleared
 *   the decision stamp so it comes back to the SAME approver rather than past
 *   them.
 */
export default function EditDraft() {
  const { id } = useParams();
  const s = useTravelStore();
  const trip = s.tripById(id ?? null);

  if (!trip) return <NotFound />;

  if (trip.status !== "draft" && trip.status !== "returned") {
    return (
      <Card className="max-w-2xl p-6">
        <h1 className="text-[18px] font-bold text-navy">
          {trip.tripNo ?? "This trip"} has already been submitted
        </h1>
        <p className="mt-2 text-[13.5px] text-grey">
          Its request can no longer be edited here — the approver is deciding on what they were
          shown. If something is wrong, ask the approver to send it back for clarification; that
          returns it to you with the reason attached and the form open again.
        </p>
      </Card>
    );
  }

  if (trip.raisedBy !== s.userId && !s.isProcessCoordinator) {
    return (
      <Card className="max-w-2xl p-6">
        <h1 className="text-[18px] font-bold text-navy">This request belongs to somebody else</h1>
        <p className="mt-2 text-[13.5px] text-grey">
          An unfinished request is private to the person writing it. It becomes visible to the rest
          of the business when they submit it.
        </p>
      </Card>
    );
  }

  // `key` forces a fresh form when the route moves between drafts: the fields are
  // seeded from props in useState, so a reused instance would keep the old trip's
  // values and silently save them onto this one.
  return <TripForm key={trip.id} draft={trip} />;
}
