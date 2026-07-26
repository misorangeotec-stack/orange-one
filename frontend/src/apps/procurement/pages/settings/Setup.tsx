import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import StepOwnersSection from "./StepOwnersSection";
import StepDueDatesSection from "./StepDueDatesSection";
import ApprovalMatrixSection from "./ApprovalMatrixSection";
import CoordinatorsSection from "./CoordinatorsSection";
import MasterOwnersSection from "./MasterOwnersSection";
import EmailNotificationsSection from "./EmailNotificationsSection";

/**
 * Setup — the no-code configuration backbone (admin only). Wire up step owners,
 * each step's due date, the amount-tiered approval matrix, the process
 * coordinators, and who owns each master (and so reviews its new-entry requests).
 */
export default function Setup() {
  const [tab, setTab] = useState("owners");

  const tabs = [
    { key: "owners", label: "Step Owners" },
    { key: "sla", label: "Due Dates" },
    { key: "approval", label: "Approval Matrix" },
    { key: "roles", label: "Coordinators" },
    { key: "masters", label: "Master Owners" },
    { key: "notifications", label: "Notifications" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Setup</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Wire up the workflow without code — who owns each step, when each step falls due, how approvals route by
          value, who oversees the whole process, and who owns each master.
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "owners" && <StepOwnersSection />}
      {tab === "sla" && <StepDueDatesSection />}
      {tab === "approval" && <ApprovalMatrixSection />}
      {tab === "roles" && <CoordinatorsSection />}
      {tab === "masters" && <MasterOwnersSection />}
      {tab === "notifications" && <EmailNotificationsSection />}
    </div>
  );
}
