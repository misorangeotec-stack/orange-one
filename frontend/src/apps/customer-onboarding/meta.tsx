import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import CustomerOnboardingApp from "./CustomerOnboardingApp";

/**
 * Manifest for New Customer Onboarding — the ninth FMS, promoted out of the
 * Outstanding Dashboard into the main menu on 29-07-2026.
 *
 * The journey: Sales raise the customer (starting from the GST number, which
 * fills in most of the form) → Accounts verify the registration and references
 * and recommend a credit limit → the Sales Head grades the customer A–E →
 * the Director approves when the limit crosses the threshold → someone records
 * the Tally ledger.
 *
 * PER-USER-GRANTED. It used to ride on the `outstanding-dashboard` grant, so
 * anyone who could open the Receivables hub could reach it. As its own module it
 * needs its own grant — see the migration that seeds it for everyone who already
 * had the hub, so nobody loses access on the day it moves.
 *
 * ⚠ Its pages remain under apps/receivables-hub/ on purpose — see
 *   CustomerOnboardingApp for why moving them would be a rewrite, not a move.
 */
export const customerOnboardingApp: AppManifest = {
  id: "customer-onboarding",
  name: appName("customer-onboarding"),
  description:
    "Onboard a new customer end to end: start from their GST number, verify the registration and trade references, agree a credit limit, grade the account and create the Tally ledger.",
  basePath: appBasePath("customer-onboarding"),
  status: "live",
  category: appCategory("customer-onboarding"),
  subGroup: appSubGroup("customer-onboarding"),
  order: 20,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3 20c0-3.6 3-5.6 6.5-5.6" />
      <path d="M17.5 13.5v6M14.5 16.5h6" stroke="#FF6A1F" />
    </svg>
  ),
  Component: CustomerOnboardingApp,
};
