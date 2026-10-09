/**
 * Ink Stabilisation → work items. See ./README.md.
 *
 * Two buckets, the app's two lists:
 *   - PLANT TESTING — a retest due this month (or carried over from an earlier
 *     month since the flow went live) that is not yet submitted, or that
 *     management sent back. Same rule as the Plant page (`inPlantScope`).
 *   - MANAGEMENT REVIEW — a submitted retest waiting to be closed or sent back.
 *     This one is the approval.
 *
 * ⚠ ONLY PEOPLE NAMED ON A STEP GET ITS WORK. The app lets anyone with the edit
 *   grant act on a step that has NO owners listed (`canAct`). Listing every such
 *   test on the home screen of every editor would put the whole plant's month on
 *   a dozen people's screens, none of whom it was given to. Admins see it as "team".
 *
 * ⚠ NOT MAILED. Untested retests come from ConnectWave lots (`useInkLots`), which
 *   the work-snapshot server bundle cannot read — see DELIBERATELY_UNCOVERED in
 *   supabase/worksnapshot/entry.ts. So unlike the other files here, this one may
 *   import from the app's flow module.
 *
 * There is no page per test (a test opens in a modal on its list), so each row
 * opens the list it sits on.
 */
import { appName } from "@/apps/appInfo";
import { inPlantScope, joinTests, type FlowData, type TestRecord } from "@/apps/ink-stabilisation/lib/flow";
import type { InkLot } from "@/apps/ink-stabilisation/lib/schedule";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import type { WorkItem } from "../types";

const SOURCE = "ink-stabilisation";
const PLANT_HREF = "/ink-stabilisation/plant";
const REVIEW_HREF = "/ink-stabilisation/review";

export function inkStabilisationWorkItems(
  flow: FlowData,
  /** Null until the (slow) ConnectWave lots have loaded — sent-back and review work still shows. */
  lots: InkLot[] | null,
  uid: string,
  isAdmin: boolean,
  canEdit = true,
): WorkItem[] {
  if (!canEdit) return [];
  const isPlant = flow.owners.plant.includes(uid);
  const isReview = flow.owners.review.includes(uid);
  if (!isPlant && !isReview && !isAdmin) return [];

  const month = todayLocalIso().slice(0, 7);
  const out: WorkItem[] = [];
  const item = (step: "plant" | "review", key: string, stockItem: string, lotNo: string, no: number, due: string): WorkItem => ({
    id: `${SOURCE}:${key}:${step}`,
    source: SOURCE,
    sourceLabel: appName(SOURCE),
    ref: `${lotNo} · Test ${no}`,
    detail: stockItem,
    stage: step === "plant" ? (no === 1 ? "Plant · 3 mo" : no === 2 ? "Plant · 6 mo" : "Plant · 9 mo") : "Mgmt review",
    // The plant's retest date is the PLANT's deadline. Review has no SLA of its
    // own, and inheriting that date painted almost every review overdue on arrival.
    dueIso: step === "plant" ? due : null,
    to: step === "plant" ? PLANT_HREF : REVIEW_HREF,
    assignment: (step === "plant" ? isPlant : isReview) ? "direct" : "team",
    isApproval: step === "review",
  });

  // Review work needs only the flow rows.
  const records: [string, TestRecord][] = [...flow.tests.entries()];
  for (const [key, t] of records) {
    if (t.status === "submitted" && (isReview || isAdmin)) {
      out.push(item("review", key, t.stockItem, t.lotNo, t.testNo, t.dueDate));
    }
  }

  if (isPlant || isAdmin) {
    if (lots) {
      for (const t of joinTests(lots, flow)) {
        if ((t.status === "pending" || t.status === "returned") && inPlantScope(t, month, true)) {
          out.push(item("plant", t.key, t.lot.item, t.lot.lot, t.no, t.due));
        }
      }
    } else {
      // Before the lots arrive, at least what management sent back.
      for (const [key, t] of records) {
        if (t.status === "returned") out.push(item("plant", key, t.stockItem, t.lotNo, t.testNo, t.dueDate));
      }
    }
  }
  return out;
}
