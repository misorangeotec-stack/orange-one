/**
 * Learning & Development — scored steps (CC-1), and through CC-1 the nightly KPI
 * facts that fill KRA 2 and KRA 5 of the L&D executive's scorecard.
 *
 * ⚠ SWITCHED OFF in the ranking at launch (`fms_rank_modules`), like Travel Desk
 *   and Asset Maintenance. The module is not deployed at all yet; scored here so
 *   that an admin can switch it on at go-live without anybody writing code that
 *   day.
 *
 * Closed and open both come from `apps/learning-development/lib/work.ts` — the
 * same builder the module's own Control Center row and every person's My Work
 * list read, so none of the three can drift from the others.
 *
 * ⚠ THIS IS THE ONLY SCORED MODULE WHERE MOST STEPS BELONG TO PEOPLE WHO DO NOT
 *   WORK THE PIPELINE. Eight of the twenty-two are a participant's or a HOD's own
 *   obligation — answer the invitation, hand in the assignment, give the feedback,
 *   write the 30-day note — and they are exactly the ones KRA 5 scores PER
 *   EMPLOYEE. That is why `lib/work.ts` keys a participant step by the
 *   participant's own row rather than by the session: twelve people owing a
 *   feedback form is twelve facts, against twelve names.
 *
 * What counts for nobody, and why:
 *  · `need_raised` is the raising itself — an event, not work anybody was given.
 *  · A step with no recorded closer (`no_actor`) or no completion time
 *    (`no_time`). Training Conducted and Attendance Closure have no actor column
 *    of their own, so `lib/work.ts` reads `fms_ld_activity`; on a row written
 *    before that log existed there is nothing to read and the step is dropped
 *    rather than credited to a guess.
 *  · `ZZ TEST` rows — the module was built and walked with seeded data, and every
 *    one of those rows is still in the database (LD-13).
 */
import { fetchLdData, type LdData } from "@/apps/learning-development/data/ldFetch";
import { resolveStepSla } from "@/apps/learning-development/lib/sla";
import { stepByKey } from "@/apps/learning-development/lib/steps";
import { buildLdWork } from "@/apps/learning-development/lib/work";
import { learningDevelopmentWorkItems } from "@/core/workspace/mywork/items/learning-development";
import type { ClosedStep, DropReason, ModuleScorer, OpenStep } from "../types";
import { parseItems } from "../workItems";

const label = (k: string) => stepByKey(k)?.title ?? k;

/*
 * ⚠ TEST DATA IS DECIDED BY `lib/work.ts`, NOT HERE, and that is the point.
 *   Every request and session carries a real sequential code (TRN-2627-0017) —
 *   the test rows were made through the module's own RPCs — so the only marker is
 *   the `ZZ TEST` title, and a PARTICIPANT step does not show the session's title:
 *   an assignment step is titled after the assignment. Matching the displayed
 *   title here let two steps of a test session through into the score, found on
 *   23-09-2026 by running this scorer against live data. The builder now decides
 *   once, on the owning entity, and every step of that entity inherits it.
 */

/**
 * The raising of a need is not work anybody was given — it is the event every
 * later step's clock is anchored on. Scoring it would credit whoever happened to
 * type the form with a step they were never assigned.
 */
const EXCLUDED = new Set(["need_raised"]);

export const learningDevelopmentScorer: ModuleScorer<LdData> = {
  key: "learning-development",
  appId: "learning-development",
  load: () => fetchLdData(),

  closed(data) {
    const work = buildLdWork(data, resolveStepSla(data.config?.step_sla ?? null));
    const out: ClosedStep[] = [];
    for (const c of work.closed) {
      const drop: DropReason | undefined = EXCLUDED.has(c.stepKey)
        ? "excluded_step"
        : c.isTest
          ? "test_record"
          : !c.actorId
            ? "no_actor"
            : !c.doneAtIso
              ? "no_time"
              : undefined;
      out.push({
        stepId: c.stepId,
        entityId: c.entityId,
        ref: c.ref,
        stepKey: c.stepKey,
        stepLabel: label(c.stepKey),
        roundNo: 0,
        dueIso: c.dueIso,
        actorId: c.actorId,
        /*
         * A dropped step still needs a string here — the contract types
         * `doneAtIso` as required and the runner reports drops rather than
         * filtering them out before they are counted. It is never read for a
         * dropped row.
         */
        doneAtIso: c.doneAtIso ?? "",
        drop,
      });
    }
    return out;
  },

  /**
   * ⚠ ALWAYS AS A NON-ADMIN — `false` is not a placeholder. Every `items/` rule
   *   in this hub returns the whole book for an admin, and one admin would then be
   *   charged with everybody's backlog. This module's own items file already
   *   refuses to widen for an admin, but passing `false` is the contract every
   *   other scorer keeps and the reason is the same.
   */
  openFor(data, uid) {
    /*
     * ⚠ THE ITEMS DECIDE OWNERSHIP, THE BUILDER DECIDES EVERYTHING ELSE. The open
     *   half must be exactly what My Work Today lists for this person — that is
     *   the ranking's contract — but a `WorkItem` carries only what a row on the
     *   home screen needs, and `isTest` is not one of those things. So the builder
     *   is asked again for its flags and the two are matched on the item's own key
     *   (`source:row:step`), which is the key the builder minted in the first
     *   place. Re-deriving "is this a test row" from the item's text is the bug
     *   this avoids.
     */
    const work = buildLdWork(data, resolveStepSla(data.config?.step_sla ?? null));
    const flagOf = new Map<string, boolean>(work.open.map((o) => [`${o.rowId}:${o.stepKey}`, o.isTest]));
    const items = learningDevelopmentWorkItems(data, uid, false);
    return parseItems(items).map(
      ({ entityId, stepKey, item }): OpenStep => ({
        stepId: `${entityId}:${stepKey}`,
        entityId,
        ref: item.ref,
        stepKey,
        stepLabel: label(stepKey),
        roundNo: 0,
        dueIso: item.dueIso,
        drop: flagOf.get(`${entityId}:${stepKey}`) ? "test_record" : undefined,
      }),
    );
  },
};
