/**
 * This module → My Work.
 *
 * The Purchase twin — shares the import app's cache entry.
 *
 * ⚠ THIS FILE HOLDS NO RULES. Which rows are this person's work, and what each one
 * says, lives in `../items/import.ts` — because the daily snapshot email runs
 * that same code on the server, where there is no browser to run a hook. Adding a
 * condition here instead would apply it to the screen and not to the mail, and the
 * two would start disagreeing about the same person. See ../items/README.md.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchImportData, importQueryKey } from "@/apps/import/data/importFetch";
import { importWorkItems } from "../items/import";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useImportWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: importQueryKey(uid),
    queryFn: fetchImportData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    return importWorkItems(data, uid, isAdmin);
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const importProvider: MyWorkProvider = {
  key: "import",
  label: appName("import"),
  appId: "import",
  category: "purchase",
  unit: "steps",
  tier: 2,
  useMyWork: useImportWork,
};
