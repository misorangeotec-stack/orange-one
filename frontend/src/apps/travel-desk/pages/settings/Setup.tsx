import MasterOwnersSection from "./MasterOwnersSection";
import StepOwnersSection from "./StepOwnersSection";
import CoordinatorsSection from "./CoordinatorsSection";
import ReassignmentSection from "./ReassignmentSection";
import ApprovalMatrixSection from "./ApprovalMatrixSection";
import StepDueDatesSection from "./StepDueDatesSection";
import PolicySection from "./PolicySection";
import EmailNotificationsSection from "./EmailNotificationsSection";

/**
 * Travel Desk settings.
 *
 * ⚠ THE ORDER IS WHO → WHEN → WHAT → WHETHER TO MAIL, and it is deliberate.
 *   Naming the people is the only setting without which the module does not
 *   work at all — a step with no owner is a queue nobody can action. The due
 *   dates and the policy numbers change how it behaves; the email switch changes
 *   who hears about it, and it is last because turning it on is a live send.
 */
export default function Setup() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Travel Desk settings</h1>
        <p className="mt-1 max-w-3xl text-[13.5px] text-grey-2">
          Who owns what, and the numbers the policy runs on. The <strong>rates</strong> — hotel
          caps, daily allowance, mileage — are not here: they live on the effective-dated rate
          card, because a Director signs those off and January&rsquo;s revision replaces them
          wholesale.
        </p>
      </div>

      <StepOwnersSection />
      {/* Directly under Step Owners: this is the same question - who owes the
          work - asked for one trip instead of for the module. */}
      <ReassignmentSection />
      <CoordinatorsSection />
      <ApprovalMatrixSection />
      <MasterOwnersSection />
      <StepDueDatesSection />
      <PolicySection />
      <EmailNotificationsSection />
    </div>
  );
}
