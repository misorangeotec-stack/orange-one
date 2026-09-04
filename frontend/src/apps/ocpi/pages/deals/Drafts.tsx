import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import { useOcpiStore } from "../../store";
import DealsTable from "./DealsTable";

/**
 * Unfinished quotations.
 *
 * ⚠ ITS OWN SCREEN, NOT A FILTER ON THE LIST. A draft is the one thing a
 *   salesperson comes back to finish, and it is private to them — burying it
 *   behind a filter on a shared list is how it gets forgotten. RLS already
 *   restricts these rows to their author (and admins), so this filter is a
 *   convenience, not the boundary.
 */
export default function Drafts() {
  const s = useOcpiStore();
  const nav = useNavigate();
  const rows = useMemo(() => s.deals.filter((d) => d.status === "draft"), [s.deals]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">Drafts</h1>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            Only you can see these. Both numbers are issued the moment you press Generate, and
            they are not given back.
          </p>
        </div>
        {s.canRaise && <Button onClick={() => nav("/ocpi/new")}>New quotation</Button>}
      </div>
      <DealsTable
        rows={rows}
        showDelete
        emptyTitle="No drafts"
        emptyMessage="Start a quotation and save it at any point — even with most of it still blank — and it will wait here."
      />
    </div>
  );
}
