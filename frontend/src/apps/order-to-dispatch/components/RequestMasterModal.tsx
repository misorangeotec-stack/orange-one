import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
import { isDirectMaster, REQUESTABLE_DISPATCH_MASTER_TYPES, type DispatchMasterType } from "../types";
import { dmy } from "../lib/format";

/** The default type for the built-in picker — never a direct master. */
const FIRST_REQUESTABLE: DispatchMasterType =
  (REQUESTABLE_DISPATCH_MASTER_TYPES.find((t) => !isDirectMaster(t.value)) ??
    REQUESTABLE_DISPATCH_MASTER_TYPES[0]).value;

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
  typePicker,
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
  /**
   * The shared "What do you need?" field, when the caller owns that choice —
   * see the note on MapCustomerItemModal's copy of this prop. Supplying it
   * replaces the built-in picker below.
   */
  typePicker?: ReactNode;
  /** Fired after the request lands, so the caller can say what was asked for. */
  onRequested?: (masterType: DispatchMasterType, label: string) => void;
}) {
  const s = useDispatchStore();
  const ctx = useMasterFieldCtx();
  /* ⚠ The first REQUESTABLE one, skipping the direct masters — this list now
     holds both kinds, and defaulting to a direct type would open this modal on a
     master it cannot submit. */
  const [mt, setMt] = useState<DispatchMasterType>(masterType ?? FIRST_REQUESTABLE);
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
        (m) => m.customerId === (values.party_id ?? "") && m.itemId === (values.item_id ?? ""),
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
        String(r.proposedPayload.party_id ?? "") === (values.party_id ?? "") &&
        String(r.proposedPayload.item_id ?? "") === (values.item_id ?? "")
      );
    }
    return String(r.proposedPayload.name ?? "").trim().toLowerCase() === (values.name ?? "").trim().toLowerCase();
  });

  const reviewers = s.masterReviewersFor(mt).map((id) => s.personName(id)).filter((n) => n !== "—");

  /* Requestable AND not one of the direct ones — a direct master writes through
     its own modal and has no approval to wait for, so it does not belong here. */
  const notRequestable =
    !REQUESTABLE_DISPATCH_MASTER_TYPES.some((t) => t.value === mt) || isDirectMaster(mt);

  const submit = async () => {
    if (notRequestable) return;
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
          <Button onClick={submit} disabled={busy || notRequestable || !!existing || !!pending}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {typePicker}

        {!typePicker && !masterType && (
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

        {/*
          ⚠ THE TYPE IS CHECKED, not trusted. `masterType` is a prop, so a picker
            wired to a master that is no longer requestable would queue a request
            nobody can approve — which is exactly what the company picker on the
            sales order used to do: the resolver refuses `company` outright, so
            the failure surfaced in front of the OWNER, after they had agreed to
            it. Refuse here, where the person who raised it is still looking.
        */}
        {notRequestable && (
          <p className="text-[13px] font-medium text-ryg-red">
            {isDirectMaster(mt)
              ? `A ${masterTypeLabel(mt).toLowerCase()} is not requested — it is created directly. Close this and use “Map items to a customer”.`
              : `A new ${masterTypeLabel(mt).toLowerCase()} cannot be requested here — it comes from Tally. Create it there and it appears within 15 minutes.`}
          </p>
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
