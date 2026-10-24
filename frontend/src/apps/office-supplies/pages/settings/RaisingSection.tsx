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
 * ⚠ THE HOD TEST READS `profiles.designation_id`, and it is LIVE. 66 of 70 profiles
 *   carry a designation (checked 28-09-2026), and it is what routes nearly every
 *   request in the module today: a requester holding one of the ticked designations
 *   skips the HOD entirely. The card below used to print an unconditional red line
 *   saying the list "matches no one for now", which was true when the Designation
 *   picker had not shipped and has been false ever since — it told an admin that the
 *   setting doing all the routing was inert. It is now derived, and only appears when
 *   it is actually true.
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

  /**
   * Does ANYBODY carry a designation? Asked of the directory rather than assumed.
   * Setup is admin-only and an admin's directory is the whole company, so this is
   * the same question the SQL asks.
   */
  const nobodyHasADesignation = !s.isLoading && !s.profiles.some((p) => p.designationId);

  return (
    <div className="space-y-4 max-w-xl">
      <Setting
        title="Who can raise a request"
        hint="Only these people see “Raise a Request”. Admins can always raise."
        options={peopleOptions}
        saved={s.requesterIds}
        loading={s.isLoading}
        placeholder="Select the people who may raise requests"
        save={s.setRequesters}
        warning={
          !s.isLoading && s.requesterIds.length === 0
            ? "Nobody is selected, so nobody but an admin can raise a request right now."
            : null
        }
      />

      <Setting
        title="HOD designations"
        hint="A request raised by someone holding one of these designations skips the HOD approval and goes straight to Management. Everyone else goes to their own department’s HOD first."
        options={designationOptions}
        saved={s.hodDesignationIds}
        loading={s.isLoading}
        placeholder="Select the designations that count as HOD"
        save={s.setHodDesignations}
        warning={
          nobodyHasADesignation
            ? "No profile carries a designation yet, so this list matches nobody — those requests go to the department HOD as before. A request raised by the head of their own department still skips the approval either way."
            : null
        }
      />
    </div>
  );
}

/**
 * One list-of-ids setting: pick, save, confirm.
 *
 * ⚠ THE PICKER FOLLOWS THE STORE UNTIL THE FIRST EDIT, and Save is dead until it is
 *   both loaded and changed. `useState(saved)` reads its argument ONCE, and the store
 *   loads asynchronously — so this tab, which is the DEFAULT tab and therefore mounts
 *   before any fetch can land, showed two EMPTY pickers over 15 saved requesters and 8
 *   saved designations, with Save enabled. Pressing it wrote `[]` to both: nobody but
 *   an admin could raise a request, and every request started routing to a department
 *   HOD instead of Management. Verified on the production build, 28-09-2026.
 *
 *   `edited === null` means "still following the store"; a successful save drops back
 *   behind it. Same fix as `ReassignPoolSection`, which is the card directly below this
 *   one on the same tab and already had it.
 */
function Setting({
  title,
  hint,
  options,
  saved,
  loading,
  placeholder,
  save,
  warning,
}: {
  title: string;
  hint: string;
  options: MultiOption[];
  saved: string[];
  loading: boolean;
  placeholder: string;
  save: (ids: string[]) => Promise<void>;
  warning: string | null;
}) {
  const [edited, setEdited] = useState<string[] | null>(null);
  const picked = edited ?? saved;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const key = (a: string[]) => [...a].sort().join(",");
  const dirty = edited !== null && key(edited) !== key(saved);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setSavedOk(false);
    try {
      await save(picked);
      // Fall back in behind the store, so the next render reads what was written.
      setEdited(null);
      setSavedOk(true);
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
          setEdited(v);
          setSavedOk(false);
        }}
        options={options}
        placeholder={loading ? "Loading…" : placeholder}
        disabled={loading}
      />
      {warning && <p className="text-[12.5px] text-ryg-red">{warning}</p>}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={run} disabled={busy || loading || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {savedOk && !dirty && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
