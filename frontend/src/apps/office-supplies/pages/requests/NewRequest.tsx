import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSuppliesStore } from "../../store";
import SupplyRequestFields from "../../components/SupplyRequestFields";
import { useSupplyRequestForm } from "./useSupplyRequestForm";

/**
 * The in-app intake form — the branching MS-Form rebuilt natively. State and the
 * fields live in useSupplyRequestForm + SupplyRequestFields, shared with the
 * Edit screen.
 */
export default function NewRequest() {
  const s = useSuppliesStore();
  const navigate = useNavigate();
  const form = useSupplyRequestForm();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    form.setErr(null);
    const built = form.build();
    if ("error" in built) return form.setErr(built.error);

    setBusy(true);
    try {
      const id = await s.submitRequest(built.input);
      navigate(`/office-supplies/requests/${id}`);
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Raise a supply request</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Tell us what you need. Computer &amp; tech accessories go through two approvals; stationery, maintenance and
          services go straight to the handover team.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <SupplyRequestFields form={form} />
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
