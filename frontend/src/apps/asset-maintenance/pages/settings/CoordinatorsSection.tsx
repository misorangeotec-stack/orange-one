import { useEffect, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useAssetStore } from "../../store";

/**
 * Process coordinators — the people who can action ANY step, see the Control
 * Center, and hold / skip / cancel a job or retire an asset. Admins are always
 * included implicitly (fms_asset_is_coordinator checks is_admin first).
 */
export default function CoordinatorsSection() {
  const s = useAssetStore();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setPicked(s.processCoordinatorIds); }, [s.processCoordinatorIds]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await s.setConfig("process_coordinators", { user_ids: picked });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally { setBusy(false); }
  };

  return (
    <Card className="max-w-2xl p-5">
      <div className="space-y-4">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Process coordinators</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-grey-2">
            Can action any step, open the Control Center, put a job on hold, skip a service, and
            retire an asset. Admins already have all of this.
          </p>
        </div>

        <FieldLabel label="People">
          <MultiSelect
            values={picked}
            onChange={(next) => { setPicked(next); setSaved(false); }}
            options={s.people.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Select people…"
            searchable
            disabled={!s.isAdmin}
          />
        </FieldLabel>

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={!s.isAdmin || busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
          {saved && <span className="text-[12.5px] font-medium text-ryg-green">Saved</span>}
          {error && <span className="text-[12.5px] text-ryg-red">{error}</span>}
        </div>
      </div>
    </Card>
  );
}
