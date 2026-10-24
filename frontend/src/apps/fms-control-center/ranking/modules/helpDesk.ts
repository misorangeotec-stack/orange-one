/**
 * Help Desk — scored steps (CC-1), and through CC-1 the nightly KPI facts that
 * fill Khushi's KRA 5, Dharmistha's KRA 4 and KRA 9, and the HR Head's KRA 1.
 *
 * ⚠ SWITCHED OFF in the ranking at launch (`fms_rank_modules`), and the reason is
 *   written down in ranking/registry.ts rather than left to be rediscovered:
 *   KPI-1 weights by VOLUME while the appraisal sheets weight by declared
 *   IMPORTANCE. 200 tickets a month would be roughly 90% of Khushi's KPI-1 score
 *   while her own sheet puts Help Desk at 5%. Switching this on without saying
 *   that makes a fair scorecard look unfair. It is scored here so an admin can
 *   turn it on at go-live without anybody writing code that day.
 *
 * Closed and open both come from `apps/help-desk/lib/work.ts` — the same builder
 * the module's own screens read, so none of them can drift.
 *
 * ⚠ THE CLOSED HALF COMES OFF THE TIMELINE, NOT THE TICKET ROW. A reopen clears
 *   `resolved_at`, so a ticket answered three times carries one resolution on the
 *   row and three in its history. Scoring the row would credit one step and lose
 *   two — backwards, because a reopened ticket is MORE work.
 *
 * What counts for nobody, and why:
 *  · `raise` — raising is the event every later clock is anchored on, not work
 *    anybody was given. Scoring it would credit whoever typed the form.
 *  · An UNTIMED category's `resolve` (`untimed`). Five are governed by policy
 *    rather than working days; there is no deadline to have met, and counting
 *    them either way invents a promise nobody made.
 *  · A step with no recorded actor (`no_actor`) — the auto-close job closes
 *    tickets with no human behind it, and nobody should be credited for silence.
 *  · `ZZ TEST` tickets.
 *  · A HELD ticket's open step (`held`) — somebody with the right to hold has
 *    already decided it is not owed today.
 *
 * ⚠ CONFIDENTIAL TICKETS ARE SCORED LIKE ANY OTHER, and that is correct: this
 *   runs as the service role in an edge function, the output is a per-person
 *   COUNT, and the HR Head's own KRA 12 is measured on exactly those cases.
 *   Nothing here carries a subject line into anybody's score.
 */
import { fetchHelpData, type HelpData } from "@/apps/help-desk/data/helpFetch";
import { resolveStepSla } from "@/apps/help-desk/lib/sla";
import { stepByKey } from "@/apps/help-desk/lib/steps";
import { buildHelpWork } from "@/apps/help-desk/lib/work";
import { helpDeskWorkItems } from "@/core/workspace/mywork/items/help-desk";
import type { ClosedStep, DropReason, ModuleScorer, OpenStep } from "../types";
import { heldDrop, parseItems } from "../workItems";

const label = (k: string) => stepByKey(k)?.title ?? k;

export const helpDeskScorer: ModuleScorer<HelpData> = {
  key: "help-desk",
  appId: "help-desk",
  load: () => fetchHelpData(),

  closed(data) {
    const { closed } = buildHelpWork(data, resolveStepSla(data.config?.step_sla ?? null));
    return closed.map((c): ClosedStep => {
      const drop: DropReason | undefined = c.isTest
        ? "test_record"
        : // ⚠ BEFORE `no_actor`: an untimed step has nothing to score whether or
          //   not somebody closed it, and reporting it as "no actor" would send
          //   whoever reads the drop counts looking for a data problem that is
          //   not there.
          c.dueIso === null
          ? "untimed"
          : !c.actorId
            ? "no_actor"
            : !c.doneAtIso
              ? "no_time"
              : undefined;
      return {
        stepId: c.stepId,
        entityId: c.entityId,
        ref: c.ref,
        stepKey: c.stepKey,
        stepLabel: label(c.stepKey),
        roundNo: c.roundNo,
        dueIso: c.dueIso,
        actorId: c.actorId,
        /* A dropped step still needs a string here — the contract types this as
           required and the runner REPORTS drops rather than filtering them out
           before they are counted. Never read for a dropped row. */
        doneAtIso: c.doneAtIso ?? "",
        drop,
      };
    });
  },

  /**
   * ⚠ ALWAYS AS A NON-ADMIN — and this module's items file takes no `isAdmin` at
   *   all, because an admin has no wider claim on a ticket than anybody else:
   *   every step is owned by a named person or by a category's owners. Passing
   *   one would have to mean "give the admin every ticket".
   */
  openFor(data, uid) {
    /*
     * ⚠ THE ITEMS DECIDE OWNERSHIP, THE BUILDER DECIDES EVERYTHING ELSE. The open
     *   half must be exactly what My Work Today lists for this person — that is
     *   the ranking's contract — but a `WorkItem` carries only what the home
     *   screen needs, and `isTest` is not one of those things. So the builder is
     *   asked again and the two are matched on entity + step.
     */
    const { open } = buildHelpWork(data, resolveStepSla(data.config?.step_sla ?? null));
    const meta = new Map(open.map((o) => [`${o.entityId}:${o.stepKey}`, o]));
    const items = helpDeskWorkItems(data, uid);

    return parseItems(items).map(({ entityId, stepKey, item }): OpenStep => {
      const m = meta.get(`${entityId}:${stepKey}`);
      return {
        // The round comes off the builder, so an open round-2 resolve is a
        // different step from the round-1 one that was already closed.
        stepId: `${entityId}:${stepKey}:${m?.roundNo ?? 0}`,
        entityId,
        ref: item.ref,
        stepKey,
        stepLabel: label(stepKey),
        roundNo: m?.roundNo ?? 0,
        dueIso: item.dueIso,
        drop: m?.isTest
          ? "test_record"
          : // An untimed step can never be late, so charging it to somebody's
            // open backlog would be charging them for a deadline that does not
            // exist.
            item.dueIso === null
            ? "untimed"
            : heldDrop(item),
      };
    });
  },
};
