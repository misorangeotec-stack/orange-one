/**
 * Physical Verification → work items. See ./README.md.
 *
 * The app's two steps:
 *   - COUNT — a round given to this person (`assigned_to`) that is still to count
 *     or was sent back for a recount. Due on its verification date, so a round set
 *     for next week sits in "Next 2 days" / later rather than in Overdue. Same rows
 *     as the Count page's "To count" and "Later" lists together.
 *   - REVIEW — a submitted count waiting to be accepted or sent back. This one is
 *     the approval. It has no SLA of its own, so it carries no date.
 *   - TALLY — an accepted count with a difference not yet posted to Tally as a
 *     Stock Journal (step 4, 20270203120000). Rule mirrors canPost / pv_can_post.
 *
 * ⚠ A COUNT IS ONE NAMED PERSON'S WORK. The Count page lets an admin look at
 *   everybody's rounds, but putting every verifier's items on every admin's home
 *   screen would report one person's late count as overdue on five screens. An
 *   admin gets a count only when it was given to them.
 *
 * ⚠ A ROUND WITH NO VERIFIER (their account was deleted) is nobody's to count, so
 *   it goes to step 1 — the schedulers, and admins — to give to someone else.
 *
 * ⚠ NOT MAILED. `fetchPv` lives beside the ConnectWave stock reader the server
 *   bundle cannot load — see DELIBERATELY_UNCOVERED in supabase/worksnapshot/entry.ts.
 *   This file imports only types from the app, so it stays pure for the day it is.
 */
import { appName, appBasePath } from "@/apps/appInfo";
import type { CountRow, PvData } from "@/apps/physical-verification/lib/pv";
import { companyName } from "@/apps/physical-verification/lib/stock";
import type { WorkItem } from "../types";

const SOURCE = "physical-verification";

export function physicalVerificationWorkItems(
  pv: PvData,
  uid: string,
  isAdmin: boolean,
  canEdit: boolean,
): WorkItem[] {
  if (!canEdit) return [];
  const isScheduler = pv.schedulers.includes(uid);
  const stepOne = isAdmin || isScheduler;
  const base = appBasePath(SOURCE);

  // Same rule as canReview / pv_can_review: step 3 list; empty = step 1. (Review used to go to
  // step 1 even with a reviewer list set — those people could not act on it.)
  const isReviewer = pv.reviewers.includes(uid);
  const stepThree = isAdmin || (pv.reviewers.length ? isReviewer : isScheduler);
  // Same rule as canPost / pv_can_post: step 4 list; empty = step 3.
  const isPoster = pv.tallyPeople.includes(uid);
  const stepFour = isAdmin || (pv.tallyPeople.length ? isPoster : stepThree);

  const item = (c: CountRow, step: "count" | "assign" | "review" | "tally"): WorkItem => ({
    id: `${SOURCE}:${c.id}:${step}`,
    source: SOURCE,
    sourceLabel: appName(SOURCE),
    ref: c.item,
    detail: [companyName(c.companyGuid), c.subGroup, c.group].filter((g, i, a) => g && a.indexOf(g) === i).join(" · ") || undefined,
    stage:
      step === "review" ? "Awaiting review"
      : step === "tally" ? "Post to Tally"
      : step === "assign" ? "Needs a verifier"
      : c.status === "returned" ? "Recount" : "To count",
    dueIso: step === "review" || step === "tally" ? null : c.verifyDate,
    to: step === "count" ? `${base}/count` : step === "review" ? `${base}/review` : step === "tally" ? `${base}/tally` : `${base}/master`,
    assignment: step === "count" || (step === "tally" ? isPoster : step === "review" ? isReviewer || (!pv.reviewers.length && isScheduler) : isScheduler)
      ? "direct" : "team",
    isApproval: step === "review",
  });

  const out: WorkItem[] = [];
  for (const c of pv.counts) {
    if (c.status === "scheduled" || c.status === "returned") {
      if (c.assignedTo === uid) out.push(item(c, "count"));
      else if (c.assignedTo === null && stepOne) out.push(item(c, "assign"));
    } else if (c.status === "submitted" && stepThree) {
      out.push(item(c, "review"));
    } else if (c.status === "accepted" && (c.difference ?? 0) !== 0 && !c.tallyPostedAt && stepFour) {
      out.push(item(c, "tally"));
    }
  }
  return out;
}
