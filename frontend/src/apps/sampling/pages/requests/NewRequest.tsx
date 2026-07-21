import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSamplingStore } from "../../store";
import SampleRequestFields from "../../components/SampleRequestFields";
import { useSampleRequestForm } from "./useSampleRequestForm";

/**
 * The in-app intake form — the branching sampling form built natively. State and
 * the fields live in useSampleRequestForm + SampleRequestFields.
 */
export default function NewRequest() {
  const s = useSamplingStore();
  const navigate = useNavigate();
  const form = useSampleRequestForm();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    form.setErr(null);
    const built = form.build();
    if ("error" in built) return form.setErr(built.error);

    setBusy(true);
    try {
      const id = await s.submitRequest(built.input);
      navigate(`/sampling/requests/${id}`);
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Raise a sampling request</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          A few quick details and you're done. Inward samples are received then tested; outward samples are sent,
          confirmed and then tested.
        </p>
      </div>

      <Card className="p-6">
        <SampleRequestFields form={form} />
        <div className="flex justify-end pt-5 mt-6 border-t border-line">
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
