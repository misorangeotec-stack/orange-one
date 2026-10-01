import { useQuery } from "@tanstack/react-query";
import { loadItemLookup, type ItemLookup } from "@/apps/receivables-hub/lib/bushraSalesRegister";
import { COMPANY_SHORT } from "./expiry";

/**
 * CATEGORY and GROUP for an ink item — from CENTRAL MASTERS with the BUSHRA CENTRAL MASTER
 * corrections laid on top, exactly as the Bushra Sales / Purchase registers and dashboards read
 * them (the user asked, 30-09-2026: "if we are using Bushra Central Master, all items have a
 * category and group"):
 *
 *   Category = override.category  ?? mst_items.category
 *   Group    = override.groupName  ?? mst_item_groups.name (via mst_items.group_id)
 *
 * It is the SAME loader (`loadItemLookup`) under the SAME query key, so every Bushra report shows
 * one spelling for each value and the ~14k-row master is read once per session, not per page.
 *
 * Joined on (company, Tally item name) — mst_items.name is Tally's own item name verbatim. The
 * lot's own company's copy wins; failing that, any company's copy that carries the field (the same
 * ink is a separate item in each book, and is usually classified in at least one).
 */

export const NOT_IN_MASTER = "(not in Central Master)";
export const NOT_SET = "(not set)";

const GUID_OF: Record<string, string> = Object.fromEntries(Object.entries(COMPANY_SHORT).map(([g, s]) => [s, g]));
const wsKey = (s: string) => s.replace(/\s+/g, " ").trim();

export function useItemLookup() {
  return useQuery({
    queryKey: ["bushraSalesRegister", "itemLookup", "v3"],
    queryFn: loadItemLookup,
    staleTime: 30 * 60 * 1000,
  });
}

export interface MasterClass {
  category: string;
  group: string;
  inMaster: boolean;
}

export function classify(lookup: ItemLookup | undefined, company: string, item: string): MasterClass {
  const copies = lookup?.exact.get(wsKey(item)) ?? lookup?.folded.get(wsKey(item).toUpperCase());
  if (!copies?.length) return { category: NOT_IN_MASTER, group: NOT_IN_MASTER, inMaster: false };
  const guid = GUID_OF[company];
  const field = (f: "category" | "group") =>
    (copies.find((c) => c.companyGuid === guid && c[f]) ?? copies.find((c) => c[f]))?.[f] ?? NOT_SET;
  return { category: field("category"), group: field("group"), inMaster: true };
}
