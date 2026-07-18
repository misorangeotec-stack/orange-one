import type { AppManifest } from "../types";
import { appName } from "../appInfo";
import HrApp from "./HrApp";

/**
 * Manifest for HR Recruitment FMS — the second FMS module, built on the same
 * engine as Purchase FMS (step owners, planned-vs-actual due dates, per-owner
 * queues, notifications, demo personas) with its own `fms_hr_*` schema.
 *
 * Manpower Requisition → HR Head + Management approval → Job posting → the
 * candidate board (resumes → shortlists → 3 interview rounds → decision) →
 * onboarding checklist → 3 monthly probation reviews → confirmation.
 */
export const hrRecruitmentApp: AppManifest = {
  id: "hr-recruitment",
  name: appName("hr-recruitment"),
  description:
    "Manpower requisitions, two-stage approval, job posting, a drag-and-drop candidate board with three interview rounds, the onboarding checklist and monthly probation reviews.",
  basePath: "/hr-recruitment",
  status: "live",
  category: "fms",
  subGroup: "HR",
  order: 40,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 3-5.6 6.5-5.6s6.5 2 6.5 5.6" />
      <path d="M17 7.5h5M19.5 5v5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: HrApp,
};
