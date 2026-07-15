import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { formatDate } from "@/shared/lib/time";
import { useSuppliesStore } from "../store";
import { REQUESTABLE_SUPPLY_MASTER_TYPES, type SupplyMasterType } from "../types";
import {
  emptyValuesFor,
  findExistingMaster,
  masterFields,
  masterTypeLabel,
  masterTypePlural,
  missingRequired,
  payloadFromValues,
  type MasterFieldContext,
  type MasterValues,
} from "../lib/masterFields";

/**
 * "Request a new master entry" — the single raise surface for every REQUESTABLE Office
 * Supplies master (item, service type). The request routes to that master's owners, or
 * to the admins when none are assigned, and the modal says who before you send it.
 */
export default function RequestMasterModal({
  open,
  onClose,
  masterType,
  lockType = false,
  prefill,
  stacked = false,
  onRequested,
}: {
  open: boolean;
  onClose: () => void;
  masterType: SupplyMasterType | null;
  lockType?: boolean;
  prefill?: MasterValues;
  stacked?: boolean;
  onRequested?: (id: string, masterType: SupplyMasterType, name: string) => void;
}) {
  const s = useSuppliesStore();
  const ctx: MasterFieldContext = useMemo(() => ({ categories: s.categories }), [s.categories]);
  const [mt, setMt] = useState<SupplyMasterType | null>(masterType);
  const [values, setValues] = useState<MasterValues>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMt(masterType);
    setValues({ ...(masterType ? emptyValuesFor(masterType, ctx) : {}), ...(prefill ?? {}) });
    setErr(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const typeOptions: ComboOption[] = REQUESTABLE_SUPPLY_MASTER_TYPES.map((m) => ({ value: m.value, label: m.label }));

  const pickType = (v: string) => {
    const next = v as SupplyMasterType;
    setMt(next);
    setValues((p) => ({ ...emptyValuesFor(next, ctx), name: p.name ?? "" }));
    setErr(null);
  };

  const fields = mt ? masterFields(mt, ctx) : [];

  const clash = useMemo(() => {
    if (!mt || !values.name?.trim()) return null;
    const existing = findExistingMaster(mt, values, { items: s.items, serviceTypes: s.serviceTypes });
    if (existing) {
      return existing.active
        ? `"${existing.name}" is already in ${masterTypePlural(mt)} — pick it from the list.`
        : `"${existing.name}" exists in ${masterTypePlural(mt)} but is deactivated. Ask its owner to reactivate it.`;
    }
    const proposed = String(payloadFromValues(mt, values, ctx).name ?? "").trim().toLowerCase();
    const dup = s.masterRequests.find((r) => {
      if (r.status !== "pending" || r.masterType !== mt) return false;
      const p = r.proposedPayload as Record<string, unknown>;
      const sameParent = mt !== "item" || String(p.category_id ?? "") === String(values.category_id ?? "");
      return sameParent && String(p.name ?? "").trim().toLowerCase() === proposed;
    });
    if (dup) {
      const who = dup.requestedBy ? (s.profileById(dup.requestedBy)?.name ?? "someone") : "someone";
      return `Already requested by ${who} on ${formatDate(dup.createdAt)} — it's awaiting review.`;
    }
    return null;
  }, [mt, values, ctx, s]);

  const reviewers = mt ? s.masterReviewersFor(mt).map((id) => s.profileById(id)?.name ?? "Unknown") : [];

  const submit = async () => {
    if (!mt) {
      setErr("Pick what you want to add.");
      return;
    }
    const missing = missingRequired(mt, values, ctx);
    if (missing) {
      setErr(missing);
      return;
    }
    if (clash) {
      setErr(clash);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload = payloadFromValues(mt, values, ctx);
      const id = await s.requestNewMaster(mt, payload);
      onRequested?.(id, mt, String(payload.name ?? ""));
      onClose();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setErr(
        /duplicate key|23505/i.test(msg)
          ? "Someone has already requested this — it's awaiting review."
          : msg || "Couldn't raise the request.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      stacked={stacked}
      title={mt && lockType ? `Request new ${masterTypeLabel(mt).toLowerCase()}` : "Request a new master entry"}
      subtitle="It goes to the master's owner for review — they can adjust the details before adding it."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !!clash}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {!lockType && (
          <FieldLabel label="What do you want to add?" required>
            <Combobox value={mt ?? ""} onChange={pickType} options={typeOptions} placeholder="Select master" autoAdvance />
          </FieldLabel>
        )}

        {fields.map((f) => (
          <FieldLabel key={f.key} label={f.label} required={f.required}>
            {f.type === "select" ? (
              <Combobox
                value={values[f.key] ?? ""}
                onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                options={f.options ?? []}
                placeholder={f.placeholder ?? "Select…"}
                autoAdvance
              />
            ) : (
              <TextInput
                value={values[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            )}
            {f.hint && <span className="mt-1 block text-[11px] leading-snug text-grey">{f.hint}</span>}
          </FieldLabel>
        ))}

        {mt && !clash && (
          <p className="text-[12px] text-grey">
            {s.isMasterUnassigned(mt) || reviewers.length === 0 ? (
              <>Goes to the admins for review — no owner is assigned to {masterTypePlural(mt)} yet.</>
            ) : (
              <>
                Goes to <span className="font-semibold text-navy">{reviewers.join(", ")}</span> for review.
              </>
            )}
          </p>
        )}
        {clash && <p className="text-[12.5px] text-ryg-red">{clash}</p>}
        {err && err !== clash && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
