import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel } from "@/shared/components/ui/Form";
import { newUid } from "@/shared/components/ui/LineGrid";
import { useProductionStore } from "../../store";
import { pctFromQty } from "../../lib/bomMath";
import { useJobCardForm, type JobCardFormInit, type RmLine } from "./useJobCardForm";
import IssueSlipFields from "../../components/IssueSlipFields";

/**
 * Correct an issue slip you already raised — allowed only while it is still
 * awaiting the FIRST material handover (nobody downstream has touched the BOM).
 * Reuses the Generate Issue Slip form wholesale; the Lot/Batch Card number is
 * fixed. The gate is re-checked server-side by fms_production_update_request —
 * this page's guard is a courtesy so the user sees a sentence, not a rejection.
 */
export default function EditRequest() {
  const { id } = useParams();
  const s = useProductionStore();
  const navigate = useNavigate();

  const request = id ? s.requestById(id) : undefined;
  const editable = request ? s.canEditRequest(request) : false;

  // Seed the form from the existing slip (multi-RM BOM, or the legacy single-RM
  // triple for cards raised before multi-RM intake). Built only when editable.
  const init: JobCardFormInit | null =
    request && editable
      ? {
          requestId: request.id,
          fgTotalQty: request.fgQty != null ? String(request.fgQty) : "",
          fgItemId: request.fgItemId ?? "",
          issueRemarks: request.issueRemarks ?? "",
          // The BOM this card was raised from, when it was raised from one.
          bomId: request.bomLines.find((l) => l.bomId)?.bomId ?? "",
          lines: (request.bomLines.length > 0
            ? request.bomLines
            : request.rawMaterialId || request.requiredQty != null
              ? [{ rawMaterialId: request.rawMaterialId, requiredQty: request.requiredQty, unitId: request.unitId, pct: null, bomId: null }]
              : []
          ).map((l): RmLine => {
            const qty = l.requiredQty ?? 0;
            // Cards raised before the BOM master stored no pct. Back-computing it
            // from this card's own quantities is exact for this card, so the grid
            // rescales correctly either way.
            const pct = l.pct ?? (request.fgQty ? pctFromQty(request.fgQty, qty) : 0);
            return {
              uid: newUid(),
              rawMaterialId: l.rawMaterialId ?? "",
              qty: l.requiredQty != null ? String(l.requiredQty) : "",
              unitId: l.unitId ?? "",
              pct: pct ? String(pct) : "",
              fromBom: !!l.bomId,
            };
          }),
        }
      : null;

  // Hooks must run unconditionally, so the form is created before the guards.
  const f = useJobCardForm(init);
  const [busy, setBusy] = useState(false);

  if (!request) {
    return (
      <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
        <h1 className="text-[18px] font-bold text-navy">Issue slip not found</h1>
        <p className="text-[13.5px] text-grey-2 mt-2">It may not exist, or you may not have access to it.</p>
        <Link to="/production-entry/requests" className="mt-4 inline-block text-[13px] font-semibold text-orange hover:underline">Back to all issue slips</Link>
      </Card>
    );
  }
  if (!editable) {
    return (
      <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
        <h1 className="text-[18px] font-bold text-navy">This issue slip can no longer be edited</h1>
        <p className="text-[13.5px] text-grey-2 mt-2">
          {request.status === "cancelled"
            ? "It has been cancelled."
            : request.status === "on_hold"
              ? "It is on hold — take it off hold to edit it."
              : "Material handover has already started. An issue slip can only be changed before its first handover."}
        </p>
        <Link to={`/production-entry/requests/${request.id}`} className="mt-4 inline-block text-[13px] font-semibold text-orange hover:underline">Back to the issue slip</Link>
      </Card>
    );
  }

  const save = async () => {
    f.setErr(null);
    const built = f.build();
    if ("error" in built) return f.setErr(built.error);
    setBusy(true);
    try {
      await s.updateRequest(request.id, built.input);
      navigate(`/production-entry/requests/${request.id}`);
    } catch (e) {
      f.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <Link to={`/production-entry/requests/${request.id}`} className="text-[12.5px] text-grey hover:text-navy">← {request.reqNo}</Link>
        <h1 className="text-[22px] font-bold text-navy mt-1">Edit Issue Slip</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Correct this issue slip while it is still awaiting material handover. The Lot/Batch Card number stays the same.
        </p>
      </div>

      <IssueSlipFields
        f={f}
        batchField={
          <FieldLabel label="Lot/Batch Card Number">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-2 text-[13.5px] text-grey-2">
              <span className="font-semibold text-navy tabular-nums">{request.jobcardNo}</span>
              <span>· fixed</span>
            </div>
          </FieldLabel>
        }
      >
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/production-entry/requests/${request.id}`)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </div>
      </IssueSlipFields>
    </div>
  );
}
