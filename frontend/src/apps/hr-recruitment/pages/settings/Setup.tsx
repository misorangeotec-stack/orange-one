import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import StepOwnersSection from "./StepOwnersSection";
import StepDueDatesSection from "./StepDueDatesSection";
import CoordinatorsSection from "./CoordinatorsSection";
import SalaryVisibilitySection from "./SalaryVisibilitySection";
import MasterOwnersSection from "./MasterOwnersSection";

/**
 * Setup — the no-code configuration backbone (admin only). Wire up who owns each
 * step, when each step falls due, who oversees the process, and who owns each
 * master (and so reviews its new-entry requests). The masters themselves are
 * edited on their own Masters page, which their owners can reach without being
 * admins.
 *
 * There is deliberately no Approval Matrix tab: HR approval is a fixed two-stage
 * gate (HR Head → Management) resolved by step ownership, with no amount bands.
 */
export default function Setup() {
  const [tab, setTab] = useState("owners");

  const tabs = [
    { key: "owners", label: "Step Owners" },
    { key: "sla", label: "Due Dates" },
    { key: "roles", label: "Coordinators" },
    { key: "salary", label: "Salary Visibility" },
    { key: "masters", label: "Master Owners" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Setup</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Wire up recruitment without code — who owns each step, when each step falls due, who oversees the process, and
          who owns each master.
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "owners" && <StepOwnersSection />}
      {tab === "sla" && <StepDueDatesSection />}
      {tab === "roles" && <CoordinatorsSection />}
      {tab === "salary" && <SalaryVisibilitySection />}
      {tab === "masters" && <MasterOwnersSection />}
    </div>
  );
}
