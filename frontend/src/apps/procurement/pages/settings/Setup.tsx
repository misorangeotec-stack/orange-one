import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import StepOwnersSection from "./StepOwnersSection";
import ApprovalMatrixSection from "./ApprovalMatrixSection";
import CoordinatorsSection from "./CoordinatorsSection";

/**
 * Setup — the no-code configuration backbone (admin only). Wire up step owners,
 * the amount-tiered approval matrix, and the process coordinators. Master
 * managers live under Masters → Managers.
 */
export default function Setup() {
  const [tab, setTab] = useState("owners");

  const tabs = [
    { key: "owners", label: "Step Owners" },
    { key: "approval", label: "Approval Matrix" },
    { key: "roles", label: "Coordinators" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Setup</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Wire up the workflow without code — who owns each step, how approvals route by value, and who oversees the
          whole process.
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "owners" && <StepOwnersSection />}
      {tab === "approval" && <ApprovalMatrixSection />}
      {tab === "roles" && <CoordinatorsSection />}
    </div>
  );
}
