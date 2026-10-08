import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReassignModal from "@/shared/components/approvals/ReassignModal";
import { fetchOrgPeople, useOrgPersonById } from "@/core/platform/orgPeople";
import { useSession } from "@/core/platform/session";
import { appBasePath } from "../../appInfo";
import { FLOW_QUERY, reassignTest, type FlowTest } from "../lib/flow";

/**
 * MANAGEMENT REVIEW · REASSIGN — hand a rejected test to someone to audit, the same dialog
 * every FMS uses. Anyone in the org can be picked; the database refuses a person without
 * the module's edit grant (they could not open the app to close it) and says so.
 */
export default function ReassignTestModal({ test, onClose }: { test: FlowTest | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useSession();
  const person = useOrgPersonById();
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const holder = test?.record?.assignedTo ?? null;

  const candidates = useMemo(() => (people.data ?? [])
    .filter((p) => p.id !== user.id && p.id !== holder)
    .map((p) => ({ id: p.id, name: p.designation ? `${p.name} — ${p.designation}` : p.name }))
    .sort((a, b) => a.name.localeCompare(b.name)), [people.data, user.id, holder]);

  if (!test?.record) return null;
  const rec = test.record;

  return (
    <ReassignModal
      open
      onClose={onClose}
      docRef={`Lot ${test.lot.lot} · Test ${test.no}`}
      resetKey={rec.id}
      candidates={candidates}
      currentHolderName={holder ? person(holder)?.name ?? "Someone" : null}
      defaultOwnerLabel="Management review owners"
      setupHref={`${appBasePath("ink-stabilisation")}/settings`}
      setupLabel="Ink Stabilisation settings"
      returnLabel="Hand back to Management"
      subtitle="It leaves Management's list and appears in theirs. Only they (or an admin) can close it after that."
      onReassign={async (target, note) => {
        await reassignTest(rec.id, target, note);
        await qc.invalidateQueries({ queryKey: FLOW_QUERY });
      }}
    />
  );
}
