import type { StepKey } from "../lib/steps";

/**
 * The Help Desk domain, as the screens use it. Mirrors the `fms_help_*` tables
 * (HD-1 and HD-2) in camelCase; the mapping lives in data/helpFetch.ts and
 * nowhere else.
 */

/**
 * ⚠ STATUSES ARE NOT STEP KEYS — the rule every FMS here follows. A status
 *   sitting in the work queue flows into the KPI tiles and the cross-FMS
 *   scoreboard as "work owed by Nobody", which is how parked work becomes
 *   invisible.
 *
 *   `awaiting_info` appears in BOTH unions and they mean different things: the
 *   STATUS says the ticket is parked on somebody outside the desk, the STEP says
 *   which queue it sits in. They move together today, and the pair is kept
 *   separate so a future "parked but still ours" state does not need a migration.
 */
export type TicketStatus =
  | "open"
  | "awaiting_info"
  | "resolved"
  | "closed"
  | "cancelled"
  | "on_hold";

/** D9: how a ticket stopped. The SLA report must keep the first two apart. */
export type ClosedReason = "confirmed" | "auto_closed" | "cancelled";

/** The modules a category can hand its work off to (decision D1). */
export type HandoffAppId =
  | "travel-desk"
  | "office-supplies"
  | "learning-development"
  | "hr-recruitment"
  | "hr-exit";

/**
 * One row of the ticket-category master — THE ROUTER.
 *
 * Everything the workflow needs to know that the employee should not have to
 * type. See the header of 20261217120100_hd1_help_desk_categories.sql.
 */
export interface TicketCategory {
  id: string;
  /** Stable report key. Reports match on THIS, never on `name`. */
  code: string;
  name: string;
  departmentId: string | null;
  /** The process owner(s). A ticket's `assigneeId` overrides this when set. */
  ownerIds: string[];
  escalationL1Ids: string[];
  /** What the source sheet promises, e.g. "Management (if policy exception)". */
  escalationL1Label: string | null;
  escalationL2Ids: string[];
  escalationL2Label: string | null;
  /**
   * Working days from raise to resolve. `0` = same working day.
   * ⚠ `null` = DELIBERATELY UNTIMED. `tatText` then says why, and the ticket's
   *   resolve step gets `dueIso = null` — which the engine already means as
   *   "can never be late". Never substitute a default here.
   */
  tatDays: number | null;
  /** The sheet's own wording, for the narrative TATs and alongside the number. */
  tatText: string | null;
  /** D4: narrows the read gate to the raiser, owners, escalations and admins. */
  confidential: boolean;
  /** Forces a free-text note — "Others" with no note tells the owner nothing. */
  requiresNote: boolean;
  /** D1: the module that actually owns this work. */
  handoffAppId: HandoffAppId | null;
  /** D5: IT Support hands off to an outside partner and is measured on it. */
  tracksExternalEscalation: boolean;
  externalPartnerLabel: string | null;
  active: boolean;
  sortOrder: number;
}

export interface Ticket {
  id: string;
  /** HD-2627-0001. FY-scoped; the series restarts each April. */
  ticketNo: string;
  categoryId: string;
  raisedBy: string | null;
  raisedAt: string;

  subject: string;
  body: string | null;
  otherNote: string | null;

  status: TicketStatus;
  /** `null` once the ticket has stopped moving (closed or cancelled). */
  currentStep: StepKey | null;
  /** Bumped by every loop — a question asked, a reopen. */
  roundNo: number;

  /** A reassignment REPLACES the category owners. Null = the category decides. */
  assigneeId: string | null;

  acknowledgedAt: string | null;
  acknowledgedBy: string | null;

  infoFromUserId: string | null;
  infoRequestedAt: string | null;
  infoAnsweredAt: string | null;

  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;

  confirmedAt: string | null;
  csatRating: number | null;
  csatNote: string | null;

  /** D3: the escalation ladder is driven by reopens, never by a TAT breach. */
  reopenCount: number;
  escalatedL1At: string | null;
  escalatedL2At: string | null;

  closedAt: string | null;
  closedReason: ClosedReason | null;

  holdFromStatus: string | null;
  heldAt: string | null;
  heldBy: string | null;
  holdReason: string | null;

  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;

  handoffAppId: HandoffAppId | null;
  handoffEntityId: string | null;
  /** The other module's human reference, copied so the ticket reads correctly
   *  even to somebody with no grant there. */
  handoffRef: string | null;

  externalEscalatedAt: string | null;
  externalRef: string | null;

  recategorisedFrom: string | null;

  createdAt: string;
  updatedAt: string;
}

/** One entry on a ticket's single timeline — a workflow event OR a comment. */
export interface TicketActivity {
  id: string;
  entityType: string;
  entityId: string;
  /** `comment` for a remark; otherwise the workflow event, e.g. `help_ticket_raised`. */
  type: string;
  actorId: string | null;
  note: string | null;
  meta: {
    category?: string;
    code?: string;
    attachments?: { path: string; name?: string }[];
    mentions?: string[];
    [k: string]: unknown;
  };
  createdAt: string;
}

export interface HelpNotification {
  id: string;
  userId: string;
  type: string;
  entityType: string;
  entityId: string;
  text: string | null;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** What the raise form sends. Attachments are uploaded FIRST and passed as paths. */
export interface RaiseInput {
  categoryId: string;
  subject: string;
  body?: string | null;
  /** Mandatory when the chosen category has `requiresNote`. */
  otherNote?: string | null;
  attachments?: { path: string; name?: string }[];
  /**
   * ⚠ A mention of somebody who cannot see the ticket is DROPPED BY THE SERVER,
   *   silently — raising would let an author probe who can see what. So the
   *   number notified can be lower than the number sent, and that is correct.
   */
  mentions?: string[];
}
