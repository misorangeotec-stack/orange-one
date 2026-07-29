import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import StepOwnersSection from "./StepOwnersSection";
import StepDueDatesSection from "./StepDueDatesSection";
import ReminderLadderSection from "./ReminderLadderSection";
import CoordinatorsSection from "./CoordinatorsSection";
import MasterOwnersSection from "./MasterOwnersSection";
import EmailNotificationsSection from "./EmailNotificationsSection";

const TABS = [
  { key: "owners", label: "Step owners" },
  { key: "due", label: "Step due dates" },
  { key: "ladder", label: "Reminder ladder" },
  { key: "coordinators", label: "Coordinators" },
  { key: "masters", label: "Master owners" },
  { key: "email", label: "Email" },
];

export default function Setup() {
  const [tab, setTab] = useState("owners");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Setup</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Who owns what, how long each step gets, and when the reminders fire.
        </p>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "owners" && <StepOwnersSection />}
      {tab === "due" && <StepDueDatesSection />}
      {tab === "ladder" && <ReminderLadderSection />}
      {tab === "coordinators" && <CoordinatorsSection />}
      {tab === "masters" && <MasterOwnersSection />}
      {tab === "email" && <EmailNotificationsSection />}
    </div>
  );
}
