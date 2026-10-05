import type { Profile } from "@/core/platform/types";

/**
 * TEMPORARY: the ranking (CC-1) is hidden from everyone except admins while the
 * scoring is being reworked. To reopen it for all, make `canSeeRanking` return true
 * (or delete it and its call sites).
 *
 * This only hides the screens — the `fms-ranking` data is untouched.
 */
export function canSeeRanking(user: Profile | null | undefined): boolean {
  return user?.role === "admin";
}
