import { useMemo } from "react";
import { apps } from "@/apps/registry";
import { useSession } from "@/core/platform/session";
import type { SearchEntry } from "@/shared/components/layout/navSearch";
import { buildHomeNav, visibleApps } from "./homeNav";

/**
 * Everything the sidebar search box can find, for the signed-in user.
 *
 * Built from `buildHomeNav` — the very list the home menu draws — so search offers exactly
 * the FMS and reports the menu would, under the same group names, and nothing it hides.
 * Apps may add finer destinations through `searchEntries` (Reports lists every report).
 *
 * The same index on every page, not the current app's own menu: the point is to jump to
 * any FMS from wherever you are, without first going home to dig through the groups.
 */
export function useHubSearch(): SearchEntry[] {
  const { hasModule, isAdmin, user } = useSession();
  return useMemo(() => {
    const access = { hasModule, isAdmin, user };
    const entries: SearchEntry[] = buildHomeNav(apps, access).map((item) => ({
      label: item.label,
      to: item.to,
      icon: item.icon,
      hint: item.group ? (item.subGroup ? `${item.group} › ${item.subGroup}` : item.group) : item.section,
    }));
    for (const app of visibleApps(apps, access)) {
      for (const extra of app.searchEntries?.({ isAdmin, user }) ?? []) {
        entries.push({ ...extra, icon: app.icon });
      }
    }
    return entries;
  }, [hasModule, isAdmin, user]);
}
