/**
 * This module → My Work.
 *
 * Shares the OCPI store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work lives in
 * `../items/ocpi.ts`, which the daily snapshot email also runs. See
 * ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchOcpiData, ocpiQueryKey } from "@/apps/ocpi/data/ocpiFetch";
import { ocpiWorkItems } from "../items/ocpi";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useOcpiWork(active: boolean): MyWorkResult {
  const { user, isAdmin, canEditModule } = useSession();
  const uid = user?.id ?? null;
  const canEdit = canEditModule("ocpi");

  const { data, isLoading, error } = useQuery({
    queryKey: ocpiQueryKey(uid),
    queryFn: fetchOcpiData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return ocpiWorkItems(data, uid, isAdmin, canEdit);
  }, [data, uid, isAdmin, canEdit]);

  return { items, isLoading, error };
}

export const ocpiProvider: MyWorkProvider = {
  key: "ocpi",
  label: appName("ocpi"),
  appId: "ocpi",
  category: "sales",
  unit: "steps",
  tier: 2,
  useMyWork: useOcpiWork,
};
