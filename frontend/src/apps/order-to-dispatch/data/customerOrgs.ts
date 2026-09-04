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
  /** The provisional `customer_id` an order is raised against, before credit check picks the book. */
  primaryPartyId: string | null;
  primaryPartyName: string | null;
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

export type OrgMissing = "ledgers" | "primary_ledger" | "recipients" | "items";

export const MISSING_LABEL: Record<OrgMissing, string> = {
  ledgers: "No ledgers ticked",
  primary_ledger: "No main ledger chosen",
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
  primaryPartyId: string | null;
  customerLocation: string | null;
  notifyUserIds: string[];
  defaultLocationId: string | null;
  defaultDispatchType: "local" | "transport" | null;
  active: boolean;
}

export const CUSTOMER_ORGS_QK = ["dispatch", "customer-orgs"] as const;

type OrgRow = {
  id: string;
  display_name: string;
  party_ids: string[] | null;
  party_names: string[] | null;
  primary_party_id: string | null;
  primary_party_name: string | null;
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
    primaryPartyId: r.primary_party_id,
    primaryPartyName: r.primary_party_name,
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
      primary_party_id: input.primaryPartyId,
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
}

/**
 * The whole of onboarding a customer, as ONE action.
 *
 * Four things have to happen and three of them are invisible if you forget them:
 * the auth account, the `is_external` flag, the single app grant, and the org +
 * login rows. Done by hand that is four steps in three different screens, and the
 * one that gets missed is the grant — the account exists, the customer signs in,
 * and lands on a page telling them they have no access to anything.
 *
 * ⚠ ORDER MATTERS, AND THE ORG COMES FIRST. If the org fails to save we must not
 *   already have created a login we then have to remember to delete; a half-made
 *   customer with no auth account is a row an admin can simply finish or bin,
 *   whereas an orphaned auth account is invisible from this screen entirely.
 *
 * ⚠ `moduleLevels` IS EXACTLY ONE APP. Not a default, not a merge — a customer must
 *   hold `customer-orders` and nothing else. The ordinary user form seeds every new
 *   user with `{ "task-management": "edit" }`, which on a customer account would be
 *   a hidden grant nobody can see and everybody forgets.
 */
export async function addCustomer(input: AddCustomerInput): Promise<{ orgId: string; profileId: string }> {
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
