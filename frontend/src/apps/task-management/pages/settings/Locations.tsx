import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import { useTaskStore } from "../../mock/store";
import { locationLabel, type Location } from "../../types";
import type { LocationWriteInput } from "../../data/taskWrites";

/**
 * Admin: manage the location master list (company + place, plus a General entry).
 * Tasks and recurring templates pick from the active entries here.
 */
export default function Locations() {
  const { locations, addLocation, editLocation, removeLocation, canManageLocations } = useTaskStore();
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [error, setError] = useState("");

  const sorted = [...locations].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const onDelete = async (loc: Location) => {
    setError("");
    try {
      await removeLocation(loc.id);
    } catch (e) {
      // FK restrict → still referenced by a task/template. Suggest deactivating instead.
      setError(
        `Couldn't delete "${locationLabel(loc)}" — it's still used by a task or recurring template. Set it inactive instead.`
      );
    }
  };

  const toggleActive = async (loc: Location) => {
    setError("");
    try {
      await editLocation(loc.id, {
        company: loc.company,
        name: loc.name,
        isGeneral: loc.isGeneral,
        active: !loc.active,
        sortOrder: loc.sortOrder,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-grey">
          Locations tag tasks with a site (company + place). A task with locations can't be completed until every one is ticked off.
        </p>
        {canManageLocations && (
          <Button size="sm" onClick={() => { setError(""); setEditing("new"); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add location
          </Button>
        )}
      </div>

      {error && <p className="text-[12.5px] text-[#d4493f]">{error}</p>}
      {!canManageLocations && <p className="text-[12.5px] text-grey-2">Only admins can manage locations.</p>}

      {sorted.length === 0 ? (
        <EmptyState title="No locations yet" message="Add your first location to start tagging tasks." />
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {sorted.map((loc) => (
              <li key={loc.id} className="flex items-center gap-3 px-4 py-3 border-b border-line/70 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[13.5px] font-medium", loc.active ? "text-navy" : "text-grey-2 line-through")}>
                      {locationLabel(loc)}
                    </span>
                    {loc.isGeneral && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-orange bg-orange-soft/60 px-1.5 py-0.5 rounded">General</span>}
                    {!loc.active && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-grey-2 bg-page px-1.5 py-0.5 rounded">Inactive</span>}
                  </div>
                </div>
                {canManageLocations && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => toggleActive(loc)} className="text-[12px] font-medium text-grey hover:text-orange px-2 py-1 rounded-lg hover:bg-page transition">
                      {loc.active ? "Deactivate" : "Activate"}
                    </button>
                    <button onClick={() => { setError(""); setEditing(loc); }} className="text-[12px] font-medium text-grey hover:text-orange px-2 py-1 rounded-lg hover:bg-page transition">
                      Edit
                    </button>
                    <button onClick={() => onDelete(loc)} className="text-[12px] font-medium text-grey hover:text-[#d4493f] px-2 py-1 rounded-lg hover:bg-page transition">
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <LocationFormModal
          existing={editing === "new" ? null : editing}
          nextSortOrder={sorted.length}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await addLocation(input);
            else await editLocation(editing.id, input);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** Add/edit form for a single location. */
function LocationFormModal({
  existing,
  nextSortOrder,
  onClose,
  onSave,
}: {
  existing: Location | null;
  nextSortOrder: number;
  onClose: () => void;
  onSave: (input: LocationWriteInput) => Promise<void>;
}) {
  const [company, setCompany] = useState(existing?.company ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [isGeneral, setIsGeneral] = useState(existing?.isGeneral ?? false);
  const [active, setActive] = useState(existing?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!isGeneral && !company.trim()) return setError("Enter a company (or mark this as General).");
    if (!name.trim()) return setError("Enter a location name.");
    setBusy(true);
    setError("");
    try {
      await onSave({
        company: isGeneral ? null : company.trim(),
        name: name.trim(),
        isGeneral,
        active,
        sortOrder: existing?.sortOrder ?? nextSortOrder,
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? "Edit location" : "Add location"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Add"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button
            type="button"
            onClick={() => setIsGeneral((g) => !g)}
            className={cn("relative w-10 h-[22px] rounded-full transition shrink-0", isGeneral ? "bg-orange" : "bg-line")}
          >
            <span className={cn("absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all", isGeneral ? "left-[20px]" : "left-0.5")} />
          </button>
          <span className="text-[13px] text-navy font-medium">General (not tied to a company)</span>
        </label>

        {!isGeneral && (
          <FieldLabel label="Company" required>
            <TextInput value={company} onChange={(e) => { setCompany(e.target.value); setError(""); }} placeholder="e.g. Otec" autoFocus />
          </FieldLabel>
        )}

        <FieldLabel label={isGeneral ? "Label" : "Location"} required>
          <TextInput value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder={isGeneral ? "e.g. General" : "e.g. Surat"} />
        </FieldLabel>

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button
            type="button"
            onClick={() => setActive((a) => !a)}
            className={cn("relative w-10 h-[22px] rounded-full transition shrink-0", active ? "bg-[#27AE60]" : "bg-line")}
          >
            <span className={cn("absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all", active ? "left-[20px]" : "left-0.5")} />
          </button>
          <span className="text-[13px] text-navy font-medium">{active ? "Active" : "Inactive"}</span>
        </label>

        {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}
      </div>
    </Modal>
  );
}
