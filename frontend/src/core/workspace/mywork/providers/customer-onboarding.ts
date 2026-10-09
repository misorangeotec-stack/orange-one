/**
 * This module → My Work.
 *
 * Shares the New Customer Onboarding store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work lives in
 * `../items/customerOnboarding.ts`, which the daily snapshot email also runs. See
 * ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchCustomerData, customerQueryKey } from "@hub/data/customerOnboarding/customerFetch";
import { customerOnboardingWorkItems } from "../items/customerOnboarding";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useCustomerOnboardingWork(active: boolean): MyWorkResult {
  const { user, isAdmin, canEditModule } = useSession();
  const uid = user?.id ?? null;
  const canEdit = canEditModule("customer-onboarding");

  const { data, isLoading, error } = useQuery({
    queryKey: customerQueryKey(uid),
    queryFn: fetchCustomerData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return customerOnboardingWorkItems(data, uid, isAdmin, canEdit);
  }, [data, uid, isAdmin, canEdit]);

  return { items, isLoading, error };
}

export const customerOnboardingProvider: MyWorkProvider = {
  key: "customer-onboarding",
  label: appName("customer-onboarding"),
  appId: "customer-onboarding",
  category: "sales",
  unit: "steps",
  tier: 2,
  useMyWork: useCustomerOnboardingWork,
};
