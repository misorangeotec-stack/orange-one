import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import ProcessCoordinatorApp from "./ProcessCoordinatorApp";

/**
 * Manifest for the Process Coordinator dashboard.
 *
 * Sits in Control between the FMS Control Center (order 10) and the Master
 * Report (order 20), and is deliberately none of the three:
 *   · the Control Center asks "what work is due today", org-wide, and names the
 *     delayed STEP but never the PERSON;
 *   · the Master Report asks "is this module alive at all";
 *   · this one asks "what is waiting on me, and who do I ring about the rest".
 *
 * It is the only one of the three with a WRITE surface — master approvals across
 * every module land here.
 *
 * ⚠ THE GRANT IS THE PERMISSION. Holding app_access for 'process-coordinator'
 *   makes someone the coordinator; there is no coordinator role and no config
 *   screen. Note this is unrelated to the per-module `process_coordinators`
 *   config, which feeds fms_<mod>_is_coordinator() and must not be widened — it
 *   short-circuits ~15 act-authority predicates including HR Exit's confidential
 *   tier. See 20261012120000_add_process_coordinator_module.sql.
 *
 * ⚠ TO SEE OTHER MODULES' WORK the coordinator also needs a **view** grant on
 *   each module — and it must be `view`, not `edit`: several FMS read policies
 *   admit `module_is_viewer()`, which is `module_level() = 'view'` exactly, so an
 *   edit grant would give them LESS read, not more.
 */
export const processCoordinatorApp: AppManifest = {
  id: "process-coordinator",
  name: appName("process-coordinator"),
  description:
    "Every master approval in one queue, and every process at a glance — which step is stuck, and who to call about it.",
  basePath: appBasePath("process-coordinator"),
  status: "live",
  category: appCategory("process-coordinator"),
  order: 15,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="6" r="2" />
      <circle cx="5.5" cy="18" r="2" />
      <path d="M5.5 8v8" />
      <path d="M9.5 6h9M9.5 18h9" />
      <path d="M9.5 12h5" />
      <circle cx="18" cy="12" r="1.8" fill="#FF6A1F" stroke="none" />
    </svg>
  ),
  Component: ProcessCoordinatorApp,
};
