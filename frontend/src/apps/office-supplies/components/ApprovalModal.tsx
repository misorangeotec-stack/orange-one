import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useSuppliesStore } from "../store";
import type { SupplyRequest } from "../types";

/**
 * Approve / send back a request at the first (HOD) or second (Management) approval.
 * A remark is mandatory when it is NOT a plain approval — the RPC enforces it too.
 *
 * `editing` revises a decision already made. It stays available until the next
 * step is done; the server re-checks that and refuses otherwise.
 */
export default function ApprovalModal({
  open,
  onClose,
  request,
  stage,
  editing = false,
}: {
  open: boolean;
  onClose: () => void;
  request: SupplyRequest | null;
  stage: "first" | "second";
  editing?: boolean;
}) {
  const s = useSuppliesStore();
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // Editing shows the remark actually recorded; a fresh decision starts blank.
      setRemarks(editing ? (stage === "first" ? request?.firstRemarks : request?.secondRemarks) ?? "" : "");
      setErr(null);
      setBusy(null);
    }
  }, [open, editing, stage, request?.id, request?.firstRemarks, request?.secondRemarks]);

  const act = async (approve: boolean) => {
    if (!request) return;
    if (!approve && !remarks.trim()) {
      setErr("A reason is required when the request is not approved.");
      return;
    }
    setBusy(approve ? "approve" : "reject");
    setErr(null);
    try {
      if (editing) {
        if (stage === "first") await s.updateFirstApproval(request, approve, remarks.trim());
        else await s.updateSecondApproval(request, approve, remarks.trim());
      } else if (stage === "first") {
        await s.decideFirstApproval(request, approve, remarks.trim());
      } else {
        await s.decideSecondApproval(request, approve, remarks.trim());
      }
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
      title={`${editing ? "Edit " : ""}${editing ? label.charAt(0).toLowerCase() + label.slice(1) : label} — ${request?.reqNo ?? ""}`}
      subtitle={request
        ? `${request.itemName ?? "Service request"} · Qty ${request.quantity}${editing ? " · revisable until the next step is done" : ""}`
        : undefined}
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
            {busy === "approve" ? "Saving…" : editing ? "Keep approved" : "Approve"}
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
