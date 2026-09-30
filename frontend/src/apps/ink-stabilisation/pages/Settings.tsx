import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useSession } from "@/core/platform/session";
import { FLOW_QUERY, saveOwners, useFlow, type StepKey } from "../lib/flow";
import { FlowUnavailable } from "../components/FlowParts";

/**
 * SETTINGS — who does each step. Admins only.
 *
 * An empty list means anyone with edit access to the app may act on that step, so the
 * module works before anyone is picked. Admins can always act on both.
 */
const STEPS: { key: StepKey; title: string; hint: string }[] = [
  { key: "plant", title: "Step 2 · Plant testing", hint: "Who opens the month's list, writes remarks, attaches the report and submits." },
  { key: "review", title: "Step 3 · Management review", hint: "Who reviews a submitted test and closes it or sends it back." },
];

export default function Settings() {
  const { user, isAdmin } = useSession();
  const qc = useQueryClient();
  const flowQ = useFlow();
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const [draft, setDraft] = useState<Record<StepKey, string[]>>({ plant: [], review: [] });
  const [busy, setBusy] = useState<StepKey | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { if (flowQ.data) setDraft(flowQ.data.owners); }, [flowQ.data]);

  const options = useMemo(() => (people.data ?? [])
    .map((p) => ({ value: p.id, label: p.designation ? `${p.name} — ${p.designation}` : p.name }))
    .sort((a, b) => a.label.localeCompare(b.label)), [people.data]);

  const save = async (step: StepKey) => {
    setBusy(step); setNote(null);
    try {
      await saveOwners(step, draft[step], user.id);
      await qc.invalidateQueries({ queryKey: FLOW_QUERY });
      setNote("Saved.");
    } catch (e) {
      setNote(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-[900px] space-y-5 px-4 py-6">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Settings</h1>
        <p className="text-[13px] text-grey">
          Who does each step. Leave a list empty to let anyone with edit access do it. Admins can always do both.
        </p>
      </div>
      {flowQ.isError && <FlowUnavailable error={flowQ.error} />}
      {!isAdmin && <Card className="p-4 text-[13px] text-grey">Only admins can change these.</Card>}
      {STEPS.map((s) => (
        <Card key={s.key} className="space-y-3 p-4">
          <div>
            <div className="text-[14px] font-semibold text-navy">{s.title}</div>
            <div className="text-[12.5px] text-grey">{s.hint}</div>
          </div>
          <MultiSelect
            values={draft[s.key]}
            onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))}
            options={options}
            placeholder="Anyone with edit access"
            searchable
            chips
            disabled={!isAdmin || flowQ.isError}
          />
          {isAdmin && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => save(s.key)} disabled={busy !== null || flowQ.isError}>
                {busy === s.key ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </Card>
      ))}
      {note && <div className="text-[12.5px] text-grey">{note}</div>}
    </div>
  );
}
