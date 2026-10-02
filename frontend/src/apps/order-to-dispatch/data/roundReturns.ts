import { supabase } from "@/core/platform/supabase";
// fms_dispatch_* tables/RPCs are not in the generated Database types; route
// through an untyped alias — the standing FMS convention.
const db = supabase as any;
import type { RoundReturn, RoundReturnLine, RoundReturnScope, SalesReturnMode } from "../types";

/**
 * Sales returns against a round's invoice once it has left the gate (migration 20261230120000).
 *
 * ⚠ ITS OWN QUERY, NOT A MEMBER OF fetchDispatchData's Promise.all. That call
 *   destructures by position and says so in capitals; a new line there shifts
 *   every binding after it. The table is small (a handful of rows a month), so
 *   the whole of it is re-read after any write that could have opened one —
 *   including a dispatch confirmation recorded as Returned, where the row is
 *   opened by a trigger rather than by us.
 *
 * ⚠ AN UN-MIGRATED DATABASE LOADS AS "NONE". If the table does not exist yet
 *   the read fails; that must not take the module's queues down with it, so it
 *   resolves to an empty list and the new screens simply show nothing.
 */
export const ROUND_RETURNS_QK = ["dispatch", "round-returns"] as const;

const PAGE = 1000;

export async function fetchRoundReturns(): Promise<RoundReturn[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("fms_dispatch_round_returns")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      // 42P01 = undefined_table: the migration is not applied yet.
      if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows.map(mapRoundReturn);
}

const str = (v: any): string | null => (v === null || v === undefined || v === "" ? null : String(v));

function mapRoundReturn(r: any): RoundReturn {
  return {
    id: r.id,
    orderId: r.order_id,
    roundId: r.round_id ?? null,
    roundNo: Number(r.round_no),
    invoiceNo: str(r.invoice_no),
    invoiceDate: str(r.invoice_date),
    ewayExpected: !!r.eway_expected,
    origin: r.origin,
    scope: r.scope,
    lines: Array.isArray(r.lines) ? r.lines.map(mapLine) : [],
    reason: r.reason ?? "",
    requestedAt: r.requested_at,
    requestedBy: r.requested_by ?? null,
    status: r.status,
    srMode: r.sr_mode ?? null,
    referenceNo: str(r.reference_no),
    actualDate: str(r.actual_date),
    remarks: str(r.remarks),
    attachmentPath: str(r.attachment_path),
    attachmentName: str(r.attachment_name),
    recordedAt: r.recorded_at ?? null,
    recordedBy: r.recorded_by ?? null,
    editedAt: r.edited_at ?? null,
    editedBy: r.edited_by ?? null,
    withdrawnAt: r.withdrawn_at ?? null,
    withdrawnBy: r.withdrawn_by ?? null,
    withdrawReason: str(r.withdraw_reason),
  };
}

function mapLine(l: any): RoundReturnLine {
  return {
    orderItemId: l.order_item_id ?? null,
    itemId: l.item_id ?? null,
    itemName: l.item_name ?? "",
    unit: str(l.unit),
    lotNo: str(l.lot_no),
    billedQty: Number(l.billed_qty) || 0,
    returnQty: Number(l.return_qty) || 0,
  };
}

/* --------------------------------- writes --------------------------------- */

export interface RoundReturnRequest {
  reason: string;
  scope: RoundReturnScope;
  /**
   * PARTIAL only: what comes back, keyed by the order line. The server checks
   * each against what the invoice billed and snapshots the rest. Ignored on a
   * full return, which takes every billed line whole.
   */
  lines?: { orderItemId: string; returnQty: number }[];
}

/**
 * Raise a sales return against one round's invoice. Returns the new id.
 *
 * Keyed on (order, round number), not the archive row: the round in progress —
 * out of the gate, delivery not yet confirmed — has no archive row yet, and its
 * invoice qualifies too.
 */
export async function requestRoundReturn(
  orderId: string, roundNo: number, req: RoundReturnRequest,
): Promise<string> {
  const { data, error } = await db.rpc("fms_dispatch_request_round_return", {
    p_order: orderId,
    p_round_no: roundNo,
    p: {
      reason: req.reason,
      scope: req.scope,
      lines: (req.lines ?? []).map((l) => ({ order_item_id: l.orderItemId, return_qty: l.returnQty })),
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Same payload shape as the order-level `SalesReturnPayload`, deliberately. */
export interface RoundReturnPayload {
  sr_mode?: SalesReturnMode;
  sr_reference_no?: string;
  sr_actual_date?: string;
  sr_remarks?: string;
  /** ⚠ OMIT on an edit to keep the stored file; "" clears it. */
  sr_attachment_path?: string;
  sr_attachment_name?: string;
}

export async function recordRoundReturn(returnId: string, payload: RoundReturnPayload): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_record_round_return", { p_return: returnId, p: payload });
  if (error) throw new Error(error.message);
}

/** Correct a recorded return. The server leaves `sr_mode` alone. */
export async function updateRoundReturn(returnId: string, payload: RoundReturnPayload): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_update_round_return", { p_return: returnId, p: payload });
  if (error) throw new Error(error.message);
}

export async function withdrawRoundReturn(returnId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_withdraw_round_return", {
    p_return: returnId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
