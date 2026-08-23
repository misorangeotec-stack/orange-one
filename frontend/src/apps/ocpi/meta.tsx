import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import OcpiApp from "./OcpiApp";

/**
 * Manifest for OCPI — the eleventh FMS module, built on the same engine as the
 * others (step owners, per-owner queues, notifications, module-level view/edit
 * grants) with its own `fms_ocpi_*` schema.
 *
 * What it is for: selling a printing machine runs on paper and a Microsoft form.
 * A salesperson fills the form, someone hand-types a quotation sheet, and after
 * the negotiation someone hand-edits one of ten PowerPoint decks into an order
 * confirmation. Nothing is tracked: revisions are untraceable, drafts do not
 * exist, approvals happen off-system, and the signed contracts live in a folder.
 *
 * ⚠ ONE ENTITY CARRIES BOTH DOCUMENTS. The order confirmation inherits every
 *   quotation field by being the SAME ROW, so the two can never drift — which is
 *   the central complaint about the process this replaces.
 *
 * PER-USER-GRANTED (not universal) — an admin switches it on for the sales team,
 * and for whoever approves. View-only is supported and enforced in the database.
 */
export const ocpiApp: AppManifest = {
  id: "ocpi",
  name: appName("ocpi"),
  description:
    "Quote a machine, revise it through the negotiation, get it approved, and turn it into an order confirmation the customer signs — with every version kept.",
  basePath: appBasePath("ocpi"),
  status: "live",
  category: appCategory("ocpi"),
  subGroup: appSubGroup("ocpi"),
  // Sales runs in the order a customer travels: lead → quotation → onboarded →
  // order dispatched → money collected. This is the second step.
  order: 15,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6z" />
      <path d="M15 2v4h4" />
      <path d="M9 12h6" />
      <path d="M9 16h4" stroke="#FF6A1F" />
    </svg>
  ),
  Component: OcpiApp,
};
