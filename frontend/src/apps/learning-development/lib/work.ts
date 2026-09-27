import { dueIsoFrom, type StepSlaMap } from "./sla";
import { buildQueueEntries, isOpen, stepOf } from "./queues";
import { STEPS, type StepKey } from "./steps";
import type { LdData } from "../data/ldFetch";
import type { TrainingSession } from "../types";

/**
 * EVERY piece of work this module holds — open and closed, across all three
 * scopes — as plain data.
 *
 * ⚠ WHY THIS EXISTS, AND WHY IT IS NOT `lib/queues.ts`. `queues.ts` answers one
 *   question — "where is this REQUEST, and when is that due" — and steps 1 to 8
 *   are all it can answer for, because a request sits at exactly one step. The
 *   other fourteen steps hang off a SESSION or off ONE PERSON'S obligation, and
 *   a session holds several of them at once: nominations can still be open while
 *   the material is already up. One "current step" cannot describe that, so this
 *   file returns a LIST of steps per session instead of a single one.
 *
 * Three consumers read it and none of them re-derives anything:
 *   · `core/workspace/mywork/items/learning-development.ts` — whose work is it;
 *   · the FMS Control Center adapter — how much is at each step, org-wide;
 *   · `ranking/modules/learningDevelopment.ts` (CC-1) and, through it, the
 *     nightly KPI facts that score KRA 2 and KRA 5.
 *
 * ⚠ PURE. No React, no `window`, no `import.meta.env` — `supabase/ranking/build.mjs`
 *   bundles this into two edge functions and refuses to finish if any of them
 *   reaches the import graph.
 *
 * ⚠ A CLOSED STEP NEEDS AN ACTOR AND A TIME, and most of them have their own
 *   columns for both (`validated_by`/`validated_at`, `nominated_by`, `issued_by`,
 *   `marked_by`, `readiness_by`, `reviewed_by`, `closed_by`). TWO DO NOT —
 *   Training Conducted and Attendance Closure stamp a time on the session and no
 *   actor at all — so those two read `fms_ld_activity`, which records the actor
 *   and the moment for every move. That is a deliberate exception, not a pattern
 *   to copy: the log is a log, and a column is the truth wherever one exists.
 */

export type LdScope = "request" | "session" | "participant";

/** What every scored step carries, open or closed. */
export interface LdStepRow {
  scope: LdScope;
  stepKey: StepKey;
  /**
   * Stable and unique within the module. A participant step keys off the
   * PARTICIPANT'S OWN ROW, not the session — twelve people owing a feedback form
   * is twelve pieces of work, and KRA 5 scores each of them against their own
   * name.
   */
  stepId: string;
  /**
   * The row this step hangs off, and the id every consumer keys it by.
   *
   * ⚠ NOT THE SESSION, for a participant step. Two people owing a feedback form on
   *   the same session are two pieces of work; keying both by the session id would
   *   collide, and My Work's item id — `source:row:step`, split on the colon by
   *   `ranking/workItems.ts` — would hand the ranking one row where there are two.
   *   The same reason hr-exit keys by `checkId ?? entityId`.
   */
  rowId: string;
  /** The entity a reader OPENS: a request for steps 1–8, otherwise the session. */
  entityId: string;
  sessionId: string | null;
  requestId: string | null;
  /** TRN-… or TRS-…, as the module's own screens print it. */
  ref: string;
  title: string;
  /** IST yyyy-mm-dd. Null = deliberately untimed, so it can never be late. */
  dueIso: string | null;
  /** For a participant or HOD step: whose obligation it is. */
  personId: string | null;
  /**
   * Seeded or walked-through data, decided ONCE from the owning request or
   * session.
   *
   * ⚠ NEVER FROM THIS ROW'S OWN `title`. A participant step shows the thing the
   *   person is looking at — an assignment is titled after the assignment, not
   *   after the session — so matching `ZZ TEST` against the displayed title let
   *   two steps of a test session through into the score on 23-09-2026, found by
   *   running this builder against live data. The entity decides; the row
   *   inherits.
   */
  isTest: boolean;
}

export interface LdOpenStep extends LdStepRow {
  /**
   * Who owes it, when the ROW names them — a nominee, an attendee's HOD, the
   * internal trainer of that session. EMPTY means "whoever Setup made the owner
   * of this step", which the consumer resolves; it never means "nobody".
   */
  ownerIds: string[];
}

export interface LdClosedStep extends LdStepRow {
  actorId: string | null;
  /** The ORIGINAL completion timestamp — never an edit stamp. */
  doneAtIso: string | null;
}

export interface LdWork {
  open: LdOpenStep[];
  closed: LdClosedStep[];
}

/* ------------------------------------------------------------------ helpers */

const titleOf = (k: StepKey) => STEPS.find((s) => s.key === k)?.title ?? k;

/** yyyy-mm-dd from a timestamp, or a date that is already one. */
const dayOf = (iso: string | null | undefined): string | null =>
  iso ? iso.slice(0, 10) : null;

/**
 * A step's due date from its configured rule and an anchor moment.
 *
 * ⚠ A MISSING ANCHOR YIELDS NULL, which reads as "untimed" everywhere. That is
 *   right here and wrong in `queues.ts`: a request that skipped the Management
 *   gate still has a submission date to fall back on, while a session step whose
 *   anchor has genuinely not happened yet — feedback before the session ran — is
 *   not late, it has not started.
 */
const dueFrom = (sla: StepSlaMap, step: StepKey, anchorIso: string | null): string | null => {
  const rule = sla[step];
  if (!rule || !anchorIso) return null;
  return dueIsoFrom(anchorIso, rule);
};

/**
 * Did this session actually happen? `status` alone is not enough — a session can
 * be marked conducted through `outcome` while its status has already moved on to
 * attendance_closed or closed.
 */
const wasConducted = (x: TrainingSession): boolean =>
  !!x.actualStart ||
  !!x.attendanceClosedAt ||
  ["conducted", "attendance_closed", "in_review", "closed"].includes(x.status);

/** A session nobody is working any more. */
const sessionDead = (x: TrainingSession): boolean =>
  ["cancelled", "rescheduled", "closed"].includes(x.status);

/**
 * When the session happened, as a moment. `actualEnd` is what was recorded;
 * failing that the scheduled date, which is what every deadline in §3 counts
 * from ("within 24 hours of session completion", "within 48 hours").
 */
/**
 * The convention this hub tags seeded rows with. There is no separate numbering
 * to recognise them by — the test data was made through the module's own RPCs, so
 * every row carries a real sequential code.
 */
const taggedTest = (...text: (string | null | undefined)[]): boolean =>
  text.some((t) => (t ?? "").trim().startsWith("ZZ TEST"));

const conductedAt = (x: TrainingSession): string | null =>
  x.actualEnd ?? x.actualStart ?? (wasConducted(x) ? `${x.sessionDate}T00:00:00Z` : null);

/* --------------------------------------------------------------- the builder */

export function buildLdWork(data: LdData, sla: StepSlaMap): LdWork {
  const open: LdOpenStep[] = [];
  const closed: LdClosedStep[] = [];

  const sessions = data.sessions;
  const requestByCode = new Map(data.requests.map((r) => [r.id, r] as const));

  /*
   * The two steps with no actor column of their own. One pass over the activity
   * log, keyed by session, so the lookups below are not a scan each.
   */
  const actorOf = new Map<string, { actorId: string | null; at: string }>();
  for (const a of data.activity) {
    const step =
      a.type === "ld_conducted" ? "conducted" : a.type === "ld_attendance_closed" ? "attendance" : null;
    if (!step) continue;
    const key = `${a.entityId}|${step}`;
    // The FIRST one is the closure; a later correction is an edit, not the act.
    if (!actorOf.has(key)) actorOf.set(key, { actorId: a.actorId, at: a.createdAt });
  }
  const logged = (sessionId: string, step: StepKey) => actorOf.get(`${sessionId}|${step}`) ?? null;

  /* ── 1. REQUEST STEPS (1–8, 21, 22) ──────────────────────────────────────
     The open half is `buildQueueEntries` verbatim — the same call the sidebar,
     the queues and the dashboard make, so the scoreboard cannot drift from the
     screen. The closed half reads each step's own two columns. */

  for (const e of buildQueueEntries(data.requests, sla)) {
    const r = requestByCode.get(e.entityId);
    open.push({
      scope: "request",
      stepKey: e.stepKey,
      stepId: `${e.entityId}:${e.stepKey}`,
      rowId: e.entityId,
      entityId: e.entityId,
      sessionId: null,
      requestId: e.entityId,
      ref: e.ref,
      title: e.title,
      dueIso: e.dueIso,
      personId: null,
      isTest: taggedTest(e.title, e.ref),
      /*
       * `need_resubmit` is the one request step the ROW owns: it is owed by the
       * person who raised it, not by whoever is configured to own the step. The
       * server says the same thing in `fms_ld_can_act`.
       */
      ownerIds: e.stepKey === "need_resubmit" && r?.requestedBy ? [r.requestedBy] : [],
    });
  }

  for (const r of data.requests) {
    const base = {
      scope: "request" as const,
      rowId: r.id,
      entityId: r.id,
      sessionId: null,
      requestId: r.id,
      ref: r.code ?? r.id,
      title: r.title,
      personId: null,
      isTest: taggedTest(r.title, r.code),
    };
    const put = (
      stepKey: StepKey,
      actorId: string | null,
      doneAtIso: string | null,
      dueIso: string | null,
    ) => {
      if (!doneAtIso) return;
      closed.push({ ...base, stepKey, stepId: `${r.id}:${stepKey}`, doneAtIso, actorId, dueIso });
    };

    put("need_raised", r.requestedBy, r.submittedAt, null);
    put("need_validation", r.validatedBy, r.validatedAt, dueFrom(sla, "need_validation", r.submittedAt));
    put("proposal", r.proposedBy, r.proposedAt, dueFrom(sla, "proposal", r.validatedAt));
    put("hr_head_approval", r.hrApprovedBy, r.hrApprovedAt, dueFrom(sla, "hr_head_approval", r.proposedAt));
    /*
     * ⚠ ONLY WHEN THE GATE APPLIED. A request frozen as not needing Management
     *   approval has a null `mgmtApprovedAt` and there is nothing to score; one
     *   that DID need it and skipped is a different thing entirely, and `put`
     *   returning early on the null is what keeps the two apart.
     */
    put("mgmt_approval", r.mgmtApprovedBy, r.mgmtApprovedAt, dueFrom(sla, "mgmt_approval", r.hrApprovedAt));
    put(
      "trainer_finalization",
      r.trainerConfirmedBy,
      r.trainerConfirmedAt,
      dueFrom(sla, "trainer_finalization", r.mgmtApprovedAt ?? r.hrApprovedAt),
    );
    put("closure", r.closedBy, r.closedAt, null);
  }

  /* ── 2. SESSION STEPS ────────────────────────────────────────────────────
     A session holds several at once, so each is tested on its own. `session_
     scheduling` closes on the session's own birth — the request step whose
     product it is. */

  const nomsBySession = new Map<string, typeof data.nominations>();
  for (const n of data.nominations) {
    const list = nomsBySession.get(n.sessionId) ?? [];
    list.push(n);
    nomsBySession.set(n.sessionId, list);
  }
  const attBySession = new Map<string, typeof data.attendance>();
  for (const a of data.attendance) {
    const list = attBySession.get(a.sessionId) ?? [];
    list.push(a);
    attBySession.set(a.sessionId, list);
  }
  const trainerById = new Map(data.trainers.map((t) => [t.id, t] as const));

  for (const x of sessions) {
    const base = {
      scope: "session" as const,
      rowId: x.id,
      entityId: x.id,
      sessionId: x.id,
      requestId: x.requestId,
      ref: x.code ?? x.id,
      title: x.title,
      personId: null,
      /*
       * ⚠ EVERY STEP OF THIS SESSION INHERITS THIS, including the participant
       *   ones whose own title is an assignment's. See the ⚠ on `isTest`.
       */
      isTest: taggedTest(x.title, x.code, requestByCode.get(x.requestId ?? "")?.title),
    };
    const noms = nomsBySession.get(x.id) ?? [];
    const approvedNoms = noms.filter((n) => n.status === "approved");
    const conducted = wasConducted(x);
    const endedAt = conductedAt(x);
    const dead = sessionDead(x);

    /**
     * An INTERNAL trainer runs their own session, so the four delivery steps are
     * theirs. An external one has no login at all (LD-0 · 5), which is why this
     * resolves to nobody and the steps fall to their configured owners — HR, who
     * acts on the trainer's behalf.
     */
    const tr = x.trainerId ? trainerById.get(x.trainerId) : undefined;
    const trainerUid = tr?.trainerType === "internal" ? tr.employeeId : null;
    const trainerOwns = trainerUid ? [trainerUid] : [];

    const putClosed = (
      stepKey: StepKey,
      actorId: string | null,
      doneAtIso: string | null,
      dueIso: string | null,
    ) => {
      if (!doneAtIso) return;
      closed.push({ ...base, stepKey, stepId: `${x.id}:${stepKey}`, doneAtIso, actorId, dueIso });
    };
    const putOpen = (stepKey: StepKey, dueIso: string | null, ownerIds: string[] = []) => {
      if (dead) return;
      open.push({ ...base, stepKey, stepId: `${x.id}:${stepKey}`, dueIso, ownerIds });
    };

    // — the request step this session IS the product of
    putClosed("session_scheduling", x.createdBy, x.createdAt, null);

    // — 9. nomination: somebody has to put names against the session
    const firstNom = noms.reduce<string | null>(
      (min, n) => (!min || n.nominatedAt < min ? n.nominatedAt : min),
      null,
    );
    const nominationDue = dueFrom(sla, "nomination", x.createdAt);
    if (firstNom) {
      /*
       * Scored per NOMINATOR, not per session and not per nominee. Two HODs who
       * each named their own people did two pieces of work; a HOD who named six
       * did one. Anything else credits or charges the wrong person.
       */
      const byWhom = new Map<string, string>();
      for (const n of noms) {
        if (!n.nominatedBy) continue;
        const at = byWhom.get(n.nominatedBy);
        if (!at || n.nominatedAt < at) byWhom.set(n.nominatedBy, n.nominatedAt);
      }
      for (const [uid, at] of byWhom) {
        closed.push({
          ...base,
          stepKey: "nomination",
          stepId: `${x.id}:nomination:${uid}`,
          doneAtIso: at,
          actorId: uid,
          dueIso: nominationDue,
        });
      }
    } else if (!conducted) {
      /*
       * ⚠ OFFERED TO THE STEP OWNERS, NOT TO EVERY HOD. `fms_ld_can_act_session`
       *   lets any HOD act here, because the client made the HOD the nominator —
       *   but a session with NO nominations yet names no HOD, so charging the
       *   open step to all of them would put every un-nominated session on
       *   twenty people's plates. HR/L&D is the nomination authority (LD-0) and
       *   owns the step in Setup; once names exist, their HODs pick it up through
       *   the participant steps below.
       */
      putOpen("nomination", nominationDue);
    }

    // — 10. nomination approval: HR is the final authority on who comes
    const firstApproved = approvedNoms.reduce<string | null>(
      (min, n) => (n.approvedAt && (!min || n.approvedAt < min) ? n.approvedAt : min),
      null,
    );
    const approvalDue = dueFrom(sla, "nomination_approval", firstNom);
    if (firstApproved) {
      const approver = approvedNoms.find((n) => n.approvedAt === firstApproved)?.approvedBy ?? null;
      putClosed("nomination_approval", approver, firstApproved, approvalDue);
    } else if (noms.some((n) => n.status === "proposed")) {
      putOpen("nomination_approval", approvalDue);
    }

    // — 12. pre-training material: the session confirmed ready to run
    const materialDue = dueFrom(sla, "pre_material", x.invitationsSentAt ?? x.createdAt);
    if (x.readinessConfirmedAt) {
      putClosed("pre_material", x.readinessBy, x.readinessConfirmedAt, materialDue);
    } else if (!conducted && approvedNoms.length > 0) {
      putOpen("pre_material", materialDue, trainerOwns);
    }

    // — 13. conducted
    /*
     * ⚠ DUE ON THE SESSION'S OWN DATE, not N days after the step before it. A
     *   training happens when it is scheduled to happen; "one working day after
     *   the material went up" would call a session booked for next month overdue
     *   the day after its handout was uploaded.
     */
    const conductDue = x.sessionDate;
    const conductLog = logged(x.id, "conducted");
    if (conducted) {
      putClosed("conducted", conductLog?.actorId ?? null, conductLog?.at ?? endedAt, conductDue);
    } else if (!dead) {
      putOpen("conducted", conductDue, trainerOwns);
    }

    // — 14. attendance closure
    const attendanceDue = dueFrom(sla, "attendance", endedAt);
    const attLog = logged(x.id, "attendance");
    if (x.attendanceClosedAt) {
      putClosed("attendance", attLog?.actorId ?? null, attLog?.at ?? x.attendanceClosedAt, attendanceDue);
    } else if (conducted) {
      putOpen("attendance", attendanceDue, trainerOwns);
    }

    // — 15. assignment issued
    const assignments = data.assignments.filter((a) => a.sessionId === x.id);
    const assignmentDue = dueFrom(sla, "assignment_issue", endedAt);
    if (assignments.length > 0) {
      const first = assignments.reduce((a, b) => (a.issuedAt <= b.issuedAt ? a : b));
      putClosed("assignment_issue", first.issuedBy, first.issuedAt, assignmentDue);
    } else if (conducted && !dead) {
      putOpen("assignment_issue", assignmentDue, trainerOwns);
    }

    // — 19. HR session review
    const reviewDue = dueFrom(sla, "session_review", endedAt);
    if (x.reviewedAt) {
      putClosed("session_review", x.reviewedBy, x.reviewedAt, reviewDue);
    } else if (x.attendanceClosedAt && !dead) {
      putOpen("session_review", reviewDue);
    }

    // — 20. 30-day effectiveness, one row per HOD, created at attendance closure
    for (const ef of data.effectiveness.filter((v) => v.sessionId === x.id)) {
      const row = {
        ...base,
        scope: "session" as const,
        stepKey: "effectiveness" as StepKey,
        stepId: `${ef.id}:effectiveness`,
        rowId: ef.id,
        /*
         * ⚠ THE ROW'S OWN `due_on`, NOT AN SLA SUM. It is computed server-side at
         *   attendance closure from `fms_ld_config.effectiveness.days_after_session`
         *   — a CALENDAR gap of 30 days, which the shared SLA model has no unit
         *   for. Recomputing it here in working days would put the deadline in a
         *   different week from the one the HOD was told.
         */
        dueIso: ef.dueOn,
        personId: ef.hodId,
      };
      if (ef.submittedAt) {
        closed.push({ ...row, actorId: ef.hodId, doneAtIso: ef.submittedAt });
      } else if (!dead) {
        open.push({ ...row, ownerIds: ef.hodId ? [ef.hodId] : [] });
      }
    }

    // — 11 / 16 / 17 / 18. the participant steps, one per person
    const attended = new Set(
      (attBySession.get(x.id) ?? [])
        .filter((a) => ["present", "partial"].includes(a.status))
        .map((a) => a.employeeId),
    );
    const feedbackBy = new Set(
      data.feedback.filter((f) => f.sessionId === x.id).map((f) => f.employeeId),
    );

    for (const n of approvedNoms) {
      const pbase = {
        scope: "participant" as const,
        rowId: n.id,
        entityId: x.id,
        sessionId: x.id,
        requestId: x.requestId,
        ref: x.code ?? x.id,
        title: x.title,
        personId: n.employeeId,
        isTest: base.isTest,
      };

      // 11 — RSVP. Owed only once the invitation actually went out.
      const rsvpDue = dueFrom(sla, "invitation", n.approvedAt ?? n.nominatedAt);
      if (n.invitedAt) {
        if (n.rsvp && n.rsvp !== "pending") {
          closed.push({
            ...pbase,
            stepKey: "invitation",
            stepId: `${n.id}:invitation`,
            actorId: n.employeeId,
            doneAtIso: n.rsvpAt,
            dueIso: rsvpDue,
          });
        } else if (!dead && !conducted) {
          open.push({
            ...pbase,
            stepKey: "invitation",
            stepId: `${n.id}:invitation`,
            dueIso: rsvpDue,
            ownerIds: [n.employeeId],
          });
        }
      }

      // 18 — feedback. Owed by whoever actually came, never by a no-show.
      if (attended.has(n.employeeId)) {
        const fbDue = dueFrom(sla, "feedback", endedAt);
        const mine = data.feedback.find(
          (f) => f.sessionId === x.id && f.employeeId === n.employeeId,
        );
        if (mine) {
          closed.push({
            ...pbase,
            stepKey: "feedback",
            stepId: `${n.id}:feedback`,
            actorId: n.employeeId,
            doneAtIso: mine.submittedAt,
            dueIso: fbDue,
          });
        } else if (!dead && !feedbackBy.has(n.employeeId)) {
          open.push({
            ...pbase,
            stepKey: "feedback",
            stepId: `${n.id}:feedback`,
            dueIso: fbDue,
            ownerIds: [n.employeeId],
          });
        }
      }
    }
  }

  /* ── 3. THE ASSIGNMENT, PER PERSON (16 and 17) ───────────────────────────
     A submission row exists from the moment the assignment was issued, with a
     null `submitted_at` meaning NOT DONE — so the rows themselves are the work
     list and nothing has to be inferred from who was nominated. */

  const sessionById = new Map(sessions.map((x) => [x.id, x] as const));
  const assignmentById = new Map(data.assignments.map((a) => [a.id, a] as const));

  for (const v of data.submissions) {
    const a = assignmentById.get(v.assignmentId);
    const x = a ? sessionById.get(a.sessionId) : undefined;
    if (!a || !x) continue;
    const dead = sessionDead(x);
    const pbase = {
      scope: "participant" as const,
      rowId: v.id,
      entityId: x.id,
      sessionId: x.id,
      requestId: x.requestId,
      ref: x.code ?? x.id,
      title: a.title,
      personId: v.employeeId,
      // The SESSION decides, never `a.title` — that is the bug this comment guards.
      isTest: taggedTest(x.title, x.code, requestByCode.get(x.requestId ?? "")?.title),
    };

    /*
     * ⚠ THE ASSIGNMENT'S OWN `due_at` WINS. Whoever issued it typed a date and
     *   the nominee was told that date; recomputing seven working days from the
     *   issue stamp would score them against a deadline nobody showed them.
     */
    const submitDue = dayOf(a.dueAt) ?? dueFrom(sla, "assignment_submit", a.issuedAt);

    if (v.submittedAt) {
      closed.push({
        ...pbase,
        stepKey: "assignment_submit",
        stepId: `${v.id}:assignment_submit`,
        actorId: v.employeeId,
        doneAtIso: v.submittedAt,
        dueIso: submitDue,
      });
    } else if (!dead) {
      open.push({
        ...pbase,
        stepKey: "assignment_submit",
        stepId: `${v.id}:assignment_submit`,
        dueIso: submitDue,
        ownerIds: [v.employeeId],
      });
    }

    // 17 — the review, which cannot be owed before there is something to read.
    if (!v.submittedAt) continue;
    const reviewDue = dueFrom(sla, "assignment_review", v.submittedAt);
    if (v.reviewedAt) {
      closed.push({
        ...pbase,
        stepKey: "assignment_review",
        stepId: `${v.id}:assignment_review`,
        actorId: v.reviewedBy,
        doneAtIso: v.reviewedAt,
        dueIso: reviewDue,
      });
    } else if (!dead) {
      open.push({
        ...pbase,
        stepKey: "assignment_review",
        stepId: `${v.id}:assignment_review`,
        dueIso: reviewDue,
        ownerIds: [],
      });
    }
  }

  /* ── 4. FOLLOW-UP AND CLOSURE (21, 22) ───────────────────────────────────
     Both hang off the REQUEST, and both wait on every one of its sessions being
     reviewed. `closure` closes above with `closed_at`; this is its open half. */

  const sessionsOfRequest = new Map<string, TrainingSession[]>();
  for (const x of sessions) {
    if (!x.requestId) continue;
    const list = sessionsOfRequest.get(x.requestId) ?? [];
    list.push(x);
    sessionsOfRequest.set(x.requestId, list);
  }

  for (const r of data.requests) {
    if (!isOpen(r) || stepOf(r)) continue; // still moving through steps 1–8
    const mine = sessionsOfRequest.get(r.id) ?? [];
    if (mine.length === 0) continue;
    const allReviewed = mine.every((x) => !!x.reviewedAt || sessionDead(x));
    if (!allReviewed) continue;
    const lastReview = mine.reduce<string | null>(
      (max, x) => (x.reviewedAt && (!max || x.reviewedAt > max) ? x.reviewedAt : max),
      null,
    );
    const base = {
      scope: "request" as const,
      rowId: r.id,
      entityId: r.id,
      sessionId: null,
      requestId: r.id,
      ref: r.code ?? r.id,
      title: r.title,
      personId: null,
      isTest: taggedTest(r.title, r.code),
      ownerIds: [] as string[],
    };
    if (!r.finalOutcome) {
      open.push({
        ...base,
        stepKey: "followup_decision",
        stepId: `${r.id}:followup_decision`,
        dueIso: dueFrom(sla, "followup_decision", lastReview),
      });
    } else if (!r.closedAt) {
      open.push({
        ...base,
        stepKey: "closure",
        stepId: `${r.id}:closure`,
        dueIso: dueFrom(sla, "closure", lastReview),
      });
    }
  }

  return { open, closed };
}

/** Every open step as the shared queue atom — what the Control Center counts. */
export const openQueueEntries = (work: LdWork) =>
  work.open.map((o) => ({ stepKey: o.stepKey, entityId: o.entityId, ref: o.ref, dueIso: o.dueIso }));

export { titleOf as ldStepTitle };
