/**
 * This module → My Work.
 *
 * Shares the Help Desk store's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each
 * one says, lives in `../items/help-desk.ts` — because the daily snapshot email
 * runs that same code on the server, where there is no browser to run a hook.
 * Adding a condition here instead would apply it to the screen and not to the
 * mail, and the two would start disagreeing about the same person.
 * See ../items/README.md.
 *
 * ⚠ NO `appId` GATE WORTH THE NAME. This module is UNIVERSAL, so
 *   `hasModule('help-desk')` answers true for all 70 people and the fetch happens
 *   for everybody. That is correct — anyone may have asked HR something — but it
 *   makes this one of the most-run providers in the hub, which is why it is
 *   tier 2 and why the items rule is careful about what it hands back.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchHelpData, helpQueryKey } from "@/apps/help-desk/data/helpFetch";
import { helpDeskWorkItems } from "../items/help-desk";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useHelpDeskWork(active: boolean): MyWorkResult {
  const { user } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: helpQueryKey(uid),
    queryFn: fetchHelpData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return helpDeskWorkItems(data, uid);
  }, [data, uid]);

  return { items, isLoading, error };
}

export const helpDeskProvider: MyWorkProvider = {
  key: "help-desk",
  label: appName("help-desk"),
  appId: "help-desk",
  category: "hr",
  // One row is one step somebody owes on one ticket — the same unit the other
  // FMS providers count in.
  unit: "steps",
  tier: 2,
  useMyWork: useHelpDeskWork,
};
