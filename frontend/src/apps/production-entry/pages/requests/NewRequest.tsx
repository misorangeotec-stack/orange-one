import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useProductionStore } from "../../store";
import { useJobCardForm } from "./useJobCardForm";
import IssueSlipFields from "../../components/IssueSlipFields";

/**
 * The issue-slip intake form (step 1). Picks the FG item, captures the job-card
 * details and a multi-raw-material BOM (one card = one FG made from many raw
 * materials), then raises the card into the material-handover queue. The form
 * body is shared with Edit Request via <IssueSlipFields />.
 */
export default function NewRequest() {
  const s = useProductionStore();
  const navigate = useNavigate();
  const f = useJobCardForm();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    f.setErr(null);
    const built = f.build();
    if ("error" in built) return f.setErr(built.error);
    setBusy(true);
    try {
      const id = await s.submitRequest(built.input);
      navigate(`/production-entry/requests/${id}`);
    } catch (e) {
      f.setErr((e as Error).message);
      setBusy(false);
    }
  };

  // The Lot/Batch number is auto-generated on save as YYMM-####; show the prefix.
  const now = new Date();
  const batchPrefix = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;

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

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Generate Issue Slip</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Raise a new production issue slip.</p>
      </div>

      <IssueSlipFields
        f={f}
        batchField={
          <FieldLabel label="Lot/Batch Card Number">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-2 text-[13.5px] text-grey-2">
              <span className="font-semibold text-navy tabular-nums">{s.batchNoPreview || `${batchPrefix}-####`}</span>
              <span>· auto-generated on save</span>
            </div>
          </FieldLabel>
        }
      >
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Raise job card"}</Button>
        </div>
      </IssueSlipFields>
    </div>
  );
}
