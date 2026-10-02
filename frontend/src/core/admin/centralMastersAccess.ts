import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useAuth } from "@/core/platform/auth";
import { fetchMyMasterManagerTypes, type CentralMasterType } from "@/core/platform/masterWrites";

/**
 * The areas a Central Masters right is given in — one per tab on the screen.
 *
 * ⚠ AN AREA CAN BE MORE THAN ONE MASTER TYPE, because some tabs write two tables.
 *   Saving a dispatch location also writes which companies dispatch from it
 *   (mst_company_locations); saving a customer writes which of our books may bill
 *   it (mst_party_companies). Granting only the first type would let the save
 *   start and then fail half-way, so each area carries every type its tab writes.
 *   `item_company` rides with Items for the same reason, should that tab ever
 *   write it.
 */
export const CENTRAL_MASTER_AREAS: {
  key: string;
  label: string;
  hint: string;
  types: CentralMasterType[];
}[] = [
  { key: "company", label: "Companies", hint: "Company alias and the modules each company shows in.", types: ["company"] },
  {
    key: "location", label: "Dispatch Locations", hint: "Sites and which companies dispatch from them.",
    types: ["location", "company_location"],
  },
  {
    key: "party", label: "Customers & Vendors", hint: "Portal fields on every ledger, and the companies that may bill a customer.",
    types: ["party", "party_company"],
  },
  { key: "item", label: "Items", hint: "Item type, category, ink type, modules.", types: ["item", "item_company"] },
  { key: "party_item", label: "Customer Items", hint: "Which items each customer buys.", types: ["party_item"] },
  { key: "item_group", label: "Item Groups", hint: "Portal fields on Tally stock groups.", types: ["item_group"] },
  { key: "unit", label: "Units", hint: "Portal fields on units of measure.", types: ["unit"] },
];

/** Where a non-admin with Central Masters rights opens the screen. Admins use /admin/masters. */
export const CENTRAL_MASTERS_PATH = "/central-masters";

/**
 * Whether the signed-in user may open Central Masters at all: an admin, or
 * anyone holding at least one master type in mst_master_managers.
 *
 * Shares its query key with Masters.tsx, so opening the screen costs no second read.
 */
export function useCentralMastersAccess(): { loading: boolean; allowed: boolean; types: CentralMasterType[] } {
  const { isAdmin } = useSession();
  // The AUTH id, not the directory profile's: it is there the moment RequireAuth
  // passes, so the guard never decides on an empty id. Same value as user.id.
  const authId = useAuth().session?.user.id ?? null;
  const q = useQuery({
    queryKey: ["masters", "my-manager-types", authId],
    queryFn: () => fetchMyMasterManagerTypes(authId),
    staleTime: 5 * 60 * 1000,
    enabled: !!authId,
  });
  const types = q.data ?? [];
  return { loading: !!authId && q.isLoading && !isAdmin, allowed: isAdmin || types.length > 0, types };
}
