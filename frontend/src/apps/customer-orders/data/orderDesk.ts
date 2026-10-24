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
 *   2. What reaches them is decided by the server. Since OD-17 that includes
 *      their own firm NAMES (Q11 relaxed for exactly that) — but never which of
 *      our books each one sits in, nor how many.
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

/** One consignment's note to the customer, as the gate wrote it. */
export interface DeskDispatchNote {
  /**
   * Which consignment. Shown only when there is more than one, because "Note 1 of
   * 1" is noise — but carried always, so the screen can tell.
   */
  roundNo: number | null;
  /** The date it actually went out. Null if the gate left the date blank. */
  sentOn: string | null;
  note: string;
}

export interface DeskOrder {
  id: string;
  orderNo: string;
  orderDate: string;
  orderRemarks: string | null;
  /**
   * Which of OUR books bills it — never shown, only used to scope the picker.
   *
   * ⚠ NULL UNTIL WE COMPLETE THE ORDER (OD-17). The customer no longer chooses
   *   it; our team does, on Complete Customer Order. Once set, a change has to
   *   offer that book's copies of the items, or a line could go onto the order
   *   that the billing company cannot supply.
   */
  companyId: string | null;
  /** Which of THEIR firms it was placed for — the ledger they picked (OD-17). */
  ledgerId: string;
  ledgerName: string;
  /**
   * The notes written FOR this customer as each consignment left, oldest first.
   *
   * ⚠ THIS IS THE ONLY REMARK CHANNEL THAT REACHES THEM, and the server is what
   *   makes that true — `go_remarks`, the internal note beside it, is not in the
   *   RPC at all. Do not add a second source here: the guarantee is "nothing else
   *   is sent", which a component cannot honour by choosing not to render.
   *
   * Empty until the gate stamps the order, and empty on an order whose round
   * looped back — the note went to the archive with the consignment it described.
   */
  dispatchNotes: DeskDispatchNote[];
  /** Already collapsed by the server — see lib/customerLabels.ts. */
  statusKey: string;
  /**
   * May they still change or cancel it?
   *
   * ⚠ THE SERVER'S ANSWER, NOT OURS. This is `fms_dispatch_customer_window_open`,
   *   the very function both write RPCs enforce — so a hidden button and a refused
   *   call can never disagree.
   *
   *   Since OD-16 it is also what `status_key` tests to decide "request_raised",
   *   so the two now agree BY CONSTRUCTION rather than by coincidence. That is not
   *   licence to re-derive one from the other here: the server sends both because
   *   the server is where the rule lives, and a browser that computed
   *   `canChange = statusKey === "request_raised"` would be a second copy of a rule
   *   that is allowed to change without asking this file.
   */
  canChange: boolean;
  placedAt: string | null;
  lines: DeskOrderLine[];
}

export const PROFILE_QK = ["order-desk", "profile"] as const;
export const LEDGERS_QK = ["order-desk", "ledgers"] as const;
/** Keyed on both, because the list is the firm's — and, once we bill it, the book's. */
export const itemsQueryKey = (companyId: string | null, ledgerId: string | null) =>
  ["order-desk", "items", companyId ?? "all", ledgerId ?? "all"] as const;
export const ORDERS_QK = ["order-desk", "orders"] as const;

/**
 * One of THEIR firms — a ledger ticked for them in Setup → Customer Logins (OD-17).
 *
 * ⚠ THE CUSTOMER NO LONGER CHOOSES ONE OF OUR COMPANIES. Which book bills the
 *   order is decided at our end, on Complete Customer Order. What they choose is
 *   which of their own firms is ordering, and the item list follows it.
 *
 * ⚠ ONE ROW PER FIRM NAME, NOT PER LEDGER. The same firm is a separate ledger in
 *   every book that bills it; the server folds them into one row and hands out a
 *   single representative id, which every write expands back on its side.
 */
export interface DeskLedger {
  ledgerId: string;
  name: string;
  itemCount: number;
}

export async function fetchDeskLedgers(): Promise<DeskLedger[]> {
  const { data, error } = await db.rpc("fms_dispatch_my_ledgers");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { ledger_id: string; ledger_name: string; item_count: number | null }[])
    .map((r) => ({ ledgerId: r.ledger_id, name: r.ledger_name, itemCount: r.item_count ?? 0 }));
}

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
 *   them apart.
 *
 * ⚠ AND SCOPED TO THE FIRM THEY PICKED (OD-17) — only what Setup mapped to that
 *   firm's ledgers. Given a company as well (an order we have already written
 *   up), the server returns THAT BOOK'S own copy of each, matched by name, so a
 *   change cannot add a line the billing book cannot supply.
 *
 *   Both null is the whole account — the order-history screen, which needs every
 *   item to name lines already placed.
 */
export async function fetchDeskItems(
  companyId: string | null,
  ledgerId: string | null,
): Promise<DeskItem[]> {
  const { data, error } = await db.rpc("fms_dispatch_my_items", {
    p_company: companyId,
    p_ledger: ledgerId,
  });
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
    company_id: string | null; ledger_id: string; ledger_name: string | null;
    dispatch_notes:
      | { round_no: number | null; sent_on: string | null; note: string | null }[]
      | null;
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
    companyId: r.company_id,
    ledgerId: r.ledger_id,
    ledgerName: r.ledger_name ?? "",
    /* Server-side `jsonb_agg` already orders these; a note with no text cannot
       reach the array, but the filter keeps a blank from rendering an empty box
       if that ever changes. */
    dispatchNotes: (r.dispatch_notes ?? [])
      .filter((n) => (n.note ?? "").trim())
      .map((n) => ({
        roundNo: n.round_no ?? null,
        sentOn: n.sent_on ?? null,
        note: (n.note ?? "").trim(),
      })),
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
  /** Which of their firms — `DeskLedger.ledgerId`. The company is ours to choose. */
  ledgerId: string;
  orderRemarks: string;
  lines: DeskLineInput[];
}): Promise<string> {
  const { data, error } = await db.rpc("fms_dispatch_submit_customer_order", {
    p: {
      ledger_id: input.ledgerId,
      order_remarks: input.orderRemarks.trim() || null,
      lines: linePayload(input.lines),
    },
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

/**
 * Cancel an order the customer has raised but we have not accepted.
 *
 * ⚠ BOUNDED BY THE SAME WINDOW AS `updateDeskOrder`, and the server is what
 *   enforces it — `fms_dispatch_customer_window_open`, which is also what
 *   `status_key` tests to decide whether the order reads "Request raised". So the
 *   pill, the Cancel button and the server's answer are three views of one fact
 *   and cannot drift apart.
 *
 *   Once we accept, this refuses. That refusal is the real rule; hiding the
 *   button is only what stops us offering something we would turn down.
 */
export async function cancelDeskOrder(orderId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_cancel_customer_order", {
    p: { order_id: orderId, reason: reason.trim() || null },
  });
  if (error) throw new Error(error.message);
}
