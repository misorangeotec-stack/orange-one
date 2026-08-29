import StepOwnersSection from "./StepOwnersSection";
import StepDueDatesSection from "./StepDueDatesSection";
import CoordinatorsSection from "./CoordinatorsSection";
import MasterOwnersSection from "./MasterOwnersSection";
import QuotationNumberingSection from "./QuotationNumberingSection";
import OcNumberingSection from "./OcNumberingSection";
import QuotationValiditySection from "./QuotationValiditySection";
import WarrantySection from "./WarrantySection";
import CompanyProfilesSection from "./CompanyProfilesSection";
import EmailNotificationsSection from "./EmailNotificationsSection";

/**
 * OCPI settings.
 *
 * ⚠ THE ORDER IS THE ORDER SOMEBODY SETTING THIS UP NEEDS IT. Who does the work,
 *   then who oversees it, then how long each step gets, then which company the
 *   paper is issued by — and mail last, because it is the only control here that
 *   reaches outside the building the moment it is saved.
 *
 * ⚠ NUMBERING SITS JUST ABOVE THE COMPANY PROFILES, and above mail, because it is
 *   the only setting here that CANNOT BE UNDONE. Everything else on this page can
 *   be changed the day after it is got wrong; a quotation number is on a document
 *   in a customer's hands.
 */
export default function Setup() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Settings</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Who can do what in OCPI, how long each step gets, and what the printed documents say.
        </p>
      </div>

      <StepOwnersSection />
      <CoordinatorsSection />
      <StepDueDatesSection />
      <MasterOwnersSection />
      <QuotationNumberingSection />
      <OcNumberingSection />
      <QuotationValiditySection />
      <WarrantySection />
      <CompanyProfilesSection />
      <EmailNotificationsSection />
    </div>
  );
}
