import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../store";
import { decideQuotation } from "../data/ocpiWrites";
import type { OcpiDeal } from "../types";

/**
 * Approve, reject or return a quotation.
 *
 * ⚠ THREE OUTCOMES, NOT TWO. "Send back for changes" is the one that gets used
 *   most — a price to revisit, a delivery date to firm up — and without it an
 *   approver's only way to say "nearly" is to reject, which kills the deal and
 *   loses its number. Rework returns it to the salesperson as a draft they can
 *   edit and regenerate, keeping the number and the whole revision history.
 *
 * ⚠ REJECT AND REWORK BOTH DEMAND A REASON, here and in the database. An
 *   approver who clicks "send back" and types nothing has told the salesperson
 *   only that they are wrong, not what to change.
 *
 * ⚠ THE BUTTONS ARE A COURTESY; the RPC re-checks who may act, refuses
 *   self-approval, and refuses a decision on a deal that is not actually waiting.
 */
export default function ApprovalPanel({ deal }: { deal: OcpiDeal }) {
  const s = useOcpiStore();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "reject" | "rework">(null);
  const [error, setError] = useState<string | null>(null);

  const mayAct = s.canActOn("quotation_approval");
  const waiting = deal.status === "awaiting_quotation_approval";
  const isOwnDeal = deal.raisedBy === s.userId;
  const soleApprover =
    s.ownersOf("quotation_approval").length === 1 && s.ownersOf("quotation_approval")[0] === s.userId;

  if (!waiting) return null;

  async function decide(decision: "approve" | "reject" | "rework") {
    setBusy(decision);
    setError(null);
    try {
      await decideQuotation(deal.id, decision, note.trim() || undefined);
      setNote("");
      await s.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!mayAct) {
    return (
      <Card className="p-4">
        <p className="text-[13.5px] text-grey">
          This quotation is waiting for approval. You are not one of the approvers, so there is
          nothing for you to do here.
        </p>
      </Card>
    );
  }

  const blockedBySelf = isOwnDeal && !soleApprover;

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="text-[15px] font-bold text-navy">Your decision</h2>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          {blockedBySelf
            ? "You raised this quotation, so somebody else has to approve it."
            : "Approving moves it on to the order confirmation. Sending it back returns it to the salesperson to edit and regenerate — the number and every earlier version are kept."}
        </p>
      </div>

      {!blockedBySelf && (
        <>
          <FieldLabel
            label="Reason or note"
            hint="required when rejecting or sending back"
          >
            <TextArea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What needs to change, or why this is refused"
              disabled={!!busy}
            />
          </FieldLabel>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void decide("approve")} disabled={!!busy}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button variant="ghost" onClick={() => void decide("rework")} disabled={!!busy}>
              {busy === "rework" ? "Sending back…" : "Send back for changes"}
            </Button>
            <Button variant="ghost" onClick={() => void decide("reject")} disabled={!!busy}>
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </>
      )}

      {error && <p className="text-[13px] text-ryg-red">{error}</p>}
    </Card>
  );
}
