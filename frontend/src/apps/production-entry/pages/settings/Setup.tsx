import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import StepOwnersSection from "./StepOwnersSection";
import MasterOwnersSection from "./MasterOwnersSection";
import CoordinatorsSection from "./CoordinatorsSection";
import StepDueDatesSection from "./StepDueDatesSection";

export default function Setup() {
  const [tab, setTab] = useState("owners");
  const tabs = [
    { key: "owners", label: "Step Owners" },
    { key: "due", label: "Due Dates" },
    { key: "coordinators", label: "Coordinators" },
    { key: "masters", label: "Master Owners" },
  ];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Setup</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Who owns each step, the per-step deadlines, the process coordinators, and who owns each master.
        </p>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "owners" && <StepOwnersSection />}
      {tab === "due" && <StepDueDatesSection />}
      {tab === "coordinators" && <CoordinatorsSection />}
      {tab === "masters" && <MasterOwnersSection />}
    </div>
  );
}
