import type { AppManifest } from "../types";
import { appName } from "../appInfo";
import ExitApp from "./ExitApp";

/**
 * Manifest for HR Exit FMS — the third FMS module, built on the same engine as
 * Purchase FMS and HR Recruitment (step owners, planned-vs-actual due dates,
 * per-owner queues, notifications, demo personas) with its own `fms_exit_*` schema.
 *
 * Resignation → manager review → HR verification → HR Head approval → the last
 * working day → departmental clearance, asset return, handover and the exit
 * interview → leave, payroll and the full & final settlement → letters and archive.
 *
 * It is a UNIVERSAL app (apps/universal.ts): every signed-in user reaches it with no
 * per-user module grant, because any employee must be able to raise their own
 * resignation and there is no bulk grant to fall back on. The nav and RLS are what
 * scope it — a person with no step ownership sees only their own case.
 */
export const hrExitApp: AppManifest = {
  id: "hr-exit",
  name: appName("hr-exit"),
  description:
    "Employee separation end to end: resignation, manager review, HR approval, the last working day, departmental clearance, asset return, handover, the exit interview, the full & final settlement and the relieving letter.",
  basePath: "/hr-exit",
  status: "live",
  category: "fms",
  subGroup: "HR",
  order: 50,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 3.5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h7.5" />
      <path d="M17 8.5l4 3.5-4 3.5" stroke="#FF6A1F" />
      <path d="M21 12H10.5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: ExitApp,
};
