import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useProductionStore } from "../../store";
import { useJobCardForm } from "./useJobCardForm";
import { useRepackForm } from "./useRepackForm";
import IssueSlipFields from "../../components/IssueSlipFields";
import RepackSlipFields from "../../components/RepackSlipFields";
import { newUid } from "@/shared/components/ui/LineGrid";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import CardTypePill from "../../components/CardTypePill";
import { dmy } from "../../lib/format";
import { makeEmptyRmLine, type RmLine } from "./useJobCardForm";
import type { BomLine, ProductionCardType, ProductionRequest } from "../../types";

/** A stored issue-slip line back into an editable grid row. */
const toRmLine = (l: BomLine): RmLine => ({
  ...makeEmptyRmLine(),
  rawMaterialId: l.rawMaterialId ?? "",
  qty: l.requiredQty != null ? String(l.requiredQty) : "",
  unitId: l.unitId ?? "",
  pct: l.pct != null ? String(l.pct) : "",
  fromBom: !!l.bomId,
});

/**
 * The issue-slip intake form (step 1), in three tabs.
 *
 * PRODUCTION picks the FG item, captures the job-card details and a
 * multi-raw-material BOM, then raises the card into the material-handover queue.
 * Unchanged in every respect.
 *
 * REPACKAGING is for traded FG — imported ready-made, repacked, sold. It captures
 * the FG item, ONE quantity (no wastage, so packed = FG) and the packaging
 * material, then raises the card straight into the PACKING ENTRY queue, bypassing
 * the manufacturing steps — and M/C testing, which it still skips now that the test
 * runs after packing.
 *
 * CONVERT is a PRODUCTION card in every respect — same fields, same BOM, same
 * chain from material handover to the finished-good transfer. Its ONE difference
 * is that the Lot/Batch Card Number is TYPED, because a converted lot already
 * carries a number from outside this system.
 *
 * ⚠ EVERY TAB HOLDS ITS OWN FORM STATE. They reuse the same `useJobCardForm` hook
 * — one definition of the BOM autofill, the rescale and the validation — but each
 * gets its OWN INSTANCE. Sharing one instance between Production and Convert made
 * an FG item or BOM typed on one tab appear on the other, which reads as the app
 * losing track of which slip you are filling in. They are separate slips and only
 * one of them is ever submitted.
 *
 * ⚠ The Lot/Batch field sits ABOVE the tabs on purpose. For Production and
 * Repackaging it is a PREVIEW: both draw the next number from the SAME continuous
 * counter, and showing one preview for both is what makes that visible rather than
 * something you have to be told. On Convert the very same slot becomes an INPUT —
 * same position, same label, so it reads as one field that is sometimes yours to
 * fill rather than as a new control that appeared from nowhere.
 */
/**
 * The tab key is a card type PLUS one extra: `drafts` is a list, not a slip.
 * Keeping it in the same strip is what makes "where did my half-typed slip go?"
 * answerable without leaving the page.
 */
type TabKey = ProductionCardType | "drafts";

const TAB_DEFS: { key: TabKey; label: string }[] = [
  { key: "production", label: "Production" },
  { key: "repackaging", label: "Repackaging" },
  { key: "convert", label: "Convert" },
  { key: "drafts", label: "Drafts" },
];

export default function NewRequest() {
  const s = useProductionStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("production");
  /**
   * The draft being continued, if any. Null means a brand-new slip.
   *
   * ⚠ Also decides WHICH RPC raises the card: a continued draft goes through
   * submitDraft so it keeps the PRD and Lot/Batch numbers it reserved when it was
   * first saved. Raising it through submitRequest would mint a second pair and
   * strand the first.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  const draft = draftId ? s.requestById(draftId) : undefined;

  /**
   * Seed a form from the draft — but ONLY the form whose card type it is, so
   * continuing a repackaging draft cannot pour its values into the Production tab.
   * The hooks hydrate once per request id, so handing them null is a no-op.
   */
  const slipInit = (t: ProductionCardType) =>
    draft && draft.cardType === t
      ? {
          requestId: draft.id,
          fgTotalQty: draft.fgQty != null ? String(draft.fgQty) : "",
          fgItemId: draft.fgItemId ?? "",
          bomId: draft.bomLines.find((l) => l.bomId)?.bomId ?? "",
          issueRemarks: draft.issueRemarks ?? "",
          issueDate: draft.issueDate ?? todayLocalIso(),
          lines: draft.bomLines.filter((l) => !l.isAdditional).map(toRmLine),
          addLines: draft.bomLines.filter((l) => l.isAdditional).map(toRmLine),
        }
      : null;

  // One instance per tab. Hooks are called unconditionally and in a fixed order,
  // so this is safe; only the rendered one is ever read.
  // ⚠ enforceSum stays ON: a draft has not been raised yet, so the FG-total rule
  //   applies to it in full.
  const prod = useJobCardForm(slipInit("production"));
  const convert = useJobCardForm(slipInit("convert"));
  const repack = useRepackForm(
    draft && draft.cardType === "repackaging"
      ? {
          requestId: draft.id,
          fgQty: draft.fgQty != null ? String(draft.fgQty) : "",
          fgItemId: draft.fgItemId ?? "",
          fgLotNo: draft.fgLotNo ?? "",
          issueDate: draft.issueDate ?? todayLocalIso(),
          issueRemarks: draft.issueRemarks ?? "",
          packRows: draft.pmhBomLines.map((l) => ({
            uid: newUid(),
            packagingItemId: l.packagingItemId,
            unitId: l.unitId,
            qty: l.qty != null ? String(l.qty) : "",
            extra: l.extra != null ? String(l.extra) : "",
          })),
        }
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const isDrafts = tab === "drafts";
  const isRepack = tab === "repackaging";
  const isConvert = tab === "convert";
  /** The issue-slip form behind the current tab (Production or Convert). */
  const slip = isConvert ? convert : prod;
  const f = isRepack ? repack : slip;

  const submit = async () => {
    f.setErr(null);
    const built = isRepack ? repack.build() : slip.build(tab as ProductionCardType);
    if ("error" in built) return f.setErr(built.error);
    setBusy(true);
    try {
      const id = draftId
        ? await s.submitDraft(draftId, built.input)
        : await s.submitRequest(built.input);
      navigate(`/production-entry/requests/${id}`);
    } catch (e) {
      f.setErr((e as Error).message);
      setBusy(false);
    }
  };

  /** Park the slip exactly as typed. Nothing is validated — see `draftInput`. */
  const saveDraft = async () => {
    f.setErr(null);
    setBusy(true);
    try {
      const input = isRepack ? repack.draftInput() : slip.draftInput(tab as ProductionCardType);
      const id = await s.saveDraft(draftId, input);
      setDraftId(id);
      setSavedNote("Saved to Drafts.");
    } catch (e) {
      f.setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = async (id: string) => {
    if (!window.confirm("Delete this draft? Its reserved Lot/Batch number will not be reused.")) return;
    try {
      await s.deleteDraft(id);
      if (id === draftId) setDraftId(null);
    } catch (e) {
      f.setErr((e as Error).message);
    }
  };

  /**
   * The Lot/Batch number is auto-generated on save as YYMM-####, where YYMM is
   * the month of the JOB DATE — so the preview has to follow the date the user
   * picked, not today. `batchNoPreview` comes from the server already formatted
   * against the current month, so take only its numeric half and re-prefix it.
   */
  const yymm = (iso: string) => (iso.length >= 7 ? iso.slice(2, 4) + iso.slice(5, 7) : "");
  const batchPreview = (() => {
    const prefix = yymm(f.issueDate) || yymm(todayLocalIso());
    const seq = s.batchNoPreview.split("-")[1] ?? "####";
    return `${prefix}-${seq}`;
  })();
  const backDated = f.issueDate && f.issueDate < todayLocalIso();

  // A draft already holds its number, so show that rather than a preview of the
  // next one — the preview would name a DIFFERENT card.
  const batchField = draft && !isConvert ? (
    <FieldLabel label="Lot/Batch Card Number">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-2 text-[13.5px] text-grey-2">
        <span className="font-semibold text-navy tabular-nums">{draft.jobcardNo}</span>
        <span>· reserved for this draft</span>
      </div>
    </FieldLabel>
  ) : isConvert ? (
    <FieldLabel
      label="Lot/Batch Card Number"
      required
      hint="typed, not generated — a converted lot keeps the number it already has"
    >
      <TextInput
        value={convert.jobcardNo}
        onChange={(e) => convert.setJobcardNo(e.target.value)}
        placeholder="e.g. 2609-1430"
      />
    </FieldLabel>
  ) : (
    <FieldLabel label="Lot/Batch Card Number">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-2 text-[13.5px] text-grey-2">
        <span className="font-semibold text-navy tabular-nums">{batchPreview}</span>
        <span>
          · auto-generated on save · one series for both types
          {backDated ? " · month follows the job date" : ""}
        </span>
      </div>
    </FieldLabel>
  );

  const actions = (
    <div className="flex items-center justify-end gap-3 pt-1">
      {savedNote && <span className="text-[12.5px] text-ryg-green">{savedNote}</span>}
      {draft && (
        <span className="text-[12.5px] text-grey-2">Continuing draft {draft.reqNo}</span>
      )}
      <Button variant="ghost" size="sm" onClick={saveDraft} disabled={busy}>
        {draft ? "Update draft" : "Save as draft"}
      </Button>
      <Button size="sm" onClick={submit} disabled={busy}>
        {busy ? "Submitting…" : isRepack ? "Raise repackaging card" : isConvert ? "Raise convert card" : "Raise job card"}
      </Button>
    </div>
  );

  if (!s.canRaise) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="p-6 text-center">
          <h1 className="text-[18px] font-bold text-navy">Not authorized to raise a job card</h1>
          <p className="text-[13.5px] text-grey-2 mt-1.5">
            Raising a batch card is restricted to the owners of the Raise Request step. Ask an admin to add you in Setup → Step Owners.
          </p>
        </Card>
      </div>
    );
  }

  /**
   * The Drafts list. A grid like every other grid in this app: every column sorts,
   * every column filters. It is usually short, which is exactly why it was easy to
   * hand-roll a bare <table> here — but "usually short" is not a property anyone
   * checks before a second shift has parked eight slips on it.
   *
   * `jobDate` carries no filter: a date column's picker restates a column that is
   * already sortable, and the two date filters that earn their place elsewhere sit
   * on queues spanning months rather than on a handful of open drafts.
   */
  const draftColumns: QueueColumn<ProductionRequest>[] = [
    {
      key: "jobcardNo",
      header: "Lot/Batch Card No.",
      cell: (d) =>
        d.jobcardNo ? (
          <span className="font-semibold text-navy tabular-nums">{d.jobcardNo}</span>
        ) : (
          // A convert draft has no number until one is typed, and reserving nothing
          // is the point — so say so rather than showing an empty cell.
          <span className="text-grey-2">not set</span>
        ),
      sortValue: (d) => d.jobcardNo ?? "",
      filter: { kind: "text", get: (d) => d.jobcardNo ?? "" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "reqNo",
      header: "Reference",
      cell: (d) => <span className="text-grey">{d.reqNo}</span>,
      sortValue: (d) => d.reqNo,
      // Unique per draft, so a dropdown would only restate the table.
      filter: { kind: "text", get: (d) => d.reqNo },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "cardType",
      header: "Type",
      cell: (d) => <CardTypePill cardType={d.cardType} />,
      sortValue: (d) => d.cardType,
      filter: { kind: "select", get: (d) => d.cardType },
    },
    {
      key: "fgItem",
      header: "FG Item",
      cell: (d) => <span className="text-navy">{s.fgItemById(d.fgItemId)?.name ?? "—"}</span>,
      sortValue: (d) => s.fgItemById(d.fgItemId)?.name ?? "",
      filter: { kind: "select", get: (d) => s.fgItemById(d.fgItemId)?.name ?? "" },
    },
    {
      key: "savedBy",
      header: "Saved by",
      cell: (d) => <span className="text-grey">{d.requesterName}</span>,
      sortValue: (d) => d.requesterName,
      filter: { kind: "select", get: (d) => d.requesterName },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "jobDate",
      header: "Job date",
      cell: (d) => <span className="text-grey">{d.issueDate ? dmy(d.issueDate) : "—"}</span>,
      // Sorts on the ISO value, never the dd-mm-yyyy the cell renders.
      sortValue: (d) => d.issueDate ?? "",
      tdClassName: "whitespace-nowrap",
    },
  ];

  // A slip reads best in a narrow column; the Drafts grid is six columns plus a
  // filter row and needs the width. Same page, two jobs.
  return (
    <div className={`${isDrafts ? "max-w-6xl" : "max-w-4xl"} mx-auto space-y-5`}>
      <div>
        <h1 className="text-[22px] font-bold text-navy">Generate Issue Slip</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {isRepack
            ? "Raise a repackaging slip for a traded FG item — repacked, not produced."
            : isConvert
              ? "Raise a convert issue slip — the same production flow, with the Lot/Batch Card Number entered by hand."
              : "Raise a new production issue slip."}
        </p>
      </div>

      <Tabs
        tabs={TAB_DEFS.map((t) =>
          t.key === "drafts" && s.drafts.length > 0 ? { ...t, label: `Drafts (${s.drafts.length})` } : t,
        )}
        active={tab}
        onChange={(k) => {
          setSavedNote(null);
          setTab(k as TabKey);
        }}
      />

      {isDrafts ? (
        <QueueTable<ProductionRequest>
          rows={s.drafts}
          rowKey={(d) => d.id}
          columns={draftColumns}
          // Newest first: a draft is picked up again within a shift or two, so the
          // one you parked last is almost always the one you came back for.
          initialSort={{ key: "jobDate", dir: "desc" }}
          rowsLabel="drafts"
          loading={s.isLoading}
          emptyTitle="No drafts yet"
          emptyMessage="Fill in a slip on any tab and choose Save as draft to park it here."
          actions={(d) => (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setSavedNote(null);
                  setDraftId(d.id);
                  setTab(d.cardType);
                }}
                className="text-[12.5px] font-semibold text-orange hover:underline"
              >
                Continue
              </button>
              {s.canDeleteDraft(d) && (
                <button
                  type="button"
                  onClick={() => discardDraft(d.id)}
                  className="text-[12.5px] font-semibold text-ryg-red hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        />
      ) : isRepack ? (
        <RepackSlipFields f={repack} batchField={batchField}>{actions}</RepackSlipFields>
      ) : (
        <IssueSlipFields f={slip} batchField={batchField}>{actions}</IssueSlipFields>
      )}
    </div>
  );
}
