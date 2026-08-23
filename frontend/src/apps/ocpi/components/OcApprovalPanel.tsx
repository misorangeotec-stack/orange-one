import { useEffect, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import DocumentPreview from "./DocumentPreview";
import { CompanyProfileWarning } from "./SetupWarnings";
import { useOcpiStore } from "../store";
import { decideOc } from "../data/ocpiWrites";
import { ocFileName, ocPdfBlob } from "../lib/ocPdf";
import type { OcpiDeal } from "../types";

/**
 * Management's decision on the order confirmation — with the document in front
 * of them.
 *
 * ⚠ THE DOCUMENT IS RENDERED, NOT SUMMARISED. This is the contract the customer
 *   signs; approving it from a list of field values would mean confirming
 *   something nobody had read. The PDF is built from the SAME machine template
 *   and deal the submitted version used, so what the approver sees is what was
 *   filed.
 *
 * ⚠ APPROVING SENDS IT TO THE CUSTOMER. The next step is printing it and
 *   collecting a signature, so the copy says so rather than "approved".
 */
export default function OcApprovalPanel({ deal }: { deal: OcpiDeal }) {
  const s = useOcpiStore();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "reject" | "rework">(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [rendering, setRendering] = useState(false);

  const machine = s.machineById(deal.machineId);
  const waiting = deal.status === "awaiting_oc_approval";
  const mayAct = s.canActOn("oc_approval");
  const isOwnDeal = deal.raisedBy === s.userId;
  const owners = s.ownersOf("oc_approval");
  const soleApprover = owners.length === 1 && owners[0] === s.userId;

  useEffect(() => {
    if (!waiting || !machine) return;
    let cancelled = false;
    setRendering(true);
    void (async () => {
      try {
        const blob = await ocPdfBlob({
          deal,
          machine,
          sections: s.sectionsFor(machine.id),
          profile: s.profileFor(deal.companyId),
          validityDays: s.config.quotationValidityDays,
        });
        if (!cancelled) setPdf(blob);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id, deal.updatedAt, machine?.id, waiting]);

  if (!waiting) return null;

  async function decide(decision: "approve" | "reject" | "rework") {
    setBusy(decision);
    setError(null);
    try {
      await decideOc(deal.id, decision, note.trim() || undefined);
      setNote("");
      await s.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const blockedBySelf = isOwnDeal && !soleApprover;

  return (
    <div className="space-y-4">
      {/*
        The approver is the last person who can stop a contract going out under
        the wrong company’s bank details, so the notice sits above the document
        rather than below it.
      */}
      <CompanyProfileWarning companyId={deal.companyId} />
      <DocumentPreview
        blob={pdf}
        fileName={ocFileName(deal)}
        title={deal.ocNo ?? "Order confirmation"}
        note="Read it before deciding — this is what the customer signs."
        busy={rendering}
      />

      {mayAct ? (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Your decision</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              {blockedBySelf
                ? "You raised this deal, so somebody else has to confirm it."
                : "Confirming sends it to the salesperson to print and get signed by the customer."}
            </p>
          </div>

          {!blockedBySelf && (
            <>
              <FieldLabel label="Reason or note" hint="required when rejecting or sending back">
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
                  {busy === "approve" ? "Confirming…" : "Confirm"}
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
      ) : (
        <Card className="p-4">
          <p className="text-[13.5px] text-grey">
            This order confirmation is waiting for management. You are not one of the approvers, so
            there is nothing for you to do here.
          </p>
        </Card>
      )}
    </div>
  );
}
