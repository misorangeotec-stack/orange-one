import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";
import { useMasterFieldCtx } from "../lib/useMasterFieldCtx";
import {
  emptyValuesFor, findExistingMaster, masterFields, masterTypeLabel, missingRequired,
  payloadFromValues, type MasterValues,
} from "../lib/masterFields";
import { REQUESTABLE_DISPATCH_MASTER_TYPES, type DispatchMasterType } from "../types";
import { dmy } from "../lib/format";

/**
 * "The entry I need isn't in the list" — raise it for the master's owner to
 * approve, instead of typing free text or getting stuck.
 *
 * Two pre-flight checks before anything is sent, because both failures are common
 * and both are better answered here than by a database error:
 *   · already in the master (including INACTIVE rows — hidden from dropdowns but
 *     still blocked by the unique index, so "ask an owner to reactivate it" is the
 *     honest answer);
 *   · already requested by someone and still pending.
 */
export default function RequestMasterModal({
  open,
  onClose,
  masterType,
  prefillName,
  stacked,
}: {
  open: boolean;
  onClose: () => void;
  /** Fix the type (raised from a specific dropdown), or let the user choose. */
  masterType?: DispatchMasterType;
  prefillName?: string;
  /** Raised from inside another modal — see Modal's z-index note. */
  stacked?: boolean;
}) {
  const s = useDispatchStore();
  const ctx = useMasterFieldCtx();
  const [mt, setMt] = useState<DispatchMasterType>(masterType ?? REQUESTABLE_DISPATCH_MASTER_TYPES[0].value);
  const [values, setValues] = useState<MasterValues>(() => emptyValuesFor(mt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = masterType ?? mt;
    setMt(next);
    setValues({ ...emptyValuesFor(next), name: prefillName ?? "" });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, masterType, prefillName]);

  const fields = useMemo(() => masterFields(mt, ctx).filter((f) => f.key !== "sortOrder"), [mt, ctx]);

  const existing = findExistingMaster(s.masterList(mt), values.name ?? "");
  const pending = s.masterRequests.find(
    (r) =>
      r.status === "pending" &&
      r.masterType === mt &&
      String(r.proposedPayload.name ?? "").trim().toLowerCase() === (values.name ?? "").trim().toLowerCase(),
  );

  const reviewers = s.masterReviewersFor(mt).map((id) => s.personName(id)).filter((n) => n !== "—");

  const submit = async () => {
    const miss = missingRequired(mt, values, ctx);
    if (miss) { setError(miss); return; }
    if (existing) { setError(`“${existing.name}” is already in the list.`); return; }
    if (pending) { setError("That entry has already been requested and is awaiting review."); return; }
    setBusy(true);
    setError(null);
    try {
      await s.requestNewMaster(mt, payloadFromValues(mt, values));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Request a new ${masterTypeLabel(mt).toLowerCase()}`}
      subtitle={reviewers.length ? `Goes to ${reviewers.join(", ")} for approval` : "Goes to an admin for approval"}
      stacked={stacked}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !!existing || !!pending}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!masterType && (
          <FieldLabel label="What do you need?">
            <Combobox
              value={mt}
              onChange={(v) => {
                const next = v as DispatchMasterType;
                setMt(next);
                setValues({ ...emptyValuesFor(next), name: values.name ?? "" });
              }}
              options={REQUESTABLE_DISPATCH_MASTER_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </FieldLabel>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <FieldLabel key={f.key} label={f.label} required={f.required} hint={f.hint}>
              {f.type === "select" ? (
                <Combobox
                  value={values[f.key] ?? ""}
                  onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                  options={f.options ?? []}
                  placeholder={f.placeholder ?? "Select…"}
                  searchable={(f.options?.length ?? 0) > 6}
                />
              ) : f.type === "textarea" ? (
                <TextArea
                  value={values[f.key] ?? ""}
                  rows={2}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              ) : (
                <TextInput
                  value={values[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              )}
            </FieldLabel>
          ))}
        </div>

        {existing && (
          <p className="text-[13px] text-yellow">
            “{existing.name}” is already in the list
            {existing.active ? "." : " but is deactivated — ask an owner to reactivate it."}
          </p>
        )}
        {!existing && pending && (
          <p className="text-[13px] text-yellow">
            Already requested by {s.personName(pending.requestedBy)} on {dmy(pending.createdAt)} — still awaiting review.
          </p>
        )}
        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}
