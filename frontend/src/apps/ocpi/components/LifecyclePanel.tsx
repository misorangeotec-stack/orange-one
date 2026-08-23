import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../store";
import { cancelDeal, holdDeal, resumeDeal } from "../data/ocpiWrites";
import { dmy } from "../lib/format";
import type { OcpiDeal } from "../types";

/**
 * Park it, restart it, or write it off.
 *
 * ⚠ THIS IS THE ANSWER TO "THE CUSTOMER WENT QUIET". Without it a deal has two
 *   futures — sit in somebody's queue for ever, or be walked through approvals
 *   that are no longer happening — and every count in the module inherits that.
 *   A queue is only worth reading if the things in it are things somebody
 *   intends to do.
 *
 * ⚠ HOLD IS REVERSIBLE AND CANCEL IS NOT, so they are not two buttons that look
 *   alike. Cancel asks in a dialog, names the deal, and says plainly that it
 *   cannot be undone; hold is a single confirm with a reason.
 *
 * ⚠ WHAT IS OFFERED MIRRORS `fms_ocpi_hold` / `_cancel` EXACTLY — including
 *   that a closed deal offers neither, and that after the customer has signed
 *   only a coordinator sees Cancel. The database refuses regardless; showing a
 *   button that is going to be refused is just a slower way to say no.
 */
export default function LifecyclePanel({ deal }: { deal: OcpiDeal }) {
  const s = useOcpiStore();
  const [ask, setAsk] = useState<null | "hold" | "cancel">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRaiser = deal.raisedBy === s.userId && s.canEdit;
  const mayAct = s.isProcessCoordinator || isRaiser;

  const held = deal.status === "on_hold";
  const terminal = deal.status === "closed" || deal.status === "cancelled";
  const isDraft = deal.status === "draft";

  // Once the customer has signed, writing the deal off stops being the
  // salesperson's call. Same rule the RPC enforces.
  const customerSigned = !!deal.csDocPath;
  const mayCancel =
    !terminal && !isDraft && (s.isProcessCoordinator || (isRaiser && !customerSigned));
  const mayHold = !terminal && !isDraft && !held && mayAct;

  if (!mayAct && !held) return null;

  async function run(what: "hold" | "resume" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      if (what === "hold") await holdDeal(deal.id, reason.trim());
      else if (what === "cancel") await cancelDeal(deal.id, reason.trim());
      else await resumeDeal(deal.id);
      setReason("");
      setAsk(null);
      await s.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {held && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-ryg-yellow/50 p-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
              On hold{deal.holdAt ? ` since ${dmy(deal.holdAt)}` : ""}
            </p>
            <p className="mt-1 text-[13.5px] text-navy">{deal.holdReason}</p>
          </div>
          {mayAct && (
            <Button onClick={() => void run("resume")} disabled={busy}>
              {busy ? "Working…" : "Take it off hold"}
            </Button>
          )}
        </Card>
      )}

      {deal.status === "cancelled" && (
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
            Cancelled{deal.cancelledAt ? ` on ${dmy(deal.cancelledAt)}` : ""}
          </p>
          <p className="mt-1 text-[13.5px] text-navy">{deal.cancelReason}</p>
        </Card>
      )}

      {(mayHold || mayCancel) && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-[13px] text-grey">
            If this deal has stalled, say so here rather than leaving it in somebody&rsquo;s queue.
          </p>
          <div className="flex flex-wrap gap-2">
            {mayHold && (
              <Button size="sm" variant="ghost" onClick={() => { setReason(""); setAsk("hold"); }}>
                Put on hold
              </Button>
            )}
            {mayCancel && (
              <Button size="sm" variant="ghost" onClick={() => { setReason(""); setAsk("cancel"); }}>
                Cancel the deal
              </Button>
            )}
          </div>
        </Card>
      )}

      <Modal
        open={ask !== null}
        onClose={() => { if (!busy) setAsk(null); }}
        title={ask === "cancel" ? "Cancel this deal?" : "Put this deal on hold?"}
      >
        <div className="space-y-3">
          <p className="text-[13.5px] text-grey">
            {ask === "cancel" ? (
              <>
                <b className="text-navy">{deal.ocNo ?? deal.quotationNo ?? deal.customerName}</b> will
                be written off and will leave every queue.{" "}
                <b className="text-navy">This cannot be undone</b> — the number stays used, and the
                quotation and any documents are kept as the record of what happened.
              </>
            ) : (
              <>
                It leaves every queue and comes back exactly where it is now when you take it off
                hold. Nothing is lost.
              </>
            )}
          </p>

          <FieldLabel label="Reason" hint="required — this is the only record of why">
            <TextArea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                ask === "cancel"
                  ? "The customer bought elsewhere"
                  : "Waiting on the customer to confirm the site is ready"
              }
              disabled={busy}
            />
          </FieldLabel>

          {error && <p className="text-[13px] text-ryg-red">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void run(ask === "cancel" ? "cancel" : "hold")}
              disabled={busy || reason.trim().length === 0}
            >
              {busy ? "Working…" : ask === "cancel" ? "Cancel the deal" : "Put on hold"}
            </Button>
            <Button variant="ghost" onClick={() => setAsk(null)} disabled={busy}>
              Keep it as it is
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
