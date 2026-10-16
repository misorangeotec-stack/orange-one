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

  const item = (c: CountRow, step: "count" | "assign" | "review"): WorkItem => ({
    id: `${SOURCE}:${c.id}:${step}`,
    source: SOURCE,
    sourceLabel: appName(SOURCE),
    ref: c.item,
    detail: [c.subGroup, c.group].filter((g, i, a) => g && a.indexOf(g) === i).join(" · ") || undefined,
    stage:
      step === "review" ? "Awaiting review"
      : step === "assign" ? "Needs a verifier"
      : c.status === "returned" ? "Recount" : "To count",
    dueIso: step === "review" ? null : c.verifyDate,
    to: step === "count" ? `${base}/count` : step === "review" ? `${base}/review` : `${base}/master`,
    assignment: step === "count" || isScheduler ? "direct" : "team",
    isApproval: step === "review",
  });

  const out: WorkItem[] = [];
  for (const c of pv.counts) {
    if (c.status === "scheduled" || c.status === "returned") {
      if (c.assignedTo === uid) out.push(item(c, "count"));
      else if (c.assignedTo === null && stepOne) out.push(item(c, "assign"));
    } else if (c.status === "submitted" && stepOne) {
      out.push(item(c, "review"));
    }
  }
  return out;
}
