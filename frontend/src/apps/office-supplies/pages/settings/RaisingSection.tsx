import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { useSuppliesStore } from "../../store";

/**
 * Raising & Routing (admin). Two settings that together decide who may start a
 * request and where it goes first. Both live in fms_supplies_config.
 *
 *   `requesters`       → who may raise at all. EMPTY MEANS NOBODY BUT ADMINS.
 *   `hod_designations` → whose request skips the HOD and goes to Management.
 *
 * ⚠ Neither list is the gate. fms_supplies_can_raise() and
 *   fms_supplies_is_hod_designation() are, inside the submit RPC — these
 *   controls only decide what the screens bother to show.
 *
 * ⚠ The HOD test reads profiles.designation_id, NOT the legacy free-text
 *   `designation`. Nothing writes that column yet — the Designation picker on
 *   the user form ships with the Organisation masters — so a ticked designation
 *   currently matches nobody, and the second card says so. Until then the skip
 *   still fires for real department HODs, via the self-approval safeguard in
 *   fms_supplies_submit_request.
 */
export default function RaisingSection() {
  const s = useSuppliesStore();

  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );

  // Ladder order, not alphabetical: the picker should read Executive → Director.
  const designationOptions: MultiOption[] = useMemo(
    () =>
      [...s.designations]
        .filter((d) => d.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((d) => ({ value: d.id, label: d.name })),
    [s.designations],
  );

  return (
    <div className="space-y-4 max-w-xl">
      <Setting
        title="Who can raise a request"
        hint="Only these people see “Raise a Request”. Admins can always raise."
        options={peopleOptions}
        initial={s.requesterIds}
        placeholder="Select the people who may raise requests"
        save={s.setRequesters}
        warning={
          s.requesterIds.length === 0
            ? "Nobody is selected, so nobody but an admin can raise a request right now."
            : null
        }
      />

      <Setting
        title="HOD designations"
        hint="A request raised by someone holding one of these designations skips the HOD approval and goes straight to Management. Everyone else goes to their own department’s HOD first."
        options={designationOptions}
        initial={s.hodDesignationIds}
        placeholder="Select the designations that count as HOD"
        save={s.setHodDesignations}
        warning="Nobody has a designation assigned yet, so this list matches no one for now — those requests go to the department HOD as before. A request raised by the head of their own department still skips the approval either way."
      />
    </div>
  );
}

/** One list-of-ids setting: pick, save, confirm. Both cards are the same shape. */
function Setting({
  title,
  hint,
  options,
  initial,
  placeholder,
  save,
  warning,
}: {
  title: string;
  hint: string;
  options: MultiOption[];
  initial: string[];
  placeholder: string;
  save: (ids: string[]) => Promise<void>;
  warning: string | null;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await save(picked);
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-3">
      <div>
        <p className="text-[13px] font-medium text-navy">{title}</p>
        <p className="text-[12.5px] text-grey mt-0.5">{hint}</p>
      </div>
      <MultiSelect
        values={picked}
        onChange={(v) => {
          setPicked(v);
          setSaved(false);
        }}
        options={options}
        placeholder={placeholder}
      />
      {warning && <p className="text-[12.5px] text-ryg-red">{warning}</p>}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={run} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {saved && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
