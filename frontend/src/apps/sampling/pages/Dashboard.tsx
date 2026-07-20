import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useSamplingStore } from "../store";
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
  const s = useSamplingStore();
  const today = todayLocalIso();

  const count = (...st: RequestStatus[]) => s.requests.filter((r) => st.includes(r.status)).length;
  const open = s.requests.filter((r) => s.isOpenRequest(r)).length;
  const overdue = s.queueEntries.filter((e) => e.dueIso && e.dueIso < today).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{appName("sampling")}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Track ink / raw-material sampling — receive or send a sample, test it, record the result, and close.
          </p>
        </div>
        <Link to="/sampling/requests/new">
          <Button size="sm">Raise a request</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Open requests" value={open} />
        <Tile label="Overdue" value={overdue} tone={overdue ? "text-ryg-red" : "text-navy"} />
        <Tile label="Awaiting movement" value={count("awaiting_receipt", "awaiting_send", "awaiting_confirm")} />
        <Tile label="Awaiting testing" value={count("awaiting_testing")} />
        <Tile label="Awaiting result" value={count("awaiting_result")} />
        <Tile label="Closed" value={count("closed")} tone="text-ryg-green" />
      </div>

      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">How it works</h2>
        <ol className="mt-3 space-y-2 text-[13.5px] text-grey list-decimal list-inside">
          <li>Anyone on the sampling team raises a request and picks its direction.</li>
          <li>Inward: the sample is received, then tested. Outward: the sample is sent and its receipt confirmed, then tested.</li>
          <li>Testing is recorded, then the result is captured — which closes the request.</li>
          <li>There are no approvals, POs or quotations — sampling is movement, testing and result.</li>
        </ol>
      </Card>
    </div>
  );
}
