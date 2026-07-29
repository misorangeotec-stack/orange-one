import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import OrderToDispatchApp from "./OrderToDispatchApp";

/**
 * Manifest for the Order to Dispatch FMS — the eighth FMS module, built on the
 * same engine pattern as the others (step owners, planned-vs-actual due dates,
 * per-owner queues, notifications, master governance) with its own
 * `fms_dispatch_*` schema.
 *
 * The sales-side journey: a customer order is raised → the collection team
 * approves the credit limit (or holds the order) → the store keeper records what
 * is actually going out, line by line, with its LOT → the sales bill is raised →
 * the gate register records it leaving → delivery is confirmed. NO approval,
 * NO PO, NO quotations.
 *
 * IT REPEATS. If only part of the order could be sent, the balance stays pending
 * and the order returns to the stock check as the next ROUND — its own invoice,
 * its own gate outward number, its own delivery confirmation. The order closes
 * when nothing is owed. See supabase/migrations/20260810120000 for the two rules
 * that keep that honest.
 *
 * It picks up where Production Entry ends: that module closes at "FG Transfer to
 * Godown", and this one takes the goods from the godown to the customer.
 *
 * PER-USER-GRANTED (not universal) — an admin switches it on for the sales,
 * stores, accounts and plant teams. The nav and RLS scope what each person sees.
 */
export const orderToDispatchApp: AppManifest = {
  id: "order-to-dispatch",
  name: appName("order-to-dispatch"),
  description:
    "Customer order to delivery end to end: approve credit, record what is going out with its LOT, raise the sales bill, write the gate outward entry and confirm the delivery. Ships partially and comes back for the balance.",
  basePath: appBasePath("order-to-dispatch"),
  status: "live",
  category: appCategory("order-to-dispatch"),
  subGroup: appSubGroup("order-to-dispatch"),
  order: 46,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5h10.5v8H3z" />
      <path d="M13.5 10.5H17l3 3v2h-6.5z" />
      <circle cx="7" cy="17.5" r="1.6" />
      <circle cx="16.5" cy="17.5" r="1.6" stroke="#FF6A1F" />
      <path d="M8.6 15.5h6.3" />
    </svg>
  ),
  Component: OrderToDispatchApp,
};
