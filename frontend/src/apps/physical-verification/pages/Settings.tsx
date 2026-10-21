import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useSession } from "@/core/platform/session";
import { PV_QUERY, saveRights, usePv, type Rights } from "../lib/pv";
import { PvUnavailable } from "../components/parts";

/**
 * SETTINGS — who does each step. Admins only.
 *
 *   Step 1 · Set dates   the Master (tick items, verification date, verifier)
 *   Step 2 · Count       the physical count — each sees only the items given to them
 *   Step 3 · Review      accept a submitted count or send it back for recount
 *   Step 4 · Tally       adjust accepted differences in Tally; voucher no. + attachment closes them
 *
 * Everyone listed also needs an EDIT grant on Physical Verification in User Access. Admins can do every step.
 */
type Key = keyof Rights;

const STEPS: { key: Key; title: string; hint: string }[] = [
  {
    key: "schedulers",
    title: "Step 1 · Set verification date (Master)",
    hint: "Who ticks items on the Master and gives the verification date and the verifier.",
  },
  {
    key: "verifiers",
    title: "Step 2 · Physical verification (count)",
    hint: "Who counts the stock. Step 1 picks one of them per item; each sees only the items given to them, from that date.",
  },
  {
    key: "reviewers",
    title: "Step 3 · Review",
    hint: "Who checks the submitted counts and accepts them or sends them back for recount. Left empty, the step 1 people review.",
  },
  {
    key: "tallyPeople",
    title: "Step 4 · Post to Tally (Stock Journal)",
    hint: "Who adjusts the accepted differences in Tally, then closes them with the Tally voucher no. and attachment. Left empty, the step 3 people do it.",
  },
];

export default function Settings() {
  const { user, isAdmin } = useSession();
  const qc = useQueryClient();
  const pvQ = usePv();
  const people = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 10 * 60_000 });
  const [draft, setDraft] = useState<Rights>({ schedulers: [], verifiers: [], reviewers: [], tallyPeople: [] });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (pvQ.data) setDraft({ schedulers: pvQ.data.schedulers, verifiers: pvQ.data.verifiers, reviewers: pvQ.data.reviewers, tallyPeople: pvQ.data.tallyPeople });
  }, [pvQ.data]);

  const options = useMemo(() => (people.data ?? [])
    .map((p) => ({ value: p.id, label: p.designation ? `${p.name} — ${p.designation}` : p.name }))
    .sort((a, b) => a.label.localeCompare(b.label)), [people.data]);

  const save = async () => {
    setBusy(true); setNote(null);
    try {
      await saveRights(draft, user.id);
      await qc.invalidateQueries({ queryKey: PV_QUERY });
      setNote("Saved.");
    } catch (e) {
      setNote(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const locked = !isAdmin || pvQ.isError;

  return (
    <div className="mx-auto max-w-[900px] space-y-5 px-4 py-6">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Settings</h1>
        <p className="text-[13px] text-grey">
          Who does each step. Everyone listed also needs <b>Edit</b> access to Physical Verification in User Access.
          Admins can always do every step.
        </p>
      </div>
      {pvQ.isError && <PvUnavailable error={pvQ.error} />}
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
            placeholder={s.key === "schedulers" ? "Admins only" : s.key === "reviewers" ? "Same as step 1" : s.key === "tallyPeople" ? "Same as step 3" : "Pick people"}
            searchable
            chips
            disabled={locked}
          />
        </Card>
      ))}
      {isAdmin && (
        <div className="flex items-center justify-end gap-3">
          {note && <span className="text-[12.5px] text-grey">{note}</span>}
          <Button size="sm" onClick={save} disabled={busy || locked}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </div>
  );
}
