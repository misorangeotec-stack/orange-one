import { supabase } from "@/core/platform/supabase";
import type { PcMasterRequest, RequestStatus } from "../types";

const db = supabase as any;

/**
 * The consolidated master-approval queue, and the one write it performs.
 *
 * READ is a single RPC that UNIONs the ten per-module tables. WRITE deliberately
 * is NOT: each approval goes back through that module's OWN
 * `fms_<mod>_resolve_master_request`, because approving is not a status update —
 * it creates the real master row, stamps the request, fires the module's
 * notification and, for HR and Exit, sends its email. Reimplementing any of that
 * centrally would fork behaviour the moment one module changed.
 *
 * What PC-1 added server-side is one extra arm on those RPCs' authorisation line
 * (`or public.pc_is_coordinator(...)`) and nothing else, so a request approved
 * from here is byte-for-byte the same operation as one approved from the
 * module's own screen.
 */

/** MANIFEST app id → that module's resolve RPC. */
const RESOLVE_RPC: Record<string, string> = {
  procurement: "fms_purchase_resolve_master_request",
  import: "fms_import_resolve_master_request",
  "hr-recruitment": "fms_hr_resolve_master_request",
  "hr-exit": "fms_exit_resolve_master_request",
  "office-supplies": "fms_supplies_resolve_master_request",
  "production-entry": "fms_production_resolve_master_request",
  "order-to-dispatch": "fms_dispatch_resolve_master_request",
  "asset-maintenance": "fms_asset_resolve_master_request",
  ocpi: "fms_ocpi_resolve_master_request",
  "travel-desk": "fms_travel_resolve_master_request",
};

export const canResolveApp = (appId: string): boolean => appId in RESOLVE_RPC;

interface RawRow {
  app_id: string;
  request_id: string;
  master_type: string;
  proposed_payload: Record<string, unknown> | null;
  status: RequestStatus;
  requested_by: string | null;
  requester_name: string | null;
  reviewed_by: string | null;
  reviewer_name: string | null;
  review_note: string | null;
  resolved_master_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchPcMasterRequests(): Promise<PcMasterRequest[]> {
  const { data, error } = await db.rpc("pc_master_requests");
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawRow[]).map((r) => ({
    appId: r.app_id,
    requestId: r.request_id,
    masterType: r.master_type,
    proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
    status: r.status,
    requestedBy: r.requested_by,
    requesterName: r.requester_name,
    reviewedBy: r.reviewed_by,
    reviewerName: r.reviewer_name,
    reviewNote: r.review_note,
    resolvedMasterId: r.resolved_master_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Approve or reject one request, through its own module's RPC.
 *
 * ⚠ TRAVEL DESK TAKES A DIFFERENT SIGNATURE — `(p_request, p_decision text,
 *   p_note, p_payload)` against everyone else's `(p_request_id, p_approve
 *   boolean, p_payload, p_note)`. Named arguments make the difference explicit
 *   rather than positional and silent.
 *
 * `payload` is sent only when approving, matching every module's own screen: a
 * rejection has nothing to write, and passing a payload with it would let a
 * correction be recorded against a master that was never created.
 */
export async function resolvePcMasterRequest(input: {
  appId: string;
  requestId: string;
  approve: boolean;
  payload?: Record<string, unknown>;
  note?: string;
}): Promise<void> {
  const fn = RESOLVE_RPC[input.appId];
  if (!fn) throw new Error(`No approval route for module "${input.appId}".`);

  const args =
    input.appId === "travel-desk"
      ? {
          p_request: input.requestId,
          p_decision: input.approve ? "approved" : "rejected",
          p_note: input.note ?? null,
          p_payload: input.approve ? (input.payload ?? null) : null,
        }
      : {
          p_request_id: input.requestId,
          p_approve: input.approve,
          p_payload: input.approve ? (input.payload ?? null) : null,
          p_note: input.note ?? null,
        };

  const { error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
}
