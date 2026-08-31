import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea, Select } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { localDateIso } from "@/shared/lib/workingDays";
import { useTravelStore } from "../store";
import { money } from "../lib/format";
import type { Trip } from "../types";

/**
 * Settlement — where the money actually moves, and where the module stops.
 *
 * ⚠ A PAYMENT AND A RECOVERY ARE TWO DIFFERENT EVENTS, and this screen never
 *   asks which one it is. The claim decides: a positive net is paid to the
 *   traveller, a negative net comes back from them. The amount box takes a
 *   POSITIVE figure either way, because a payment recorded as −4,390 is a row
 *   nobody can tie to a bank statement, and because a user asked to type a minus
 *   sign will eventually forget it.
 *
 * ⚠ RECORDING A RECOVERY IS WHAT CLEARS §11.2. The RPC credits
 *   `advance_recovered_amount`, which is the column `outstanding_advance` and
 *   the Employee Exit `travel_advance` clearance row both read. Settling without
 *   it would close the trip while the ledger still said the money was out.
 *
 * ⚠ THE MODULE STOPS AT "FINANCE MARKED IT PAID". Nothing writes to Tally or to
 *   payroll — the ConnectWave mirror is read-only and there is no payroll
 *   integration. This records what Finance did, with a reference it can be
 *   traced to. That was the confirmed scope, and a figure here that no ledger
 *   agrees with would be worse than none.
 */

const num = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const MODES = [
  "NEFT / bank transfer",
  "IMPS / UPI",
  "Cheque",
  "Cash",
  "Payroll deduction",
  "Adjusted against next advance",
];

export default function SettlementPanel({ trip }: { trip: Trip }) {
  const s = useTravelStore();

  const net = trip.netPayable ?? 0;
  const recovering = net < 0;
  const nothingMoves = net === 0;

  const [amount, setAmount] = useState<number | null>(Math.abs(net) || null);
  const [paidOn, setPaidOn] = useState<string>(localDateIso(new Date()));
  const [mode, setMode] = useState<string>(recovering ? "Payroll deduction" : "NEFT / bank transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const editable = trip.status === "awaiting_settlement" && s.canActOn("settlement", trip);

  const settle = async () => {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const st = await s.settleTrip(trip.id, {
        amount: nothingMoves ? null : amount,
        paidOn,
        mode: mode || null,
        reference: reference.trim() || null,
        note: note.trim() || null,
      });
      setDone(`Settled — the trip is ${st}.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- already settled ---------------------------------------------------
  if (trip.stAt) {
    const moved = trip.settledAmount ?? 0;
    return (
      <Card className="p-4">
        <div className="text-[13px] font-semibold text-navy">Settled</div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-grey">
              {moved < 0 ? "Recovered" : moved > 0 ? "Paid" : "Moved"}
            </div>
            <div className="text-[15px] font-semibold text-navy">{money(Math.abs(moved))}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-grey">On</div>
            <div className="text-[15px] font-semibold text-navy">
              {trip.settledAt ? formatDateDMY(trip.settledAt) : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-grey">How</div>
            <div className="text-[15px] font-semibold text-navy">{trip.settledMode ?? "—"}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-grey">Reference</div>
            <div className="text-[15px] font-semibold text-navy">{trip.settledRef ?? "—"}</div>
          </div>
        </div>
        {trip.settledNote && <p className="mt-2 text-[12px] text-grey-2">{trip.settledNote}</p>}
      </Card>
    );
  }

  if (trip.status !== "awaiting_settlement") return null;

  return (
    <Card className="p-4">
      <div className="text-[13px] font-semibold text-navy">Settlement</div>

      <div className="mt-3 rounded-xl bg-[#F6F8FB] p-3">
        <div className="grid gap-2 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-grey">Allowed expenses</span>
            <div className="font-semibold text-navy">
              {money((trip.claimTotal ?? 0) - (trip.disallowedTotal ?? 0))}
            </div>
          </div>
          <div>
            <span className="text-grey">Daily allowance</span>
            <div className="font-semibold text-navy">{money(trip.daTotal)}</div>
          </div>
          <div>
            <span className="text-grey">Less advance outstanding</span>
            <div className="font-semibold text-navy">
              {money(
                Math.max((trip.advancePaidAmount ?? 0) - (trip.advanceRecoveredAmount ?? 0), 0),
              )}
            </div>
          </div>
          <div>
            <span className="text-grey">
              {recovering ? "Recoverable" : nothingMoves ? "Net" : "Payable"}
            </span>
            <div className="text-[17px] font-semibold text-navy">{money(Math.abs(net))}</div>
          </div>
        </div>
        {recovering && (
          <p className="mt-2 text-[11.5px] text-grey-2">
            The advance was larger than the claim and the allowance together, so this money comes
            back. Recording it here is what clears the §11.2 block on the traveller&rsquo;s next
            advance.
          </p>
        )}
        {nothingMoves && (
          <p className="mt-2 text-[11.5px] text-grey-2">
            The claim and the advance come to the same figure, so nothing has to move. Closing it
            still records the date and who did it.
          </p>
        )}
      </div>

      {editable && (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {!nothingMoves && (
              <FieldLabel
                label={recovering ? "Amount recovered" : "Amount paid"}
                required
                hint="A positive figure — the claim decides which way it went"
              >
                <TextInput
                  inputMode="decimal"
                  value={amount ?? ""}
                  onChange={(e) => setAmount(num(e.target.value))}
                />
              </FieldLabel>
            )}
            <FieldLabel label="Date" required>
              <TextInput
                type="date"
                value={paidOn}
                max={localDateIso(new Date())}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel label="How">
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="">—</option>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </FieldLabel>
            {!nothingMoves && (
              <FieldLabel
                label="Reference"
                required
                hint={
                  recovering
                    ? "The payroll run, receipt or voucher"
                    : "The UTR, cheque number or voucher"
                }
              >
                <TextInput value={reference} onChange={(e) => setReference(e.target.value)} />
              </FieldLabel>
            )}
          </div>

          <div className="mt-3">
            <FieldLabel
              label="Note"
              hint={
                nothingMoves
                  ? "Optional"
                  : `Required only if the figure differs from the ${money(Math.abs(net))} above`
              }
            >
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>
          </div>

          {err && <p className="mt-3 text-[12.5px] font-semibold text-[#B3261E]">{err}</p>}
          {done && <p className="mt-3 text-[12.5px] text-grey">{done}</p>}

          <div className="mt-3">
            <Button onClick={settle} disabled={busy}>
              {busy
                ? "Working…"
                : nothingMoves
                  ? "Close this trip"
                  : recovering
                    ? "Record the recovery and close"
                    : "Mark paid and close"}
            </Button>
          </div>
          <p className="mt-2 text-[11.5px] text-grey-2">
            This records what Finance did. Nothing is written to Tally or to payroll — that stays a
            manual step, by design.
          </p>
        </>
      )}

      {!editable && (
        <p className="mt-3 text-[12.5px] text-grey-2">
          Waiting on Finance to release the payment. Whoever is named on the Settlement step in
          Settings can record it.
        </p>
      )}
    </Card>
  );
}
