import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { formatDate } from "@/shared/lib/time";
import { useHrStore } from "../store";
import { REQUESTABLE_MASTER_TYPES, type HrMasterType } from "../types";
import {
  emptyValuesFor,
  findExistingMaster,
  masterFields,
  masterTypeLabel,
  masterTypePlural,
  missingRequired,
  payloadFromValues,
  type MasterValues,
} from "../lib/masterFields";

/**
 * "Request a new master entry" — the single raise surface for every requestable
 * HR master. Opened from a Combobox's `onCreate` (prefilled with what the user
 * typed), from the Post Job modal's "Request a new platform" link, or standalone
 * from the Master Requests page with the type picker unlocked.
 *
 * The request routes to that master's assigned owners, or to the admins when none
 * are assigned; the owner can edit the values before they land in the master.
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
  /** null (with lockType off) → the requester picks the type. */
  masterType: HrMasterType | null;
  /** The caller already knows the type — hide the picker. */
  lockType?: boolean;
  /** e.g. `{ name: "Vapi Plant" }` — what the user typed into the dropdown. */
  prefill?: MasterValues;
  /** This modal opens on top of another one (e.g. inside a kanban dialog). */
  stacked?: boolean;
  onRequested?: (id: string, masterType: HrMasterType, name: string) => void;
}) {
  const s = useHrStore();
  const [mt, setMt] = useState<HrMasterType | null>(masterType);
  const [values, setValues] = useState<MasterValues>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-seed each time the modal opens (a fresh typed name, or a different type).
  useEffect(() => {
    if (!open) return;
    setMt(masterType);
    setValues({ ...(masterType ? emptyValuesFor(masterType) : {}), ...(prefill ?? {}) });
    setErr(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const typeOptions: ComboOption[] = REQUESTABLE_MASTER_TYPES.map((m) => ({ value: m.value, label: m.label }));

  const pickType = (v: string) => {
    const next = v as HrMasterType;
    setMt(next);
    // Keep the name across a type change; everything else is type-specific.
    setValues((p) => ({ ...emptyValuesFor(next), name: p.name ?? "" }));
    setErr(null);
  };

  const fields = mt ? masterFields(mt) : [];

  /** Already in the master, or already sitting in someone's review queue? */
  const clash = useMemo(() => {
    if (!mt || !values.name?.trim()) return null;

    const existing = findExistingMaster(mt, values, {
      jobPlatforms: s.jobPlatforms,
      jobTypes: s.jobTypes,
      locations: s.locations,
      disqualificationReasons: s.disqualificationReasons,
      onboardingItems: s.onboardingItems,
    });
    if (existing) {
      return existing.active
        ? `“${existing.name}” is already in ${masterTypePlural(mt)} — pick it from the list.`
        : `“${existing.name}” exists in ${masterTypePlural(mt)} but is deactivated. Ask its owner to reactivate it rather than adding a duplicate.`;
    }

    const proposed = String(payloadFromValues(mt, values).name ?? "").trim().toLowerCase();
    const dup = s.masterRequests.find((r) => {
      if (r.status !== "pending" || r.masterType !== mt) return false;
      const p = r.proposedPayload as Record<string, unknown>;
      return String(p.name ?? "").trim().toLowerCase() === proposed;
    });
    if (dup) {
      const who = dup.requestedBy ? s.profileById(dup.requestedBy)?.name ?? "someone" : "someone";
      return `Already requested by ${who} on ${formatDate(dup.createdAt)} — it's awaiting review.`;
    }
    return null;
  }, [mt, values, s]);

  const reviewers = mt
    ? s.masterReviewersFor(mt).map((id) => s.profileById(id)?.name ?? "Unknown")
    : [];

  const submit = async () => {
    if (!mt) {
      setErr("Pick what you want to add.");
      return;
    }
    const missing = missingRequired(mt, values);
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
      const payload = payloadFromValues(mt, values);
      const id = await s.requestNewMaster(mt, payload);
      onRequested?.(id, mt, String(payload.name ?? ""));
      onClose();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      setErr(
        /duplicate key|23505/i.test(msg)
          ? "Someone has already requested this — it's awaiting review."
          : msg || "Couldn't raise the request."
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
            {f.type === "textarea" ? (
              <TextArea
                rows={3}
                value={values[f.key] ?? ""}
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
