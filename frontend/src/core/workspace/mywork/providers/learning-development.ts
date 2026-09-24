/**
 * This module → My Work.
 *
 * Shares the Learning & Development store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each
 * one says, lives in `../items/learning-development.ts` — because the daily
 * snapshot email runs that same code on the server, where there is no browser to
 * run a hook. Adding a condition here instead would apply it to the screen and
 * not to the mail, and the two would start disagreeing about the same person.
 * See ../items/README.md.
 *
 * ⚠ NO `appId` GATE WORTH THE NAME. Every other provider here is narrowed by
 *   `session.hasModule(appId)`; this module is UNIVERSAL, so that check answers
 *   true for all 67 people and the fetch happens for everybody. That is correct —
 *   everybody is a potential participant — but it means this provider is the one
 *   that runs most often in the hub, which is why it is tier 2 and why the items
 *   rule is so careful about what it hands back.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchLdData, ldQueryKey } from "@/apps/learning-development/data/ldFetch";
import { learningDevelopmentWorkItems } from "../items/learning-development";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useLearningDevelopmentWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: ldQueryKey(uid),
    queryFn: fetchLdData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return learningDevelopmentWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const learningDevelopmentProvider: MyWorkProvider = {
  key: "learning-development",
  label: appName("learning-development"),
  appId: "learning-development",
  category: "hr",
  // A row here is one step somebody owes — their own RSVP, their assignment, an
  // approval — the same unit the other FMS providers count in.
  unit: "steps",
  tier: 2,
  useMyWork: useLearningDevelopmentWork,
};
