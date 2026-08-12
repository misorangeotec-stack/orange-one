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
import { creditHeadroomOf, currentRoundView, type RoundView } from "../lib/rounds";
import OrderRefPanel, { OrderRefDocs } from "./OrderRefPanel";
import CreditApprovalPanel, { approvedQtyError } from "./CreditApprovalPanel";
import ShipLinesGrid, { shipLinesFrom, type ShipLineValue } from "./ShipLinesGrid";
import StepDocLink from "./StepDocLink";
import GatePassButton from "./GatePassButton";
import ReceiverCopyCapture, { type ReceiverPage } from "./ReceiverCopyCapture";
import { uploadReceiverPages } from "../lib/receiverPages";
import type { DispatchOrder } from "../types";
import type { StepAttachment } from "../lib/stepConfig";

/**
 * The pages already stored against this round, as the capture grid wants them:
 * the primary first, then the extras.
 *
 * ⚠ THE PRIMARY IS PREPENDED, NOT STORED IN THE LIST. `dc_attachment_pages`
 *   holds pages 2..N only — the server strips anything matching the primary —
 *   so reading them back means putting page one at the front here.
 */
function storedPagesOf(a: StepAttachment, v: RoundView | null): ReceiverPage[] {
  if (!v) return [];
  const first = a.getPath(v);
  const rest = a.photos ? a.photos.getPages(v) : [];
  return [
    ...(first ? [{ kind: "stored" as const, path: first, name: a.getName(v) ?? "Receiver copy" }] : []),
    ...rest.map((d) => ({ kind: "stored" as const, path: d.path, name: d.name })),
  ];
}

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
  /** The partial credit release. Its own state because it is a pair of linked
   *  inputs, not a single descriptor-driven field — see CreditApprovalPanel. */
  const [approvedQty, setApprovedQty] = useState("");
  /** The file chosen for each attachment slot, keyed by its `pathKey`. */
  const [files, setFiles] = useState<Record<string, File | null>>({});
  /**
   * The ordered page list for a MULTI-PAGE slot, keyed by its `pathKey`.
   *
   * Separate state from `files` because the shape is genuinely different: one
   * ordered list mixing already-stored pages with newly-picked ones, where
   * position 0 is the primary. See ReceiverCopyCapture.
   */
  const [pages, setPages] = useState<Record<string, ReceiverPage[]>>({});
  const [busy, setBusy] = useState(false);
  /** "Uploading 2 of 4…" — the only progress surface this app has. */
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the modal opens on a different row, a different ROUND, or
  // flips edit/record. The round number is load-bearing in these deps: without
  // it, opening round 1 then round 2 of the same order keeps round 1's values.
  useEffect(() => {
    if (!open || !order || !view) return;
    const next: Record<string, string> = {};
    for (const f of cfg.fields) next[f.key] = f.get(order, view);
    setValues(next);
    setShipLines(cfg.lines === "ship" ? shipLinesFrom(order) : []);
    /*
      The panel asks for THIS decision's quantity; the column stores the
      CUMULATIVE ceiling. Headroom is the conversion, and it is exact here:
      an editable partial is one nothing has yet shipped under, so
      `ccApprovedQty - dispatched` is precisely what this decision released.
      (Once something does ship under it and the round loops, `ccRoundNo` stops
      matching and the round view carries no decision at all.)

      An archived round is not convertible — the dispatched total has moved on
      since — so it renders a read-only sentence instead of these boxes.
    */
    const headroom = creditHeadroomOf(order);
    setApprovedQty(
      cfg.approvedQty && !view.isArchived && view.ccStatus === "partial" && headroom != null
        ? String(headroom)
        : "",
    );
    setFiles({});
    // Seeded from the round so an already-attached set is what the grid shows,
    // and so a save that omits the slot still sends what is actually there.
    setPages(
      Object.fromEntries(
        (cfg.attachments ?? [])
          .filter((a) => a.photos)
          .map((a) => [a.pathKey, storedPagesOf(a, view)]),
      ),
    );
    setProgress(null);
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

  /* The partial-release control appears only once "Partially approved" is the
     chosen outcome, and only on a live round — an archived decision cannot be
     converted back into its per-decision figure, so it reads as a sentence. */
  const showApprovedQty = !!cfg.approvedQty && values.cc_status === "partial" && !view?.isArchived;

  /* How much the credit decision still allows out, and whether the grid is over
     it. Null headroom means uncapped, which is every order raised before partial
     approval existed — those must behave exactly as they always have. */
  const creditHeadroom = order ? creditHeadroomOf(order) : null;
  const shipTotal = shipLines.reduce((a, l) => a + (Number(l.ship_qty) || 0), 0);
  const overCredit = creditHeadroom !== null && shipTotal > creditHeadroom;

  /**
   * Why Save cannot be pressed yet, or null.
   *
   * ⚠ THE SCREEN ALREADY SAYS WHY, IN PLACE, so this only greys the button and
   *   never adds a second message: the grid turns its total red and prints the
   *   ceiling, the approval panel prints its own error, and the empty grid has
   *   standing copy pointing at "Nothing available yet". A refusal the person
   *   can only discover by clicking is the thing being removed here — leaving
   *   the button live while the reason is already on screen just invites the
   *   click that gets rejected.
   *
   * `save()` re-checks all of this. This is the courtesy layer; the RPC is the
   * gate.
   */
  const blocked: string | null =
    cfg.lines === "ship" && shipTotal <= 0 ? "nothing entered"
    : cfg.lines === "ship" && overCredit ? "over the credit ceiling"
    : showApprovedQty && order && approvedQtyError(order, approvedQty) ? "approved quantity"
    : null;

  /**
   * The printable slip, offered beside the action rather than instead of it.
   *
   * Gate outward only — this modal drives all five steps. It sits in the footer
   * of BOTH the editable and the locked branch on purpose: a reprint is the most
   * likely reason to open a finished round at all, and refusing it there would
   * send someone back to the order page for a read-only document.
   */
  const gatePass =
    stepKey === "gate_out" && order ? <GatePassButton order={order} view={view} /> : null;

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
  const slots = (cfg.attachments ?? []).map((a) => ({
    spec: a,
    stored: view ? { path: a.getPath(view), name: a.getName(view) } : null,
    file: files[a.pathKey] ?? null,
    /** Multi-page slots only; empty for the ordinary single-file ones. */
    pages: a.photos ? (pages[a.pathKey] ?? []) : [],
  }));

  const save = async () => {
    if (!order || busy || locked) return;
    const miss = missingRequired(cfg, values, order);
    if (miss) { setError(miss); return; }
    // Per slot, because required-ness is per slot: the invoice must be there,
    // the e-way bill need not be. A multi-page slot is satisfied by anything in
    // its list — the server's gate is on the PRIMARY, which is position 0.
    const missingDoc = slots.find((sl) =>
      sl.spec.required && (sl.spec.photos ? sl.pages.length === 0 : !sl.file && !sl.stored?.path),
    );
    if (missingDoc) {
      setError(`${missingDoc.spec.label} is required.`);
      return;
    }
    // A partial release with no usable figure is not a decision. Caught here so
    // nobody discovers by round-trip that 70 of 70 is an approval, not a partial.
    if (showApprovedQty) {
      const bad = approvedQtyError(order, approvedQty);
      if (bad) { setError(bad); return; }
    }
    // The credit ceiling, enforced at the point of typing as well as in the RPC —
    // the store keeper should see the limit while filling the grid, not after.
    if (cfg.lines === "ship" && overCredit) {
      setError(
        `Credit has authorised ${creditHeadroom} more on this order. Reduce the quantities going out.`,
      );
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

      // Sent only on a partial. On a full approval the RPC sets the ceiling to
      // the whole order itself, and a stale figure from a since-changed outcome
      // must not reach it.
      if (showApprovedQty) payload.cc_approved_qty = approvedQty.trim();

      for (const sl of slots) {
        if (sl.spec.photos) {
          // ── MULTI-PAGE SLOT ──────────────────────────────────────────────
          // Upload what is new, in list order, then split: position 0 is the
          // primary, the rest are the extra pages.
          //
          // ⚠ ALL THREE KEYS MOVE TOGETHER, ALWAYS. Sending a new primary while
          //   omitting the pages key would leave the old page one orphaned
          //   instead of demoted. The server deliberately does not enforce this
          //   — a guard there would break the plain single-file path — so it is
          //   this loop's job.
          const resolved = await uploadReceiverPages(
            order.id, sl.spec.folder, order.roundNo, sl.pages,
            (done, total) => setProgress(`Uploading ${done} of ${total}…`),
          );
          setProgress(null);
          payload[sl.spec.pathKey] = resolved[0]?.path ?? "";
          payload[sl.spec.nameKey] = resolved[0]?.name ?? "";
          payload[sl.spec.photos.pagesKey] = resolved.slice(1);
        } else if (sl.file) {
          const up = await s.uploadStepDocument(order.id, sl.spec.folder, sl.file, order.roundNo);
          payload[sl.spec.pathKey] = up.path;
          payload[sl.spec.nameKey] = up.name;
        } else if (!editing) {
          // Recording with no file: send blanks so the RPC stores nulls (and,
          // where the attachment is required, refuses).
          payload[sl.spec.pathKey] = "";
          payload[sl.spec.nameKey] = "";
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
      // ⚠ CLEARED HERE, NOT JUST ON THE HAPPY PATH. An upload that dies halfway
      //   leaves the modal open for a retry, and a Save button still reading
      //   "Uploading 2 of 4…" next to an error message is unreadable.
      setProgress(null);
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
  // The customer's own PO earns a place here: it is the reference THEY quote when
  // they ring up, so it is what an actor matches the order against.
  const subtitle = [
    order.orderNo,
    s.customerName(order.customerId),
    `round ${view.roundNo}`,
    order.customerPoNo ? `PO ${order.customerPoNo}` : null,
  ].filter(Boolean).join(" · ");

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
      /* Steps filled in on a phone open as a bottom sheet under `sm`. */
      mobileFull={cfg.mobileFirst}
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
          <>
            {gatePass}
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            {gatePass}
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
            {/* `progress` outranks "Saving…" — uploading four photographs over
                mobile data is the slow part, and a button that says nothing for
                thirty seconds gets pressed again. */}
            <Button onClick={save} disabled={busy || !!blocked}>
              {progress ?? (busy ? "Saving…" : cfg.actionLabel)}
            </Button>
          </>
        )
      }
    >
      {/*
        ⚠ 16px INPUTS ON THE MOBILE-FIRST STEPS. iOS zooms the viewport whenever
          a focused field's text is under 16px, and the shared field token is
          14px — so tapping Remarks at a customer's gate scrolled the form
          sideways and left the person pinching to get back. Scoped to this
          dialog rather than fixed in Form.tsx, which every screen in the portal
          renders through.
      */}
      <div className={cfg.mobileFirst
        ? "space-y-5 [&_input]:text-[16px] [&_textarea]:text-[16px] sm:[&_input]:text-[14px] sm:[&_textarea]:text-[14px]"
        : "space-y-5"}>
        {cfg.context && (
          <OrderRefPanel
            order={order}
            round={view}
            readOnly={locked}
            showCredit={cfg.context.showCredit}
            showLines={cfg.context.showLines}
            showOrderLines={cfg.context.showOrderLines}
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
          ABOVE Remarks, below the outcome. The quantity is the second half of the
          decision the outcome above it started, and the remark underneath exists
          to explain this figure — putting it after the remark would ask for the
          justification before the thing being justified.
        */}
        {showApprovedQty && (
          <CreditApprovalPanel
            order={order}
            value={approvedQty}
            onChange={(v) => { setApprovedQty(v); setError(null); }}
            readOnly={locked}
          />
        )}
        {cfg.approvedQty && view.isArchived && view.ccStatus === "partial" && view.ccApprovedQty != null && (
          <p className="text-[12.5px] text-grey">
            Credit had authorised{" "}
            <span className="font-semibold text-navy tabular-nums">{view.ccApprovedQty}</span>{" "}
            of this order in total at that point.
          </p>
        )}

        {/*
          THE FILE SITS WITH THE FIELD IT EVIDENCES, not at the bottom of the dialog.
          The invoice belongs under the invoice number and the receiver copy under
          the delivery outcome; parked below Remarks — a box people scroll past once
          they have typed — a REQUIRED attachment read as an optional afterthought,
          and the save was refused by something already off screen.
        */}
        {slots.map((sl) => (
          sl.spec.photos ? (
            /*
              A MULTI-PAGE SLOT. Rendered from the descriptor, not from a test on
              stepKey, so every other step keeps the plain input below by
              construction. Only ever reached when the form is live: the whole
              block sits inside `{!locked && …}` at the call site of the plain
              input too, and a locked round shows its documents through
              OrderRefDocs in Modal's readOnlyHeader instead — the one place
              outside the disabled fieldset where a button still works.
            */
            !locked && (
              <ReceiverCopyCapture
                key={sl.spec.pathKey}
                label={sl.spec.label}
                required={sl.spec.required}
                value={sl.pages}
                onChange={(next) => setPages((p) => ({ ...p, [sl.spec.pathKey]: next }))}
                onError={setError}
              />
            )
          ) : (
          <section key={sl.spec.pathKey} className="space-y-2">
            <SectionHeading>
              {sl.spec.label}
              {sl.spec.required && !locked && <span className="text-orange"> *</span>}
            </SectionHeading>
            {sl.stored?.path && !sl.file && (
              <div className="flex items-center gap-3">
                <StepDocLink path={sl.stored.path} name={sl.stored.name} />
                {!locked && <span className="text-[12px] text-grey-2">choose a file below to replace it</span>}
              </div>
            )}
            {/* An optional slot says so where it is asked, not in a legend — this is
                the moment someone decides whether the consignment needs one. */}
            {!locked && !sl.spec.required && !sl.stored?.path && sl.spec.note && (
              <p className="text-[12px] text-grey-2">{sl.spec.note}</p>
            )}
            {!locked && (
              <input
                type="file"
                onChange={(e) => {
                  const picked = e.target.files?.[0] ?? null;
                  setFiles((p) => ({ ...p, [sl.spec.pathKey]: picked }));
                  setError(null);
                }}
                className="block w-full text-[13px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-[#F1F4F9] file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-navy"
              />
            )}
          </section>
          )
        ))}

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
