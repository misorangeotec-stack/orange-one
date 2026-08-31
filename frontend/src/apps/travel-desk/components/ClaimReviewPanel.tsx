import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useTravelStore } from "../store";
import { money } from "../lib/format";
import { travelDocUrl } from "../data/travelBookingWrites";
import DaPanel from "./DaPanel";
import type { Trip } from "../types";

/**
 * The reporting manager's decision on a filed claim.
 *
 * ⚠ THE REVIEWER IS NOT ASKED TO CHECK THE ARITHMETIC. Every cap in §7, §9, §10
 *   and §15 has already been applied by the engine, and each line already
 *   carries the sentence saying which rule bit. What a human is here for is the
 *   judgement no rule can make — was the journey necessary, is the business
 *   meal plausible, does the §7.3 exception actually hold. So this screen leads
 *   with what was disallowed and why, rather than with a form to re-add columns.
 *
 * ⚠ A RETURN CLEARS `cl_at` SERVER-SIDE, which is what puts the trip back on the
 *   claim step and makes the lines editable again. There is no separate
 *   "reopened" state to get out of step with the router — the one router reads
 *   the same field either way.
 *
 * ⚠ NOBODY APPROVES THEIR OWN CLAIM, INCLUDING A COORDINATOR OR AN ADMIN. The
 *   RPC refuses it on the TRAVELLER, not on who filed it, and this hides the
 *   buttons so the refusal is not first met on a button press.
 */
export default function ClaimReviewPanel({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const lines = s.claimLinesOf(trip.id);
  const daDays = s.daDaysOf(trip.id);

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const mine = s.canActOn("claim_review", trip);
  const ownClaim = trip.travellerId === s.userId;
  const canDecide = mine && !ownClaim && trip.status === "awaiting_claim_review";

  const catName = useMemo(() => {
    const m = new Map(s.expenseCategories.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "—") : "—");
  }, [s.expenseCategories]);

  const cityName = useMemo(() => {
    const m = new Map(s.cities.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "—") : "—");
  }, [s.cities]);

  const decide = async (decision: "approve" | "return") => {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const st = await s.decideClaim(trip.id, decision, note.trim() || null);
      setDone(
        decision === "approve"
          ? `Approved — the claim is now ${st.replace(/_/g, " ")}.`
          : "Sent back to the traveller with your note.",
      );
      setNote("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (path: string) => {
    try {
      window.open(await travelDocUrl(path), "_blank", "noopener");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const disallowed = lines.filter((l) => (l.disallowReason ?? "").length > 0);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-navy">Claim filed</div>
            <p className="mt-0.5 text-[11.5px] text-grey-2">
              {trip.clAt ? `Filed on ${formatDateDMY(trip.clAt)}` : "Not yet filed"} · travelled{" "}
              {formatDateDMY(trip.actualDepartureDate ?? trip.plannedDepartureDate)} to{" "}
              {formatDateDMY(trip.actualReturnDate ?? trip.plannedReturnDate)}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-grey">
              {(trip.netPayable ?? 0) < 0 ? "Recoverable" : "Payable"}
            </div>
            <div className="text-[17px] font-semibold text-navy">
              {money(Math.abs(trip.netPayable ?? 0))}
            </div>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-grey">
                <th className="py-1.5 pr-3 font-semibold">Date</th>
                <th className="py-1.5 pr-3 font-semibold">Category</th>
                <th className="py-1.5 pr-3 font-semibold">City</th>
                <th className="py-1.5 pr-3 font-semibold">Vendor</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Claimed</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Allowed</th>
                <th className="py-1.5 pr-3 font-semibold">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-line/60">
                  <td className="py-2 pr-3 whitespace-nowrap text-navy">
                    {l.spentOn ? formatDateDMY(l.spentOn) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-navy">{catName(l.categoryId)}</td>
                  <td className="py-2 pr-3 text-grey-2">{cityName(l.cityId)}</td>
                  <td className="py-2 pr-3 text-grey-2">{l.vendor ?? "—"}</td>
                  <td className="py-2 pr-3 text-right text-grey-2">{money(l.amount)}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-navy">
                    {money(l.allowedAmount)}
                  </td>
                  <td className="py-2 pr-3">
                    {l.docPath ? (
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-orange underline"
                        onClick={() => void openDoc(l.docPath!)}
                      >
                        View
                      </button>
                    ) : l.hasReceipt ? (
                      <span className="text-grey-2">On paper</span>
                    ) : (
                      <span className="text-ryg-amber">None</span>
                    )}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-[12.5px] text-grey-2">
                    No expenses were claimed. The allowance below is what is being settled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {disallowed.length > 0 && (
          <div className="mt-3 rounded-xl bg-[#FDECEC] p-3">
            <div className="text-[12px] font-semibold text-navy">
              {money(trip.disallowedTotal)} was not allowed under policy
            </div>
            <ul className="mt-1.5 space-y-1">
              {disallowed.map((l) => (
                <li key={l.id} className="text-[11.5px] text-navy">
                  <span className="font-semibold">
                    {l.spentOn ? formatDateDMY(l.spentOn) : "—"} · {catName(l.categoryId)}
                  </span>{" "}
                  — {l.disallowReason}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-grey-2">
              These have already been applied. Approving does not reinstate them; a genuine policy
              exception is Finance&rsquo;s to record at the next step.
            </p>
          </div>
        )}
      </Card>

      <DaPanel frozen={daDays} overrideTotal={trip.daTotal} />

      {canDecide && (
        <Card className="p-4">
          <div className="text-[13px] font-semibold text-navy">Your decision</div>
          <div className="mt-3">
            <FieldLabel
              label="Note"
              hint="Required to send it back — a claim returned without a reason leaves nothing to act on"
            >
              <TextArea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What needs fixing, or why you are approving it as it stands"
              />
            </FieldLabel>
          </div>

          {err && <p className="mt-3 text-[12.5px] font-semibold text-[#B3261E]">{err}</p>}
          {done && <p className="mt-3 text-[12.5px] text-grey">{done}</p>}

          <div className="mt-3 flex flex-wrap gap-3">
            <Button onClick={() => decide("approve")} disabled={busy}>
              {busy ? "Working…" : "Approve and send to Finance"}
            </Button>
            <Button variant="outline" onClick={() => decide("return")} disabled={busy}>
              Send back to the traveller
            </Button>
          </div>
        </Card>
      )}

      {ownClaim && trip.status === "awaiting_claim_review" && (
        <Card className="p-4">
          <p className="text-[12.5px] text-grey-2">
            This is your own claim, so somebody else has to decide it — your reporting manager, or
            whoever is named on this step in Settings.
          </p>
        </Card>
      )}
    </div>
  );
}
