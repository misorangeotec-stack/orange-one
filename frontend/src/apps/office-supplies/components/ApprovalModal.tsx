import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useSuppliesStore } from "../store";
import type { SupplyRequest } from "../types";

/**
 * Approve / send back a request at the first (HOD) or second (Management) approval.
 * A remark is mandatory when it is NOT a plain approval — the RPC enforces it too.
 */
export default function ApprovalModal({
  open,
  onClose,
  request,
  stage,
}: {
  open: boolean;
  onClose: () => void;
  request: SupplyRequest | null;
  stage: "first" | "second";
}) {
  const s = useSuppliesStore();
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRemarks("");
      setErr(null);
      setBusy(null);
    }
  }, [open]);

  const act = async (approve: boolean) => {
    if (!request) return;
    if (!approve && !remarks.trim()) {
      setErr("A reason is required when the request is not approved.");
      return;
    }
    setBusy(approve ? "approve" : "reject");
    setErr(null);
    try {
      if (stage === "first") await s.decideFirstApproval(request, approve, remarks.trim());
      else await s.decideSecondApproval(request, approve, remarks.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const label = stage === "first" ? "First approval (HOD)" : "Second approval (Management)";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${label} — ${request?.reqNo ?? ""}`}
      subtitle={request ? `${request.itemName ?? "Service request"} · Qty ${request.quantity}` : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => act(false)}
            disabled={!!busy}
            className="!text-ryg-red"
          >
            {busy === "reject" ? "Saving…" : "Not approved"}
          </Button>
          <Button size="sm" onClick={() => act(true)} disabled={!!busy}>
            {busy === "approve" ? "Saving…" : "Approve"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FieldLabel label="Remarks" hint="required if not approving">
          <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add a remark…" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
