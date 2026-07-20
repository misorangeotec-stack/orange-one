import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useProductionStore } from "../store";
import type { ProductionStatus } from "../types";
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
  const s = useProductionStore();
  const today = todayLocalIso();

  const count = (...st: ProductionStatus[]) => s.requests.filter((r) => st.includes(r.status)).length;
  const open = s.requests.filter((r) => s.isOpenRequest(r)).length;
  const overdue = s.queueEntries.filter((e) => e.dueIso && e.dueIso < today).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{appName("production-entry")}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Track ink production job cards end to end — from the issue slip through to finished-good transfer to Hojiwala.
          </p>
        </div>
        <Link to="/production-entry/requests/new">
          <Button size="sm">Generate issue slip</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Open job cards" value={open} />
        <Tile label="Overdue" value={overdue} tone={overdue ? "text-ryg-red" : "text-navy"} />
        <Tile label="In production" value={count("awaiting_production")} />
        <Tile label="In quality / testing" value={count("awaiting_quality", "awaiting_mc_testing")} />
        <Tile label="In packing" value={count("awaiting_pm_handover", "awaiting_pm_transfer", "awaiting_packing")} />
        <Tile label="Closed" value={count("closed")} tone="text-ryg-green" />
      </div>

      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">How it works</h2>
        <ol className="mt-3 space-y-2 text-[13.5px] text-grey list-decimal list-inside">
          <li>The production team raises an issue slip (job card).</li>
          <li>Material is handed over, a transfer slip &amp; batch card are created, and production is entered.</li>
          <li>Quality checking and M/C testing follow, then packing-material handover, transfer and the packing entry.</li>
          <li>The finished good is transferred to Hojiwala — which closes the job card.</li>
        </ol>
      </Card>
    </div>
  );
}
