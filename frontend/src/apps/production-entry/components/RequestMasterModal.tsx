import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { formatDate } from "@/shared/lib/time";
import { useProductionStore } from "../store";
import { PRODUCTION_MASTER_TYPES, type ProductionMasterType } from "../types";
import {
  findExistingMaster,
  masterTypeLabel,
  masterTypePlural,
  missingRequired,
  payloadFromValues,
  type MasterValues,
} from "../lib/masterFields";

/**
 * "Request a new master entry" — one raise surface for every Production master.
 * The request routes to that master's owners (or the admins when none), who can
 * edit before adding it. All four masters are simple name lists.
 */
export default function RequestMasterModal({
  open,
  onClose,
  masterType = null,
  onRequested,
}: {
  open: boolean;
  onClose: () => void;
  masterType?: ProductionMasterType | null;
  onRequested?: (id: string) => void;
}) {
  const s = useProductionStore();
  const [mt, setMt] = useState<ProductionMasterType | null>(masterType);
  const [values, setValues] = useState<MasterValues>({ name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMt(masterType);
    setValues({ name: "" });
    setErr(null);
    setBusy(false);
  }, [open, masterType]);

  const typeOptions: ComboOption[] = PRODUCTION_MASTER_TYPES.map((m) => ({ value: m.value, label: m.label }));

  const clash = useMemo(() => {
    if (!mt || !values.name?.trim()) return null;
    const existing = findExistingMaster(values, s.masterList(mt));
    if (existing) {
      return existing.active
        ? `“${existing.name}” is already in ${masterTypePlural(mt)} — pick it from the list.`
        : `“${existing.name}” exists in ${masterTypePlural(mt)} but is deactivated. Ask a master owner to reactivate it.`;
    }
    const dup = s.masterRequests.find(
      (r) => r.status === "pending" && r.masterType === mt &&
        String(r.proposedPayload.name ?? "").trim().toLowerCase() === values.name.trim().toLowerCase(),
    );
    if (dup) {
      const who = s.profileById(dup.requestedBy ?? "")?.name ?? "someone";
      return `Already requested by ${who} on ${formatDate(dup.createdAt)} — it's awaiting review.`;
    }
    return null;
  }, [mt, values, s]);

  const reviewers = mt ? s.masterReviewersFor(mt).map((id) => s.profileById(id)?.name ?? "Unknown") : [];

  const submit = async () => {
    if (!mt) { setErr("Pick what you want to add."); return; }
    const missing = missingRequired(mt, values);
    if (missing) { setErr(missing); return; }
    if (clash) { setErr(clash); return; }
    setBusy(true);
    setErr(null);
    try {
      const id = await s.requestNewMaster(mt, payloadFromValues(mt, values));
      onRequested?.(id);
      onClose();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setErr(/duplicate key|23505/i.test(msg) ? "Someone has already requested this — it's awaiting review." : msg || "Couldn't raise the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a new master entry"
      subtitle="It goes to the master's owner for review — they can adjust it before adding."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={busy || !!clash}>{busy ? "Sending…" : "Send request"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="What do you want to add?" required>
          <Combobox
            value={mt ?? ""}
            onChange={(v) => { setMt(v as ProductionMasterType); setErr(null); }}
            options={typeOptions}
            placeholder="Select master"
            autoAdvance
          />
        </FieldLabel>
        <FieldLabel label="Name" required>
          <TextInput value={values.name} onChange={(e) => setValues({ name: e.target.value })} placeholder="Name of the new entry" />
        </FieldLabel>

        {mt && !clash && (
          <p className="text-[12px] text-grey">
            {s.isMasterUnassigned(mt) || reviewers.length === 0 ? (
              <>Goes to the admins for review — no owner is assigned to {masterTypePlural(mt)} yet.</>
            ) : (
              <>Goes to <span className="font-semibold text-navy">{reviewers.join(", ")}</span> for review.</>
            )}
          </p>
        )}
        {clash && <p className="text-[12.5px] text-ryg-red">{clash}</p>}
        {err && err !== clash && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
