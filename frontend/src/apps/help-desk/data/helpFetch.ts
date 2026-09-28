import { supabase } from "@/core/platform/supabase";
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  HelpNotification,
  Ticket,
  TicketActivity,
  TicketCategory,
} from "../types";

/**
 * Help Desk read layer. One paginated pass over the module's tables, mapped
 * snake_case → camelCase, so the pure rules in lib/queues.ts get plain data and
 * every screen reads the same react-query cache entry.
 *
 * ⚠ TICKETS COME BACK RLS-FILTERED, AND AN EMPTY LIST IS NOT AN ERROR. The
 *   module is universal, so all 70 people load this — but `fms_help_can_see`
 *   withholds a ticket from anyone who neither raised it, owns its category,
 *   was asked about it, was escalated to, nor sits in the HR pool. A plain
 *   employee therefore gets their OWN tickets and the full category list, which
 *   is the intended shape. Never read an empty `tickets` array as "the module is
 *   broken".
 *
 * ⚠ AND A CONFIDENTIAL TICKET IS MISSING FROM THIS LIST FOR MOST PEOPLE, BY
 *   DESIGN (decision D4). Any count computed from `tickets` is therefore "what I
 *   can see", not "what exists" — the SLA and ageing reports must say so rather
 *   than presenting a filtered figure as a total.
 */

const PAGE = 1000;

type Tbl =
  | "fms_help_step_owners"
  | "fms_help_config"
  | "fms_help_categories"
  | "fms_help_master_requests"
  | "fms_help_tickets"
  | "fms_help_activity"
  | "fms_help_notifications";

/*
 * ⚠ `orderBy` MUST BE A COLUMN THAT EXISTS ON THAT TABLE, and getting it wrong
 *   takes the WHOLE MODULE down rather than one list. PostgREST answers 400 for
 *   an unknown order column, the `Promise.all` below rejects, and every screen
 *   then renders as though there were simply no data — an empty ticket list, no
 *   categories, and an HR executive told she has no queue because her step
 *   owners never loaded either. L&D hit exactly this on 22-09-2026. Check the
 *   migration before adding a call.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchAll(table: Tbl, orderBy = "created_at"): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const mapCategory = (r: any): TicketCategory => ({
  id: r.id,
  code: r.code,
  name: r.name,
  departmentId: r.department_id,
  ownerIds: r.owner_ids ?? [],
  escalationL1Ids: r.escalation_l1_ids ?? [],
  escalationL1Label: r.escalation_l1_label,
  escalationL2Ids: r.escalation_l2_ids ?? [],
  escalationL2Label: r.escalation_l2_label,
  // ⚠ `?? null`, never `?? 0`. A null TAT means DELIBERATELY UNTIMED and
  //   coalescing it to a number would give five categories a same-day deadline
  //   nobody agreed to — including POSH.
  tatDays: r.tat_days ?? null,
  tatText: r.tat_text,
  confidential: r.confidential ?? false,
  requiresNote: r.requires_note ?? false,
  handoffAppId: r.handoff_app_id,
  tracksExternalEscalation: r.tracks_external_escalation ?? false,
  externalPartnerLabel: r.external_partner_label,
  active: r.active ?? true,
  sortOrder: r.sort_order ?? 0,
});

const mapTicket = (r: any): Ticket => ({
  id: r.id,
  ticketNo: r.ticket_no,
  categoryId: r.category_id,
  raisedBy: r.raised_by,
  raisedAt: r.raised_at,
  subject: r.subject,
  body: r.body,
  otherNote: r.other_note,
  status: r.status,
  currentStep: r.current_step,
  roundNo: r.round_no ?? 0,
  assigneeId: r.assignee_id,
  acknowledgedAt: r.acknowledged_at,
  acknowledgedBy: r.acknowledged_by,
  infoFromUserId: r.info_from_user_id,
  infoRequestedAt: r.info_requested_at,
  infoAnsweredAt: r.info_answered_at,
  resolvedAt: r.resolved_at,
  resolvedBy: r.resolved_by,
  resolution: r.resolution,
  confirmedAt: r.confirmed_at,
  csatRating: r.csat_rating ?? null,
  csatNote: r.csat_note,
  reopenCount: r.reopen_count ?? 0,
  escalatedL1At: r.escalated_l1_at,
  escalatedL2At: r.escalated_l2_at,
  closedAt: r.closed_at,
  closedReason: r.closed_reason,
  holdFromStatus: r.hold_from_status,
  heldAt: r.held_at,
  heldBy: r.held_by,
  holdReason: r.hold_reason,
  cancelledAt: r.cancelled_at,
  cancelledBy: r.cancelled_by,
  cancelReason: r.cancel_reason,
  handoffAppId: r.handoff_app_id,
  handoffEntityId: r.handoff_entity_id,
  handoffRef: r.handoff_ref,
  externalEscalatedAt: r.external_escalated_at,
  externalRef: r.external_ref,
  recategorisedFrom: r.recategorised_from,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapActivity = (r: any): TicketActivity => ({
  id: r.id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id,
  note: r.note,
  meta: r.meta ?? {},
  createdAt: r.created_at,
});

export const HELP_QK = ["helpDeskData"] as const;
export const helpQueryKey = (userId: string | null) => [...HELP_QK, userId] as const;

export interface HelpData {
  categories: TicketCategory[];
  tickets: Ticket[];
  activity: TicketActivity[];
  notifications: HelpNotification[];
  stepOwners: { stepKey: string; departmentIds: string[]; employeeIds: string[] }[];
  masterRequests: {
    id: string;
    requestedBy: string;
    proposedName: string;
    reason: string | null;
    status: "pending" | "approved" | "rejected";
    decidedBy: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
    createdCategoryId: string | null;
    createdAt: string;
  }[];
  stepSla: StepSlaMap;
  coordinatorIds: string[];
  masterOwnerIds: string[];
  reassignPoolIds: string[];
  /** Raw config, for the Setup tabs that own their own keys. */
  config: Record<string, any>;
}

export async function fetchHelpData(): Promise<HelpData> {
  const [owners, config, categories, masterRequests, tickets, activity, notifications] =
    await Promise.all([
      fetchAll("fms_help_step_owners"),
      fetchAll("fms_help_config", "key"),
      fetchAll("fms_help_categories", "sort_order"),
      fetchAll("fms_help_master_requests"),
      fetchAll("fms_help_tickets", "raised_at"),
      fetchAll("fms_help_activity"),
      fetchAll("fms_help_notifications"),
    ]);

  const cfg: Record<string, any> = {};
  for (const row of config) cfg[row.key] = row.value ?? {};

  const ids = (key: string): string[] => (cfg[key]?.user_ids ?? []) as string[];

  return {
    categories: categories.map(mapCategory),
    tickets: tickets.map(mapTicket),
    activity: activity.map(mapActivity),
    notifications: notifications.map(
      (n): HelpNotification => ({
        id: n.id,
        userId: n.user_id,
        type: n.type,
        entityType: n.entity_type,
        entityId: n.entity_id,
        text: n.text,
        actorId: n.actor_id,
        readAt: n.read_at,
        createdAt: n.created_at,
      }),
    ),
    stepOwners: owners.map((o) => ({
      stepKey: o.step_key,
      departmentIds: o.department_ids ?? [],
      employeeIds: o.employee_ids ?? [],
    })),
    masterRequests: masterRequests.map((m) => ({
      id: m.id,
      requestedBy: m.requested_by,
      proposedName: m.proposed_name,
      reason: m.reason,
      status: m.status,
      decidedBy: m.decided_by,
      decidedAt: m.decided_at,
      decisionNote: m.decision_note,
      createdCategoryId: m.created_category_id,
      createdAt: m.created_at,
    })),
    // An unset or unknown step falls back to its code default, so behaviour
    // never silently disappears when Settings has not been touched.
    stepSla: resolveStepSla(cfg.step_sla ?? null),
    coordinatorIds: ids("process_coordinators"),
    masterOwnerIds: ids("master_owners"),
    reassignPoolIds: ids("reassign_pool"),
    config: cfg,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The monthly MIS (HD-10) — PDF step 11.
 *
 * ⚠ THIS IS THE ONLY READ IN THE MODULE THAT SEES EVERY HELP TICKET rather than
 *   just the reader's. `fms_help_can_see` withholds tickets from anyone outside
 *   the desk, which makes an honest desk-wide compliance figure impossible to
 *   compute in the browser — a percentage that silently omits what the reader
 *   cannot see is worse than none, because it looks authoritative. So the server
 *   does it, and checks the caller itself.
 *
 * ⚠ IT EXCLUDES THE THREE CONFIDENTIAL CATEGORIES FROM EVERY COUNT, and returns
 *   `excludedConfidential` so the screen can say how many it left out. A total
 *   that quietly included grievances would tell a reader how many exist.
 */
export interface MisSlaRow {
  code?: string;
  category?: string;
  ownerId?: string;
  raised: number;
  resolved: number;
  /** Tickets that HAD a deadline. The compliance denominator. */
  timed: number;
  within: number;
  /** Governed by policy rather than working days — never scored either way. */
  untimed: number;
}

export interface Mis {
  from: string;
  to: string;
  asOf: string;
  frtTargetMinutes: number;
  excludedConfidential: number;
  raised: number;
  slaByCategory: MisSlaRow[];
  slaByOwner: MisSlaRow[];
  ageing: { band: string; tickets: number }[];
  trend: { month: string; code: string; category: string; tickets: number }[];
  firstResponse: {
    answered: number;
    neverAnswered: number;
    medianMinutes: number | null;
    withinTarget: number;
  };
  resolution: {
    resolved: number;
    avgHours: number | null;
    reopened: number;
    reopenedTwicePlus: number;
    firstContact: number;
  };
  closure: {
    closed: number;
    confirmed: number;
    autoClosed: number;
    cancelled: number;
    stillOpen: number;
    rated: number;
    csatAvg: number | null;
  };
}

const slaRow = (r: any): MisSlaRow => ({
  code: r.code,
  category: r.category,
  ownerId: r.owner_id,
  raised: r.raised ?? 0,
  resolved: r.resolved ?? 0,
  timed: r.timed ?? 0,
  within: r.within ?? 0,
  untimed: r.untimed ?? 0,
});

export async function fetchMis(fromIso: string, toIso: string): Promise<Mis> {
  const { data, error } = await (supabase as any).rpc("fms_help_mis", {
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw new Error(error.message);
  const d = data as any;
  return {
    from: d.from,
    to: d.to,
    asOf: d.as_of,
    frtTargetMinutes: d.frt_target_minutes ?? 30,
    excludedConfidential: d.excluded_confidential ?? 0,
    raised: d.raised ?? 0,
    slaByCategory: (d.sla_by_category ?? []).map(slaRow),
    slaByOwner: (d.sla_by_owner ?? []).map(slaRow),
    ageing: (d.ageing ?? []).map((a: any) => ({ band: a.band, tickets: a.tickets ?? 0 })),
    trend: (d.trend ?? []).map((t: any) => ({
      month: t.month, code: t.code, category: t.category, tickets: t.tickets ?? 0,
    })),
    firstResponse: {
      answered: d.first_response?.answered ?? 0,
      neverAnswered: d.first_response?.never_answered ?? 0,
      medianMinutes: d.first_response?.median_minutes ?? null,
      withinTarget: d.first_response?.within_target ?? 0,
    },
    resolution: {
      resolved: d.resolution?.resolved ?? 0,
      avgHours: d.resolution?.avg_hours ?? null,
      reopened: d.resolution?.reopened ?? 0,
      reopenedTwicePlus: d.resolution?.reopened_twice_plus ?? 0,
      firstContact: d.resolution?.first_contact ?? 0,
    },
    closure: {
      closed: d.closure?.closed ?? 0,
      confirmed: d.closure?.confirmed ?? 0,
      autoClosed: d.closure?.auto_closed ?? 0,
      cancelled: d.closure?.cancelled ?? 0,
      stillOpen: d.closure?.still_open ?? 0,
      rated: d.closure?.rated ?? 0,
      csatAvg: d.closure?.csat_avg ?? null,
    },
  };
}

/** One row of the confidential register — dates and status, never the complaint. */
export interface RegisterRow {
  ticketNo: string;
  category: string;
  code: string;
  raisedAt: string;
  raisedBy: string | null;
  acknowledgedAt: string | null;
  /** The HR Head's KRA 12 measure: acknowledged within one working day. */
  ackedNextDay: boolean | null;
  resolvedAt: string | null;
  closedAt: string | null;
  status: string;
  reopenCount: number;
  escalatedL1At: string | null;
  escalatedL2At: string | null;
}

/**
 * Riya's KRA 12 register.
 *
 * ⚠ IT CARRIES NO SUBJECT, NO BODY AND NO RESOLUTION, by design. A register
 *   proves the case was logged and answered in time; reprinting the complaint
 *   would be an easier second copy of the thing the gate protects.
 */
export async function fetchConfidentialRegister(
  fromIso: string,
  toIso: string,
): Promise<RegisterRow[]> {
  const { data, error } = await (supabase as any).rpc("fms_help_confidential_register", {
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map((r) => ({
    ticketNo: r.ticket_no,
    category: r.category,
    code: r.code,
    raisedAt: r.raised_at,
    raisedBy: r.raised_by,
    acknowledgedAt: r.acknowledged_at,
    ackedNextDay: r.acked_next_day ?? null,
    resolvedAt: r.resolved_at,
    closedAt: r.closed_at,
    status: r.status,
    reopenCount: r.reopen_count ?? 0,
    escalatedL1At: r.escalated_l1_at,
    escalatedL2At: r.escalated_l2_at,
  }));
}
