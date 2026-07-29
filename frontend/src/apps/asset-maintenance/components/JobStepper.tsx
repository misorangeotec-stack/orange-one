import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useAssetStore } from "../store";
import type { StepKey } from "../lib/steps";
import type { ServiceJob } from "../types";

/**
 * The service-job lifecycle stages, in order, for the detail stepper — the origin
 * (Due), the three workflow steps, and the terminal Closed node.
 *
 * ⚠ PoStageRail prints `i + 1` in each pending circle, so THIS ORDER IS THE
 *   USER-VISIBLE STEP NUMBERING. It must line up 1:1 with STEPS[].index, which is
 *   what Setup → Step Owners and Setup → Due Dates also show. A rail that numbers
 *   a step differently from Setup is the exact mismatch the Import FMS had to fix.
 */
const STAGES: { key: string; label: string; step: StepKey | null }[] = [
  { key: "service_due", label: "Due", step: "service_due" },
  { key: "schedule", label: "Schedule", step: "schedule" },
  { key: "service_done", label: "Service", step: "service_done" },
  { key: "verify_close", label: "Verify", step: "verify_close" },
  { key: "closed", label: "Closed", step: null },
];

/**
 * Which node the job is sitting on. A closed job finishes the final node; a
 * cancelled or skipped one stops where it stood. "Due" (index 0) is always
 * complete for a live job — the job exists BECAUSE it fell due — so the floor is 1.
 */
function activeIndex(j: ServiceJob): number {
  if (j.status === "closed") return STAGES.length - 1;
  const i = STAGES.findIndex((st) => st.step === j.currentStep);
  return i < 1 ? 1 : i;
}

/**
 * Horizontal lifecycle rail for a service job — the same rail the Purchase,
 * Import, Production and Dispatch FMS use, captioned with the people responsible
 * for each step. This is the ADAPTER: it resolves step-owner ids to names; the
 * rendering lives in the shared PoStageRail.
 */
export default function JobStepper({ job, fit }: { job: ServiceJob; fit?: boolean }) {
  const s = useAssetStore();

  const nodes: PoStageRailNode[] = useMemo(() => {
    const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name;
    const custodianId = s.assetById(job.assetId)?.custodianUserId ?? null;

    return STAGES.map((st) => {
      if (!st.step) {
        return { key: st.key, label: st.label, departments: [], people: [], hasStep: false };
      }
      const owner = s.stepOwnerFor(st.step);
      const people = (owner?.employeeIds ?? [])
        // personName, not a directory lookup: the directory is RLS-scoped, so a
        // cross-department owner would render blank.
        .map((id) => s.personName(id))
        .filter((n) => n !== "—" && n !== "Unknown user");

      // The custodian genuinely can action these two steps (fms_asset_can_act has
      // the same arm), so the rail names them — otherwise the person most likely
      // to do the work is missing from the picture of who is responsible.
      if ((st.step === "schedule" || st.step === "service_done") && custodianId) {
        const name = s.personName(custodianId);
        if (name !== "—" && name !== "Unknown user" && people.indexOf(name) === -1) {
          people.push(`${name} (custodian)`);
        }
      }

      return {
        key: st.key,
        label: st.label,
        departments: (owner?.departmentIds ?? []).map(deptName).filter((n): n is string => !!n),
        people,
        hasStep: true,
      };
    });
  }, [s, job.assetId]);

  return <PoStageRail nodes={nodes} activeIndex={activeIndex(job)} finished={job.status === "closed"} fit={fit} />;
}
