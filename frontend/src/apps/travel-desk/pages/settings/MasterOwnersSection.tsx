import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";
import { TRAVEL_MASTER_TYPES, type TravelMasterType } from "../../types";

/**
 * Who owns each list.
 *
 * ⚠ OWNERSHIP IS PER LIST, NOT PER MODULE, and that is the whole point. The
 *   person who knows which hotels are usable in Coimbatore should be able to
 *   curate that list without being made an administrator of the entire portal.
 *   An owner edits their list and decides requests against it, and nothing else
 *   — proved in the database in 20261005120500, where a hotel owner answers
 *   false for cities.
 *
 * ⚠ AN UNOWNED LIST FALLS TO ADMINS, never to nobody. `fms_travel_is_master_manager`
 *   returns true for an admin regardless, so a list with no named owner is still
 *   editable and its requests are still decidable. A list nobody could maintain
 *   would silently stop growing.
 */
export default function MasterOwnersSection() {
  const s = useTravelStore();
  const { profiles } = useDirectory();
  const [busy, setBusy] = useState<TravelMasterType | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const people = useMemo(
    () =>
      profiles
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.name })),
    [profiles],
  );

  const ownersOf = (type: TravelMasterType) =>
    s.masterManagers.filter((m) => m.masterType === type).map((m) => m.managerUserId);

  const save = async (type: TravelMasterType, ids: string[]) => {
    setBusy(type);
    setErr(null);
    try {
      await s.setMasterOwners(type, ids);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-bold text-navy">Who owns each list</h2>
      <p className="mt-1 max-w-3xl text-[13px] text-grey-2">
        An owner may edit that one list and decide requests against it — and nothing else. A list
        with no owner falls to admins, so it is never left unmaintainable.
      </p>

      <div className="mt-4 space-y-3">
        {TRAVEL_MASTER_TYPES.map((m) => (
          <div key={m.value} className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-start">
            <div>
              <span className="text-[13.5px] font-medium text-navy">{m.plural}</span>
              {m.value === "rate_card" && (
                <p className="text-[12px] text-grey-2">
                  Owning this means editing the policy&rsquo;s figures and signing a card off.
                </p>
              )}
            </div>
            <div>
              <MultiSelect
                options={people}
                values={ownersOf(m.value)}
                onChange={(ids) => void save(m.value, ids)}
                placeholder={busy === m.value ? "Saving…" : "Nobody — admins only"}
              />
            </div>
          </div>
        ))}
      </div>

      {err && <p className="mt-3 text-[12.5px] text-ryg-red">{err}</p>}
    </Card>
  );
}
