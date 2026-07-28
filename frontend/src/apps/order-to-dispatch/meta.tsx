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
 * confirms the credit limit → the store keeper checks material → LOT no. and
 * final quantity are confirmed per line → the sales bill is raised → the gate
 * register records it going out → the driver confirms delivery. NO approval,
 * NO PO, NO quotations.
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
    "Customer order to delivery end to end: confirm credit, check material, fix the LOT and final quantity, raise the sales bill, record the gate-out entry and confirm the dispatch.",
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
