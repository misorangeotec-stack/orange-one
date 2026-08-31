import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea, Select } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useTravelStore } from "../store";
import { money } from "../lib/format";
import { stillOwed } from "../lib/advance";
import type { Trip } from "../types";

/**
 * Finance's two actions on an advance: agree the figure, then move the money.
 *
 * ⚠ TWO ACTIONS, NOT ONE. §11.1 gives them different owners and different
 *   deadlines — the HOD agrees within a working day, Finance transfers within
 *   two — and in practice the figure is settled days before the payment goes
 *   out. One button would mean an advance could only be agreed by somebody able
 *   to make a transfer.
 *
 * ⚠ THE §11.2 BALANCE IS SHOWN BEFORE THE BUTTON, NOT AFTER IT. The RPC refuses
 *   a second advance while an earlier one is unreconciled; showing the figure
 *   here means the refusal is never a surprise, and Finance can see whose money
 *   is outstanding without leaving the screen.
 */
export default function AdvancePanel({ trip }: { trip: Trip }) {
  const s = useTravelStore();

  const ceiling = s.advanceCeiling(trip);
  const [amount, setAmount] = useState(
    String(trip.advanceApprovedAmount ?? trip.advanceRequestedAmount ?? ""),
  );
  const [note, setNote] = useState(trip.advNote ?? "");
  const [paidOn, setPaidOn] = useState(todayLocalIso());
  const [mode, setMode] = useState("NEFT");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (trip.advanceSkipped || !trip.advanceRequested) return null;
  if (trip.status !== "awaiting_advance") return null;
  if (!s.canActOn("advance", trip)) return null;

  const n = amount.trim() === "" ? null : Number(amount);
  const valid = n !== null && Number.isFinite(n) && n > 0;
  const overCap = valid && ceiling !== null && n > ceiling;

  /*
    ⚠ EXCLUDES THIS TRIP. Its own advance is what is about to be paid, not a
      prior debt — including it would refuse every advance the moment it was
      approved. The SQL does the same with `x.id <> p_trip`.
  */
  const owing = s.outstandingAdvanceFor(trip.travellerId, trip.id);

  const run = async (fn: () => Promise<unknown>, tag: string) => {
    setBusy(tag);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="border-orange/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={SECTION_HEADING_CLASS}>Travel advance</h2>
        <span className="text-[11.5px] text-grey-2">
          asked for {money(trip.advanceRequestedAmount)}
          {ceiling !== null && ` · §11.1 ceiling ${money(ceiling)}`}
        </span>
      </div>

      {owing > 0 && (
        <p className="mt-2 rounded-lg bg-[#FDECEC] px-3 py-2 text-[12.5px] text-ryg-red">
          <strong>{money(owing)} is still unreconciled</strong> for {trip.travellerName} on another
          trip. Policy §11.2 does not allow a second advance until that is settled or recovered, and
          the payment below will be refused.
        </p>
      )}

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <FieldLabel
          label="Amount"
          required
          hint={ceiling !== null ? `at most ${money(ceiling)}` : "no estimate on the trip"}
        >
          <TextInput
            type="number"
            min={0}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Note" hint="why the figure differs from the request, if it does">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={1} />
        </FieldLabel>
      </div>

      {overCap && (
        <p className="mt-2 text-[12.5px] text-ryg-red">
          §11.1 caps this at {money(ceiling)} — 90% of the estimated cost. Either lower the figure,
          or ask the traveller to correct the estimate.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => run(() => s.approveAdvance(trip.id, n as number, note.trim() || null), "approve")}
          disabled={!!busy || !valid || overCap}
        >
          {busy === "approve" ? "Saving…" : "Agree this figure"}
        </Button>
        {trip.advanceApprovedAmount !== null && (
          <span className="text-[12.5px] text-ryg-green">
            ✓ {money(trip.advanceApprovedAmount)} agreed
          </span>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-grey">
          Record the payment
        </div>
        <p className="mt-1 text-[12px] text-grey-2">
          This is what closes the step and sends the trip on to booking. §11.1 wants the money to
          land <strong>before</strong> departure — the due date on this step counts backwards from
          it for exactly that reason.
        </p>

        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <FieldLabel label="Paid on">
            <TextInput type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Mode">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="NEFT">NEFT</option>
              <option value="IMPS">IMPS</option>
              <option value="RTGS">RTGS</option>
              <option value="UPI">UPI</option>
              <option value="Cash">Cash</option>
              <option value="Cheque">Cheque</option>
            </Select>
          </FieldLabel>
          <FieldLabel label="Reference" hint="UTR, cheque number">
            <TextInput value={ref} onChange={(e) => setRef(e.target.value)} />
          </FieldLabel>
        </div>

        {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}

        <div className="mt-3">
          <Button
            onClick={() =>
              run(
                () =>
                  s.disburseAdvance(trip.id, {
                    amount: n as number,
                    paidOn,
                    mode,
                    ref: ref.trim() || null,
                  }),
                "pay",
              )
            }
            disabled={!!busy || !valid || overCap}
          >
            {busy === "pay" ? "Recording…" : `Record ${money(n)} paid`}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Recovering an advance that no claim will ever net off.
 *
 * ⚠ THIS IS THE ONLY WAY OUT FOR A CANCELLED TRIP. The money left, the journey
 *   never happened, and settlement — which is what normally clears an advance —
 *   is unreachable because the trip died before the claim. Without this the
 *   traveller is barred from every future advance by §11.2, for ever, through no
 *   fault of theirs.
 */
export function AdvanceRecoveryPanel({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const owed = stillOwed(trip);

  const [amount, setAmount] = useState(String(owed || ""));
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Only where money is genuinely stranded: paid, unsettled, and the trip is not
  // going to reach a claim.
  const stranded =
    owed > 0 &&
    trip.stAt === null &&
    (trip.status === "cancelled" || trip.status === "rejected");

  if (!stranded) return null;
  if (!(s.canActOn("advance", trip) || s.canActOn("settlement", trip))) return null;

  const n = amount.trim() === "" ? null : Number(amount);
  const valid = n !== null && Number.isFinite(n) && n > 0 && n <= owed;

  return (
    <Card className="border-ryg-red/40 p-4">
      <h2 className={SECTION_HEADING_CLASS}>Recover the advance</h2>
      <p className="mt-1 text-[12.5px] text-grey">
        This trip is {trip.status} and drew {money(trip.advancePaidAmount)}, so no claim is coming to
        net it against. {money(owed)} is still outstanding, and until it is recorded as returned
        §11.2 blocks {trip.travellerName} from any further advance.
      </p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <FieldLabel label="Amount returned" required hint={`at most ${money(owed)}`}>
          <TextInput
            type="number"
            min={0}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label="Reference" hint="cheque number, deduction slip">
          <TextInput value={ref} onChange={(e) => setRef(e.target.value)} />
        </FieldLabel>
      </div>

      {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}

      <div className="mt-3">
        <Button
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await s.recordAdvanceRecovery(trip.id, n as number, ref.trim() || null);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy || !valid}
        >
          {busy ? "Recording…" : "Record the recovery"}
        </Button>
      </div>
    </Card>
  );
}
