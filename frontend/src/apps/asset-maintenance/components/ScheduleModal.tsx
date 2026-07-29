import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useAssetStore } from "../store";
import { FREQUENCY_UNITS, type Asset, type AssetSchedule, type ScheduleType } from "../types";
import { daysBetween } from "../lib/format";

interface Values {
  schedule_type_id: string;
  frequency_value: string;
  frequency_unit: string;
  last_done_date: string;
  next_due_date: string;
  lead_days: string;
  usage_interval: string;
  ref_no: string;
  provider: string;
  amount: string;
  notes: string;
}

const EMPTY: Values = {
  schedule_type_id: "", frequency_value: "", frequency_unit: "months",
  last_done_date: "", next_due_date: "", lead_days: "15",
  usage_interval: "", ref_no: "", provider: "", amount: "", notes: "",
};

/**
 * Add or edit one dated track on an asset.
 *
 * `next_due_date` is entered, never computed, on the way IN — that is the whole
 * point: you are copying the date off the policy, or saying when the last service
 * was. It is only ever computed on the way OUT, when a job closes.
 */
export default function ScheduleModal({
  open,
  onClose,
  asset,
  schedule,
}: {
  open: boolean;
  onClose: () => void;
  asset: Asset;
  schedule: AssetSchedule | null;
}) {
  const s = useAssetStore();
  const [v, setV] = useState<Values>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const types = useMemo(() => s.activeOf(s.scheduleTypes) as ScheduleType[], [s]);
  const picked = types.find((t) => t.id === v.schedule_type_id)
    ?? s.scheduleTypes.find((t) => t.id === v.schedule_type_id);

  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setV({
        schedule_type_id: schedule.scheduleTypeId,
        frequency_value: schedule.frequencyValue === null ? "" : String(schedule.frequencyValue),
        frequency_unit: schedule.frequencyUnit,
        last_done_date: schedule.lastDoneDate ?? "",
        next_due_date: schedule.nextDueDate ?? "",
        lead_days: String(schedule.leadDays),
        usage_interval: schedule.usageInterval === null ? "" : String(schedule.usageInterval),
        ref_no: schedule.refNo ?? "",
        provider: schedule.provider ?? "",
        amount: schedule.amount === null ? "" : String(schedule.amount),
        notes: schedule.notes ?? "",
      });
    } else {
      setV(EMPTY);
    }
    setError(null);
  }, [open, schedule]);

  /** Picking a type seeds its defaults — but never overwrites what is already typed. */
  const pickType = (id: string) => {
    const t = types.find((x) => x.id === id);
    setV((prev) => ({
      ...prev,
      schedule_type_id: id,
      frequency_value: prev.frequency_value || (t?.defaultFrequencyValue ? String(t.defaultFrequencyValue) : ""),
      frequency_unit: schedule ? prev.frequency_unit : (t?.defaultFrequencyUnit ?? prev.frequency_unit),
      lead_days: schedule ? prev.lead_days : String(t?.defaultLeadDays ?? 15),
    }));
  };

  // Which tracks are still available: one per type per asset (the DB has a unique
  // key), so an already-used type would fail on save rather than in the picker.
  const taken = new Set(asset.schedules.filter((x) => x.id !== schedule?.id).map((x) => x.scheduleTypeId));
  const typeOptions: ComboOption[] = types
    .filter((t) => !taken.has(t.id) || t.id === v.schedule_type_id)
    .map((t) => ({ value: t.id, label: `${t.name}${t.kind === "renewal" ? " (renewal)" : ""}` }));

  const isRenewal = picked?.kind === "renewal";
  const isOneTime = v.frequency_unit === "one_time";

  const ladderNote = useMemo(() => {
    const lead = Number(v.lead_days);
    if (!Number.isFinite(lead) || lead < 0) return null;
    const tiers = s.reminderLadder.filter((d) => d <= lead);
    if (!tiers.length) return `Opens ${lead} days ahead. No ladder tier fits inside that, so it reminds on the day it opens and then daily once overdue.`;
    return `Opens ${lead} days ahead, then reminds at ${tiers.join(", ")} day${tiers.length === 1 ? "" : "s"} before — and daily once overdue.`;
  }, [v.lead_days, s.reminderLadder]);

  const dueWarning = useMemo(() => {
    if (!v.next_due_date) return null;
    const d = daysBetween(s.todayIso, v.next_due_date);
    const lead = Number(v.lead_days) || 0;
    if (d < 0) return "That date is in the past — a service job will open for it on the next nightly run.";
    if (d <= lead) return "That is already inside the reminder window — a job will open on the next nightly run.";
    return null;
  }, [v.next_due_date, v.lead_days, s.todayIso]);

  const save = async () => {
    if (busy) return;
    if (!v.schedule_type_id) { setError("Pick what kind of schedule this is."); return; }
    if (!v.next_due_date) { setError("Enter when this is next due — that is what the reminder counts back from."); return; }
    setBusy(true);
    setError(null);
    try {
      await s.upsertSchedule(asset.id, { ...v, id: schedule?.id ?? "" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={schedule ? "Edit track" : "Add a track"}
      subtitle={`${asset.assetNo} ${asset.name}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : schedule ? "Save track" : "Add track"}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="What is being tracked" required>
            <Combobox value={v.schedule_type_id} onChange={pickType} options={typeOptions}
              placeholder="Select…" searchable disabled={!!schedule} />
          </FieldLabel>
          <FieldLabel label="Next due on" required
            hint="Copy it off the document, or work it forward from the last service.">
            <TextInput type="date" value={v.next_due_date}
              onChange={(e) => setV((p) => ({ ...p, next_due_date: e.target.value }))} />
          </FieldLabel>

          <FieldLabel label="Repeats every"
            hint={isOneTime ? "One time only parks the track after it fires — right for a warranty, wrong for anything renewed." : undefined}>
            <div className="flex gap-2">
              <TextInput inputMode="numeric" className="w-24" value={v.frequency_value}
                disabled={isOneTime}
                onChange={(e) => setV((p) => ({ ...p, frequency_value: e.target.value }))} />
              <Combobox value={v.frequency_unit}
                onChange={(x) => setV((p) => ({ ...p, frequency_unit: x }))}
                options={FREQUENCY_UNITS.map((u) => ({ value: u.value, label: u.label }))} />
            </div>
          </FieldLabel>

          <FieldLabel label="Remind this many days ahead" required hint={ladderNote ?? undefined}>
            <TextInput inputMode="numeric" value={v.lead_days}
              onChange={(e) => setV((p) => ({ ...p, lead_days: e.target.value }))} />
          </FieldLabel>

          <FieldLabel label="Last done on">
            <TextInput type="date" value={v.last_done_date}
              onChange={(e) => setV((p) => ({ ...p, last_done_date: e.target.value }))} />
          </FieldLabel>

          <FieldLabel label="Or every (usage)"
            hint="Optional second trigger — e.g. 10000 km. Checked when someone logs a meter reading.">
            <TextInput inputMode="decimal" value={v.usage_interval}
              placeholder={s.masterName("usage_unit", asset.usageUnitId) === "—" ? "" : `in ${s.masterName("usage_unit", asset.usageUnitId)}`}
              onChange={(e) => setV((p) => ({ ...p, usage_interval: e.target.value }))} />
          </FieldLabel>
        </div>

        {isRenewal && (
          <div className="space-y-3">
            <p className="rounded-lg bg-[#FFF4EC] px-3 py-2 text-[12.5px] text-navy">
              This is a <strong>renewal</strong>. When its job is closed you will be asked for the
              expiry on the renewed document, and these details are replaced with the new ones.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <FieldLabel label="Policy / contract no.">
                <TextInput value={v.ref_no} onChange={(e) => setV((p) => ({ ...p, ref_no: e.target.value }))} />
              </FieldLabel>
              <FieldLabel label="Provider">
                <TextInput value={v.provider} onChange={(e) => setV((p) => ({ ...p, provider: e.target.value }))} />
              </FieldLabel>
              <FieldLabel label="Premium / fee (₹)">
                <TextInput inputMode="decimal" value={v.amount}
                  onChange={(e) => setV((p) => ({ ...p, amount: e.target.value }))} />
              </FieldLabel>
            </div>
          </div>
        )}

        <FieldLabel label="Notes">
          <TextArea rows={2} value={v.notes} onChange={(e) => setV((p) => ({ ...p, notes: e.target.value }))} />
        </FieldLabel>

        {dueWarning && <p className="text-[12.5px] text-[#946200]">{dueWarning}</p>}
        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}
