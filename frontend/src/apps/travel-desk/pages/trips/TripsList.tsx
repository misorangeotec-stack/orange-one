import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import PillToggle from "@/shared/components/ui/PillToggle";
import { useTravelStore } from "../../store";
import TripTable from "../../components/TripTable";
import { OPEN_STATUSES, CLOSED_STATUSES } from "../../types";

/**
 * Every trip in the module.
 *
 * ⚠ THE OPEN / CLOSED TOGGLE IS NOT A FILTER ON THE TABLE, and the difference
 *   matters. A column filter narrows what you are looking at; this decides which
 *   SET you are looking at, and it defaults to Open because a list that opens on
 *   two years of settled trips buries the eleven that need something. Every
 *   column's own filter still cascades within whichever set is showing.
 */
export default function TripsList() {
  const s = useTravelStore();
  const [scope, setScope] = useState<"open" | "closed" | "all">("open");

  const rows = useMemo(() => {
    // A draft belongs to its author, not to a list of the company's trips - it
    // has no number, owes nobody, and is shown under Drafts.
    const visible = s.trips.filter((t) => t.status !== "draft");
    if (scope === "open") return visible.filter((t) => OPEN_STATUSES.includes(t.status));
    if (scope === "closed") return visible.filter((t) => CLOSED_STATUSES.includes(t.status));
    return visible;
  }, [s.trips, scope]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-bold text-navy">All trips</h1>
          <p className="text-[13px] text-grey">
            Every request in the module. Sort or filter on any column; the export carries whatever
            you are looking at.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PillToggle
            value={scope}
            onChange={setScope}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Finished" },
              { value: "all", label: "All" },
            ]}
          />
          {s.canRaise && (
            <Link to="/travel-desk/new">
              <Button>New trip request</Button>
            </Link>
          )}
        </div>
      </div>

      <TripTable
        trips={rows}
        emptyTitle={scope === "open" ? "No open trips" : "Nothing here"}
        emptyMessage={
          scope === "open"
            ? "Every trip raised so far has been settled, cancelled or rejected."
            : "No trip matches this view yet."
        }
        exportName="Travel_Trips"
      />
    </div>
  );
}
