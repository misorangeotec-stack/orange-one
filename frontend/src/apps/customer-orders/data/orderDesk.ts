import { supabase } from "@/core/platform/supabase";

/**
 * Everything the Orange Order Desk talks to. Six calls, and NOT ONE OF THEM IS A
 * TABLE.
 *
 * ⚠ THIS IS THE DESIGN, NOT A CONVENIENCE. The customer's login reads no master
 *   and no FMS table directly — every screen is served by a SECURITY DEFINER RPC
 *   that resolves the caller's own customer from `auth.uid()` and returns only
 *   that. Three consequences follow, and each of them is load-bearing:
 *
 *   1. The security sweep could be a clean "staff only" rule with NO exceptions
 *      to reason about. There is no table needing an external read arm, so there
 *      is no table where somebody must remember one.
 *   2. Q11 — "the customer never sees the ticked ledger list" — is honoured by
 *      never sending it. Not by hiding it in the UI, which is not honouring it.
 *   3. Our books, sites and companies (`mst_companies`, `mst_locations`,
 *      `mst_company_locations`) stay entirely out of reach, so the customer never
 *      learns which of our ledgers they are about to be billed from.
 *
 *   Adding a `.from("…")` to this file gives all three of those away at once.
 *   If a screen needs more, widen the RPC.
 *
 * `fms_dispatch_*` is absent from the generated Database types, so calls route
 * through an untyped alias — the standing FMS convention (see
 * order-to-dispatch/data/dispatchFetch.ts, which says the same at the same line).
 */
const db = supabase as any;

/* -------------------------------------------------------------------------- */
/*  Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface CustomerProfile {
  /** Their name, as we agreed to show it — never a Tally ledger name. */
  displayName: string;
  /** Shown as text. They do not choose it (Q2). */
  customerLocation: string | null;
  /** Distinct item names they may order. Zero means their screen cannot work. */
  itemCount: number;
}

export interface DeskItem {
  itemId: string;
  name: string;
  unit: string | null;
  itemType: string | null;
}

export interface DeskOrderLine {
  lineNo: number;
  /**
   * ⚠ CARRIED SO "CHANGE THIS ORDER" CAN RE-OPEN THE PICKER ON THE RIGHT ITEM.
   *   Displaying an order needs only the name; EDITING one needs the id, and the
   *   temptation is to match the name back against the picker instead. This
   *   codebase already has that written down as a trap — join by id, never by name
   *   (receivables-hub/lib/scopeParties.ts) — and here it would appear to work
   *   until the first item renamed in Tally, when one line would silently empty
   *   itself on the screen whose whole job is to edit it.
   */
  itemId: string;
  name: string;
  quantity: number;
  unit: string | null;
  lineRemark: string | null;
}

export interface DeskOrder {
  id: string;
  orderNo: string;
  orderDate: string;
  orderRemarks: string | null;
  /** Already collapsed by the server — see lib/customerLabels.ts. */
  statusKey: string;
  /**
   * May they still change or cancel it?
   *
   * ⚠ THE SERVER'S ANSWER, NOT OURS. This is `fms_dispatch_customer_window_open`,
   *   the very function both write RPCs enforce — so a hidden button and a refused
   *   call can never disagree. Do not re-derive it from `statusKey`: two distinct
   *   states both render as "Placed" and only one of them is open.
   */
  canChange: boolean;
  placedAt: string | null;
  lines: DeskOrderLine[];
}

export const PROFILE_QK = ["order-desk", "profile"] as const;
export const ITEMS_QK = ["order-desk", "items"] as const;
export const ORDERS_QK = ["order-desk", "orders"] as const;

/**
 * Who am I, as a customer?
 *
 * Returns NULL rather than throwing when the caller is not a customer login at
 * all — an admin opening the app from their own launcher is the ordinary case,
 * not an error, and the app explains itself to them instead of showing a red box.
 */
export async function fetchCustomerProfile(): Promise<CustomerProfile | null> {
  const { data, error } = await db.rpc("fms_dispatch_my_customer_profile");
  if (error) throw new Error(error.message);
  const r = (data ?? [])[0] as
    | { display_name: string; customer_location: string | null; item_count: number | null }
    | undefined;
  if (!r) return null;
  return {
    displayName: r.display_name,
    customerLocation: r.customer_location,
    itemCount: r.item_count ?? 0,
  };
}

/**
 * What they may order.
 *
 * ⚠ ALREADY DE-DUPLICATED BY NAME, SERVER-SIDE, and that is not cosmetic. One
 *   customer is several Tally ledgers, and the same ink is a separate item row in
 *   each book — "KY SUBLIMATION INK BLACK" is three rows for one product. Listed
 *   raw, the customer sees the same ink three times with nothing on screen to tell
 *   them apart. Which row survives does not matter: credit check re-points the
 *   line to the billing book's own row afterwards.
 */
export async function fetchDeskItems(): Promise<DeskItem[]> {
  const { data, error } = await db.rpc("fms_dispatch_my_items");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { item_id: string; name: string; unit: string | null; item_type: string | null }[])
    .map((r) => ({ itemId: r.item_id, name: r.name, unit: r.unit, itemType: r.item_type }));
}

/**
 * Their orders — every one their FIRM has placed, not only their own.
 *
 * The RPC keys on the customer, not on who signed in, so the day a second person
 * at the same firm gets a login the history does not fragment into two halves
 * neither of them can see whole.
 */
export async function fetchDeskOrders(): Promise<DeskOrder[]> {
  const { data, error } = await db.rpc("fms_dispatch_my_orders");
  if (error) throw new Error(error.message);
  return ((data ?? []) as {
    id: string; order_no: string; order_date: string; order_remarks: string | null;
    status_key: string; can_change: boolean; placed_at: string | null;
    lines:
      | {
          line_no: number; item_id: string; name: string; quantity: number | string;
          unit: string | null; line_remark: string | null;
        }[]
      | null;
  }[]).map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    orderDate: r.order_date,
    orderRemarks: r.order_remarks,
    statusKey: r.status_key,
    canChange: r.can_change,
    placedAt: r.placed_at,
    lines: (r.lines ?? []).map((l) => ({
      lineNo: l.line_no,
      itemId: l.item_id,
      name: l.name,
      quantity: Number(l.quantity),
      unit: l.unit,
      lineRemark: l.line_remark,
    })),
  }));
}

/* -------------------------------------------------------------------------- */
/*  Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface DeskLineInput {
  itemId: string;
  quantity: string;
  lineRemark: string;
}

/**
 * `unit` is deliberately NOT sent.
 *
 * The server reads it off the item master through a LEFT JOIN and writes it onto
 * the line itself, so the gate pass and the receiver copy carry the same unit the
 * master holds. Letting the browser post one would be a second source for it, and
 * the browser's copy is the one that goes stale.
 */
const linePayload = (lines: DeskLineInput[]) =>
  lines
    .filter((l) => l.itemId && Number(l.quantity) > 0)
    .map((l) => ({
      item_id: l.itemId,
      quantity: l.quantity,
      line_remark: l.lineRemark.trim() || null,
    }));

export async function submitDeskOrder(input: {
  orderRemarks: string;
  lines: DeskLineInput[];
}): Promise<string> {
  const { data, error } = await db.rpc("fms_dispatch_submit_customer_order", {
    p: { order_remarks: input.orderRemarks.trim() || null, lines: linePayload(input.lines) },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function updateDeskOrder(input: {
  orderId: string;
  orderRemarks: string;
  lines: DeskLineInput[];
}): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_update_customer_order", {
    p: {
      order_id: input.orderId,
      order_remarks: input.orderRemarks.trim() || null,
      lines: linePayload(input.lines),
    },
  });
  if (error) throw new Error(error.message);
}

export async function cancelDeskOrder(orderId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_cancel_customer_order", {
    p: { order_id: orderId, reason: reason.trim() || null },
  });
  if (error) throw new Error(error.message);
}
