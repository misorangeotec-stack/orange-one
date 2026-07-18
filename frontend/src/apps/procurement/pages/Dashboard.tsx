import Card from "@/shared/components/ui/Card";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { useSandbox } from "@/shared/sandbox/SandboxContext";
import SandboxDashboard from "../sandbox/SandboxDashboard";
import { appName } from "@/apps/appInfo";

/**
 * Procurement home. In demo mode this becomes the per-persona SandboxDashboard
 * (your queues + notifications). A richer KPI dashboard for the live app lands
 * in a later phase; this static welcome is the default surface for now.
 */
export default function Dashboard() {
  const { user } = useEffectiveIdentity();
  const { active } = useSandbox();
  if (active) return <SandboxDashboard />;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{appName("procurement")}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}. Raise purchase requests and track them through
          sourcing, approval, PO, receipt and payment.
        </p>
      </div>
      <Card className="p-6">
        <p className="text-[13.5px] text-grey-2">
          This workspace is being rolled out stage by stage. Start with{" "}
          <span className="font-semibold text-navy">New Request</span> to raise a requirement; admins can set up the
          masters and approval matrix under <span className="font-semibold text-navy">Masters</span> and{" "}
          <span className="font-semibold text-navy">Setup</span>.
        </p>
      </Card>
    </div>
  );
}
