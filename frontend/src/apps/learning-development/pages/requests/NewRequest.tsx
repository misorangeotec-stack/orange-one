import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { B } from "../../nav";

/**
 * Raise a training need — §11 step 1.
 *
 * ⚠ THE THREE FIELDS MARKED REQUIRED ARE REQUIRED ONLY TO **SUBMIT**, not to
 *   save. §4 of the source document: "Request cannot submit without objective,
 *   target group and required-by date." A draft may be as empty as its author
 *   likes, which is what makes a half-remembered need worth writing down at all.
 *   The RPC enforces the same split, so this is guidance, not the gate.
 */
export default function NewRequest() {
  const s = useLdStore();
  const nav = useNavigate();

  const [title, setTitle] = useState("");
  const [needSourceId, setNeedSourceId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [skillGap, setSkillGap] = useState("");
  const [objective, setObjective] = useState("");
  const [targetGroup, setTargetGroup] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needSources = (s.data?.needSources ?? []).filter((n) => n.active);

  const save = async (submit: boolean) => {
    setErr(null);
    if (!title.trim()) {
      setErr("A title is required.");
      return;
    }
    if (submit && (!objective.trim() || !targetGroup.trim() || !requiredBy)) {
      setErr("Objective, who it is for, and the required-by date are all needed before submitting.");
      return;
    }
    setBusy(true);
    try {
      const id = await s.writes.createRequest({
        title: title.trim(),
        needSourceId: needSourceId || null,
        departmentId: departmentId || null,
        skillGap: skillGap.trim() || null,
        objective: objective.trim() || null,
        targetGroup: targetGroup.trim() || null,
        requiredBy: requiredBy || null,
        submit,
      });
      await s.refresh();
      nav(`${B}/requests/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Raise a training need</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Say what the gap is and who it affects. HR validates it, works out the cost and puts it up for
          approval — you'll be told at each step.
        </p>
      </div>

      <Card className="p-6 space-y-5 max-w-3xl">
        <FieldLabel label="What training is needed?" required>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Advanced Tally for the accounts team"
          />
        </FieldLabel>

        <div className="grid gap-5 sm:grid-cols-2">
          <FieldLabel label="Where did this come from?">
            <Combobox
              value={needSourceId}
              onChange={setNeedSourceId}
              clearable
              options={needSources.map((n) => ({ value: n.id, label: n.name }))}
              placeholder="Select a source"
            />
          </FieldLabel>
          <FieldLabel label="Department">
            <Combobox
              value={departmentId}
              onChange={setDepartmentId}
              clearable
              options={s.orgDepartments.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="Select a department"
            />
          </FieldLabel>
        </div>

        <FieldLabel label="What is the gap?" hint="What people cannot do today, in plain words.">
          <TextArea
            rows={3}
            value={skillGap}
            onChange={(e) => setSkillGap(e.target.value)}
            placeholder="e.g. Month-end close takes six days because only one person can run the reports"
          />
        </FieldLabel>

        <FieldLabel label="What should be different afterwards?" required>
          <TextArea
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="e.g. Any of the four can close the month, inside three days"
          />
        </FieldLabel>

        <div className="grid gap-5 sm:grid-cols-2">
          <FieldLabel label="Who is it for?" required hint="Roles or a team — the names come later, at nomination.">
            <TextInput
              value={targetGroup}
              onChange={(e) => setTargetGroup(e.target.value)}
              placeholder="e.g. Accounts executives"
            />
          </FieldLabel>
          <FieldLabel label="Needed by" required>
            <TextInput type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />
          </FieldLabel>
        </div>

        {err && (
          <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={() => void save(true)} disabled={busy}>
            {busy ? "Submitting…" : "Submit to HR"}
          </Button>
          <Button variant="ghost" onClick={() => void save(false)} disabled={busy}>
            Save as draft
          </Button>
          <Button variant="ghost" onClick={() => nav(`${B}/my-requests`)} disabled={busy}>
            Cancel
          </Button>
        </div>
        <p className="text-[12px] text-grey-2">
          A draft keeps no Training Request ID and nobody is told about it until you submit.
        </p>
      </Card>
    </div>
  );
}
