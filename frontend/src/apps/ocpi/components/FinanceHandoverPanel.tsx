import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import SignedDocStrip from "./SignedDocStrip";
import { StepOwnersWarning } from "./SetupWarnings";
import { useOcpiStore } from "../store";
import { recordFinanceHandover } from "../data/ocpiWrites";
import { signedPages } from "../lib/signatures";
import { dmy } from "../lib/format";
import type { OcpiDeal } from "../types";

/**
 * Hand the countersigned contract over to Finance.
 *
 * ⚠ THIS STEP EXISTS BECAUSE THE PAPER WENT MISSING. Countersigning used to
 *   close the deal, which recorded that the contract had been signed and nothing
 *   at all about where it then went. The client asked for both halves of the
 *   handover on record: who handed it over, and who accepted it. This is the
 *   first half.
 *
 * ⚠ THE SIGNED PAGES ARE SHOWN HERE, not just named. Whoever is carrying the
 *   contract across should be able to check they are carrying all of it — a
 *   five-page contract handed over as three pages is exactly the failure this
 *   step is meant to catch, and the strip is where it shows.
 *
 * ⚠ IT SELF-HIDES. Rendered unconditionally by the deal page and shows nothing
 *   unless the deal is actually waiting to be handed over.
 */
export default function FinanceHandoverPanel({ deal }: { deal: OcpiDeal }) {
  const s = useOcpiStore();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (deal.status !== "awaiting_finance_handover") return null;

  const mayAct = s.canActOn("finance_handover") || (deal.raisedBy === s.userId && s.canEdit);

  const pages = [
    { slot: "customer-signed" as const, title: "Signed by the customer", at: deal.csAt },
    { slot: "management-signed" as const, title: "Countersigned", at: deal.msAt },
  ]
    .map((set) => ({ ...set, docs: signedPages(deal, set.slot) }))
    .filter((set) => set.docs.length > 0);

  async function handOver() {
    setBusy(true);
    setError(null);
    try {
      await recordFinanceHandover(deal.id, note.trim() || undefined);
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
      <StepOwnersWarning step="finance_handover" />
      {pages.length > 0 && (
        <Card className="space-y-5 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">What is being handed over</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              Check every page is here before you walk it across — these scans are the one thing on
              this deal that cannot be produced again.
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

      {mayAct ? (
        <Card className="space-y-3 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Hand it over to Finance</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              Recording this puts your name and today&rsquo;s date against the handover, and asks
              Finance to confirm they have it. Somebody in Finance has to do that — you cannot
              confirm your own delivery.
            </p>
          </div>

          <FieldLabel label="Note" hint="optional — who you gave it to, or anything Finance should know">
            <TextArea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Handed to the accounts desk on the second floor"
              disabled={busy}
            />
          </FieldLabel>

          <div>
            <Button onClick={() => void handOver()} disabled={busy}>
              {busy ? "Recording…" : "Record the handover"}
            </Button>
          </div>

          {error && <p className="text-[13px] text-ryg-red">{error}</p>}
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-[13.5px] text-grey">
            This contract is waiting to be handed over to Finance. That is the salesperson&rsquo;s
            job, so there is nothing for you to do here.
          </p>
        </Card>
      )}
    </div>
  );
}
