import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import ComplaintApp from "./ComplaintApp";

/**
 * Manifest for the Complaint (RM/FG) FMS — quality complaints, built on the same
 * engine as the other FMS modules (step owners, planned-vs-actual due dates,
 * per-owner queues, notifications, master governance) with its own
 * `fms_complaint_*` schema.
 *
 * ONE flow, taken from either side: a FINISHED GOOD complaint arrives from a
 * customer against a sales invoice; a RAW MATERIAL one goes out to a vendor
 * against a purchase invoice. Raise → acknowledge → investigate → corrective
 * action → resolve → confirm → close. NO approval matrix, NO PO, NO quotations.
 *
 * It is a PER-USER-GRANTED app (not universal) — an admin switches it on for the
 * quality team and for whoever raises, resolves and confirms. The nav and RLS
 * scope what each person sees.
 */
export const complaintApp: AppManifest = {
  id: "complaint",
  name: appName("complaint"),
  description:
    "Quality complaints end to end, raw material or finished good: raise it against a LOT, acknowledge and assign, find the root cause, act on it, resolve with the party and close.",
  basePath: appBasePath("complaint"),
  status: "live",
  category: appCategory("complaint"),
  subGroup: appSubGroup("complaint"),
  order: 10,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* A speech bubble — somebody is telling us something — with a warning mark inside it. */}
      <path d="M20 14a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
      <path d="M12 8v3.5" stroke="#FF6A1F" />
      <path d="M12 13.6h.01" stroke="#FF6A1F" />
    </svg>
  ),
  Component: ComplaintApp,
};
