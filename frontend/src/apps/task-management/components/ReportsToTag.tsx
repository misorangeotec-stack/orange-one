import type { Profile } from "../types";
import { useTaskStore } from "../mock/store";
import { cn } from "@/shared/lib/cn";

/**
 * Resolve a person's *immediate* reporting manager — the deepest ancestor listed on
 * their profile that we can actually see. Most people have a single HOD, in which case
 * that's returned directly; when several ancestors are present (e.g. a HOD and a
 * sub-HOD) the closest one wins, so the tag reads "↳ <sub-HOD>" rather than the top.
 */
export function useReportsTo() {
  const { profileById, downlineIds } = useTaskStore();
  return (person: Profile): Profile | undefined => {
    const cands = person.hodIds
      .map((id) => profileById(id))
      .filter((m): m is Profile => !!m && m.id !== person.id);
    if (cands.length === 0) return undefined;
    if (cands.length === 1) return cands[0];
    // Pick the closest manager: the candidate sitting inside every other candidate's downline.
    return cands.reduce((best, c) => (downlineIds(best.id).includes(c.id) ? c : best), cands[0]);
  };
}

/** Build the "↳ <manager>" suffix for dropdown sublabels, or null when there's nothing to show. */
export function useReportsToSuffix() {
  const reportsTo = useReportsTo();
  return (person: Profile, viewerId?: string): string | null => {
    const mgr = reportsTo(person);
    return mgr && mgr.id !== viewerId ? `↳ ${mgr.name}` : null;
  };
}

/**
 * Subtle "↳ <manager>" pill marking who a person reports to — used wherever we list
 * employees, so a sub-HOD's team is recognisable at a glance. Renders nothing when the
 * person has no visible manager, or when they report directly to `viewerId` (so a
 * viewer's own direct reports stay unadorned).
 */
export default function ReportsToTag({ person, viewerId, className }: { person: Profile; viewerId?: string; className?: string }) {
  const reportsTo = useReportsTo();
  const mgr = reportsTo(person);
  if (!mgr || mgr.id === viewerId) return null;
  return (
    <span
      title={`Reports to ${mgr.name}`}
      className={cn(
        "shrink-0 inline-flex items-center gap-0.5 rounded-full bg-navy/[0.04] text-grey-2 text-[10px] leading-none px-1.5 py-1",
        className
      )}
    >
      <span aria-hidden className="text-[11px] -mt-px">↳</span>
      {mgr.name}
    </span>
  );
}
