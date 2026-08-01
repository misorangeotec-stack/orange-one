import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../store";
import {
  STEP_CONFIG, isRequiredNow, missingRequired, visibleFields, type StepField,
} from "../lib/stepConfig";
import type { QueueStep } from "../lib/queues";
import { currentRoundView, type RoundView } from "../lib/rounds";
import OrderRefPanel, { OrderRefDocs } from "./OrderRefPanel";
import ShipLinesGrid, { shipLinesFrom, type ShipLineValue } from "./ShipLinesGrid";
import StepDocLink from "./StepDocLink";
import type { DispatchOrder } from "../types";

/**
 * THE step modal. One component records (and edits) every one of the five queue
 * steps, driven entirely by lib/stepConfig.ts — five near-identical modal files
 * would drift, this cannot.
 *
 * ⚠ IT IS ROUND-SCOPED. `round` says WHICH consignment is on screen. A Completed
 *   tab can legitimately be showing round 1 of an order that is now on round 3;
 *   seeding from the order header would then show round 3's invoice number under
 *   a heading that says round 1. Every field getter takes `(order, view)` for
 *   exactly this reason, and an archived round always opens read-only because
 *   correcting a finished round goes through Amend, not through here.
 *
 * ⚠ ATTACHMENT CONTRACT: when editing with no NEW file chosen, the attachment keys
 *   are OMITTED from the payload entirely so the RPC keeps the stored file. Only a
 *   fresh upload writes them. Sending "" on every edit would silently wipe the
 *   invoice or the receiver copy — and since both are now REQUIRED, it would also
 *   make every remarks-only edit fail.
 */
export default function StepModal({
  stepKey,
  open,
  onClose,
  order,
  round,
  editing = false,
  readOnly = false,
}: {
  stepKey: QueueStep;
  open: boolean;
  onClose: () => void;
  order: DispatchOrder | null;
  /** The consignment being shown. Defaults to the one in progress. */
  round?: RoundView | null;
  editing?: boolean;
  readOnly?: boolean;
}) {
  const s = useDispatchStore();
  const cfg = STEP_CONFIG[stepKey];

  const view = useMemo<RoundView | null>(
    () => round ?? (order ? currentRoundView(order) : null),
    [round, order],
  );
  // A finished round is immutable here — the order page's "Correct this round"
  // is the only way to change what was delivered.
  const locked = readOnly || !!view?.isArchived;

  const [values, setValues] = useState<Record<string, string>>({});
  const [shipLines, setShipLines] = useState<ShipLineValue[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Re-seed whenever the modal opens on a different row, a different ROUND, or
  // flips edit/record. The round number is load-bearing in these deps: without
  // it, opening round 1 then round 2 of the same order keeps round 1's values.
  useEffect(() => {
    if (!open || !order || !view) return;
    const next: Record<string, string> = {};
    for (const f of cfg.fields) next[f.key] = f.get(order, view);
    setValues(next);
    setShipLines(cfg.lines === "ship" ? shipLinesFrom(order) : []);
    setFile(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id, view?.roundNo, view?.isArchived, editing, cfg.stepKey]);

  const shown = useMemo(() => visibleFields(cfg, values, order), [cfg, values, order]);
  // Split by position: a `beforeLines` field frames the item grid and is asked above
  // it; everything else annotates what was entered and sits below.
  const topFields = shown.filter((f) => f.beforeLines);
  const bodyFields = shown.filter((f) => !f.beforeLines);
  // The attachment slots BETWEEN these two: short answers, then the file that
  // evidences them, then the free-text remark.
  const shortFields = bodyFields.filter((f) => f.kind !== "textarea");
  const longFields = bodyFields.filter((f) => f.kind === "textarea");

  // Editing clears the last refusal. Without this, filling in the very field the
  // error named leaves "Delivery outcome is required." sitting under a filled-in
  // Delivery outcome until the next save attempt.
  const set = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setError(null);
  };

  const renderField = (f: StepField) => {
    const v = values[f.key] ?? "";
    /*
      A placeholder is a prompt for someone about to type. In VIEW ONLY it reads
      as the recorded answer instead — an unfilled Remarks box showed the grey
      "why the order is being held" exactly where the actual remark would sit. A
      dash says the same thing honestly: nothing was recorded here.
    */
    const ph = locked ? "—" : f.placeholder;
    if (f.kind === "select") {
      // A select is either a fixed code enum (`choices`) or a live master list the
      // descriptor names — stepConfig is pure, so resolving it is the modal's job.
      const opts = f.master
        ? s.activeOf(s.masterList(f.master)).map((m) => ({ value: m.id, label: m.name }))
        : (f.choices ?? []);
      return (
        <Combobox
          value={v}
          onChange={(next) => set(f.key, next)}
          options={opts}
          placeholder={locked ? "—" : (f.placeholder ?? "Select…")}
          disabled={locked}
        />
      );
    }
    if (f.kind === "textarea") {
      return (
        <TextArea value={v} rows={3} disabled={locked} placeholder={ph}
          onChange={(e) => set(f.key, e.target.value)} />
      );
    }
    return (
      <TextInput
        type={f.kind === "date" ? "date" : "text"}
        inputMode={f.kind === "number" ? "decimal" : undefined}
        value={v}
        disabled={locked}
        placeholder={ph}
        onChange={(e) => set(f.key, e.target.value)}
      />
    );
  };

  // Read off the ROUND, via the descriptor — never off the order header, which
  // belongs to whichever round is currently in progress.
  const existingDoc =
    cfg.attachment && view
      ? { path: cfg.attachment.getPath(view), name: cfg.attachment.getName(view) }
      : null;

  const save = async () => {
    if (!order || busy || locked) return;
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

      if (cfg.lines === "ship") {
        payload.lines = shipLines
          .filter((l) => Number(l.ship_qty) > 0)
          .map((l) => ({ id: l.id, ship_qty: l.ship_qty, lot_no: l.lot_no }));
      }

      if (cfg.attachment) {
        if (file) {
          const up = await s.uploadStepDocument(order.id, cfg.attachment.folder, file, order.roundNo);
          payload[cfg.attachment.pathKey] = up.path;
          payload[cfg.attachment.nameKey] = up.name;
        } else if (!editing) {
          // Recording with no file: send blanks so the RPC stores nulls (and,
          // where the attachment is required, refuses).
          payload[cfg.attachment.pathKey] = "";
          payload[cfg.attachment.nameKey] = "";
        }
        // Editing with no new file: the keys stay OMITTED — the RPC keeps the file.
      }

      if (editing) await s.updateStep(stepKey, order.id, payload);
      else await s.recordStep(stepKey, order.id, payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * "Nothing available yet" — record the check, restart this round's clock, and
   * leave the order exactly where it is.
   */
  const nothingAvailable = async () => {
    if (!order || busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      await s.materialNothingAvailable(order.id, values.ms_remarks ?? "");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  if (!order || !view) return null;

  const title = editing ? `Edit — ${cfg.title}` : cfg.title;
  const subtitle = `${order.orderNo} · ${s.customerName(order.customerId)} · round ${view.roundNo}`;

  const recordedAt = view.dcAt ?? view.goAt ?? view.sbAt ?? view.msAt;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      /*
        The steps that carry the item grid — what is going out, and everything
        downstream that recaps it — are a table inside a dialog, and `lg` (512px)
        wrapped item names onto two lines. The two that are purely a decision plus
        a remark stay `lg`; widening those would only strand a lone dropdown in a
        lot of white.
      */
      size={cfg.lines === "ship" || cfg.context?.showLines || cfg.context?.showOrderLines ? "xl" : "lg"}
      readOnly={locked}
      /*
        ⚠ This slot renders OUTSIDE Modal's disabled <fieldset>, and it is the only
        place a document button still works in read-only mode. StepDocLink mints a
        signed URL on click, so it must be a real button — inside the fieldset it
        would look live and do nothing.
      */
      readOnlyHeader={
        locked ? (
          <div className="space-y-2">
            <p className="text-[12.5px] text-grey-2">
              Viewing round {view.roundNo}
              {recordedAt ? `, recorded ${formatDateTime(recordedAt)}` : ""}
              {view.isArchived ? " — finished, and corrected from the order page." : ""}
            </p>
            <OrderRefDocs round={view} showInvoice showReceiver />
          </div>
        ) : undefined
      }
      footer={
        locked ? (
          <Button variant="ghost" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            {/*
              The store keeper's other legal answer. Without it, an order whose
              material is still in production has no action available at all: the
              save is refused for having no quantity, and the round's clock keeps
              running until the row is permanently red.
            */}
            {cfg.stepKey === "material_status" && !editing && (
              <Button variant="ghost" onClick={nothingAvailable} disabled={busy}>
                Nothing available yet
              </Button>
            )}
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : cfg.actionLabel}</Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        {cfg.context && (
          <OrderRefPanel
            order={order}
            round={view}
            readOnly={locked}
            showCredit={cfg.context.showCredit}
            showLines={cfg.context.showLines}
            showOrderLines={cfg.context.showOrderLines}
            showCompany={cfg.context.showCompany}
            showInvoice={cfg.context.showInvoice}
            showOutward={cfg.context.showOutward}
          />
        )}

        {/* Decisions that frame the consignment — asked before the quantities. */}
        {topFields.length > 0 && (
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            {topFields.map((f) => (
              <div key={f.key} className={f.kind === "textarea" ? "sm:col-span-2" : undefined}>
                <FieldLabel label={f.label} required={isRequiredNow(f, values, order)}>
                  {renderField(f)}
                </FieldLabel>
              </div>
            ))}
          </div>
        )}

        {cfg.lines === "ship" && (
          <section className="space-y-2">
            <SectionHeading>What is going out</SectionHeading>
            <ShipLinesGrid order={order} values={shipLines} onChange={setShipLines} readOnly={locked} />
          </section>
        )}

        {/*
          Every step is "one or two short answers, then a Remarks box". Pairing a
          one-line control with a multi-line one across two equal columns left the
          two ragged against each other and squeezed both; the remark — the field
          people actually write a sentence into — got the narrower half of a 512px
          dialog. Short fields pair up, the textarea takes the full width beneath.
        */}
        {shortFields.length > 0 && (
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            {shortFields.map((f) => (
              <div key={f.key}>
                <FieldLabel label={f.label} required={isRequiredNow(f, values, order)}>
                  {renderField(f)}
                </FieldLabel>
              </div>
            ))}
          </div>
        )}

        {/*
          THE FILE SITS WITH THE FIELD IT EVIDENCES, not at the bottom of the dialog.
          The invoice belongs under the invoice number and the receiver copy under
          the delivery outcome; parked below Remarks — a box people scroll past once
          they have typed — a REQUIRED attachment read as an optional afterthought,
          and the save was refused by something already off screen.
        */}
        {cfg.attachment && (
          <section className="space-y-2">
            <SectionHeading>
              {cfg.attachment.label}
              {cfg.attachment.required && !locked && <span className="text-orange"> *</span>}
            </SectionHeading>
            {existingDoc?.path && !file && !locked && (
              <div className="flex items-center gap-3">
                <StepDocLink path={existingDoc.path} name={existingDoc.name} />
                <span className="text-[12px] text-grey-2">choose a file below to replace it</span>
              </div>
            )}
            {!locked && (
              <input
                ref={fileRef}
                type="file"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                className="block w-full text-[13px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-[#F1F4F9] file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-navy"
              />
            )}
          </section>
        )}

        {longFields.length > 0 && (
          <div className="space-y-4">
            {longFields.map((f) => (
              <div key={f.key}>
                <FieldLabel label={f.label} required={isRequiredNow(f, values, order)}>
                  {renderField(f)}
                </FieldLabel>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}
