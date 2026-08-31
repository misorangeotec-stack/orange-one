import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import { useTravelStore } from "../../store";
import TripTable from "../../components/TripTable";

/**
 * The trips this person is travelling on, or filed for somebody else.
 *
 * Drafts are deliberately NOT here — they have their own destination, because a
 * draft is the one thing a traveller comes back to finish and burying it among
 * submitted trips is how it gets forgotten.
 */
export default function MyTrips() {
  const s = useTravelStore();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-bold text-navy">My trips</h1>
          <p className="text-[13px] text-grey">
            What is awaiting approval, what is booked, and what claim is now due.
          </p>
        </div>
        {s.canRaise && (
          <Link to="/travel-desk/new">
            <Button>New trip request</Button>
          </Link>
        )}
      </div>

      <TripTable
        trips={s.myTrips}
        emptyTitle="You have no trips yet"
        emptyMessage="Raise a request and it will appear here with its state and what is owed next."
        exportName="My_Travel_Trips"
      />
    </div>
  );
}
