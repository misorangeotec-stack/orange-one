/**
 * This module → My Work.
 *
 * Shares the Physical Verification pages' cache entry (PV_QUERY), so opening the
 * Count or Review page after the home screen costs nothing.
 *
 * ⚠ THIS FILE HOLDS NO RULES — they live in `../items/physicalVerification.ts`.
 *
 * Only the Orange One rows are read here. The live closing stock is a ConnectWave
 * read the Count page needs and the home screen does not.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { PV_QUERY, PvNotInstalled, fetchPv } from "@/apps/physical-verification/lib/pv";
import { physicalVerificationWorkItems } from "../items/physicalVerification";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function usePhysicalVerificationWork(active: boolean): MyWorkResult {
  const { user, isAdmin, canEditModule } = useSession();
  const uid = user?.id ?? null;
  const canEdit = canEditModule("physical-verification");

  const pv = useQuery({
    queryKey: PV_QUERY,
    queryFn: fetchPv,
    enabled: active && !!uid,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof PvNotInstalled) && n < 2,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!pv.data || !uid) return [];
    return physicalVerificationWorkItems(pv.data, uid, isAdmin, canEdit);
  }, [pv.data, uid, isAdmin, canEdit]);

  return { items, isLoading: pv.isLoading, error: pv.error };
}

export const physicalVerificationProvider: MyWorkProvider = {
  key: "physical-verification",
  label: appName("physical-verification"),
  appId: "physical-verification",
  category: "plant",
  unit: "items",
  tier: 1,
  useMyWork: usePhysicalVerificationWork,
};
