import { useState } from "react";
import { useNavigate } from "react-router-dom";
import MrfForm from "../../components/MrfForm";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import type { MrfInput } from "../../data/hrWrites";

/** Raise a new Manpower Requisition. Gated to whoever Setup lists as owning `mrf`. */
export default function NewMrf() {
  const s = useHrStore();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!s.isStepOwner("mrf")) return <AccessDenied />;

  const submit = async (input: MrfInput, jdFile: File | null) => {
    setBusy(true);
    setErr(null);
    try {
      const id = await s.submitMrf(input);
      // The MRF exists now, so it has an id to upload against. A JD failure must not
      // undo a created requisition — surface it, but still route to the new MRF.
      if (jdFile) {
        try {
          await s.attachRequisitionJd(id, jdFile);
        } catch (e) {
          setErr(`Requisition created, but the JD didn't attach: ${(e as Error).message}`);
        }
      }
      navigate(`/hr-recruitment/requisitions/${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Raise a Requisition</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          This goes to the HR Head, then to Management. Once both approve, HR posts the job.
        </p>
      </div>

      <MrfForm
        busy={busy}
        error={err}
        submitLabel="Submit requisition"
        onSubmit={submit}
        onCancel={() => navigate("/hr-recruitment/requisitions")}
      />
    </div>
  );
}
