import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { useTravelStore } from "../store";
import {
  masterFields, emptyValuesFor, missingRequired, payloadFromValues,
} from "../lib/masterFields";
import { TRAVEL_MASTER_TYPES, type TravelRequestableMaster } from "../types";

/**
 * Ask for a value that is not on a list yet.
 *
 * ⚠ A CITY REQUEST BLOCKS THE TRIP THAT NEEDS IT, and the modal says so. OCPI
 *   lets three of its four masters through free-text-plus-a-request, because
 *   those values are stored as TEXT on the deal and a salesperson mid-negotiation
 *   should not wait for a vocabulary entry. A city cannot work that way: it
 *   carries a TIER, and the tier is what prices the hotel cap, the daily
 *   allowance and the conveyance cap. A free-text city is an unpriceable trip.
 *
 * It names WHO the request goes to, so nobody is left wondering whether it fell
 * into a void.
 */
export default function RequestMasterModal({
  open,
  onClose,
  type,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  type: TravelRequestableMaster;
  initialName?: string;
}) {
  const s = useTravelStore();
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...emptyValuesFor(type),
    name: initialName ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cityOptions = useMemo(
    () => s.cities.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })),
    [s.cities],
  );

  const fields = useMemo(() => masterFields(type, { cityOptions }), [type, cityOptions]);
  const label = TRAVEL_MASTER_TYPES.find((m) => m.value === type)?.label ?? "value";

  /** Who will see this. An unowned list falls to the admins. */
  const owners = s.masterManagers.filter((m) => m.masterType === type);
  const goesTo = owners.length
    ? `${owners.length} person${owners.length === 1 ? "" : "s"} who own${owners.length === 1 ? "s" : ""} the ${label.toLowerCase()} list`
    : "an admin — nobody owns this list yet";

  const submit = async () => {
    const missing = missingRequired(type, values);
    if (missing) { setErr(missing); return; }
    setBusy(true);
    setErr(null);
    try {
      await s.requestMaster(type, payloadFromValues(type, values));
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Ask for a ${label.toLowerCase()}`}>
      <div className="space-y-3">
        <p className="text-[13px] text-grey-2">
          It goes to <strong className="text-navy">{goesTo}</strong>, who can correct it before
          approving.
          {type === "city" && (
            <>
              {" "}
              <strong className="text-navy">A trip to this city cannot be raised until it is
              approved</strong> — the tier is what decides its hotel cap and daily allowance.
            </>
          )}
        </p>

        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="text-[13px] font-medium text-navy">
              {f.label}
              {f.required && <span className="text-ryg-red"> *</span>}
            </span>

            {f.type === "select" && f.options ? (
              <div className="mt-1">
                <Combobox
                  options={f.options}
                  value={values[f.key] ?? ""}
                  onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                  placeholder={f.placeholder ?? "Choose…"}
                />
              </div>
            ) : f.type === "textarea" ? (
              <textarea
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[13.5px]"
              />
            ) : (
              <input
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[13.5px]"
                placeholder={f.placeholder}
              />
            )}

            {f.hint && <span className="mt-1 block text-[12px] text-grey-2">{f.hint}</span>}
          </label>
        ))}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Sending…" : "Send request"}</Button>
        </div>
      </div>
    </Modal>
  );
}
