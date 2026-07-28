/**
 * Route-level layout for the Customer Creation module.
 *
 * Exists solely to mount the provider HERE rather than in ReceivablesHubApp:
 * the module's snapshot then loads on /customer-onboarding/* only, and the
 * hub's other forty pages never pay for a query they don't read.
 */
import { Outlet } from "react-router-dom";
import { CustomerOnboardingProvider } from "@hub/lib/customerOnboarding/store";

export default function CustomerOnboardingLayout() {
  return (
    <CustomerOnboardingProvider>
      <Outlet />
    </CustomerOnboardingProvider>
  );
}
