import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";
import { useMasterFieldCtx } from "../lib/useMasterFieldCtx";
import {
  describePayload, emptyValuesFor, findExistingMaster, isNameless, masterFields, masterTypeLabel,
  missingRequired, payloadFromValues, type MasterValues,
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
  prefill,
  stacked,
  onRequested,
}: {
  open: boolean;
  onClose: () => void;
  /** Fix the type (raised from a specific dropdown), or let the user choose. */
  masterType?: DispatchMasterType;
  /**
   * Whatever the form raising this already knows — the name just typed into a
   * picker, and for a mapping the customer it was typed against. Everything the
   * requester would otherwise re-enter to say what they already said.
   */
  prefill?: MasterValues;
  /** Raised from inside another modal — see Modal's z-index note. */
  stacked?: boolean;
  /** Fired after the request lands, so the caller can say what was asked for. */
  onRequested?: (masterType: DispatchMasterType, label: string) => void;
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
    setValues({ ...emptyValuesFor(next), ...(prefill ?? {}) });
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, masterType, prefill]);

  const fields = useMemo(() => masterFields(mt, ctx).filter((f) => f.key !== "sortOrder"), [mt, ctx]);

  /*
    ⚠ A nameless master is keyed on its PAIR, not on a name. Matching on
      `values.name` (always "" here) would compare against the synthetic labels
      the store builds and either match nothing or match the wrong row — and the
      unique index would then reject the approval instead of the request.
  */
  const existing = isNameless(mt)
    ? s.customerItems.find(
        (m) => m.customerId === (values.customer_id ?? "") && m.itemId === (values.item_id ?? ""),
      )
    : findExistingMaster(s.masterList(mt), values.name ?? "");
  /*
    ⚠ AND THE SAME TRAP HERE. A nameless master's payload has no `name`, so
      matching on one compares "" to "" and reports the FIRST pending mapping
      request — any mapping — as "already requested". The pair is what identifies it.
  */
  const pending = s.masterRequests.find((r) => {
    if (r.status !== "pending" || r.masterType !== mt) return false;
    if (isNameless(mt)) {
      return (
        String(r.proposedPayload.customer_id ?? "") === (values.customer_id ?? "") &&
        String(r.proposedPayload.item_id ?? "") === (values.item_id ?? "")
      );
    }
    return String(r.proposedPayload.name ?? "").trim().toLowerCase() === (values.name ?? "").trim().toLowerCase();
  });

  const reviewers = s.masterReviewersFor(mt).map((id) => s.personName(id)).filter((n) => n !== "—");

  const submit = async () => {
    const miss = missingRequired(mt, values, ctx);
    if (miss) { setError(miss); return; }
    if (existing) { setError(`“${existing.name}” is already in the list.`); return; }
    if (pending) { setError("That entry has already been requested and is awaiting review."); return; }
    setBusy(true);
    setError(null);
    try {
      const payload = payloadFromValues(mt, values);
      await s.requestNewMaster(mt, payload);
      onRequested?.(mt, describePayload(mt, payload, {
        customerName: s.customerName,
        itemName: s.itemName,
        companyName: (id) => s.masterName("company", id),
      }));
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
