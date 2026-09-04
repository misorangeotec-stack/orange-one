import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import CustomerOrdersApp from "./CustomerOrdersApp";

/**
 * Orange Order Desk — the only app in the portal whose users do not work here.
 *
 * Two customers punch their own sales orders instead of ringing us to have them
 * typed in. What they place lands in `fms_dispatch_orders` exactly as a staff
 * order does, and everything after that — the credit check, the stock, the bill,
 * the gate, the delivery — is the existing Order to Dispatch flow, untouched.
 *
 * ⚠ THE NAME ON THIS CARD IS THE CUSTOMER-FACING ONE, and every word inside the
 *   app is written for a reader outside the company. Nowhere in it may "Order to
 *   Dispatch", "FMS", "credit check", "gate out" or any other internal step name
 *   appear. See lib/customerLabels.ts, which holds every sentence that is not the
 *   customer's own data.
 *
 * ⚠ IT IS REGISTERED LIKE ANY OTHER MODULE ON PURPOSE, even though no member of
 *   staff will ever use it. Registering is what puts it in the Module Access
 *   matrix and the User form, which is the only way an admin can SEE who holds a
 *   customer login. An unregistered app id would still work as an `app_access`
 *   grant — it would simply be a grant nobody could find, which is exactly the
 *   failure this module was audited for.
 *
 * Admins bypass module checks and will therefore see this card. Opening it is a
 * supported thing to do: with no customer behind the login the app says so and
 * points at Setup, rather than failing.
 */
export const customerOrdersApp: AppManifest = {
  id: "customer-orders",
  name: appName("customer-orders"),
  description:
    "The customer's own screen: they punch their sales order, follow it, and change or cancel it until we start preparing it. Their orders arrive in Order to Dispatch like any other.",
  basePath: appBasePath("customer-orders"),
  status: "live",
  category: appCategory("customer-orders"),
  order: 35,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h2l1.6 9.2a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.3L20 9H7" />
      <circle cx="10" cy="20" r="1.3" />
      <circle cx="17" cy="20" r="1.3" stroke="#FF6A1F" />
      <path d="M13.5 3v4M11.5 5h4" stroke="#FF6A1F" />
    </svg>
  ),
  Component: CustomerOrdersApp,
};
