/**
 * Types for the Process Coordinator dashboard.
 *
 * Both shapes mirror a SECURITY DEFINER RPC exactly (`pc_master_requests()` and
 * `pc_step_owner_contacts()`), so there is no client-side derivation to keep in
 * step — add a column there and add it here, and nowhere else.
 */

/** The ten modules that own a master-request queue. */
export const APPROVAL_APP_IDS = [
  "procurement",
  "import",
  "hr-recruitment",
  "hr-exit",
  "office-supplies",
  "production-entry",
  "order-to-dispatch",
  "asset-maintenance",
  "ocpi",
  "travel-desk",
] as const;

export type ApprovalAppId = (typeof APPROVAL_APP_IDS)[number];

export type RequestStatus = "pending" | "approved" | "rejected";

/** One row of `pc_master_requests()`. */
export interface PcMasterRequest {
  /** MANIFEST id, not the table prefix — routes the approve call. */
  appId: string;
  requestId: string;
  masterType: string;
  /**
   * ⚠ THE WIRE CONTRACT. These keys are read verbatim by the module's own
   *   `fms_<mod>_resolve_master_request`. Pass them back with their shape intact
   *   — a key the RPC does not read is silently dropped on approval.
   */
  proposedPayload: Record<string, unknown>;
  status: RequestStatus;
  requestedBy: string | null;
  requesterName: string | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One (step, owner) pair from `pc_step_owner_contacts()`.
 *
 * ⚠ `userId === null` means the step is configured but resolves to NOBODY. It is
 *   a row on purpose, not an absence — an unowned step is the delay this
 *   dashboard exists to surface, so it must render as "No owner set".
 */
export interface PcStepOwner {
  appId: string;
  stepKey: string;
  /** Dispatch only — its owners are scoped per location (null = fallback). */
  locationId: string | null;
  userId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}
