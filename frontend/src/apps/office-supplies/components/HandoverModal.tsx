import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useSuppliesStore } from "../store";
import type { SupplyRequest } from "../types";

/**
 * Final confirmation / material handover. Records remarks + delivery dates; supplying an
 * ACTUAL delivery date closes the request as delivered (the RPC decides).
 */
export default function HandoverModal({
  open,
  onClose,
  request,
}: {
  open: boolean;
  onClose: () => void;
  request: SupplyRequest | null;
}) {
  const s = useSuppliesStore();
  const [remarks, setRemarks] = useState("");
  const [tentative, setTentative] = useState("");
  const [actual, setActual] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && request) {
      setRemarks(request.handoverRemarks ?? "");
      setTentative(request.tentativeDeliveryDate ?? "");
      setActual(request.actualDeliveryDate ?? "");
      setErr(null);
      setBusy(false);
    }
  }, [open, request]);

  const save = async () => {
    if (!request) return;
    setBusy(true);
    setErr(null);
    try {
      await s.recordHandover(request, {
        handoverRemarks: remarks.trim() || null,
        tentativeDeliveryDate: tentative || null,
        actualDeliveryDate: actual || null,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Handover — ${request?.reqNo ?? ""}`}
      subtitle={request ? `${request.itemName ?? "Service request"} · Qty ${request.quantity}` : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : actual ? "Save & mark delivered" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Tentative delivery date">
          <TextInput type="date" value={tentative} onChange={(e) => setTentative(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Actual delivery date" hint="setting this marks the request delivered">
          <TextInput type="date" value={actual} onChange={(e) => setActual(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Remarks">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
