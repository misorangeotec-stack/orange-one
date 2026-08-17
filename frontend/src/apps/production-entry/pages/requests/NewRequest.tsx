import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import { FieldLabel } from "@/shared/components/ui/Form";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useProductionStore } from "../../store";
import { useJobCardForm } from "./useJobCardForm";
import { useRepackForm } from "./useRepackForm";
import IssueSlipFields from "../../components/IssueSlipFields";
import RepackSlipFields from "../../components/RepackSlipFields";
import type { ProductionCardType } from "../../types";

/**
 * The issue-slip intake form (step 1), in two tabs.
 *
 * PRODUCTION picks the FG item, captures the job-card details and a
 * multi-raw-material BOM, then raises the card into the material-handover queue.
 * Unchanged in every respect.
 *
 * REPACKAGING is for traded FG — imported ready-made, repacked, sold. It captures
 * the FG item, ONE quantity (no wastage, so packed = FG) and the packaging
 * material, then raises the card straight into the packing-material transfer
 * queue, bypassing the six manufacturing steps.
 *
 * ⚠ The Lot/Batch preview sits ABOVE the tabs on purpose: both types draw the next
 * number from the SAME continuous counter, and showing one preview for both is
 * what makes that visible rather than something you have to be told.
 */
const TABS: { key: ProductionCardType; label: string }[] = [
  { key: "production", label: "Production" },
  { key: "repackaging", label: "Repackaging" },
];

export default function NewRequest() {
  const s = useProductionStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ProductionCardType>("production");
  const prod = useJobCardForm();
  const repack = useRepackForm();
  const [busy, setBusy] = useState(false);

  const f = tab === "repackaging" ? repack : prod;

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

  const batchField = (
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
    <div className="flex justify-end pt-1">
      <Button size="sm" onClick={submit} disabled={busy}>
        {busy ? "Submitting…" : tab === "repackaging" ? "Raise repackaging card" : "Raise job card"}
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

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Generate Issue Slip</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {tab === "repackaging"
            ? "Raise a repackaging slip for a traded FG item — repacked, not produced."
            : "Raise a new production issue slip."}
        </p>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as ProductionCardType)} />

      {tab === "repackaging" ? (
        <RepackSlipFields f={repack} batchField={batchField}>{actions}</RepackSlipFields>
      ) : (
        <IssueSlipFields f={prod} batchField={batchField}>{actions}</IssueSlipFields>
      )}
    </div>
  );
}
