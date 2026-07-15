import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import StepOwnersSection from "./StepOwnersSection";
import StepDueDatesSection from "./StepDueDatesSection";
import CoordinatorsSection from "./CoordinatorsSection";
import MasterOwnersSection from "./MasterOwnersSection";
import PolicySection from "./PolicySection";

/**
 * Setup — the no-code configuration backbone (admin only). Wire up who owns each
 * step, when each step falls due, who oversees the process, the two policy numbers the
 * workflow keys off (the payroll cut-off and the default notice period), and who owns
 * each master (and so reviews its new-entry requests).
 *
 * The masters themselves — including the clearance checklist, which is where a 9th
 * department gets added without a migration — are edited on their own Masters page,
 * which their owners can reach WITHOUT being admins.
 */
export default function Setup() {
  const [tab, setTab] = useState("owners");

  const tabs = [
    { key: "owners", label: "Step Owners" },
    { key: "sla", label: "Due Dates" },
    { key: "roles", label: "Coordinators" },
    { key: "masters", label: "Master Owners" },
    { key: "policy", label: "Policy" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Setup</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Wire up the exit process without code — who owns each step, when each step falls due, who oversees it, and the
          payroll and notice-period rules it runs on.
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "owners" && <StepOwnersSection />}
      {tab === "sla" && <StepDueDatesSection />}
      {tab === "roles" && <CoordinatorsSection />}
      {tab === "masters" && <MasterOwnersSection />}
      {tab === "policy" && <PolicySection />}
    </div>
  );
}
