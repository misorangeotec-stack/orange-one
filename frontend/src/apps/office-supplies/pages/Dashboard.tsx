import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useSuppliesStore } from "../store";
import type { RequestStatus } from "../types";
import { appName } from "@/apps/appInfo";

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card className="p-4">
      <div className={`text-[26px] font-bold ${tone ?? "text-navy"}`}>{value}</div>
      <div className="text-[12.5px] text-grey-2 mt-0.5">{label}</div>
    </Card>
  );
}

export default function Dashboard() {
  const s = useSuppliesStore();
  const today = todayLocalIso();

  const count = (st: RequestStatus) => s.requests.filter((r) => r.status === st).length;
  const open = s.requests.filter((r) => s.isOpenRequest(r)).length;
  const overdue = s.queueEntries.filter((e) => e.dueIso && e.dueIso < today).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{appName("office-supplies")}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Raise and track office-supply requests — stationery, computer &amp; tech accessories, maintenance and services.
          </p>
        </div>
        <Link to="/office-supplies/requests/new">
          <Button size="sm">Raise a request</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Open requests" value={open} />
        <Tile label="Overdue" value={overdue} tone={overdue ? "text-ryg-red" : "text-navy"} />
        <Tile label="Awaiting first approval" value={count("pending_first_approval")} />
        <Tile label="Awaiting second approval" value={count("pending_second_approval")} />
        <Tile label="Awaiting handover" value={count("pending_handover")} />
        <Tile label="Delivered" value={count("delivered")} tone="text-ryg-green" />
      </div>

      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">How it works</h2>
        <ol className="mt-3 space-y-2 text-[13.5px] text-grey list-decimal list-inside">
          <li>Anyone raises a request (for themselves or on behalf of a colleague).</li>
          <li>Computer &amp; tech accessories go to the department HOD (first approval), then Management (second approval).</li>
          <li>Stationery, office maintenance and services skip approvals and go straight to the handover team.</li>
          <li>The handover team records delivery and closes the request.</li>
        </ol>
      </Card>
    </div>
  );
}
