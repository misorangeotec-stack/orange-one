/**
 * What the hub can actually fill in on the Weekly Review Report (KPI-3, read-only).
 *
 * ⚠ EVERY QUERY HERE IS A READ. Nothing in this folder writes, upserts or deletes, and
 *   the figures a reader types on the page stay in their browser (lib/notes.ts).
 *
 * All of it runs under the CALLER'S OWN RLS. A reader outside HR gets an error rather
 * than a page of zeros, and the report says which it was — the difference between "no
 * requisitions this week" and "you are not allowed to see requisitions" is the whole
 * meaning of the number.
 *
 * ── Why this does not go through `kpi_report` ─────────────────────────────────
 * The framework lab takes everything it can from the live scorecard's RPC, because that
 * RPC already knows each module's due dates and the framework is about deadlines. This
 * report is not. It asks for counts, ageing, a funnel and a joiner list — the shape of
 * the recruitment tables themselves, not of the step facts on top of them. `kpi_report`
 * has no row for "how many CVs came in this week"; it has rows for "was the CV-upload
 * step done on time". So this reads the tables.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";

// Untyped alias for tables outside the generated Database types — the standing
// convention here (see asset-maintenance/data/assetFetch.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * PostgREST stops at 1,000 rows unless told otherwise, and a silently truncated read
 * would make every count on the page quietly low. Asked for explicitly, and the page is
 * told when a read came back exactly full so it can say so instead of under-reporting.
 */
const PAGE = 5000;

/* ------------------------------------------------------------------ raw rows */

interface RawReq {
  id: string;
  mrf_no: string | null;
  job_title: string | null;
  department_id: string | null;
  request_date: string | null;
  status: string;
  current_step: string | null;
  positions_required: number | null;
  closed_at: string | null;
  hr_approved_at: string | null;
  posted_at: string | null;
}

interface RawCand {
  id: string;
  requisition_id: string | null;
  name: string | null;
  stage: string | null;
  uploaded_at: string | null;
  hr_shortlisted_at: string | null;
  hod_decided_at: string | null;
  telephonic_at: string | null;
  finalized_at: string | null;
  offered_ctc: number | null;
  joined_at: string | null;
  disqualified_at: string | null;
}

interface RawIvw {
  id: string;
  candidate_id: string | null;
  round: number | null;
  scheduled_on: string | null;
  held_at: string | null;
  status: string | null;
}

interface RawOnb {
  id: string;
  candidate_id: string | null;
  requisition_id: string | null;
  joining_date: string | null;
  offer_status: string | null;
  offer_decided_at: string | null;
  completed_at: string | null;
  /** pending / clear / discrepancy. A real BGV result, not the old checklist tick. */
  bgv_status: string | null;
  bgv_at: string | null;
  /** The induction date, written by the fms_hr_set_induction RPC. */
  induction_on: string | null;
}

interface RawBuddy {
  id: string;
  onboarding_id: string | null;
  buddy_user_id: string | null;
  allocated_at: string | null;
  /** How many connects this buddy is expected to complete — the form's "of 8". */
  interaction_target: number | null;
  feedback_rating: number | null;
  status: string | null;
}

interface RawInteraction {
  id: string;
  buddy_id: string;
  confirmed_at: string | null;
}

interface RawChk {
  onboarding_id: string;
  item_key: string | null;
  done: boolean | null;
  done_at: string | null;
}

/* -------------------------------------------------------------- shaped rows */

/** The six stages the FORM asks for — not the hub's `current_step`. */
export type FormStage = "Sourcing" | "Screening" | "Interview" | "Offer" | "BGV" | "Joined";

export interface PositionRow {
  id: string;
  mrfNo: string | null;
  title: string;
  departmentId: string | null;
  requestDate: string | null;
  /** The raw `status`, mapped to the app's own wording by the page. */
  status: string;
  currentStep: string | null;
  /** How many people the requisition asks for. Four of them ask for more than one. */
  seats: number;
  closedAt: string | null;
  live: boolean;
  /** Null when there is no request date to count from, or the position has closed. */
  daysOpen: number | null;
  /** The form's stage, derived. See `formStageOf`. */
  stage: FormStage;
  /* the funnel, whole-life */
  sourced: number;
  screened: number;
  shortlisted: number;
  interviewed: number;
  selected: number;
  /* the funnel, this week only */
  sourcedWeek: number;
  screenedWeek: number;
}

export interface OfferRow {
  id: string;
  candidate: string;
  title: string;
  departmentId: string | null;
  /** When the offer letter was ticked as sent. Null on every row today. */
  offerDate: string | null;
  ctc: number | null;
  /** The candidate's own answer: accepted / declined / null. */
  offerStatus: string | null;
  /**
   * `fms_hr_onboardings.bgv_status` — pending / clear / discrepancy. A real result, not
   * the old "Police verification" tick: that one could never come back WITH a
   * discrepancy, which is the only state the form's flag list cares about.
   */
  bgvStatus: string | null;
  bgvAt: string | null;
  /** `fms_hr_onboardings.induction_on`, and whether it landed inside the form's 15 days. */
  inductionOn: string | null;
  inductionWithin15: boolean | null;
  /** The Buddy Program, per joiner. Null throughout means no buddy record exists yet. */
  buddyUserId: string | null;
  buddyAllocatedAt: string | null;
  /** Allocated strictly before the joining date, as the form's "Before Day 1" asks. */
  buddyBeforeDay1: boolean | null;
  /** Connects confirmed by the person met, against the buddy's own target. */
  connectsDone: number | null;
  connectsTarget: number | null;
  /** `fms_hr_buddies.feedback_rating` — the joiner's own score out of 5. */
  joinerRating: number | null;
  joiningDate: string | null;
  /** `fms_hr_candidates.joined_at`. Set on the seeded test candidate alone today. */
  joined: boolean;
  /** Joining date has passed and nobody has ticked the joining. */
  joiningUnconfirmed: boolean;
}

export interface WeekTotals {
  /* A1 */
  openPositions: number;
  openSeats: number;
  sourced: number;
  interviewsHeld: number;
  interviewsScheduled: number;
  positionsClosed: number;
  /** Cancellations in the week — kept separate so a closure count can never absorb them. */
  positionsCancelled: number;
  offersAccepted: number;
  joinedOfAccepted: number;
  offerToJoin: number | null;
  /* A2 / A3 */
  shortlistedWeek: number;
  selectedWeek: number;
  agedOver45: number;
  oldestDays: number | null;
  /* B1 */
  newJoinersDue: number;
  newJoinersConfirmed: number;
}

export interface YtdTotals {
  /** Requisitions that reached `closed` this calendar year. Zero, so far, ever. */
  positionsClosed: number;
  /** …and how many carry a candidate with a joining recorded. */
  positionsClosedWithJoiner: number;
  /** Offers accepted this year — the pool SK-1 should be drawing from. */
  offersAccepted: number;
  probations: number;
  probationReviews: number;
}

export interface ReportData {
  positions: PositionRow[];
  offers: OfferRow[];
  week: WeekTotals;
  ytd: YtdTotals;
  /** True when a read came back exactly full, so a count on the page may be low. */
  truncated: boolean;
}

/* --------------------------------------------------------------- the reading */

/** `to` is inclusive on the form, exclusive in PostgREST. */
const dayAfter = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const inWindow = (ts: string | null, from: string, to: string) => !!ts && ts >= from && ts < dayAfter(to);

const daysSince = (iso: string | null, asOf: string): number | null =>
  iso === null ? null : Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(iso.slice(0, 10) + "T00:00:00Z")) / 86_400_000);

/**
 * Did `event` land within `days` of `from`? Null when either date is missing — and the
 * null matters: "the induction was late" and "no induction is recorded" are opposite
 * findings, and a boolean that folds them into `false` would report the second as the
 * first on every untouched joiner.
 */
const daysWithin = (from: string | null, event: string | null, days: number): boolean | null => {
  if (!from || !event) return null;
  const d = Math.floor((Date.parse(`${event.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  return d >= 0 && d <= days;
};

/** Still taking candidates — the app's own isLivePosition(), restated on raw rows. */
const isLive = (status: string) => status === "posting" || status === "sourcing";

/**
 * The form's six stages, worked out from the candidates rather than the requisition.
 *
 * ⚠ THIS IS A MAPPING, NOT A LOOKUP, and it is the one assumption on this page HR has
 *   to confirm. `fms_hr_requisitions.current_step` answers a different question — whose
 *   desk the MRF is on (resume_upload, hr_head_approval, job_posting, mgmt_approval) —
 *   while the form's Sourcing→Joined describes how far the HIRING got. So the stage is
 *   read off the furthest point any of the position's candidates reached.
 *
 *   "BGV" is a real stage now: `bgv_status` holds pending / clear / discrepancy, so a
 *   position whose onboarding has a BGV result genuinely sits at that stage. It stays
 *   rare only because HR has not started filling the column.
 */
function formStageOf(cands: RawCand[], onb: RawOnb[]): FormStage {
  if (cands.some((c) => c.joined_at)) return "Joined";
  const mine = onb.filter((o) => o.id);
  if (mine.some((o) => o.bgv_status)) return "BGV";
  if (mine.length > 0 || cands.some((c) => c.finalized_at)) return "Offer";
  const interviewing = new Set(["interview_1", "interview_2", "interview_3", "finalized"]);
  if (cands.some((c) => c.stage && interviewing.has(c.stage))) return "Interview";
  if (cands.some((c) => c.hr_shortlisted_at || c.hod_decided_at || c.telephonic_at)) return "Screening";
  return "Sourcing";
}

async function readAll<T>(table: string, cols: string): Promise<{ rows: T[]; full: boolean }> {
  const { data, error } = await db.from(table).select(cols).limit(PAGE);
  if (error) throw new Error(`${table}: ${error.message}`);
  const rows = (data ?? []) as T[];
  return { rows, full: rows.length >= PAGE };
}

async function countOf(table: string): Promise<number> {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

export async function fetchReportData(from: string, to: string, asOf: string): Promise<ReportData> {
  const [reqs, cands, ivws, onbs, chks, buddies, interactions] = await Promise.all([
    readAll<RawReq>(
      "fms_hr_requisitions",
      "id, mrf_no, job_title, department_id, request_date, status, current_step, positions_required, closed_at, hr_approved_at, posted_at",
    ),
    readAll<RawCand>(
      "fms_hr_candidates",
      "id, requisition_id, name, stage, uploaded_at, hr_shortlisted_at, hod_decided_at, telephonic_at, finalized_at, offered_ctc, joined_at, disqualified_at",
    ),
    readAll<RawIvw>("fms_hr_interviews", "id, candidate_id, round, scheduled_on, held_at, status"),
    readAll<RawOnb>(
      "fms_hr_onboardings",
      "id, candidate_id, requisition_id, joining_date, offer_status, offer_decided_at, completed_at, bgv_status, bgv_at, induction_on",
    ),
    readAll<RawChk>("fms_hr_onboarding_checks", "onboarding_id, item_key, done, done_at"),
    // The Buddy Program (NR-9) reached master on 22-09-2026. Section B of this form is
    // four boxes about it, so the report reads the real tables — printing "no table"
    // over a module that shipped is the single most expensive thing this page can do.
    readAll<RawBuddy>("fms_hr_buddies", "id, onboarding_id, buddy_user_id, allocated_at, interaction_target, feedback_rating, status"),
    readAll<RawInteraction>("fms_hr_buddy_interactions", "id, buddy_id, confirmed_at"),
  ]);
  const [probations, probationReviews] = await Promise.all([countOf("fms_hr_probations"), countOf("fms_hr_probation_reviews")]);

  const candById = new Map(cands.rows.map((c) => [c.id, c]));
  const candsByReq = new Map<string, RawCand[]>();
  for (const c of cands.rows) {
    const k = c.requisition_id ?? "";
    const list = candsByReq.get(k);
    if (list) list.push(c);
    else candsByReq.set(k, [c]);
  }

  /** Candidates with at least one interview row, by requisition. */
  const interviewedByReq = new Map<string, Set<string>>();
  for (const i of ivws.rows) {
    const c = i.candidate_id ? candById.get(i.candidate_id) : undefined;
    if (!c?.requisition_id) continue;
    const set = interviewedByReq.get(c.requisition_id) ?? new Set<string>();
    set.add(c.id);
    interviewedByReq.set(c.requisition_id, set);
  }

  // BGV is read off `fms_hr_onboardings.bgv_status` now, not off a checklist tick, so
  // the only thing still taken from the checklist is the offer-letter date.
  const offerSentByOnb = new Map<string, string | null>();
  for (const k of chks.rows) {
    if (k.item_key === "offer_letter_sent" && k.done) offerSentByOnb.set(k.onboarding_id, k.done_at ?? null);
  }

  const onbByReq = new Map<string, RawOnb[]>();
  for (const o of onbs.rows) {
    if (!o.requisition_id) continue;
    const list = onbByReq.get(o.requisition_id);
    if (list) list.push(o);
    else onbByReq.set(o.requisition_id, [o]);
  }

  const positions: PositionRow[] = reqs.rows.map((r) => {
    const cs = candsByReq.get(r.id) ?? [];
    const live = isLive(r.status);
    return {
      id: r.id,
      mrfNo: r.mrf_no,
      title: r.job_title ?? "—",
      departmentId: r.department_id,
      requestDate: r.request_date,
      status: r.status,
      currentStep: r.current_step,
      seats: r.positions_required ?? 1,
      closedAt: r.closed_at,
      live,
      daysOpen: live ? daysSince(r.request_date, asOf) : null,
      stage: formStageOf(cs, onbByReq.get(r.id) ?? []),
      sourced: cs.length,
      // HR's shortlist IS the screening pass; there is no separate screened event.
      screened: cs.filter((c) => c.hr_shortlisted_at).length,
      // `hod_decided_at` is stamped on a rejection too, so this reads "the HOD decided".
      shortlisted: cs.filter((c) => c.hod_decided_at).length,
      interviewed: (interviewedByReq.get(r.id) ?? new Set()).size,
      selected: cs.filter((c) => c.finalized_at).length,
      sourcedWeek: cs.filter((c) => inWindow(c.uploaded_at, from, to)).length,
      screenedWeek: cs.filter((c) => inWindow(c.hr_shortlisted_at, from, to)).length,
    };
  });

  const reqById = new Map(reqs.rows.map((r) => [r.id, r]));
  const buddyByOnb = new Map(buddies.rows.filter((b) => b.onboarding_id).map((b) => [b.onboarding_id as string, b]));
  // A connect only counts when the person met signs it off — the form says so, and the
  // table carries `confirmed_at` for exactly that. Counting logged interactions instead
  // would report the buddy's own word as a completed connect.
  const confirmedByBuddy = new Map<string, number>();
  for (const i of interactions.rows) {
    if (!i.confirmed_at) continue;
    confirmedByBuddy.set(i.buddy_id, (confirmedByBuddy.get(i.buddy_id) ?? 0) + 1);
  }

  const offers: OfferRow[] = onbs.rows.map((o) => {
    const c = o.candidate_id ? candById.get(o.candidate_id) : undefined;
    const r = o.requisition_id ? reqById.get(o.requisition_id) : undefined;
    const buddy = buddyByOnb.get(o.id);
    const joined = !!c?.joined_at;
    return {
      id: o.id,
      candidate: c?.name ?? "—",
      title: r?.job_title ?? "—",
      departmentId: r?.department_id ?? null,
      offerDate: offerSentByOnb.get(o.id) ?? null,
      ctc: c?.offered_ctc ?? null,
      offerStatus: o.offer_status,
      bgvStatus: o.bgv_status,
      bgvAt: o.bgv_at,
      inductionOn: o.induction_on,
      inductionWithin15: daysWithin(o.joining_date, o.induction_on, 15),
      buddyUserId: buddy?.buddy_user_id ?? null,
      buddyAllocatedAt: buddy?.allocated_at ?? null,
      buddyBeforeDay1:
        buddy?.allocated_at && o.joining_date ? buddy.allocated_at.slice(0, 10) < o.joining_date.slice(0, 10) : null,
      connectsDone: buddy ? (confirmedByBuddy.get(buddy.id) ?? 0) : null,
      connectsTarget: buddy?.interaction_target ?? null,
      joinerRating: buddy?.feedback_rating ?? null,
      joiningDate: o.joining_date,
      joined,
      joiningUnconfirmed: !joined && !!o.joining_date && o.joining_date <= asOf,
    };
  });

  const acceptedThisWeek = onbs.rows.filter((o) => o.offer_status === "accepted" && inWindow(o.offer_decided_at, from, to));
  const joinedThisWeek = cands.rows.filter((c) => inWindow(c.joined_at, from, to)).length;
  const closedThisWeek = reqs.rows.filter((r) => r.status === "closed" && inWindow(r.closed_at, from, to));
  const liveNow = positions.filter((p) => p.live);
  const aged = liveNow.filter((p) => (p.daysOpen ?? 0) > 45);

  const week: WeekTotals = {
    openPositions: liveNow.length,
    openSeats: liveNow.reduce((s, p) => s + p.seats, 0),
    sourced: cands.rows.filter((c) => inWindow(c.uploaded_at, from, to)).length,
    interviewsHeld: ivws.rows.filter((i) => inWindow(i.held_at, from, to)).length,
    interviewsScheduled: ivws.rows.filter((i) => !!i.scheduled_on && i.scheduled_on >= from && i.scheduled_on <= to).length,
    positionsClosed: closedThisWeek.length,
    positionsCancelled: reqs.rows.filter((r) => r.status === "cancelled" && inWindow(r.closed_at, from, to)).length,
    offersAccepted: acceptedThisWeek.length,
    joinedOfAccepted: joinedThisWeek,
    // Offers accepted in a single week are usually none, which would make a percentage
    // of nothing. Null, so the page prints "—" rather than 0% or NaN.
    offerToJoin: acceptedThisWeek.length > 0 ? (joinedThisWeek / acceptedThisWeek.length) * 100 : null,
    shortlistedWeek: cands.rows.filter((c) => inWindow(c.hr_shortlisted_at, from, to)).length,
    selectedWeek: cands.rows.filter((c) => inWindow(c.finalized_at, from, to)).length,
    agedOver45: aged.length,
    oldestDays: liveNow.reduce<number | null>((m, p) => (p.daysOpen !== null && (m === null || p.daysOpen > m) ? p.daysOpen : m), null),
    newJoinersDue: onbs.rows.filter((o) => !!o.joining_date && o.joining_date >= from && o.joining_date <= to).length,
    newJoinersConfirmed: joinedThisWeek,
  };

  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const closedYtd = reqs.rows.filter((r) => r.status === "closed" && !!r.closed_at && r.closed_at >= yearStart);
  const ytd: YtdTotals = {
    positionsClosed: closedYtd.length,
    positionsClosedWithJoiner: closedYtd.filter((r) => (candsByReq.get(r.id) ?? []).some((c) => c.joined_at)).length,
    offersAccepted: onbs.rows.filter((o) => o.offer_status === "accepted" && !!o.offer_decided_at && o.offer_decided_at >= yearStart).length,
    probations,
    probationReviews,
  };

  return {
    positions,
    offers,
    week,
    ytd,
    truncated: reqs.full || cands.full || ivws.full || onbs.full || chks.full,
  };
}

export function useReportData(from: string, to: string, asOf: string) {
  return useQuery<ReportData>({
    queryKey: ["weekly-review-lab", from, to, asOf],
    enabled: !!from && !!to,
    staleTime: 5 * 60_000,
    queryFn: () => fetchReportData(from, to, asOf),
  });
}
