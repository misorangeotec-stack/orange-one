import type { Candidate, Requisition, RequisitionStatus } from "../types";

/**
 * A POSITION is a requisition that actually became a job opening.
 *
 * The statuses before `posting` are a request working its way through HR and
 * Management approval — real work, but not an opening anyone can apply to, and it
 * already has a home on the Requisitions screen. Everything from posting onward is
 * a position, including the ones that ended: a closed vacancy is where hires,
 * time-to-hire and platform effectiveness live.
 */
export const POSITION_STATUSES: RequisitionStatus[] = [
  "posting",
  "sourcing",
  "on_hold",
  "closed",
  "cancelled",
];

export const isPosition = (r: Requisition): boolean => POSITION_STATUSES.includes(r.status);

/**
 * Still taking candidates — the green dot.
 *
 * Deliberately narrower than `isOpenRequisition` in lib/queues.ts, which answers a
 * different question ("does this still emit work?") and counts an approval-stage MRF
 * as open. Here the question is "can somebody still apply to this?", and on hold
 * means no.
 */
export const isLivePosition = (r: Requisition): boolean => r.status === "posting" || r.status === "sourcing";

/**
 * When anything last MOVED on this position.
 *
 * Candidate movement, not requisition edits: a vacancy is alive because people are
 * flowing through it. Reads the candidates' own stage timestamps rather than the
 * activity trail, which is best-effort (a failed `announce` is swallowed) and would
 * silently under-report.
 */
export function lastActivityIso(r: Requisition, candidates: Candidate[]): string | null {
  let latest: string | null = r.postedAt ?? r.submittedAt ?? null;
  for (const c of candidates) {
    for (const t of [
      c.uploadedAt,
      c.hrShortlistedAt,
      c.sharedToHodAt,
      c.hodDecidedAt,
      c.telephonicAt,
      c.interview1At,
      c.interview2At,
      c.interview3At,
      c.finalDecisionAt,
      c.finalizedAt,
      c.joinedAt,
      c.disqualifiedAt,
    ]) {
      if (t && (latest === null || t > latest)) latest = t;
    }
  }
  return latest;
}
