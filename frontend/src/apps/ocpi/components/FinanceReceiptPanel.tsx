import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import SignedDocStrip from "./SignedDocStrip";
import { StepOwnersWarning } from "./SetupWarnings";
import { useOcpiStore } from "../store";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { recordFinanceReceipt } from "../data/ocpiWrites";
import { signedPages } from "../lib/signatures";
import { dmy } from "../lib/format";
import type { OcpiDeal } from "../types";

/**
 * Finance confirms the signed contract has reached them — and the deal closes.
 *
 * ⚠ THE SECOND HALF OF THE HANDOVER, and the reason there are two steps rather
 *   than one. A salesperson recording "I handed it over" records an intention;
 *   somebody in Finance recording "I have it" records a fact, and only the
 *   second one closes the deal.
 *
 * ⚠ THE PERSON WHO HANDED IT OVER CANNOT CONFIRM RECEIVING IT. The database
 *   refuses it outright; this says so on screen rather than letting somebody
 *   press a button that will fail.
 *
 * ⚠ IT SELF-HIDES, like every other step panel on the deal page.
 */
export default function FinanceReceiptPanel({ deal }: { deal: OcpiDeal }) {
  const s = useOcpiStore();
  const personById = useOrgPersonById();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (deal.status !== "awaiting_finance_receipt") return null;

  const mayAct = s.canActOn("finance_receipt");
  const handedOverByMe = !!deal.fhBy && deal.fhBy === s.userId;
  const handedOverBy = deal.fhBy ? personById(deal.fhBy)?.name ?? "Someone" : "Someone";

  const pages = [
    { slot: "customer-signed" as const, title: "Signed by the customer", at: deal.csAt },
    { slot: "management-signed" as const, title: "Countersigned", at: deal.msAt },
  ]
    .map((set) => ({ ...set, docs: signedPages(deal, set.slot) }))
    .filter((set) => set.docs.length > 0);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await recordFinanceReceipt(deal.id, note.trim() || undefined);
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
      <StepOwnersWarning step="finance_receipt" />
      <Card className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
          Handed over to Finance
        </p>
        <p className="mt-1 text-[13.5px] text-navy">
          {handedOverBy}
          {deal.fhAt ? ` on ${dmy(deal.fhAt)}` : ""}.
        </p>
      </Card>

      {pages.length > 0 && (
        <Card className="space-y-5 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">What you should be holding</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              Check the paper on your desk against these scans before you confirm. Confirming closes
              the deal.
            </p>
          </div>
          {pages.map((set) => (
            <SignedDocStrip
              key={set.slot}
              pages={set.docs}
              title={set.title}
              meta={set.at ? `Filed ${dmy(set.at)}` : undefined}
            />
          ))}
        </Card>
      )}

      {mayAct && !handedOverByMe ? (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Confirm Finance has it</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              This puts your name against receiving the signed contract, and completes the deal.
            </p>
          </div>

          <FieldLabel label="Note" hint="optional — where it has been filed, or anything unusual">
            <TextArea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Filed in the 2026-27 contracts folder"
              disabled={busy}
            />
          </FieldLabel>

          <div>
            <Button onClick={() => void confirm()} disabled={busy}>
              {busy ? "Confirming…" : "Confirm receipt and complete"}
            </Button>
          </div>

          {error && <p className="text-[13px] text-ryg-red">{error}</p>}
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-[13.5px] text-grey">
            {handedOverByMe
              ? "You handed this contract over, so somebody in Finance has to confirm receiving it. A handover with one name on both halves records nothing."
              : "This contract is waiting for Finance to confirm they have it. You are not one of them, so there is nothing for you to do here."}
          </p>
        </Card>
      )}
    </div>
  );
}
