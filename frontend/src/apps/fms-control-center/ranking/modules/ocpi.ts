/**
 * OC & PI (OCPI) — scored steps (CC-1).
 *
 * Closed: every deal × step, with the module's own `stepCompletedIso`,
 * `stepActorId` and `dueIsoFor` — it has no Completed-tab builder, and these three
 * are what its stepper reads. A stamp on the step the deal is waiting at RIGHT NOW
 * is not a closure: returning a signature sends the deal back to the customer
 * without clearing `cs_at`, so that stamp describes a step that is open again.
 *
 * Open: OCPI has no My Work Today rule, so nobody was "given" its steps in the
 * My Work sense. The user ruled on 18-09-2026 that its overdue steps are charged
 * to whoever the database lets act on them — `ocpiStepOwnerIds` (lib/owners.ts):
 * the step's owners, plus the deal's own raiser for customer sign-off and finance
 * handover, each only with an edit grant.
 *
 * From the module's own records:
 *  · A quotation decision is re-stamped by every decision, rework included, so an
 *    approval after rework reads as the latest decision.
 *  · "Return signature" records no actor, so it closes nothing for anybody.
 *  · A deal in `rework` is open but sits at no queue step; it is owed by nobody.
 *
 * Test deals: every `ZZ TEST` customer, and four dummies filed under real customer
 * names that Ritesh Bhai confirmed are throwaway (QT-M0040 and QT-M0053 on 08-09,
 * QT-M0042 and QT-M0045 on 01-09-2026 — see WORKLIST OCPI-19 / OCPI-26).
 */
import { supabase } from "@/core/platform/supabase";
import { fetchOcpiData, type OcpiData } from "@/apps/ocpi/data/ocpiFetch";
import { ocpiStepOwnerIds } from "@/apps/ocpi/lib/owners";
import { buildQueueEntries, dealRef, dueIsoFor, stepActorId, stepCompletedIso, type QueueStep } from "@/apps/ocpi/lib/queues";
import { resolveStepSla } from "@/apps/ocpi/lib/sla";
import { stepByKey } from "@/apps/ocpi/lib/steps";
import type { OcpiDeal } from "@/apps/ocpi/types";
import type { ClosedStep, ModuleScorer, OpenStep } from "../types";
import { perDataset } from "../memo";

/** The live chain plus the two retired steps older deals still passed through. */
const STEPS: QueueStep[] = [
  "quotation_approval",
  "order_confirmation",
  "oc_approval",
  "customer_signoff",
  "management_signoff",
  "finance_handover",
  "finance_receipt",
];

const DUMMY_QUOTATIONS: ReadonlySet<string> = new Set(["QT-M0040", "QT-M0042", "QT-M0045", "QT-M0053"]);
const isTestDeal = (d: OcpiDeal) =>
  (d.customerName ?? "").toUpperCase().startsWith("ZZ TEST") || DUMMY_QUOTATIONS.has(d.quotationNo ?? "");

const label = (k: string) => stepByKey(k)?.title ?? k;

/** OCPI's data plus who holds an EDIT grant on it — what `module_can_edit` reads. */
export interface OcpiRankData extends OcpiData {
  editors: Set<string>;
}

async function loadEditors(): Promise<Set<string>> {
  const [grants, admins] = await Promise.all([
    supabase.from("app_access").select("user_id").eq("app_id", "ocpi").eq("access_level", "edit"),
    supabase.from("user_roles").select("user_id").eq("role", "admin"),
  ]);
  if (grants.error) throw new Error(`ocpi editors: ${grants.error.message}`);
  if (admins.error) throw new Error(`ocpi admins: ${admins.error.message}`);
  return new Set([...(grants.data ?? []), ...(admins.data ?? [])].map((r) => r.user_id as string));
}

/** Every open entry with the people it belongs to — computed once, filtered per person. */
const ownedEntries = perDataset((data: OcpiRankData) => {
  const sla = resolveStepSla(data.stepSla);
  const byId = new Map(data.deals.map((d) => [d.id, d]));
  return buildQueueEntries(data.deals, sla).map((e) => {
    const deal = byId.get(e.dealId)!;
    return { e, deal, owners: new Set(ocpiStepOwnerIds(deal, e.stepKey, data.stepOwners, (u) => data.editors.has(u))) };
  });
});

export const ocpiScorer: ModuleScorer<OcpiRankData> = {
  key: "ocpi",
  appId: "ocpi",
  load: async () => {
    const [data, editors] = await Promise.all([fetchOcpiData(), loadEditors()]);
    return { ...data, editors };
  },

  closed(data) {
    const sla = resolveStepSla(data.stepSla);
    const openNow = new Map(buildQueueEntries(data.deals, sla).map((e) => [e.dealId, e.stepKey]));
    const out: ClosedStep[] = [];
    for (const d of data.deals) {
      for (const step of STEPS) {
        const at = stepCompletedIso(d, step);
        if (!at || openNow.get(d.id) === step) continue;
        out.push({
          stepId: `${d.id}:${step}`,
          entityId: d.id,
          ref: dealRef(d),
          stepKey: step,
          stepLabel: label(step),
          roundNo: 0,
          dueIso: dueIsoFor(d, step, sla),
          actorId: stepActorId(d, step),
          doneAtIso: at,
          drop: isTestDeal(d) ? "test_record" : undefined,
        });
      }
    }
    return out;
  },

  openFor(data, uid) {
    return ownedEntries(data)
      .filter(({ owners }) => owners.has(uid))
      .map(({ e, deal }): OpenStep => ({
        stepId: `${deal.id}:${e.stepKey}`,
        entityId: deal.id,
        ref: e.ref,
        stepKey: e.stepKey,
        stepLabel: label(e.stepKey),
        roundNo: 0,
        dueIso: e.dueIso,
        drop: isTestDeal(deal) ? "test_record" : undefined,
      }));
  },
};
