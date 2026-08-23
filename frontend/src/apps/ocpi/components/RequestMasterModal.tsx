import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../store";
import { requestMaster } from "../data/ocpiMasterWrites";
import {
  emptyValuesFor, findExisting, masterFields, masterTypeLabel, missingRequired,
  payloadFromValues, type MasterValues,
} from "../lib/masterFields";
import { OCPI_MASTER_TYPES, type OcpiMasterType } from "../types";

/**
 * "This is missing from the list" — the one raise surface for every OCPI master.
 *
 * ⚠ IT SAYS WHO IT IS GOING TO, before you send it. A request that disappears
 *   into an unnamed queue is a request nobody chases. When a master has no owner
 *   assigned, it says "an admin" — which is true, and is also a nudge to assign
 *   one in Settings.
 *
 * ⚠ THE CLASH CHECK RUNS AS YOU TYPE. The database refuses a second pending
 *   request for the same name, and most of the time the requester simply did not
 *   scroll the dropdown — so the modal answers "that is already in the list"
 *   rather than letting them send it and read a constraint error.
 */
export default function RequestMasterModal({
  open,
  onClose,
  masterType,
  lockType = false,
  prefillName,
  stacked = false,
  onRequested,
}: {
  open: boolean;
  onClose: () => void;
  masterType: OcpiMasterType | null;
  /** True when raised from a form field that already knows which master it wants. */
  lockType?: boolean;
  prefillName?: string;
  stacked?: boolean;
  onRequested?: (masterType: OcpiMasterType, name: string) => void;
}) {
  const s = useOcpiStore();
  const [mt, setMt] = useState<OcpiMasterType | null>(masterType);
  const [values, setValues] = useState<MasterValues>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMt(masterType);
    setValues({
      ...(masterType ? emptyValuesFor(masterType) : {}),
      ...(prefillName ? { name: prefillName } : {}),
    });
    setErr(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, masterType, prefillName]);

  const typeOptions: ComboOption[] = OCPI_MASTER_TYPES.map((m) => ({
    value: m.value,
    label: m.label,
  }));

  const rowsFor = (t: OcpiMasterType) =>
    t === "machine"
      ? s.machines
      : t === "head_type"
        ? s.headTypes
        : t === "ink_type"
          ? s.inkTypes
          : s.dryerTypes;

  const clash = useMemo(
    () => (mt ? findExisting(rowsFor(mt), values.name ?? "") : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mt, values.name, s.machines, s.headTypes, s.inkTypes, s.dryerTypes],
  );

  const owners = mt
    ? s.masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId)
    : [];

  const missing = mt ? missingRequired(mt, values) : ["a master"];

  async function send() {
    if (!mt) return;
    setBusy(true);
    setErr(null);
    try {
      const payload = payloadFromValues(mt, values);
      await requestMaster(mt, payload);
      await s.refresh();
      onRequested?.(mt, payload.name);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title="Ask for a new entry"
      subtitle="It goes to whoever owns that list. You will be told when it is decided."
      stacked={stacked}
    >
      <div className="space-y-3">
        {!lockType && (
          <FieldLabel label="What is missing" required>
            <Combobox
              value={mt ?? ""}
              onChange={(v) => {
                const next = v as OcpiMasterType;
                setMt(next || null);
                setValues((p) => ({ ...emptyValuesFor(next), name: p.name ?? "" }));
                setErr(null);
              }}
              options={typeOptions}
              placeholder="Choose a list"
              disabled={busy}
            />
          </FieldLabel>
        )}

        {mt &&
          masterFields(mt).map((f) => (
            <FieldLabel key={f.key} label={f.label} hint={f.hint} required={f.required}>
              <TextInput
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                disabled={busy}
              />
            </FieldLabel>
          ))}

        {clash && (
          <p className="rounded-xl border border-line bg-page/60 p-3 text-[12.5px] text-grey">
            <b className="text-navy">&ldquo;{clash.name}&rdquo; is already on the list</b>
            {clash.active ? " — try the dropdown again." : " but is switched off. Ask an owner to switch it back on rather than adding a duplicate."}
          </p>
        )}

        {mt && (
          <p className="text-[12.5px] text-grey-2">
            This goes to{" "}
            {owners.length > 0
              ? `${owners.length} ${owners.length === 1 ? "owner" : "owners"} of ${masterTypeLabel(mt).toLowerCase()}`
              : "an admin — nobody owns this list yet"}
            .
            {mt === "machine" && (
              <>
                {" "}
                A new machine can carry a quotation straight away; its order-confirmation
                template has to be built before a contract can be printed.
              </>
            )}
          </p>
        )}

        {err && <p className="text-[13px] text-ryg-red">{err}</p>}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void send()} disabled={busy || !mt || missing.length > 0 || !!clash}>
            {busy ? "Sending…" : "Send the request"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
