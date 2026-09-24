import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import StepOwnersSection from "./StepOwnersSection";
import ApprovalRulesSection from "./ApprovalRulesSection";
import StepDueDatesSection from "./StepDueDatesSection";
import CoordinatorsSection from "./CoordinatorsSection";
import MasterOwnersSection from "./MasterOwnersSection";

/**
 * Setup — the no-code configuration backbone (admin only), laid out the same way
 * Order to Dispatch and New Recruitment lay theirs out, so an admin who has
 * configured one FMS already knows where to look.
 *
 * ⚠ SEEDING STEP OWNERS IS A GO-LIVE STEP, NOT AN OPTION. Four modules in this
 *   hub shipped with nobody configured and their approvals went nowhere (PF-14).
 *   With no owner on a step, nothing can move past it — except `need_raised`,
 *   where "no owners" deliberately means "anyone may raise".
 *
 * The tabs for nominations, feedback, effectiveness and targets arrive with the
 * phases that use them (LD-3, LD-6, LD-7, LD-8, LD-11). Their config keys are
 * already seeded in the database, so nothing is lost meanwhile — but a tab that
 * edits a setting no screen yet reads would be a control that does nothing, and
 * this module already has enough moving parts.
 */
export default function Setup() {
  const [tab, setTab] = useState("owners");

  const tabs = [
    { key: "owners", label: "Step Owners" },
    { key: "approval", label: "Approval Rules" },
    { key: "due", label: "Due Dates" },
    { key: "coordinators", label: "Coordinators" },
    { key: "masters", label: "Master Owners" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Setup</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Who owns each step, when a second approval is needed, the per-step deadlines, who oversees the
          process, and who owns each master.
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "owners" && <StepOwnersSection />}
      {tab === "approval" && <ApprovalRulesSection />}
      {tab === "due" && <StepDueDatesSection />}
      {tab === "coordinators" && <CoordinatorsSection />}
      {tab === "masters" && <MasterOwnersSection />}
    </div>
  );
}
