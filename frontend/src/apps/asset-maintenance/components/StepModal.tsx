import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { useAssetStore } from "../store";
import {
  STEP_CONFIG,
  missingRequired,
  visibleFields,
  type OptionSource,
  type StepField,
  type StepFieldCtx,
} from "../lib/stepConfig";
import type { QueueStep } from "../lib/queues";
import { dmy } from "../lib/format";
import DocLink from "./DocLink";
import type { ServiceJob } from "../types";

/**
 * THE step modal. One component records (and edits) all three queue steps, driven
 * entirely by lib/stepConfig.ts.
 *
 * ⚠ ATTACHMENT CONTRACT: when editing with no NEW file chosen, the attachment keys
 *   are OMITTED from the payload entirely so the RPC keeps the stored file. Only a
 *   fresh upload writes them. Sending "" on every edit would silently wipe the
 *   service bill.
 *
 * ⚠ The payload is built from the VISIBLE fields, never from all of them — a
 *   hidden branch field (the new-expiry block on a service track, or on a rework)
 *   must not be sent at all, or an empty string would land where the RPC expects
 *   either a date or nothing.
 */
export default function StepModal({
  stepKey,
  open,
  onClose,
  job,
  editing = false,
  readOnly = false,
}: {
  stepKey: QueueStep;
  open: boolean;
  onClose: () => void;
  job: ServiceJob | null;
  editing?: boolean;
  readOnly?: boolean;
}) {
  const s = useAssetStore();
  const cfg = STEP_CONFIG[stepKey];

  const [values, setValues] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /**
   * Is this job's track a renewal? Decides whether Verify & Close asks for the new
   * expiry date. Read from the schedule TYPE, not the job, because the job carries
   * only the type's id.
   */
  const ctx = useMemo<StepFieldCtx>(() => {
    const type = job?.scheduleTypeId
      ? s.scheduleTypes.find((t) => t.id === job.scheduleTypeId)
      : undefined;
    return { isRenewal: type?.kind === "renewal", scheduleTypeName: type?.name ?? "Service" };
  }, [job?.scheduleTypeId, s.scheduleTypes]);

  // Re-seed whenever the modal opens on a different row (or flips edit/record).
  useEffect(() => {
    if (!open || !job) return;
    const next: Record<string, string> = {};
    for (const f of cfg.fields) next[f.key] = f.get(job);
    // A fresh record defaults the actual date to today rather than leaving it blank.
    const dateKey = cfg.fields.find((f) => f.kind === "date" && /_actual_date$/.test(f.key))?.key;
    if (dateKey && !next[dateKey] && !editing) {
      next[dateKey] = s.todayIso;
    }
    // Verification defaults to the common case, so the branch fields appear at once.
    if (cfg.stepKey === "verify_close" && !next.vc_outcome && !editing) next.vc_outcome = "satisfactory";
    setValues(next);
    setFile(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job?.id, editing, cfg.stepKey]);

  const shown = useMemo(() => visibleFields(cfg, values, job, ctx), [cfg, values, job, ctx]);

  const optionsFor = (src: OptionSource): ComboOption[] => {
    const map = (rows: { id: string; name: string }[]) => rows.map((r) => ({ value: r.id, label: r.name }));
    switch (src) {
      case "vendor": return map(s.activeOf(s.vendors));
      case "cost_head": return map(s.activeOf(s.costHeads));
      default: return [];
    }
  };

  const set = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const renderField = (f: StepField) => {
    const v = values[f.key] ?? "";
    if (f.kind === "select") {
      const opts = f.choices ?? (f.optionsFrom ? optionsFor(f.optionsFrom) : []);
      // ⚠ Buttons only for a fixed `choices` list of two or three. `optionsFrom`
      //   reads a master and must keep its dropdown however few rows it holds
      //   today — see ChoiceButtons for why that rule is absolute.
      if (f.choices && f.choices.length >= 2 && f.choices.length <= 3) {
        return (
          <ChoiceButtons
            value={v}
            onChange={(next) => set(f.key, next)}
            options={opts}
            disabled={readOnly}
            ariaLabel={f.label}
          />
        );
      }
      return (
        <Combobox
          value={v}
          onChange={(next) => set(f.key, next)}
          options={opts}
          placeholder={f.placeholder ?? "Select…"}
          disabled={readOnly}
          searchable={opts.length > 6}
        />
      );
    }
    if (f.kind === "textarea") {
      return (
        <TextArea value={v} rows={2} disabled={readOnly} placeholder={f.placeholder}
          onChange={(e) => set(f.key, e.target.value)} />
      );
    }
    return (
      <TextInput
        type={f.kind === "date" ? "date" : "text"}
        inputMode={f.kind === "number" ? "decimal" : undefined}
        value={v}
        disabled={readOnly}
        placeholder={f.placeholder}
        onChange={(e) => set(f.key, e.target.value)}
      />
    );
  };

  const existingDoc =
    cfg.attachment && job ? { path: job.sdBillPath, name: job.sdBillName } : null;

  const save = async () => {
    if (!job || busy || readOnly) return;
    const miss = missingRequired(cfg, values, job, ctx);
    if (miss.length) {
      setError(`Still needed: ${miss.join(", ")}.`);
      return;
    }
    if (cfg.attachment?.required && !file && !existingDoc?.path) {
      setError(`${cfg.attachment.label} is required.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of shown) payload[f.key] = values[f.key] ?? "";

      if (cfg.attachment) {
        if (file) {
          const up = await s.uploadDocument(job.id, cfg.attachment.folder, file);
          payload[cfg.attachment.pathKey] = up.path;
          payload[cfg.attachment.nameKey] = up.name;
        } else if (!editing) {
          // Recording with no file: send blanks so the RPC stores nulls.
          payload[cfg.attachment.pathKey] = "";
          payload[cfg.attachment.nameKey] = "";
        }
        // Editing with no new file: the keys stay OMITTED — the RPC keeps the file.
      }

      if (editing) await s.updateStep(stepKey, job.id, payload);
      else await s.recordStep(stepKey, job.id, payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (!job) return null;

  const title = editing ? `Edit — ${cfg.title}` : cfg.title;
  const subtitle = `${job.jobNo} · ${ctx.scheduleTypeName} · ${s.assetLabel(job.assetId)}${
    job.dueDate ? ` · due ${dmy(job.dueDate)}` : ""
  }`;

  const isRework = values.vc_outcome === "rework_needed";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="lg"
      readOnly={readOnly}
      readOnlyHeader={readOnly ? "Viewing a completed entry" : undefined}
      footer={
        readOnly ? (
          <Button variant="ghost" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : isRework ? "Send back" : cfg.actionLabel}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        {/*
          Closing a renewal is the one place the module can quietly go wrong for
          years, so it says so on screen rather than only in the field hint.
        */}
        {cfg.stepKey === "verify_close" && ctx.isRenewal && values.vc_outcome === "satisfactory" && (
          <p className="rounded-lg bg-[#FFF4EC] px-3 py-2 text-[12.5px] text-navy">
            This is a <strong>renewal</strong>. Enter the expiry shown on the renewed{" "}
            {ctx.scheduleTypeName.toLowerCase()} document — the next reminder counts back from that
            date, and it is often not exactly a year away.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((f) => (
            <FieldLabel
              key={f.key}
              label={f.label}
              required={f.required || (f.requiredWhen ? f.requiredWhen(values, job, ctx) : false)}
              hint={f.hint}
            >
              {renderField(f)}
            </FieldLabel>
          ))}
        </div>

        {cfg.attachment && (
          <section className="space-y-2">
            <SectionHeading>{cfg.attachment.label}</SectionHeading>
            {existingDoc?.path && !file && (
              <div className="flex items-center gap-3">
                <DocLink path={existingDoc.path} name={existingDoc.name} />
                {!readOnly && <span className="text-[12px] text-grey-2">choose a file below to replace it</span>}
              </div>
            )}
            {!readOnly && (
              <input
                ref={fileRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-[13px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-[#F1F4F9] file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-navy"
              />
            )}
          </section>
        )}

        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}
