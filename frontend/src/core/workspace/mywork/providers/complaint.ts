/**
 * This module → My Work.
 *
 * Shares the Complaint store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work lives in
 * `../items/complaint.ts`, which the daily snapshot email also runs. See
 * ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchComplaintData, complaintQueryKey } from "@/apps/complaint/data/complaintFetch";
import { complaintWorkItems } from "../items/complaint";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useComplaintWork(active: boolean): MyWorkResult {
  const { user, isAdmin, canEditModule } = useSession();
  const uid = user?.id ?? null;
  const canEdit = canEditModule("complaint");

  const { data, isLoading, error } = useQuery({
    queryKey: complaintQueryKey(uid),
    queryFn: fetchComplaintData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return complaintWorkItems(data, uid, isAdmin, canEdit);
  }, [data, uid, isAdmin, canEdit]);

  return { items, isLoading, error };
}

export const complaintProvider: MyWorkProvider = {
  key: "complaint",
  label: appName("complaint"),
  appId: "complaint",
  category: "plant",
  unit: "steps",
  tier: 2,
  useMyWork: useComplaintWork,
};
