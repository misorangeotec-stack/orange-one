import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { formatDateDMY } from "@/shared/lib/date";
import { useHrStore } from "../store";
import { STEPS, isHodStep, type StepKey } from "../lib/steps";
import { STAGE_PENDING_STEP } from "../lib/queues";
import type { Requisition } from "../types";

/**
 * The WHOLE recruitment journey on one rail, at the top of an MRF — the same
 * component Purchase puts on a PR, wearing HR's steps.
 *
 * This used to be five requisition-level stages that stopped dead at "Collecting
 * CVs", which is the point the interesting half of recruitment begins. HR already
 * had the workflow drawn four times (the Control Center strip, the queues, the
 * board columns, the Due Dates screen) and never once end to end, so "where has
 * this vacancy actually got to?" meant opening several screens and holding the
 * answer in your head.
 *
 * THREE THINGS ABOUT THE POSITION THAT ARE NOT OBVIOUS:
 *
 * 1. IT TRACKS THE FURTHEST-ALONG CANDIDATE, NOT THE BOTTLENECK.
 *    Purchase's rail sits on the LEAST-advanced line, because a PR is not done
 *    until every line is. A vacancy is the opposite: it is filled the moment ONE
 *    person gets through. Pinning it to the least-advanced candidate would park
 *    the rail on "Resumes" indefinitely, because fresh CVs keep arriving right up
 *    until the seat is filled — and the fact you opened the page for (somebody is
 *    at Round 3) would never appear.
 *
 * 2. DISQUALIFIED AND DROPPED-OUT CANDIDATES DO NOT COUNT.
 *    Someone rejected at Round 3 is not evidence the vacancy reached Round 3; they
 *    left the pipeline. Nor is someone who accepted and then declined — that seat
 *    went back to being a vacancy, so they prove nothing past Decision.
 *
 * 3. A DEAD REQUISITION IS NOT A FINISHED ONE.
 *    Rejected and cancelled stop where they stopped. Ticking the rail through would
 *    claim work that never happened.
 *
 * The two conditional steps (`mrf_resubmit`, `probation_extension`) appear only on
 * requisitions that actually hit them, the way Purchase's return branch does —
 * otherwise every MRF would advertise a send-back that never occurred.
 */
export default function MrfStepper({ requisition: r }: { requisition: Requisition }) {
  const s = useHrStore();

  /** Did any hire off this requisition have their probation extended? */
  const extended = useMemo(
    () =>
      s
        .candidatesFor(r.id)
        .map((c) => s.onboardingForCandidate(c.id))
        .filter((o): o is NonNullable<typeof o> => !!o)
        .some((o) => s.probationForOnboarding(o.id)?.outcome === "extended"),
    [s, r.id],
  );

  /** The steps THIS requisition's journey is actually made of. */
  const steps: StepKey[] = useMemo(
    () =>
      STEPS.filter((st) => {
        if (st.key === "mrf_resubmit") return r.status === "sent_back";
        if (st.key === "probation_extension") return extended;
        return true;
      }).map((st) => st.key),
    [r.status, extended],
  );

  /**
   * The date a step actually completed, from the requisition's OWN timestamp column
   * — stamped inside the RPC that performed the step, never inferred from the
   * activity trail, which is best-effort and can be missing. Only the requisition-
   * scoped steps have one; the rest belong to a candidate, not the vacancy.
   */
  const doneOn: Partial<Record<StepKey, string | null>> = {
    mrf: r.submittedAt,
    hr_head_approval: r.hrApprovedAt,
    mgmt_approval: r.mgmtApprovedAt,
    job_posting: r.postedAt,
  };

  const nodes: PoStageRailNode[] = useMemo(
    () =>
      steps.map((key) => {
        const def = STEPS.find((st) => st.key === key)!;
        // HOD steps are owned per-requisition by whoever raised THIS MRF. There is no
        // departments.hod_id in this portal, so a global owner would route Sachin
        // Plant's candidates to the Exim head — the rule fms_hr_can_act() enforces.
        const ownerIds = isHodStep(key)
          ? r.hiringManagerIds
          : (s.stepOwners.find((o) => o.stepKey === key)?.employeeIds ?? []);

        const people = ownerIds.map((id) => s.profileById(id)?.name).filter((n): n is string => !!n);
        const departments = [
          ...new Set(
            ownerIds
              .map((id) => s.profileById(id)?.departmentId)
              .map((did) => (did ? s.departments.find((d) => d.id === did)?.name : undefined))
              .filter((n): n is string => !!n),
          ),
        ];

        const at = doneOn[key];
        return {
          key,
          label: def.short,
          departments,
          people,
          note: at ? formatDateDMY(at) : undefined,
          // `mrf` is noQueue — raising the requisition IS the event, nobody owes it.
          hasStep: !def.noQueue,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, s, r],
  );

  const { activeIndex, finished } = useMemo(() => {
    /** Position of a step, or 0 if this journey doesn't include it. */
    const at = (key: StepKey) => Math.max(0, steps.indexOf(key));

    if (r.status === "closed") return { activeIndex: steps.length - 1, finished: true };
    if (r.status === "rejected") return { activeIndex: at("mgmt_approval"), finished: false };
    if (r.status === "cancelled") return { activeIndex: at("mrf"), finished: false };

    // Pre-pipeline: the requisition's own status is the whole truth.
    if (r.status === "sent_back") return { activeIndex: at("mrf_resubmit"), finished: false };
    if (r.status === "hr_review") return { activeIndex: at("hr_head_approval"), finished: false };
    if (r.status === "mgmt_review") return { activeIndex: at("mgmt_approval"), finished: false };
    if (r.status === "posting") return { activeIndex: at("job_posting"), finished: false };

    // On hold: parked wherever it was parked, so read the stored step.
    if (r.status === "on_hold") {
      const idx = steps.indexOf(r.currentStep as StepKey);
      return { activeIndex: idx >= 0 ? idx : at("resume_upload"), finished: false };
    }

    // Sourcing onwards — how far a LIVE candidate has actually got.
    let best = at("resume_upload");

    for (const c of s.candidatesFor(r.id)) {
      if (c.stage === "disqualified") continue;

      // Everyone who has been offered the job — `hired` included, since that is the
      // same person one acknowledgement later. Below this the card is still moving,
      // and its pending step is how far it got.
      if (c.stage !== "finalized" && c.stage !== "hired") {
        const step = STAGE_PENDING_STEP[c.stage];
        if (step) best = Math.max(best, at(step));
        continue;
      }

      const o = s.onboardingForCandidate(c.id);
      if (!o || o.offerStatus === "declined" || o.offerStatus === "no_show") {
        best = Math.max(best, at("final_decision"));
        continue;
      }
      if (!o.completedAt) {
        best = Math.max(best, at("onboarding"));
        continue;
      }

      // They joined. Probation is measured by reviews actually recorded.
      const p = s.probationForOnboarding(o.id);
      if (!p) {
        best = Math.max(best, at("onboarding"));
        continue;
      }
      if (p.finalStatus) return { activeIndex: steps.length - 1, finished: true };

      const months = s.reviewsFor(p.id).length;
      const key: StepKey =
        p.outcome === "extended"
          ? "probation_extension"
          : months >= 3
            ? "probation_final"
            : months === 2
              ? "probation_m3"
              : months === 1
                ? "probation_m2"
                : "probation_m1";
      best = Math.max(best, at(key));
    }

    return { activeIndex: best, finished: false };
  }, [s, r, steps]);

  // No status chip here any more. It said only the word — "CANCELLED" — and `StateNote`
  // now renders directly beneath this rail with the same word plus the reason, the person
  // and the date. Two red chips 8px apart, one of which explained nothing.
  return <PoStageRail nodes={nodes} activeIndex={activeIndex} finished={finished} />;
}
