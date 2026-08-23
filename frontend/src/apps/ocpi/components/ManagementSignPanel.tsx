import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import ApprovedOcPreview from "./ApprovedOcPreview";
import SignedDocStrip from "./SignedDocStrip";
import SignedDocCapture, { asStored, uploadPages, type SignedPage } from "./SignedDocCapture";
import { useOcpiStore } from "../store";
import { recordManagementSign, returnSignature } from "../data/ocpiWrites";
import { signedPages } from "../lib/signatures";
import { dmy } from "../lib/format";
import type { OcpiDeal } from "../types";

/**
 * The countersignature — the last act, and the one that closes the deal.
 *
 * ⚠ WHAT THE CUSTOMER SIGNED IS SHOWN FIRST, and the approved original beneath
 *   it. Countersigning without seeing both is signing on trust: the whole value
 *   of this step is somebody comparing the returned pages against the document
 *   that was approved.
 *
 * ⚠ THE RAISER CANNOT DO THIS, even if they are an owner of every other step.
 *   fms_ocpi_record_management_sign has no raiser arm and the storage rule
 *   refuses them the management-signed folder outright — one person holding both
 *   pens is the thing this module exists to stop. The panel does not hand them a
 *   button the database would refuse.
 *
 * ⚠ THERE IS A WAY BACK. An illegible or unsigned page would otherwise leave the
 *   deal parked here for good, with the only escape being to countersign a
 *   document management can see is wrong.
 */
export default function ManagementSignPanel({ deal }: { deal: OcpiDeal }) {
  const s = useOcpiStore();
  const [pages, setPages] = useState<SignedPage[]>(() =>
    signedPages(deal, "management-signed").map(asStored),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "sign" | "return">(null);
  const [error, setError] = useState<string | null>(null);

  if (deal.status !== "awaiting_management_sign") return null;

  const mayAct = s.canActOn("management_signoff");
  const fromCustomer = signedPages(deal, "customer-signed");

  async function sign() {
    setBusy("sign");
    setError(null);
    try {
      const docs = await uploadPages(deal.id, "management-signed", pages, setPages);
      if (docs.length === 0) throw new Error("Attach the countersigned copy first");
      await recordManagementSign(deal.id, docs, note.trim() || undefined);
      setNote("");
      await s.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendBack() {
    setBusy("return");
    setError(null);
    try {
      await returnSignature(deal.id, note.trim());
      setNote("");
      await s.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">What the customer signed</h2>
          <p className="mt-0.5 text-[13.5px] text-grey-2">
            Check it against the approved order confirmation below before countersigning.
          </p>
        </div>
        <SignedDocStrip
          pages={fromCustomer}
          title="Customer-signed copy"
          meta={deal.csAt ? `Filed ${dmy(deal.csAt)}` : undefined}
        />
      </Card>

      <ApprovedOcPreview deal={deal} note="The order confirmation as it was approved." />

      {mayAct ? (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Countersign and close</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              Sign the printed copy, photograph it, and file it here. That completes the
              deal and tells the salesperson.
            </p>
          </div>

          <SignedDocCapture
            label="Countersigned order confirmation"
            hint="Page 1 first. Take the pages one at a time, or choose a scanned PDF."
            value={pages}
            onChange={setPages}
            onError={setError}
            disabled={!!busy}
          />

          <FieldLabel
            label="Note or reason"
            hint="required when sending the signed copy back"
          >
            <TextArea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Page 4 is unsigned — get the customer to initial it"
              disabled={!!busy}
            />
          </FieldLabel>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void sign()} disabled={!!busy || pages.length === 0}>
              {busy === "sign" ? "Filing…" : "Countersign and close"}
            </Button>
            <Button variant="ghost" onClick={() => void sendBack()} disabled={!!busy}>
              {busy === "return" ? "Sending back…" : "Send the signed copy back"}
            </Button>
          </div>

          {error && <p className="text-[13px] text-ryg-red">{error}</p>}
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-[13.5px] text-grey">
            This deal is waiting to be countersigned by management. You are not one of them,
            so there is nothing for you to do here.
          </p>
        </Card>
      )}
    </div>
  );
}
