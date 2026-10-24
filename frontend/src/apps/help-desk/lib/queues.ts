import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { dueIsoFrom, resolveStepSla, type StepSlaMap } from "./sla";
import type { StepKey } from "./steps";
import type { Ticket, TicketCategory } from "../types";

/**
 * Turning tickets into work-items: who owes what, and by when.
 *
 * Every consumer reads from here — the queues, the dashboard, My Work Today, the
 * Control Center adapter and the ranking scorer — so the answer to "is this
 * late?" exists exactly once.
 */

export interface HelpQueueEntry extends QueueEntryBase<StepKey> {
  ticketId: string;
  ticketNo: string;
  subject: string;
  categoryId: string;
  categoryName: string;
  /** Null on an untimed category — see `ticketDueIso`. */
  tatDays: number | null;
  /** The category's own wording, shown wherever the due date would be. */
  tatText: string | null;
  confidential: boolean;
  /** Who owes it right now: the assignee, else the category owners. */
  ownerIds: string[];
  raisedBy: string | null;
  raisedAt: string;
  roundNo: number;
  reopenCount: number;
}

/**
 * The due date for one step of one ticket, as an IST-local yyyy-mm-dd, or
 * `null` when it is deliberately untimed.
 *
 * ⚠⚠ `resolve` IS TIMED BY THE CATEGORY, NOT BY THE STEP SLA. That is the point
 *   of the category master: an attendance correction is due in 1 working day and
 *   a PMS query in 3, and both are the same step. A module-wide number would
 *   make thirty different promises into one.
 *
 * ⚠⚠ AND A NULL `tatDays` MUST RETURN NULL, NOT A DEFAULT. Five categories are
 *   deliberately untimed ("As per POSH Policy", "As per Exit Policy", …).
 *   `QueueEntryBase.dueIso` already means null as "can never be late".
 *   Substituting the step default would put a POSH complaint in somebody's
 *   overdue list on a schedule nobody agreed to, and the SLA report would count
 *   it as a miss.
 *
 * ⚠ `awaiting_info` IS A TRIGGER STEP — its clock starts when the QUESTION WAS
 *   ASKED (`infoRequestedAt`), which is not a step completion. A trigger step
 *   that falls through to the generic anchor path is BORN OVERDUE; see the
 *   warning in lib/sla.ts.
 */
export function ticketDueIso(
  t: Ticket,
  cat: TicketCategory | undefined,
  slaMap: StepSlaMap,
  step: StepKey,
): string | null {
  const sla = slaMap[step];
  if (!sla) return null;

  switch (step) {
    case "acknowledge":
      // Same working day as the ticket was raised (days = 0 by default).
      return dueIsoFrom(t.raisedAt, sla);

    case "awaiting_info":
      // Trigger step: measured from the moment somebody was asked.
      return dueIsoFrom(t.infoRequestedAt, sla);

    case "resolve": {
      // See the ⚠⚠ above. No category, or no TAT on it, means untimed.
      if (!cat || cat.tatDays === null) return null;
      return dueIsoFrom(t.raisedAt, { ...sla, days: cat.tatDays });
    }

    case "confirm":
      // The employee is being asked to accept a resolution, so the resolution is
      // what starts their clock.
      return dueIsoFrom(t.resolvedAt, sla);

    default:
      return null;
  }
}

/** Who owes this ticket right now. Mirrors SQL's fms_help_owner_ids(). */
export function ticketOwnerIds(t: Ticket, cat: TicketCategory | undefined): string[] {
  const base = t.assigneeId ? [t.assigneeId] : (cat?.ownerIds ?? []);
  const escalated = [
    ...(t.escalatedL1At ? (cat?.escalationL1Ids ?? []) : []),
    ...(t.escalatedL2At ? (cat?.escalationL2Ids ?? []) : []),
  ];
  return Array.from(new Set([...base, ...escalated].filter(Boolean)));
}

/**
 * Who a given step is owed BY, for this ticket.
 *
 * ⚠ THIS IS "WHO OWES IT", NOT "WHO MAY ACT". The additive Setup co-owners and
 *   the coordinators may also act (fms_help_can_act) and are deliberately absent
 *   here: charging a coordinator with every open ticket in the hub would bury
 *   their My Work list and wreck their ranking score.
 */
export function stepOwedBy(t: Ticket, cat: TicketCategory | undefined, step: StepKey): string[] {
  switch (step) {
    case "acknowledge":
    case "resolve":
      return ticketOwnerIds(t, cat);
    case "awaiting_info":
      return t.infoFromUserId ? [t.infoFromUserId] : [];
    case "confirm":
      return t.raisedBy ? [t.raisedBy] : [];
    default:
      return [];
  }
}

/** Is this ticket still moving? Closed and cancelled owe nobody anything. */
export const isOpenTicket = (t: Ticket): boolean =>
  t.status !== "closed" && t.status !== "cancelled";

/**
 * Every open work-item across a set of tickets.
 *
 * ⚠ A HELD TICKET IS STILL OPEN AND IS STILL LISTED. `on_hold` is excluded from
 *   nobody's queue on purpose: hiding parked work is how a ticket sits for five
 *   weeks with no one noticing. The screens badge it instead, and
 *   `holdAwareBucketOf` (shared/lib/dueBuckets) keeps it out of the overdue
 *   count without hiding the row.
 */
export function openEntries(
  tickets: Ticket[],
  categoryById: Map<string, TicketCategory>,
  storedSla: Record<string, unknown> | null | undefined,
): HelpQueueEntry[] {
  const slaMap = resolveStepSla(storedSla as never);
  const out: HelpQueueEntry[] = [];

  for (const t of tickets) {
    if (!isOpenTicket(t) || !t.currentStep) continue;
    const cat = categoryById.get(t.categoryId);
    const step = t.currentStep;
    out.push({
      stepKey: step,
      entityId: t.id,
      ref: t.ticketNo,
      dueIso: ticketDueIso(t, cat, slaMap, step),
      ticketId: t.id,
      ticketNo: t.ticketNo,
      subject: t.subject,
      categoryId: t.categoryId,
      categoryName: cat?.name ?? "Unknown category",
      tatDays: cat?.tatDays ?? null,
      tatText: cat?.tatText ?? null,
      confidential: cat?.confidential ?? false,
      ownerIds: stepOwedBy(t, cat, step),
      raisedBy: t.raisedBy,
      raisedAt: t.raisedAt,
      roundNo: t.roundNo,
      reopenCount: t.reopenCount,
    });
  }
  return out;
}

/**
 * First Response Time in whole minutes, or null if not answered yet.
 *
 * The PDF's headline KPI (≤ 30 minutes). Deliberately NOT a due date — see the
 * hours trap in lib/sla.ts. This is a measurement the report renders; the
 * acknowledge step's DEADLINE is the same working day.
 */
export function firstResponseMinutes(t: Ticket): number | null {
  if (!t.acknowledgedAt) return null;
  const ms = new Date(t.acknowledgedAt).getTime() - new Date(t.raisedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.round(ms / 60_000);
}

/**
 * First Contact Resolution: resolved without ever having to ask the employee
 * anything, and never reopened. The PDF's ≥ 80% KPI, derived rather than stored.
 */
export const isFirstContactResolution = (t: Ticket): boolean =>
  t.resolvedAt !== null && t.reopenCount === 0 && t.roundNo === 0;
