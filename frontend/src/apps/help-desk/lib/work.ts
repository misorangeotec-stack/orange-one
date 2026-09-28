import { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
import { resolveStepSla, type StepSlaMap } from "./sla";
import { isOpenTicket, stepOwedBy, ticketDueIso } from "./queues";
import type { StepKey } from "./steps";
import type { HelpData } from "../data/helpFetch";
import type { Ticket, TicketActivity, TicketCategory } from "../types";

/**
 * Every step this desk has ever CLOSED, and every step still open — the shape
 * the monthly ranking and the nightly KPI facts need (CC-1 / KPI-1).
 *
 * ⚠⚠ THE CLOSED HALF IS READ FROM THE TIMELINE, NOT FROM THE TICKET ROW, AND IT
 *    HAS TO BE.
 *
 *    A reopen CLEARS `resolved_at`, `resolved_by` and `resolution` so the next
 *    answer replaces them (HD-5). So a ticket answered, sent back, answered
 *    again and finally accepted carries ONE resolution on the row and THREE in
 *    its history. Scoring the row would credit the person with one step and
 *    silently lose the two they actually did — which is precisely backwards,
 *    because a reopened ticket is more work, not less.
 *
 *    `fms_help_activity` has all of it: who, when, and in what order.
 *
 * ⚠ AND THE DUE DATE OF A LATER ROUND IS MEASURED FROM ITS REOPEN, not from when
 *   the ticket was first raised. Otherwise every round after the first is born
 *   overdue, and the more carefully somebody handles a difficult ticket the
 *   worse their score gets. The walk below carries a moving anchor for exactly
 *   this.
 *
 * ⚠ FIVE CATEGORIES ARE UNTIMED, so their `resolve` steps have `dueIso: null`.
 *   The ranking drops those as `untimed` and REPORTS the drop; it must never
 *   score them as met.
 */

export interface ClosedHelpStep {
  stepId: string;
  entityId: string;
  ref: string;
  stepKey: StepKey;
  roundNo: number;
  dueIso: string | null;
  actorId: string | null;
  doneAtIso: string | null;
  /** A seeded or demo ticket — scored for nobody. */
  isTest: boolean;
}

export interface OpenHelpStep {
  entityId: string;
  stepKey: StepKey;
  roundNo: number;
  isTest: boolean;
  ownerIds: string[];
}

/** The four events that mean "a step was completed", and which step each closes. */
const CLOSES: Record<string, StepKey> = {
  help_ticket_acknowledged: "acknowledge",
  help_ticket_info_answered: "awaiting_info",
  help_ticket_resolved: "resolve",
  help_ticket_confirmed: "confirm",
};

/**
 * ⚠ A TEST TICKET IS DECIDED ONCE, ON THE TICKET, and every step of it inherits
 *   that. L&D learned this the hard way: deciding per step from the displayed
 *   text let two steps of a test session through into a real score.
 */
const isTestTicket = (t: Ticket): boolean => /\bZZ TEST\b/i.test(t.subject ?? "");

const addDays = (fromIso: string | null, days: number): string | null => {
  if (!fromIso) return null;
  const d = new Date(fromIso);
  if (Number.isNaN(d.getTime())) return null;
  return localDateIso(addWorkingDays(d, days));
};

export function buildHelpWork(
  data: HelpData,
  slaMap: StepSlaMap = resolveStepSla(data.config?.step_sla ?? null),
): { closed: ClosedHelpStep[]; open: OpenHelpStep[] } {
  const catById = new Map<string, TicketCategory>(data.categories.map((c) => [c.id, c]));
  const byTicket = new Map<string, TicketActivity[]>();
  for (const a of data.activity) {
    if (a.entityType !== "ticket") continue;
    const list = byTicket.get(a.entityId) ?? [];
    list.push(a);
    byTicket.set(a.entityId, list);
  }

  const closed: ClosedHelpStep[] = [];
  const open: OpenHelpStep[] = [];

  for (const t of data.tickets) {
    const cat = catById.get(t.categoryId);
    const test = isTestTicket(t);
    const events = (byTicket.get(t.id) ?? [])
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // The moving anchors. `roundAnchor` is when the CURRENT round of work
    // started: the raise for round 0, the reopen for every round after it.
    let round = 0;
    let roundAnchor: string = t.raisedAt;
    let lastAsked: string | null = null;
    let lastResolved: string | null = null;

    for (const e of events) {
      if (e.type === "help_ticket_reopened") {
        round += 1;
        roundAnchor = e.createdAt;
        continue;
      }
      if (e.type === "help_ticket_info_requested") {
        lastAsked = e.createdAt;
        continue;
      }

      const step = CLOSES[e.type];
      if (!step) continue;

      // What this step WAS due, at the time it was worked.
      let dueIso: string | null;
      switch (step) {
        case "acknowledge":
          // Same working day as the ticket was raised. Only ever happens once.
          dueIso = addDays(t.raisedAt, slaMap.acknowledge?.days ?? 0);
          break;
        case "awaiting_info":
          // From the moment somebody was asked — a trigger step.
          dueIso = addDays(lastAsked, slaMap.awaiting_info?.days ?? 1);
          break;
        case "resolve":
          // ⚠ THE CATEGORY'S TAT, from THIS round's anchor. Null when untimed.
          dueIso = cat?.tatDays == null ? null : addDays(roundAnchor, cat.tatDays);
          break;
        case "confirm":
          dueIso = addDays(lastResolved, slaMap.confirm?.days ?? 2);
          break;
        default:
          dueIso = null;
      }

      if (step === "resolve") lastResolved = e.createdAt;

      closed.push({
        // ⚠ THE ROUND IS PART OF THE ID. Round 2's resolve is a different scored
        //   step from round 1's — the same rule Order to Dispatch keeps.
        stepId: `${t.id}:${step}:${round}`,
        entityId: t.id,
        ref: t.ticketNo,
        stepKey: step,
        roundNo: round,
        dueIso,
        actorId: e.actorId,
        doneAtIso: e.createdAt,
        isTest: test,
      });
    }

    if (isOpenTicket(t) && t.currentStep) {
      open.push({
        entityId: t.id,
        stepKey: t.currentStep,
        roundNo: t.roundNo,
        isTest: test,
        ownerIds: stepOwedBy(t, cat, t.currentStep),
      });
    }
  }

  return { closed, open };
}

/** The due date of a ticket's CURRENT step — the one the queues and ranking share. */
export const openDueIso = (
  t: Ticket,
  cat: TicketCategory | undefined,
  slaMap: StepSlaMap,
): string | null => (t.currentStep ? ticketDueIso(t, cat, slaMap, t.currentStep) : null);
