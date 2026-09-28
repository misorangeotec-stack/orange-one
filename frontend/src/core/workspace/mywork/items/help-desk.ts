/**
 * Help Desk → work items. See ./README.md.
 *
 * ⚠ THIS MODULE IS UNIVERSAL, and most of what this file returns is an ORDINARY
 *   EMPLOYEE'S OWN obligation, not HR's pipeline. Two of the four steps belong to
 *   the person who raised the ticket or to whoever HR tagged — answer the
 *   question, accept the answer — and they are the reason the module is on the
 *   home screen at all. Get the ownership wrong here and a warehouse operator
 *   opens their morning to HR's queue.
 *
 * ⚠ THE OWNERSHIP RULE IS NOT RE-DERIVED HERE. `stepOwedBy` in
 *   apps/help-desk/lib/queues.ts is the single answer to "whose is this", shared
 *   with the queues, the dashboard and (in HD-12) the ranking scorer. This file
 *   reads it.
 *
 * ⚠ A COORDINATOR IS NOT GIVEN EVERY TICKET. `fms_help_can_act` lets one act on
 *   anything, which is right for a permission and wrong for a worklist: it would
 *   hand the HR Head every open ticket in the company and drown the ones actually
 *   hers. My Work answers "what should I do next", not "what am I allowed to
 *   touch" — the same line travel-desk and L&D draw.
 *
 * ⚠ AND THE SETUP STEP OWNERS ARE NOT EITHER. Rows in fms_help_step_owners are
 *   ADDITIVE co-owners — they exist so HR can act on a colleague's ticket when
 *   somebody is away, not so every ticket appears on all of their home screens.
 *
 * ⚠ FIVE CATEGORIES ARE DELIBERATELY UNTIMED ("As per POSH Policy", "As per Exit
 *   Policy"…). Their `dueIso` is null and the home screen files them as untimed
 *   rather than overdue. Never substitute a date here — inventing one would put a
 *   POSH complaint in somebody's overdue list on a schedule nobody agreed to.
 */
import { appName } from "@/apps/appInfo";
import type { HelpData } from "@/apps/help-desk/data/helpFetch";
import { resolveStepSla } from "@/apps/help-desk/lib/sla";
import { isOpenTicket, stepOwedBy, ticketDueIso } from "@/apps/help-desk/lib/queues";
import { stepByKey } from "@/apps/help-desk/lib/steps";
import type { WorkItem } from "../types";

/**
 * How each step reads on somebody's home screen.
 *
 * ⚠ WRITTEN FOR WHOEVER HOLDS IT, NOT FOR THE DESK. `awaiting_info`'s step title
 *   is "Waiting on the Employee", which is how HR thinks of it; the person who
 *   actually holds that row is the employee, and to them it means "they need
 *   something from you". Printing the desk's wording on an employee's home screen
 *   is how a row gets ignored for a week.
 */
const STAGE_LABEL: Record<string, string> = {
  acknowledge: "Pick it up",
  resolve: "Answer it",
  awaiting_info: "HR is waiting on you",
  confirm: "Did this sort it?",
};

export function helpDeskWorkItems(data: HelpData, uid: string): WorkItem[] {
  const categoryById = new Map(data.categories.map((c) => [c.id, c]));
  const slaMap = resolveStepSla(data.config?.step_sla ?? null);
  const label = appName("help-desk");
  const out: WorkItem[] = [];

  for (const t of data.tickets) {
    if (!isOpenTicket(t) || !t.currentStep) continue;

    const cat = categoryById.get(t.categoryId);
    const owners = stepOwedBy(t, cat, t.currentStep);
    if (!owners.includes(uid)) continue;

    out.push({
      id: `help-desk:${t.id}:${t.currentStep}:${t.roundNo}`,
      source: "help-desk",
      sourceLabel: label,
      ref: t.ticketNo,
      detail: t.subject,
      stage: STAGE_LABEL[t.currentStep] ?? stepByKey(t.currentStep)?.title,
      dueIso: ticketDueIso(t, cat, slaMap, t.currentStep),
      to: `/help-desk/tickets/${t.id}`,
      // A ticket is owed by the category's owners, which is usually one person
      // but is four on "General HR Query" and "Others". `direct` when it is
      // unambiguously this person's — a named assignee, or their own ticket to
      // confirm — and `team` when several people could pick it up.
      assignment: owners.length === 1 ? "direct" : "team",
      // ⚠ NOTHING HERE IS AN APPROVAL. `isApproval` puts a row in the home
      //   screen's approvals tile, which is for decisions somebody is blocking.
      //   Confirming a resolution looks like one and is not: the work is already
      //   done and nobody is waiting on the answer.
      // ⚠ `isHeld`, not a due-date trick. `holdAwareBucketOf` files a held row
      //   under `hold` and keeps the dueIso it HAD — seeing what it was due is
      //   useful — so a ticket somebody deliberately parked stops showing red
      //   without disappearing.
      isHeld: t.status === "on_hold",
    });
  }

  return out;
}
