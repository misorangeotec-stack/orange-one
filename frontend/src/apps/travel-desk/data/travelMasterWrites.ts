import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type {
  TravelMasterType, TravelRequestableMaster, RateType, TravelCategory, CityTier,
} from "../types";

/**
 * Master and rate-card writes.
 *
 * ⚠ THE MASTER TABLES ARE WRITTEN DIRECTLY, THE RATE CARD IS NOT ENTIRELY.
 *   A master row is an ordinary upsert whose RLS policy already says exactly who
 *   may make it (`fms_travel_is_master_manager`), so wrapping it in a definer
 *   function would put that rule in two places. SIGNING OFF a rate card is
 *   different: it supersedes other cards, refuses while the policy still
 *   contradicts itself, and writes an activity row — so it goes through
 *   `fms_travel_confirm_rate_card`, which is the only door.
 */

/** Which table backs each list. One map, so a typo cannot invent a table name. */
const TABLE: Record<Exclude<TravelMasterType, "rate_card">, string> = {
  city: "fms_travel_cities",
  purpose: "fms_travel_purposes",
  expense_category: "fms_travel_expense_categories",
  airline: "fms_travel_airlines",
  hotel: "fms_travel_hotels",
  bus_operator: "fms_travel_bus_operators",
};

export type MasterValues = Record<string, string>;

const trimmed = (v: unknown): string => String(v ?? "").trim();
const orNull = (v: unknown): string | null => trimmed(v) || null;
const numOrNull = (v: unknown): number | null => {
  const s = trimmed(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const boolOf = (v: unknown): boolean => {
  const s = trimmed(v).toLowerCase();
  return s === "yes" || s === "true" || s === "y" || s === "1";
};

/**
 * Turn a MasterCrud value bag into the row its table expects.
 *
 * MasterCrud hands every field back as a STRING — that is its contract, so one
 * form and one Excel round trip can serve nine different masters. The typing
 * happens here, once per master, rather than in nine screens.
 */
function rowFor(type: Exclude<TravelMasterType, "rate_card">, v: MasterValues, active: boolean) {
  const base = { name: trimmed(v.name), active };
  switch (type) {
    case "city":
      return {
        ...base,
        state: orNull(v.state),
        // Tier 3 is the policy's own default for anything it does not name
        // (§1.3: "All other cities, towns, and locations"), so an unparseable
        // value falls there rather than failing the save.
        tier: numOrNull(v.tier) ?? 3,
      };
    case "purpose":
      return { ...base, requires_remarks: boolOf(v.requires_remarks) };
    case "expense_category":
      return {
        ...base,
        kind: trimmed(v.kind) || "misc",
        reimbursable: boolOf(v.reimbursable),
        receipt_required_above: numOrNull(v.receipt_required_above),
        self_declaration_cap: numOrNull(v.self_declaration_cap),
        needs_guest_details: boolOf(v.needs_guest_details),
        refusal_note: orNull(v.refusal_note),
      };
    case "hotel":
      return { ...base, city_id: orNull(v.city_id) };
    default:
      return base;
  }
}

/** Add or edit one master row. RLS enforces that you own the list. */
export async function saveMaster(
  type: Exclude<TravelMasterType, "rate_card">,
  id: string | null,
  values: MasterValues,
  active: boolean,
): Promise<void> {
  const row = rowFor(type, values, active);
  const q = id
    ? db.from(TABLE[type]).update(row).eq("id", id)
    : db.from(TABLE[type]).insert(row);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/**
 * Switch a master row off.
 *
 * ⚠ DEACTIVATE, NEVER DELETE. A city, a purpose or an expense category with
 *   trips against it is history: last quarter's claim has to keep reading
 *   correctly even after the row leaves the pickers. Every FMS in this portal
 *   works this way, and `fms_travel_cities` is additionally FK'd from employee
 *   base cities with ON DELETE RESTRICT, so a delete would fail anyway.
 */
export async function setMasterActive(
  type: Exclude<TravelMasterType, "rate_card">,
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await db.from(TABLE[type]).update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Ask for a value that is not on a list yet. */
export async function requestMaster(
  type: TravelRequestableMaster,
  payload: Record<string, unknown>,
  requestedBy: string,
): Promise<void> {
  const { error } = await db.from("fms_travel_master_requests").insert({
    master_type: type,
    proposed_payload: payload,
    requested_by: requestedBy,
  });
  if (error) {
    // The partial unique index means somebody already asked for this exact name
    // and it is still waiting. That is not a failure worth showing as one.
    if (String(error.message).includes("fms_travel_master_requests_pending_uniq")) {
      throw new Error("Somebody has already asked for this, and it is still waiting to be reviewed.");
    }
    throw new Error(error.message);
  }
}

/**
 * Approve or reject a request.
 *
 * `payload` lets the reviewer CORRECT what was typed before approving it —
 * "kolkatta" at no tier becomes "Kolkata", Tier 1 — and the correction is what
 * the master row gets. Approving a misspelling because it was quicker than
 * editing it is how a master list rots.
 */
export async function resolveMasterRequest(
  id: string,
  decision: "approved" | "rejected",
  note?: string | null,
  payload?: Record<string, unknown> | null,
): Promise<string | null> {
  const { data, error } = await db.rpc("fms_travel_resolve_master_request", {
    p_request: id,
    p_decision: decision,
    p_note: note ?? null,
    p_payload: payload ?? null,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** Who owns which list. Admin only, enforced by RLS. */
export async function setMasterOwners(type: TravelMasterType, userIds: string[]): Promise<void> {
  const { error: delErr } = await db
    .from("fms_travel_master_managers").delete().eq("master_type", type);
  if (delErr) throw new Error(delErr.message);
  if (!userIds.length) return;
  const { error } = await db.from("fms_travel_master_managers").insert(
    userIds.map((u) => ({ master_type: type, manager_user_id: u })),
  );
  if (error) throw new Error(error.message);
}

// ===========================================================================
// RATE CARDS
// ===========================================================================

/**
 * Edit one figure on a card.
 *
 * ⚠ EDITING A DISPUTED CELL CLEARS ITS `disputed` FLAG, and that is the whole
 *   mechanism. Setting the value IS the act of deciding which of the policy's
 *   two answers is real, so the flag comes off at the same moment — and once the
 *   last one comes off, the card becomes signable. Nobody has to remember to
 *   unmark anything separately.
 */
export async function setRate(
  rateId: string,
  patch: { amount?: number | null; textValue?: string | null; notes?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = { disputed: false };
  if ("amount" in patch) row.amount = patch.amount;
  if ("textValue" in patch) row.text_value = patch.textValue;
  if ("notes" in patch) row.notes = patch.notes;
  const { error } = await db.from("fms_travel_rates").update(row).eq("id", rateId);
  if (error) throw new Error(error.message);
}

/** Add a figure the seeded card does not carry. */
export async function addRate(input: {
  rateCardId: string;
  rateType: RateType;
  travelCategory?: TravelCategory | null;
  cityTier?: CityTier | null;
  key?: string | null;
  amount?: number | null;
  textValue?: string | null;
  notes?: string | null;
}): Promise<void> {
  const { error } = await db.from("fms_travel_rates").insert({
    rate_card_id: input.rateCardId,
    rate_type: input.rateType,
    travel_category: input.travelCategory ?? null,
    city_tier: input.cityTier ?? null,
    key: input.key ?? null,
    amount: input.amount ?? null,
    text_value: input.textValue ?? null,
    notes: input.notes ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * Start next year's card by copying this one.
 *
 * §7.2 asks for an annual review every January. Copying rather than editing in
 * place is what keeps a March claim priced on March's figures after an April
 * revision — the trip froze the old card's id, and the old card still resolves.
 */
export async function cloneRateCard(
  fromCardId: string,
  label: string,
  effectiveFrom: string,
): Promise<string> {
  const { data: card, error: cardErr } = await db
    .from("fms_travel_rate_cards")
    .insert({ label, effective_from: effectiveFrom, status: "draft" })
    .select("id")
    .single();
  if (cardErr) throw new Error(cardErr.message);

  const { data: rows, error: readErr } = await db
    .from("fms_travel_rates").select("*").eq("rate_card_id", fromCardId);
  if (readErr) throw new Error(readErr.message);

  if (rows?.length) {
    const { error } = await db.from("fms_travel_rates").insert(
      rows.map((r: any) => ({
        rate_card_id: card.id,
        rate_type: r.rate_type,
        travel_category: r.travel_category,
        city_tier: r.city_tier,
        key: r.key,
        amount: r.amount,
        text_value: r.text_value,
        // A dispute carries forward: copying a card does not decide anything.
        disputed: r.disputed,
        notes: r.notes,
        sort_order: r.sort_order,
      })),
    );
    if (error) throw new Error(error.message);
  }
  return card.id as string;
}

/**
 * Sign off a card so its caps enforce.
 *
 * Goes through the RPC because it does three things a plain update cannot: it
 * REFUSES while any figure is still disputed, it supersedes every previously
 * confirmed card, and it records who signed and when.
 */
export async function confirmRateCard(cardId: string): Promise<void> {
  const { error } = await db.rpc("fms_travel_confirm_rate_card", { p_card: cardId });
  if (error) throw new Error(error.message);
}
