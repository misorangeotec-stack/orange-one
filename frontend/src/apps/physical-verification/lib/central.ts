import { useQuery } from "@tanstack/react-query";
import { linkKey, loadImsLinks, saveImsEdits, type ImsField, type ImsLink } from "@/apps/bushra-central-master/lib/imsLink";
import { OTEC_SURAT_GUID } from "./stock";

/**
 * GROUP + CATEGORY FROM BUSHRA CENTRAL MASTER (asked 17-10-2026).
 *
 * The Master shows each item's Group and Category as Bushra Central Master holds them, and an
 * edit here saves straight back into it through the same IMS link every IMS sheet uses — one
 * store, so this list, the IMS sheets and Bushra Central Master never disagree.
 *
 * Who may edit is Bushra Central Master's own grant (`edit` on 'bushra-central-master', admins
 * always); RLS on its table enforces the same rule.
 */

export const CENTRAL_QUERY = ["physical-verification", "central"] as const;

export function useCentral() {
  return useQuery({ queryKey: CENTRAL_QUERY, queryFn: () => loadImsLinks([OTEC_SURAT_GUID]), staleTime: 5 * 60_000 });
}

export const centralLink = (links: Map<string, ImsLink> | undefined, item: string) =>
  links?.get(linkKey(OTEC_SURAT_GUID, item));

export async function saveCentralField(link: ImsLink, field: ImsField, value: string, userId: string): Promise<void> {
  await saveImsEdits([{ link, values: { [field]: value.trim() } }], userId);
}
