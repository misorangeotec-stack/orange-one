import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useProductionStore } from "../../store";
import { useJobCardForm } from "./useJobCardForm";

/**
 * The issue-slip intake form (step 1). Picks the four masters and captures the
 * job-card details, then raises the card into the material-handover queue.
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

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Generate Issue Slip</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Raise a new production job card. Missing an option below? Request it on the{" "}
          <Link to="/production-entry/master-requests" className="font-semibold text-orange hover:underline">Master Requests</Link> page.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <FieldLabel label="Job Card No." required>
          <TextInput value={f.jobcardNo} onChange={(e) => f.setJobcardNo(e.target.value)} placeholder="e.g. JC-1043" />
        </FieldLabel>
        <FieldLabel label="Category">
          <Combobox value={f.categoryId} onChange={f.setCategoryId} options={f.categoryOptions} placeholder="Select category" autoAdvance />
        </FieldLabel>
        <FieldLabel label="Raw Material Name" required>
          <Combobox value={f.rawMaterialId} onChange={f.setRawMaterialId} options={f.rawMaterialOptions} placeholder="Select raw material" autoAdvance />
        </FieldLabel>
        <div className="grid grid-cols-2 gap-4">
          <FieldLabel label="Required Qty">
            <TextInput value={f.requiredQty} inputMode="decimal" onChange={(e) => f.setRequiredQty(e.target.value)} placeholder="0" />
          </FieldLabel>
          <FieldLabel label="Unit">
            <Combobox value={f.unitId} onChange={f.setUnitId} options={f.unitOptions} placeholder="Select unit" autoAdvance />
          </FieldLabel>
        </div>
        <FieldLabel label="FG Item Name (RM used for)" required>
          <Combobox value={f.fgItemId} onChange={f.setFgItemId} options={f.fgItemOptions} placeholder="Select finished-good item" autoAdvance />
        </FieldLabel>
        <FieldLabel label="Remarks">
          <TextArea rows={2} value={f.issueRemarks} onChange={(e) => f.setIssueRemarks(e.target.value)} placeholder="Anything the team should know" />
        </FieldLabel>

        {f.err && <p className="text-[12.5px] text-ryg-red">{f.err}</p>}

        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Raise job card"}</Button>
        </div>
      </Card>
    </div>
  );
}
