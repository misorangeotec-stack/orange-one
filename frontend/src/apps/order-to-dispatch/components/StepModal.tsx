import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { useDispatchStore } from "../store";
import {
  STEP_CONFIG,
  missingRequired,
  visibleFields,
  type OptionSource,
  type StepField,
} from "../lib/stepConfig";
import type { QueueStep } from "../lib/queues";
import { dmy } from "../lib/format";
import StockCheckGrid, { msLinesFrom, type MsLineValue } from "./StockCheckGrid";
import LotLinesGrid, { lcLinesFrom, type LcLineValue } from "./LotLinesGrid";
import CustomerMailPanel from "./CustomerMailPanel";
import StepDocLink from "./StepDocLink";
import type { DispatchOrder } from "../types";

/**
 * THE step modal. One component records (and edits) every one of the six queue
 * steps, driven entirely by lib/stepConfig.ts — six near-identical modal files
 * would drift, this cannot.
 *
 * Three things it owns beyond the descriptor fields:
 *   · the per-line grids (material status, LOT confirmation),
 *   · the attachment picker,
 *   · the customer-mail panel on the material-status step.
 *
 * ⚠ ATTACHMENT CONTRACT: when editing with no NEW file chosen, the attachment keys
 *   are OMITTED from the payload entirely so the RPC keeps the stored file. Only a
 *   fresh upload writes them. Sending "" on every edit would silently wipe the
 *   invoice or the receiver copy.
 */
export default function StepModal({
  stepKey,
  open,
  onClose,
  order,
  editing = false,
  readOnly = false,
}: {
  stepKey: QueueStep;
  open: boolean;
  onClose: () => void;
  order: DispatchOrder | null;
  editing?: boolean;
  readOnly?: boolean;
}) {
  const s = useDispatchStore();
  const cfg = STEP_CONFIG[stepKey];

  const [values, setValues] = useState<Record<string, string>>({});
  const [msLines, setMsLines] = useState<MsLineValue[]>([]);
  const [lcLines, setLcLines] = useState<LcLineValue[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Re-seed whenever the modal opens on a different row (or flips edit/record).
  useEffect(() => {
    if (!open || !order) return;
    const next: Record<string, string> = {};
    for (const f of cfg.fields) next[f.key] = f.get(order);
    // A fresh record defaults the actual date to today rather than leaving it blank.
    const dateKey = cfg.fields.find((f) => f.kind === "date" && f.key.endsWith("_actual_date"))?.key;
    if (dateKey && !next[dateKey] && !editing) next[dateKey] = new Date().toISOString().slice(0, 10);
    setValues(next);
    setMsLines(cfg.lines === "material_status" ? msLinesFrom(order) : []);
    setLcLines(cfg.lines === "lot_confirm" ? lcLinesFrom(order) : []);
    setFile(null);
    setError(null);
    // Default the customer mail to ON only when it is armed and the customer has
    // an address — never silently mail a customer because a checkbox was sticky.
    const customer = s.customers.find((c) => c.id === order.customerId);
    setNotifyCustomer(cfg.stepKey === "material_status" && s.customerMail.enabled && !!customer?.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id, editing, cfg.stepKey]);

  const shown = useMemo(() => visibleFields(cfg, values, order), [cfg, values, order]);

  const optionsFor = (src: OptionSource): ComboOption[] => {
    const map = (rows: { id: string; name: string }[]) => rows.map((r) => ({ value: r.id, label: r.name }));
    switch (src) {
      case "payment_term": return map(s.activeOf(s.paymentTerms));
      case "godown": return map(s.activeOf(s.godowns));
      case "company": return map(s.activeOf(s.companies));
      case "invoice_series": return map(s.activeOf(s.invoiceSeries));
      case "gate": return map(s.activeOf(s.gates));
      case "vehicle": return map(s.activeOf(s.vehicles));
      case "driver": return map(s.activeOf(s.drivers));
      case "transporter": return map(s.activeOf(s.transporters));
      default: return [];
    }
  };

  const set = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const renderField = (f: StepField) => {
    const v = values[f.key] ?? "";
    if (f.kind === "select") {
      const opts = f.choices ?? (f.optionsFrom ? optionsFor(f.optionsFrom) : []);
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
        type={f.kind === "date" ? "date" : f.kind === "datetime" ? "datetime-local" : "text"}
        inputMode={f.kind === "number" ? "decimal" : undefined}
        value={v}
        disabled={readOnly}
        placeholder={f.placeholder}
        onChange={(e) => set(f.key, e.target.value)}
      />
    );
  };

  const existingDoc =
    cfg.attachment && order
      ? {
          path: (order as unknown as Record<string, string | null>)[
            cfg.attachment.pathKey === "sb_attachment_path" ? "sbAttachmentPath" : "dcAttachmentPath"
          ],
          name: (order as unknown as Record<string, string | null>)[
            cfg.attachment.nameKey === "sb_attachment_name" ? "sbAttachmentName" : "dcAttachmentName"
          ],
        }
      : null;

  const save = async () => {
    if (!order || busy || readOnly) return;
    const miss = missingRequired(cfg, values, order);
    if (miss) { setError(miss); return; }
    if (cfg.attachment?.required && !file && !existingDoc?.path) {
      setError(`${cfg.attachment.label} is required.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of shown) payload[f.key] = values[f.key] ?? "";

      if (cfg.lines === "material_status") payload.lines = msLines;
      if (cfg.lines === "lot_confirm") payload.lines = lcLines;

      if (cfg.attachment) {
        if (file) {
          const up = await s.uploadStepDocument(order.id, cfg.attachment.folder, file);
          payload[cfg.attachment.pathKey] = up.path;
          payload[cfg.attachment.nameKey] = up.name;
        } else if (!editing) {
          // Recording with no file: send blanks so the RPC stores nulls.
          payload[cfg.attachment.pathKey] = "";
          payload[cfg.attachment.nameKey] = "";
        }
        // Editing with no new file: the keys stay OMITTED — the RPC keeps the file.
      }

      if (cfg.stepKey === "material_status") payload.ms_notify_customer = notifyCustomer ? "true" : "false";

      if (editing) await s.updateStep(stepKey, order.id, payload);
      else await s.recordStep(stepKey, order.id, payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (!order) return null;

  const title = editing ? `Edit — ${cfg.title}` : cfg.title;
  const subtitle = `${order.orderNo} · ${s.customerName(order.customerId)}${
    order.promisedDate ? ` · promised ${dmy(order.promisedDate)}` : ""
  }`;

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
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : cfg.actionLabel}</Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((f) => (
            <FieldLabel key={f.key} label={f.label} required={f.required} hint={f.hint}>
              {renderField(f)}
            </FieldLabel>
          ))}
        </div>

        {cfg.lines === "material_status" && (
          <section className="space-y-2">
            <SectionHeading>Line availability</SectionHeading>
            <StockCheckGrid order={order} values={msLines} onChange={setMsLines} readOnly={readOnly} />
          </section>
        )}

        {cfg.lines === "lot_confirm" && (
          <section className="space-y-2">
            <SectionHeading>LOT and final quantity</SectionHeading>
            <LotLinesGrid order={order} values={lcLines} onChange={setLcLines} readOnly={readOnly} />
          </section>
        )}

        {cfg.stepKey === "material_status" && (
          <CustomerMailPanel
            order={order}
            plannedDate={values.ms_planned_dispatch_date ?? ""}
            notify={notifyCustomer}
            onNotifyChange={setNotifyCustomer}
            readOnly={readOnly}
          />
        )}

        {cfg.attachment && (
          <section className="space-y-2">
            <SectionHeading>{cfg.attachment.label}</SectionHeading>
            {existingDoc?.path && !file && (
              <div className="flex items-center gap-3">
                <StepDocLink path={existingDoc.path} name={existingDoc.name} />
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
