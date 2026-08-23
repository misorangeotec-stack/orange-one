import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import ApprovedOcPreview from "./ApprovedOcPreview";
import SignedDocCapture, { asStored, uploadPages, type SignedPage } from "./SignedDocCapture";
import { useOcpiStore } from "../store";
import { recordCustomerSign } from "../data/ocpiWrites";
import { signedPages } from "../lib/signatures";
import { dmy } from "../lib/format";
import type { OcpiDeal } from "../types";

/**
 * Print it, get it signed, file the signed copy.
 *
 * ⚠ THE DOCUMENT IS ON THE SAME SCREEN AS THE UPLOAD, deliberately. The person
 *   doing this prints from here, walks it to the customer, and comes back to the
 *   same page to photograph what they got back. Splitting print and upload
 *   across two screens is how the second half stops happening.
 *
 * ⚠ IT SELF-HIDES. Rendered unconditionally by the deal page and shows nothing
 *   unless the deal is actually waiting for a customer signature, so the page
 *   offers exactly one thing to do — or none.
 *
 * ⚠ THE SALESPERSON WHO RAISED THE DEAL MAY FILE IT even without owning the
 *   step. They are the one holding the paper. The database says the same in
 *   fms_ocpi_record_customer_sign, and that is the real boundary.
 */
export default function CustomerSignPanel({ deal }: { deal: OcpiDeal }) {
  const s = useOcpiStore();
  const [pages, setPages] = useState<SignedPage[]>(() =>
    signedPages(deal, "customer-signed").map(asStored),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (deal.status !== "awaiting_customer_sign") return null;

  const mayAct =
    s.canActOn("customer_signoff") || (deal.raisedBy === s.userId && s.canEdit);
  const sentBack = deal.reworkStage === "management_signoff" && !!deal.reworkReason;

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const docs = await uploadPages(deal.id, "customer-signed", pages, setPages);
      if (docs.length === 0) throw new Error("Attach the signed order confirmation first");
      await recordCustomerSign(deal.id, docs, note.trim() || undefined);
      setNote("");
      await s.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {sentBack && (
        <Card className="border-ryg-yellow/50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
            Sent back by management{deal.reworkAt ? ` on ${dmy(deal.reworkAt)}` : ""}
          </p>
          <p className="mt-1 text-[13.5px] text-navy">{deal.reworkReason}</p>
        </Card>
      )}

      <ApprovedOcPreview
        deal={deal}
        note="Print this, get the customer to sign it, then photograph every page below."
      />

      {mayAct ? (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">File the signed copy</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              Photograph every page the customer signed. Filing it tells management to
              countersign.
            </p>
          </div>

          <SignedDocCapture
            label="Signed order confirmation"
            hint="Page 1 first. Take the pages one at a time, or choose a scanned PDF."
            value={pages}
            onChange={setPages}
            onError={setError}
            disabled={busy}
          />

          <FieldLabel label="Note" hint="optional — anything management should know">
            <TextArea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Signed by the director; page 3 initialled only"
              disabled={busy}
            />
          </FieldLabel>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void record()} disabled={busy || pages.length === 0}>
              {busy ? "Filing…" : "Record the signed copy"}
            </Button>
            {pages.length === 0 && (
              <span className="text-[12.5px] text-grey-2">Attach at least one page.</span>
            )}
          </div>

          {error && <p className="text-[13px] text-ryg-red">{error}</p>}
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-[13.5px] text-grey">
            This deal is waiting for the customer&rsquo;s signature. Filing it is the
            salesperson&rsquo;s job, so there is nothing for you to do here.
          </p>
        </Card>
      )}
    </div>
  );
}
