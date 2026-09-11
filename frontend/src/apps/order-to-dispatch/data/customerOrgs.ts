import { supabase } from "@/core/platform/supabase";
import { createUserViaFunction } from "@/core/platform/adminUserApi";

// fms_dispatch_* tables and RPCs are not in the generated Database types; route
// table/rpc calls through an untyped alias. This is the standing FMS convention —
// see data/dispatchFetch.ts, which says the same thing at the same line.
const db = supabase as any;

/**
 * Customer logins for the Orange Order Desk (OD-13).
 *
 * Two tables sit behind this: `fms_dispatch_customer_orgs` is the CUSTOMER (the
 * ticked ledgers, who we notify, the credit-check pre-fills) and
 * `fms_dispatch_customer_logins` is the LOGIN. They are separate so that a second
 * person at the same customer is one more row rather than a migration, and so the
 * order history keys on the customer rather than on whoever happened to sign in.
 *
 * ⚠ EVERYTHING HERE IS ADMIN-SIDE. The customer's own app reads none of it — their
 *   whole screen is served by SECURITY DEFINER RPCs, which is what keeps the ticked
 *   ledger list off the wire entirely (decision Q11: "the customer never sees this
 *   list", honoured by never sending it).
 */

export interface CustomerOrg {
  id: string;
  displayName: string;
  /** The ticked Tally ledgers. At most one per billing company — the server refuses more. */
  partyIds: string[];
  partyNames: string[];
  customerLocation: string | null;
  notifyUserIds: string[];
  notifyNames: string[];
  defaultLocationId: string | null;
  defaultDispatchType: "local" | "transport" | null;
  active: boolean;
  loginCount: number;
  /** Distinct item names the union of the ticked ledgers offers. Zero means an empty picker. */
  itemCount: number;
  /**
   * What is still missing before this customer can be switched on, from the server's
   * own readiness check — the same one `fms_dispatch_save_customer_org` runs while
   * saving, so the screen and the save can never disagree about what "ready" means.
   */
  missing: OrgMissing[];
}

/**
 * ⚠ `primary_ledger` IS GONE (OD-14). The customer picks the company they are
 *   buying from, so there is no provisional ledger left to nominate. The COLUMN
 *   survives on `fms_dispatch_customer_orgs` — changes here are additive-only —
 *   but nothing reads it and the readiness check no longer names it.
 */
export type OrgMissing = "ledgers" | "recipients" | "items";

export const MISSING_LABEL: Record<OrgMissing, string> = {
  ledgers: "No ledgers ticked",
  recipients: "Nobody is told about their orders",
  items: "No items mapped — their order screen would be empty",
};

export interface CustomerLogin {
  profileId: string;
  orgId: string;
  active: boolean;
}

export interface SaveCustomerOrgInput {
  id?: string | null;
  displayName: string;
  partyIds: string[];
  customerLocation: string | null;
  notifyUserIds: string[];
  defaultLocationId: string | null;
  defaultDispatchType: "local" | "transport" | null;
  active: boolean;
}

export const CUSTOMER_ORGS_QK = ["dispatch", "customer-orgs"] as const;

/* -------------------------------------------------------------------------- */
/*  What this customer may order (OD-14)                                       */
/* -------------------------------------------------------------------------- */

/**
 * One mapped pair, as Setup needs to render it: the item, and the ledger it is
 * filed against so the list can be grouped by company book.
 *
 * ⚠ READ STRAIGHT FROM THE TABLE, not through an RPC, and that is safe here in
 *   a way it is not on the customer's side. `mst_party_items` is readable by any
 *   member of staff (`mst_party_items_select` is `is_staff`), and this screen is
 *   coordinator-only. It is the WRITE that needs a definer function, because the
 *   write policy is admin-or-master-manager and a coordinator is neither.
 */
export interface OrgItemRow {
  partyId: string;
  itemId: string;
  itemName: string;
  itemCode: string | null;
  itemType: string | null;
  companyId: string | null;
}

/**
 * Keyed on the ticked ledgers rather than on the org, because the Add form has
 * no org yet — the whole point of the section is that it works before the first
 * save. Sorted so that reordering the ticks does not miss the cache.
 */
export const orgItemsQueryKey = (partyIds: readonly string[]) =>
  ["dispatch", "customer-org-items", [...partyIds].sort().join(",")] as const;

export async function fetchOrgItems(partyIds: readonly string[]): Promise<OrgItemRow[]> {
  if (partyIds.length === 0) return [];
  const { data, error } = await db
    .from("mst_party_items")
    .select("party_id,item_id,item:mst_items(id,name,code,item_type,company_id,active)")
    .in("party_id", partyIds as string[])
    .eq("active", true)
    // The largest customer today maps 84 pairs. The cap is a guard against a
    // silent truncation at PostgREST's default, not a real limit.
    .limit(5000);
  if (error) throw new Error(error.message);

  /**
   * ⚠ EVERY PAIR, NOT ONE PER ITEM — the same item really is mapped twice.
   *
   *   Nothing constrains a mapping to the item's own book: Central Masters →
   *   Customer Items has an OPTIONAL company filter, so an O-tec item can be and
   *   is mapped to a customer's Enterprise ledger as well as their O-tec one.
   *   Live right now: 5 of Bishen's items and 5 of Kalahansh's sit on two of that
   *   customer's ledgers each.
   *
   *   The caller needs both rows, because `partyId` is the only thing that says
   *   which BOOK can supply the item — and that is the question the customer's
   *   own screen will ask in Phase 2. Collapsing to one row per item throws that
   *   away and, done naively, counts a cross-book twin twice.
   *
   *   Collapsing to what the reader should see — one row per NAME — is the
   *   component's job, and it has to be by name rather than by id because the
   *   count has to match `item_count` on the grid, which the server computes as
   *   `count(distinct i.name)`.
   */
  return ((data ?? []) as any[])
    .filter((r) => r.item?.active)
    .map((r): OrgItemRow => ({
      partyId: r.party_id,
      itemId: r.item_id,
      itemName: r.item?.name ?? "",
      itemCode: r.item?.code ?? null,
      itemType: r.item?.item_type ?? null,
      companyId: r.item?.company_id ?? null,
    }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName));
}

export interface SetOrgItemsResult {
  added: number;
  reactivated: number;
  removed: number;
  skipped: number;
}

/**
 * Add and remove in one call, across every book the ticked ledgers occupy.
 *
 * ⚠ THE ADMIN NEVER NAMES A BOOK. Tally files a stock item in exactly one
 *   company book, so the item itself says where it belongs; the server resolves
 *   the ledger from `mst_items.company_id`. Asking the admin to choose the book
 *   first — as the OD-9 mapping modal has to, because it is opened from an order
 *   already committed to one — would be asking a question the data answers.
 *
 * ⚠ REMOVAL IS SOFT, and the server enforces that rather than trusting callers.
 *   masters-sync upserts `mst_party_items` on (party_id, item_id) and would
 *   recreate a deleted row the next time the customer bought the item; it never
 *   rewrites `active`, so a switched-off pair stays off.
 */
export async function setCustomerOrgItems(
  partyIds: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): Promise<SetOrgItemsResult> {
  const { data, error } = await db.rpc("fms_dispatch_set_customer_org_items", {
    p_party_ids: partyIds,
    p_add: add,
    p_remove: remove,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Partial<SetOrgItemsResult>;
  return {
    added: r.added ?? 0,
    reactivated: r.reactivated ?? 0,
    removed: r.removed ?? 0,
    skipped: r.skipped ?? 0,
  };
}

type OrgRow = {
  id: string;
  display_name: string;
  party_ids: string[] | null;
  party_names: string[] | null;
  customer_location: string | null;
  notify_user_ids: string[] | null;
  notify_names: string[] | null;
  default_location_id: string | null;
  default_dispatch_type: string | null;
  active: boolean;
  login_count: number | null;
  item_count: number | null;
  missing: string[] | null;
};

export async function fetchCustomerOrgs(): Promise<CustomerOrg[]> {
  const { data, error } = await db.rpc("fms_dispatch_customer_orgs_admin");
  if (error) throw new Error(error.message);
  return ((data ?? []) as OrgRow[]).map((r) => ({
    id: r.id,
    displayName: r.display_name,
    partyIds: r.party_ids ?? [],
    partyNames: r.party_names ?? [],
    customerLocation: r.customer_location,
    notifyUserIds: r.notify_user_ids ?? [],
    notifyNames: r.notify_names ?? [],
    defaultLocationId: r.default_location_id,
    defaultDispatchType:
      r.default_dispatch_type === "local" || r.default_dispatch_type === "transport"
        ? r.default_dispatch_type
        : null,
    active: r.active,
    loginCount: r.login_count ?? 0,
    itemCount: r.item_count ?? 0,
    missing: (r.missing ?? []) as OrgMissing[],
  }));
}

export async function fetchCustomerLogins(): Promise<CustomerLogin[]> {
  const { data, error } = await db
    .from("fms_dispatch_customer_logins")
    .select("profile_id,org_id,active");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { profile_id: string; org_id: string; active: boolean }[]).map((r) => ({
    profileId: r.profile_id,
    orgId: r.org_id,
    active: r.active,
  }));
}

export async function saveCustomerOrg(input: SaveCustomerOrgInput): Promise<string> {
  const { data, error } = await db.rpc("fms_dispatch_save_customer_org", {
    p: {
      id: input.id ?? null,
      display_name: input.displayName,
      party_ids: input.partyIds,
      customer_location: input.customerLocation,
      notify_user_ids: input.notifyUserIds,
      default_location_id: input.defaultLocationId,
      default_dispatch_type: input.defaultDispatchType,
      active: input.active,
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function linkCustomerLogin(
  profileId: string,
  orgId: string,
  active = true,
): Promise<void> {
  const { error } = await db.rpc("fms_dispatch_link_customer_login", {
    p: { profile_id: profileId, org_id: orgId, active },
  });
  if (error) throw new Error(error.message);
}

export interface AddCustomerInput extends SaveCustomerOrgInput {
  loginName: string;
  loginEmail: string;
  loginPassword: string;
  /** Item ids to map before the org is saved. See the ordering note below. */
  addItems?: readonly string[];
  removeItems?: readonly string[];
}

/**
 * The whole of onboarding a customer, as ONE action.
 *
 * Five things have to happen and three of them are invisible if you forget them:
 * what they may order, the auth account, the `is_external` flag, the single app
 * grant, and the org + login rows. Done by hand that is five steps in three
 * different screens, and the one that gets missed is the grant — the account
 * exists, the customer signs in, and lands on a page telling them they have no
 * access to anything.
 *
 * ⚠ ORDER MATTERS. The login is LAST: if the org fails to save we must not
 *   already have created a login we then have to remember to delete; a half-made
 *   customer with no auth account is a row an admin can simply finish or bin,
 *   whereas an orphaned auth account is invisible from this screen entirely.
 *
 * ⚠ AND THE ITEMS ARE FIRST, WHICH LOOKS BACKWARDS AND IS NOT (OD-14).
 *   `fms_dispatch_save_customer_org` runs the readiness check whenever `active`
 *   is true, and one of its arms is "no items mapped". Mapping after the org save
 *   would therefore make the very first save of a switched-on customer fail on a
 *   condition the same dialog had just satisfied.
 *
 *   Mapping first is safe because a mapping does not belong to the org: it is a
 *   row in a central master, keyed on the LEDGER, standing on its own whether or
 *   not this customer is ever created. If the org save then fails, the admin
 *   fixes the org and presses Create again; the pairs are already there and come
 *   back `skipped`, not duplicated.
 *
 * ⚠ `moduleLevels` IS EXACTLY ONE APP. Not a default, not a merge — a customer must
 *   hold `customer-orders` and nothing else. The ordinary user form seeds every new
 *   user with `{ "task-management": "edit" }`, which on a customer account would be
 *   a hidden grant nobody can see and everybody forgets.
 */
export async function addCustomer(input: AddCustomerInput): Promise<{ orgId: string; profileId: string }> {
  if ((input.addItems?.length ?? 0) > 0 || (input.removeItems?.length ?? 0) > 0) {
    await setCustomerOrgItems(input.partyIds, input.addItems ?? [], input.removeItems ?? []);
  }

  const orgId = await saveCustomerOrg(input);

  const profileId = await createUserViaFunction({
    name: input.loginName,
    email: input.loginEmail,
    phone: "",
    isExternal: true,
    password: input.loginPassword,
    role: "employee",
    moduleLevels: { "customer-orders": "edit" },
  });

  await linkCustomerLogin(profileId, orgId, true);
  return { orgId, profileId };
}

/* -------------------------------------------------------------------------- */
/*  What the browser needs to mirror the server's recipient rule               */
/* -------------------------------------------------------------------------- */

/**
 * `raised_by` → which customer, and who we named to act on their orders.
 *
 * ⚠ THIS EXISTS BECAUSE THE CLIENT HAS THE SAME BUG THE SERVER DID, INDEPENDENTLY.
 *   `store.tsx`'s `canActOn` is a hand-written mirror of
 *   `fms_dispatch_can_act__ungated`. Fixing the RLS alone lets the clerk READ a
 *   customer order while the client still drops it out of their queue — same
 *   symptom, two different bugs, and the second one is invisible because nothing
 *   errors.
 *
 * Deliberately NOT a read of `fms_dispatch_customer_orgs`: that table is
 * coordinator-only and the people who need this are ordinary clerks. The RPC
 * returns these two columns and nothing else, so the ticked-ledger list (Q11)
 * still never leaves the server.
 */
export interface CustomerOrderActor {
  /** The customer login that raises orders. */
  profileId: string;
  orgId: string;
  /** Our staff, named on this customer in Setup. */
  notifyUserIds: string[];
}

export const CUSTOMER_ACTORS_QK = ["dispatch", "customer-actors"] as const;

export async function fetchCustomerOrderActors(): Promise<CustomerOrderActor[]> {
  const { data, error } = await db.rpc("fms_dispatch_customer_order_actors");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { profile_id: string; org_id: string; notify_user_ids: string[] | null }[])
    .map((r) => ({
      profileId: r.profile_id,
      orgId: r.org_id,
      notifyUserIds: r.notify_user_ids ?? [],
    }));
}

/* -------------------------------------------------------------------------- */
/*  Credit check completing a customer order                                   */
/* -------------------------------------------------------------------------- */

/**
 * What the credit-check clerk may choose on ONE customer order.
 *
 * Only the COMPANIES of the ticked ledgers come back — never the ledgers. Staff
 * already see every company master, so this discloses nothing new; what it buys
 * is that the picker offers exactly what the server will accept, instead of
 * thirty companies of which five are allowed.
 */
export interface CustomerIntakeOptions {
  companies: { id: string; name: string }[];
  /** Pre-fills only. Always changeable — decisions Q1/Q2 stand. */
  defaultLocationId: string | null;
  defaultDispatchType: "local" | "transport" | null;
}

export const intakeOptionsQueryKey = (orderId: string) =>
  ["dispatch", "customer-intake-options", orderId] as const;

export async function fetchCustomerIntakeOptions(orderId: string): Promise<CustomerIntakeOptions> {
  const { data, error } = await db.rpc("fms_dispatch_customer_intake_options", { p_order: orderId });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    company_id: string; company_name: string;
    default_location_id: string | null; default_dispatch_type: string | null;
  }[];
  return {
    companies: rows.map((r) => ({ id: r.company_id, name: r.company_name })),
    defaultLocationId: rows[0]?.default_location_id ?? null,
    defaultDispatchType:
      rows[0]?.default_dispatch_type === "local" || rows[0]?.default_dispatch_type === "transport"
        ? rows[0].default_dispatch_type
        : null,
  };
}

/**
 * ⚠ `completeCustomerIntake` WAS HERE, AND IS GONE (OD-14).
 *
 *   It filled in the three fields a customer order arrived without, from a panel
 *   bolted to the top of the credit-check modal — which was, as that panel said,
 *   "the only workable place for it" while the work had no screen of its own.
 *   It has one now: `pages/orders/CompleteCustomerOrder.tsx`, backed by
 *   `fms_dispatch_complete_customer_order`, which does the same three fields plus
 *   the rest of the sales order and moves the order on to credit check.
 *
 *   `fetchCustomerIntakeOptions` below SURVIVES and is used by that page — it is
 *   what keeps the company picker to the customer's ticked ledgers without ever
 *   sending the ledgers themselves (Q11).
 *
 *   The SQL function `fms_dispatch_complete_customer_intake` is left in place,
 *   unreachable from the app, rather than dropped: changes here are additive-only,
 *   and the credit-check guard that refuses an incomplete intake stays as a belt
 *   and braces it can no longer trip.
 */
