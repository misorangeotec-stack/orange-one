import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { useSamplingStore } from "../../store";
import SampleRequestFields from "../../components/SampleRequestFields";
import { useSampleRequestForm } from "./useSampleRequestForm";
import type { SamplingRequest } from "../../types";

/**
 * Edit a raised request — the same form as NewRequest, started from the request.
 * Open only until the next bucket records its step (store.canEditRequest, and
 * authoritatively fms_sampling_update_request). Changing direction, collector or
 * the lab gate re-routes the request exactly as a fresh raise would.
 */
export default function EditRequest() {
  const { id } = useParams();
  const s = useSamplingStore();
  const r = id ? s.requestById(id) : undefined;

  if (!r || !s.canEditRequest(r)) {
    return (
      <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
        <h1 className="text-[18px] font-bold text-navy">{r ? "This request can no longer be edited" : "Request not found"}</h1>
        <p className="text-[13.5px] text-grey-2 mt-2">
          {r
            ? "A request can be edited by its requester, an admin or a coordinator — and only until the next step is recorded."
            : "It may not exist, or you may not have access to it."}
        </p>
        <Link
          to={r ? `/sampling/requests/${r.id}` : "/sampling/requests"}
          className="mt-4 inline-block text-[13px] font-semibold text-orange hover:underline"
        >
          {r ? "Back to the request" : "Back to all requests"}
        </Link>
      </Card>
    );
  }

  // Keyed so the form re-initialises if the route moves to another request.
  return <EditRequestForm key={r.id} request={r} />;
}

function EditRequestForm({ request }: { request: SamplingRequest }) {
  const s = useSamplingStore();
  const navigate = useNavigate();
  const form = useSampleRequestForm(request);
  const [busy, setBusy] = useState(false);
  const back = `/sampling/requests/${request.id}`;

  const save = async () => {
    form.setErr(null);
    const built = form.build();
    if ("error" in built) return form.setErr(built.error);

    setBusy(true);
    try {
      await s.updateRequest(request, built.input);
      navigate(back);
    } catch (e) {
      form.setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Edit {request.reqNo}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Anything on the request can be changed until the next step is recorded. Changing the direction, the collector
          or the lab testing choice moves the request to the matching first step.
        </p>
      </div>

      <Card className="p-6">
        <SampleRequestFields form={form} />
        <div className="flex justify-end gap-2 pt-5 mt-6 border-t border-line">
          <Button size="sm" variant="ghost" onClick={() => navigate(back)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
