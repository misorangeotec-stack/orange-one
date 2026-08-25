import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../store";
import { stepActorId, stepCompletedIso } from "../lib/queues";
import { dmy } from "../lib/format";
import { isRetiredStep, type StepKey } from "../lib/steps";
import { STATUS_STEP, type OcpiDeal, type OcpiStatus } from "../types";

/**
 * The deal lifecycle stages, in order — the quotation itself, the five queue
 * steps, and the terminal Closed node.
 *
 * ⚠ PoStageRail PRINTS `i + 1` IN EACH PENDING CIRCLE, so THIS ORDER IS THE
 *   USER-VISIBLE STEP NUMBERING. It must line up 1:1 with `STEPS[].index` in
 *   lib/steps.ts, which is what Settings → Step Owners and Settings → Due Dates
 *   number too. A rail that numbers a step differently from Settings is the
 *   exact mismatch the Import FMS had to go back and fix.
 *
 * ⚠ `quotation` IS A REAL STEP HERE even though it has no queue. It is ownable
 *   (OWNER_STEPS includes it) and it is where a deal spends the whole
 *   negotiation, so leaving it off would make the rail start at an approval for
 *   a document nobody is shown the author of.
 */
type Stage = { key: string; label: string; step: StepKey | null };

/** The chain a deal raised today travels. */
const LIVE_STAGES: Stage[] = [
  { key: "quotation",          label: "Quotation",            step: "quotation" },
  { key: "quotation_approval", label: "Approve Quotation",    step: "quotation_approval" },
  { key: "customer_signoff",   label: "Customer Signature",   step: "customer_signoff" },
  { key: "management_signoff", label: "Management Signature", step: "management_signoff" },
  { key: "finance_handover",   label: "Hand Over to Finance", step: "finance_handover" },
  { key: "finance_receipt",    label: "Finance Receipt",      step: "finance_receipt" },
  { key: "closed",             label: "Closed",               step: null },
];

/** The two steps the stage-F cutover removed, in the place they used to occupy. */
const RETIRED_STAGES: Stage[] = [
  { key: "order_confirmation", label: "Order Confirmation", step: "order_confirmation" },
  { key: "oc_approval",        label: "Approve OC",         step: "oc_approval" },
];

/**
 * Did this deal travel the OLD chain?
 *
 * ⚠ NOT ANSWERED FROM `oc_at`, which would be wrong now. Since stage E the order
 *   confirmation is issued at the Directors' approval, so `oc_at` is stamped on
 *   every new deal and would report all of them as historical. `oca_at` is only
 *   ever written by fms_ocpi_decide_oc, the retired gate, so it is the honest
 *   marker — together with a deal actually parked at, held from, or bounced back
 *   from one of the retired steps.
 */
function tookOldPath(d: OcpiDeal): boolean {
  if (d.ocaAt) return true;
  const retiredStatus = (st: string | null): boolean =>
    st === "awaiting_order_confirmation" || st === "awaiting_oc_approval";
  return (
    retiredStatus(d.status) ||
    retiredStatus(d.holdFromStatus) ||
    isRetiredStep(d.reworkStage ?? "") ||
    isRetiredStep(d.rejectStage ?? "")
  );
}

/**
 * The rail THIS deal should draw.
 *
 * ⚠ A NEW DEAL IS NOT SHOWN TWO STEPS IT WILL NEVER VISIT, and a historical one
 *   is not shown a rail that omits where it is standing. Building the nodes from
 *   the deal rather than from a single constant is what lets both be true; a
 *   fixed array would have to be wrong for one of them.
 */
function stagesFor(d: OcpiDeal): Stage[] {
  if (!tookOldPath(d)) return LIVE_STAGES;
  const out = [...LIVE_STAGES];
  out.splice(2, 0, ...RETIRED_STAGES);
  return out;
}

const idxOfStep = (stages: Stage[], step: StepKey): number =>
  stages.findIndex((s) => s.step === step);

/**
 * Which node the deal is sitting on.
 *
 * ⚠ IT READS `status` THROUGH THE SAME `STATUS_STEP` MAP THE QUEUES READ. The
 *   rail must not be able to say a deal is at Approve OC while the OC Approval
 *   queue does not hold it — one map, so they cannot disagree.
 *
 * ⚠ A PARKED OR DEAD DEAL IS SHOWN WHERE IT STOPPED, not where it would have
 *   gone next. `on_hold` remembers the status it was held from, and reject /
 *   rework stamp the step key they came back from, so all three are answerable
 *   exactly. `cancelled` records no stage at all — for that one, and for any
 *   stage string this build does not recognise, the honest answer is the first
 *   step with nothing stamped on it.
 */
function activeIndex(d: OcpiDeal, stages: Stage[]): number {
  if (d.status === "closed") return stages.length - 1;
  if (d.status === "draft") return 0;

  const live = STATUS_STEP[d.status];
  if (live) return idxOfStep(stages, live);

  if (d.status === "on_hold" && d.holdFromStatus) {
    const held = STATUS_STEP[d.holdFromStatus as OcpiStatus];
    if (held) return idxOfStep(stages, held);
  }
  const stamped = d.status === "rework" ? d.reworkStage : d.status === "rejected" ? d.rejectStage : null;
  if (stamped) {
    const i = idxOfStep(stages, stamped as StepKey);
    if (i >= 0) return i;
  }

  // Nothing recorded: the first step that never completed. Floored at 0 and
  // capped below the Closed node, which only a closed deal may sit on.
  const first = stages.findIndex((s) => s.step !== null && !stepCompletedIso(d, s.step));
  return first < 0 ? stages.length - 2 : first;
}

/**
 * Statuses in which the deal is not moving, and the rail should say so.
 *
 * ⚠ `rework` IS UNREACHABLE TODAY and is listed anyway. The approval RPC sends a
 *   returned deal back to a LIVE status — `fms_ocpi_decide_quotation` sets
 *   `draft` — and records the bounce in `rework_stage` / `rework_at` /
 *   `rework_count` instead. So
 *   nothing in the module can currently produce this status, even though it is a
 *   legal value in the deals CHECK and several screens test for it. Do not
 *   conclude the rail is broken because you cannot make this branch fire; the
 *   fact a returned deal really does carry is the chip below, driven by
 *   `reworkCount`.
 */
const HALTED: Partial<Record<OcpiStatus, string>> = {
  on_hold: "On hold",
  rework: "Sent back for changes",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/**
 * The step a deal was last returned from, in the words the rail uses.
 *
 * ⚠ THE NULL CHECK IS LOAD-BEARING, not defensive. The Closed node carries
 *   `step: null`, so a lookup for a deal with no recorded rework stage used to
 *   match it and the chip read "sent back from Closed" — a step nothing is ever
 *   returned from, on a deal that had been bounced from an approval.
 */
const STAGE_LABEL = (stage: string | null): string =>
  (stage ? [...LIVE_STAGES, ...RETIRED_STAGES].find((s) => s.step === stage)?.label : null) ??
  "an approval";

/**
 * The horizontal lifecycle rail for one deal — the same rail Order to Dispatch,
 * Purchase, Import, Production, Sampling, Asset Maintenance and HR use.
 *
 * This is the ADAPTER; the drawing lives in the shared `PoStageRail`. Its job is
 * to turn ids into names and a status into a position.
 *
 * ⚠ A FINISHED STEP NAMES WHO DID IT; AN UNFINISHED ONE NAMES WHO OWES IT. Those
 *   are different questions and the rail answers whichever one the reader can
 *   actually use. Once a quotation is approved, "the approvers are A and B" is
 *   noise — the fact is that B approved it, on the 18th. Before it is approved,
 *   who approved it does not exist yet and the useful answer is who to chase.
 *   The date under a finished step is what tells the two apart at a glance.
 *
 * ⚠ NO SITE CHIP, unlike Order to Dispatch. That chip exists there to explain
 *   why *those* names — dispatch owners are per site. OCPI's step owners are
 *   module-wide, so a chip saying otherwise would be a lie. What OCPI has
 *   instead is revisions, which is the fact the same slot should carry.
 */
export default function OcpiStepper({ deal, fit }: { deal: OcpiDeal; fit?: boolean }) {
  const s = useOcpiStore();
  const personById = useOrgPersonById();

  const stages = useMemo(() => stagesFor(deal), [deal]);
  const active = activeIndex(deal, stages);
  const finished = deal.status === "closed";
  const haltedLabel = HALTED[deal.status];

  const nodes: PoStageRailNode[] = useMemo(() => {
    const name = (id: string | null): string | null => personById(id)?.name ?? null;

    return stages.map((st, i) => {
      if (!st.step) {
        // Closed carries no owners and no caption — nobody is assigned to a deal
        // being over.
        return { key: st.key, label: st.label, departments: [], people: [], hasStep: false };
      }

      const doneAt = stepCompletedIso(deal, st.step);
      const isDone = i < active || (finished && i === active);
      /*
        ⚠ `quotation` NAMES ITS AUTHOR WHETHER OR NOT IT IS FINISHED, unlike every
          other step. Settings leaves that step unowned on purpose — no owners
          means anyone with an edit grant may raise a deal — so asking the owner
          list would caption it "Unassigned" on a draft that plainly does belong
          to somebody. A returned quotation sits here, and the one thing its
          reader needs is whose desk it is back on.
      */
      const actor = isDone || st.step === "quotation" ? name(stepActorId(deal, st.step)) : null;

      return {
        key: st.key,
        label: st.label,
        departments: [],
        // Falling back to the owner list when a finished step has no actor on
        // record keeps the column from reading "Unassigned" for work that was
        // demonstrably done.
        people: actor
          ? [actor]
          : (s.ownersOf(st.step).map(name).filter(Boolean) as string[]),
        hasStep: true,
        note: isDone && doneAt ? dmy(doneAt) : undefined,
      };
    });
    // `personById` is rebuilt every render by design (it closes over a query
    // result), so it is deliberately not a dependency — including it would make
    // this memo run every render and defeat the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, stages, active, finished, s.stepOwners]);

  return (
    <div className="space-y-2.5">
      {(deal.quotationVersionNo > 1 || deal.reworkCount > 0 || haltedLabel) && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {/*
            The revision chip is OCPI's answer to Order to Dispatch's round chip:
            the rail shows one pass through the process, and this says how many
            times the document behind it was rewritten. `quotationVersionNo` is
            the NEXT version to be minted, so the count already issued is one
            less — the same off-by-one the editor's "Rev n" heading applies.
          */}
          {deal.quotationVersionNo > 1 && (
            <>
              <span className="rounded-full bg-orange-soft px-2.5 py-0.5 text-[11.5px] font-semibold text-orange">
                Rev {deal.quotationVersionNo - 1}
              </span>
              <span className="text-[12.5px] text-grey-2">
                the quotation was revised {deal.quotationVersionNo - 1}{" "}
                {deal.quotationVersionNo - 1 === 1 ? "time" : "times"} during the negotiation
              </span>
            </>
          )}
          {/*
            ⚠ A RETURNED DEAL LOOKS EXACTLY LIKE A NORMAL ONE WITHOUT THIS. An
              approver who sends a quotation back sets the deal's status to
              `draft` again — the same status it had before it was ever
              submitted — so the rail, the queues and the deal list would all show
              it as though nothing had happened. The only surviving evidence is
              `rework_count` and `rework_stage`, and this is where they are read.
              It is not a halted state: somebody is working on it. It is a fact
              about how the deal got here.
          */}
          {deal.reworkCount > 0 && (
            <>
              <span className="rounded-full bg-ryg-yellow/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-navy">
                Sent back {deal.reworkCount === 1 ? "once" : `${deal.reworkCount} times`}
              </span>
              <span className="text-[12.5px] text-grey-2">
                last returned from {STAGE_LABEL(deal.reworkStage)}
                {deal.reworkAt ? ` on ${dmy(deal.reworkAt)}` : ""}
                {deal.reworkReason ? ` — ${deal.reworkReason}` : ""}
              </span>
            </>
          )}
          {haltedLabel && (
            <>
              <span className="rounded-full bg-ryg-red/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-ryg-red">
                {haltedLabel}
              </span>
              <span className="text-[12.5px] text-grey-2">
                {deal.status === "cancelled"
                  ? "the rail shows where it stopped"
                  : "the rail shows the step it is waiting at — nobody's queue holds it"}
              </span>
            </>
          )}
        </div>
      )}

      <PoStageRail nodes={nodes} activeIndex={active} finished={finished} stopped={!!haltedLabel} fit={fit} />
    </div>
  );
}
