import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useTravelStore } from "../store";
import { money } from "../lib/format";
import { travelDocUrl } from "../data/travelBookingWrites";
import type { Trip, ClaimLine, DaDay } from "../types";

/**
 * Finance verification — §11.1 step 8.
 *
 * ⚠ FINANCE IS NOT A SECOND AUTHOR OF THE CAPS. Every cap in §7, §9, §10 and
 *   §15 was applied before the claim reached this screen, and `allowedAmount`
 *   is never editable. What Finance records is a DIFFERENT figure beside it,
 *   with a reason — lower for a judgement no rule can make ("that dinner was not
 *   business"), higher for a §7.3 exception once the evidence is in the file.
 *   The two sit side by side on the row, and the gap between them IS the Policy
 *   Exceptions report.
 *
 * ⚠ CLEARING IS OFFERED SEPARATELY FROM SETTLING AT ZERO, because they mean
 *   opposite things. Zero is a decision that needs a reason; clearing is undoing
 *   one and puts the engine's answer back.
 *
 * ⚠ THE ALLOWANCE IS EDITABLE PER DAY, NOT IN TOTAL. §8 computes a figure per
 *   calendar day with a reason on each row, and a lump-sum override would throw
 *   that away — leaving a total nobody could reconcile against the days that
 *   produced it.
 */

const num = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** One row of the claim, with Finance's own figure beside the engine's. */
function LineRow({
  line,
  categoryName,
  cityName,
  refused,
  editable,
  onSave,
  onOpenDoc,
}: {
  line: ClaimLine;
  categoryName: string;
  cityName: string;
  /**
   * The category refuses outright under §15.
   *
   * ⚠ THIS IS NOT A CAP AND HAS NO EXCEPTION PATH. §7.3 exists so a cap can be
   *   exceeded on evidence; nothing lets a refused category be paid, and §15
   *   says so in as many words — "regardless of band or whether a client was
   *   present". So the control is not offered at all, and the RPC refuses it
   *   too: without that, the one rule the policy states absolutely would be the
   *   one any reviewer could set aside with a sentence.
   */
  refused: boolean;
  editable: boolean;
  onSave: (amount: number | null, reason: string | null) => Promise<void>;
  onOpenDoc: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(line.financeAmount);
  const [reason, setReason] = useState(line.financeReason ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const settled = line.financeAmount ?? line.allowedAmount ?? 0;
  const changed = line.financeAmount !== null;

  const run = async (a: number | null, r: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      await onSave(a, r);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-navy">
            {categoryName}
            {line.vendor ? <span className="font-normal text-grey-2"> · {line.vendor}</span> : null}
          </div>
          <div className="text-[11.5px] text-grey-2">
            {line.spentOn ? formatDateDMY(line.spentOn) : "—"} · {cityName}
            {line.invoiceNo ? ` · ${line.invoiceNo}` : ""}
            {line.gstAmount > 0 ? ` · GST ${money(line.gstAmount)}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-grey">Settles at</div>
          <div className="text-[15px] font-semibold text-navy">{money(settled)}</div>
          <div className="text-[11px] text-grey-2">
            claimed {money(line.amount)} · engine {money(line.allowedAmount)}
          </div>
        </div>
      </div>

      {line.disallowReason && (
        <p className="mt-2 rounded-lg bg-[#FDECEC] px-2.5 py-1.5 text-[11.5px] text-navy">
          {line.disallowReason}
        </p>
      )}
      {changed && (
        <p className="mt-2 rounded-lg bg-[#FFF7E6] px-2.5 py-1.5 text-[11.5px] text-navy">
          <span className="font-semibold">Finance settled this at {money(line.financeAmount)}</span>
          {" — "}
          {line.financeReason}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {line.docPath ? (
          <button
            type="button"
            className="text-[12px] font-semibold text-orange underline"
            onClick={() => onOpenDoc(line.docPath!)}
          >
            View receipt
          </button>
        ) : line.hasReceipt ? (
          <span className="text-[12px] text-grey-2">Receipt on paper</span>
        ) : (
          <span className="text-[12px] text-ryg-amber">No receipt</span>
        )}
        {editable && !open && !refused && (
          <button
            type="button"
            className="ml-auto text-[12px] font-semibold text-navy underline"
            onClick={() => setOpen(true)}
          >
            {changed ? "Change this figure" : "Settle at a different figure"}
          </button>
        )}
        {editable && refused && (
          <span className="ml-auto text-[11.5px] text-grey-2">
            Nothing to decide — §15 refuses this outright
          </span>
        )}
      </div>

      {open && editable && (
        <div className="mt-3 rounded-lg bg-[#F6F8FB] p-3">
          <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <FieldLabel label="Settle at" hint={`Never above the ${money(line.amount)} claimed`}>
              <TextInput
                inputMode="decimal"
                value={amount ?? ""}
                onChange={(e) => setAmount(num(e.target.value))}
              />
            </FieldLabel>
            <FieldLabel label="Reason" required>
              <TextInput
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What the traveller will be told, and what the exceptions report prints"
              />
            </FieldLabel>
          </div>
          {err && <p className="mt-2 text-[12px] font-semibold text-[#B3261E]">{err}</p>}
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              className="h-8 px-3 text-[12px]"
              disabled={busy || amount === null || !reason.trim()}
              onClick={() => run(amount, reason.trim())}
            >
              {busy ? "Saving…" : "Save this figure"}
            </Button>
            {changed && (
              <Button
                variant="outline"
                className="h-8 px-3 text-[12px]"
                disabled={busy}
                onClick={() => run(null, null)}
              >
                Put the engine&rsquo;s figure back
              </Button>
            )}
            <Button
              variant="ghost"
              className="h-8 px-3 text-[12px]"
              onClick={() => {
                setOpen(false);
                setAmount(line.financeAmount);
                setReason(line.financeReason ?? "");
              }}
            >
              Never mind
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One day of the allowance, overridable with a reason. */
function DayRow({
  day,
  editable,
  onSave,
}: {
  day: DaDay;
  editable: boolean;
  onSave: (amount: number | null, reason: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(day.overrideAmount);
  const [reason, setReason] = useState(day.overrideReason ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (a: number | null, r: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      await onSave(a, r);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-line/60 py-2 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[12.5px] text-navy">
          <span className="font-semibold">{formatDateDMY(day.day)}</span>
          <span className="text-grey-2">
            {" "}
            · {day.cityTier ? `Tier ${day.cityTier}` : "tier not resolved"} ·{" "}
            {Number(day.factor) === 1 ? "full" : `×${Number(day.factor)}`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-navy">
            {money(day.overrideAmount ?? day.amount)}
          </span>
          {editable && !open && (
            <button
              type="button"
              className="text-[11.5px] font-semibold text-navy underline"
              onClick={() => setOpen(true)}
            >
              {day.overrideAmount !== null ? "Change" : "Override"}
            </button>
          )}
        </div>
      </div>
      {day.factorReason && <p className="text-[11.5px] text-grey-2">{day.factorReason}</p>}
      {day.overrideReason && (
        <p className="mt-1 rounded bg-[#FFF7E6] px-2 py-1 text-[11.5px] text-navy">
          <span className="font-semibold">Finance:</span> {day.overrideReason}
        </p>
      )}

      {open && editable && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)_auto]">
          <TextInput
            inputMode="decimal"
            value={amount ?? ""}
            placeholder="Amount"
            onChange={(e) => setAmount(num(e.target.value))}
          />
          <TextInput
            value={reason}
            placeholder="Why this day differs from the computed figure"
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              className="h-8 px-3 text-[12px]"
              disabled={busy || amount === null || !reason.trim()}
              onClick={() => run(amount, reason.trim())}
            >
              Save
            </Button>
            {day.overrideAmount !== null && (
              <Button
                variant="outline"
                className="h-8 px-3 text-[12px]"
                disabled={busy}
                onClick={() => run(null, null)}
              >
                Reset
              </Button>
            )}
            <Button variant="ghost" className="h-8 px-3 text-[12px]" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {err && <p className="sm:col-span-3 text-[12px] font-semibold text-[#B3261E]">{err}</p>}
        </div>
      )}
    </div>
  );
}

export default function FinanceReviewPanel({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const lines = s.claimLinesOf(trip.id);
  const daDays = s.daDaysOf(trip.id);

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const editable =
    trip.status === "awaiting_finance_review" && s.canActOn("finance_review", trip);

  const catName = useMemo(() => {
    const m = new Map(s.expenseCategories.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "—") : "—");
  }, [s.expenseCategories]);
  const catRefuses = useMemo(() => {
    const m = new Map(s.expenseCategories.map((c) => [c.id, !c.reimbursable]));
    return (id: string | null) => (id ? (m.get(id) ?? false) : false);
  }, [s.expenseCategories]);
  const cityName = useMemo(() => {
    const m = new Map(s.cities.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "—") : "from the itinerary");
  }, [s.cities]);

  const openDoc = async (path: string) => {
    try {
      window.open(await travelDocUrl(path), "_blank", "noopener");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const finish = async () => {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const st = await s.completeFinanceReview(trip.id, note.trim() || null);
      setDone(`Verified — the trip is now ${st.replace(/_/g, " ")}.`);
      setNote("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const outstandingAdvance = Math.max(
    (trip.advancePaidAmount ?? 0) - (trip.advanceRecoveredAmount ?? 0),
    0,
  );
  const net = trip.netPayable ?? 0;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="text-[13px] font-semibold text-navy">Finance verification</div>
        <p className="mt-0.5 text-[11.5px] text-grey-2">
          Every policy cap was applied before this claim reached you, and each line already carries
          the sentence saying which rule bit. What is left is the judgement no rule can make — and a
          figure you change here never overwrites the engine&rsquo;s, it sits beside it.
        </p>

        <div className="mt-3 space-y-3">
          {lines.map((l) => (
            <LineRow
              key={l.id}
              line={l}
              categoryName={catName(l.categoryId)}
              cityName={cityName(l.cityId)}
              refused={catRefuses(l.categoryId)}
              editable={editable}
              onOpenDoc={openDoc}
              onSave={async (a, r) => {
                await s.setLineSettlement(l.id, a, r);
              }}
            />
          ))}
          {lines.length === 0 && (
            <p className="rounded-xl border border-dashed border-line p-4 text-[12.5px] text-grey-2">
              No expenses were claimed on this trip. Only the allowance and the advance are being
              settled.
            </p>
          )}
        </div>
      </Card>

      {daDays.length > 0 && (
        <Card className="p-4">
          <div className="text-[13px] font-semibold text-navy">Daily allowance (§8)</div>
          <p className="mt-0.5 text-[11.5px] text-grey-2">
            Overridable a day at a time, never in total — a lump sum would leave a figure nobody
            could reconcile against the days that produced it.
          </p>
          <div className="mt-2">
            {daDays.map((d) => (
              <DayRow
                key={d.id}
                day={d}
                editable={editable}
                onSave={async (a, r) => {
                  await s.overrideDaDay(d.id, a, r);
                }}
              />
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-grey">Claimed</div>
            <div className="text-[15px] font-semibold text-navy">{money(trip.claimTotal)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-grey">Not allowed</div>
            <div className="text-[15px] font-semibold text-navy">{money(trip.disallowedTotal)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-grey">Allowance</div>
            <div className="text-[15px] font-semibold text-navy">{money(trip.daTotal)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-grey">Advance outstanding</div>
            <div className="text-[15px] font-semibold text-navy">{money(outstandingAdvance)}</div>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-[#F6F8FB] p-3">
          <div className="text-[11px] uppercase tracking-wide text-grey">
            {net < 0 ? "Recoverable from the traveller" : "Payable to the traveller"}
          </div>
          <div className="text-[20px] font-semibold text-navy">{money(Math.abs(net))}</div>
        </div>

        {editable && (
          <>
            <div className="mt-3">
              <FieldLabel label="Note" hint="Optional — it rides on the trip's history">
                <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </FieldLabel>
            </div>
            {err && <p className="mt-3 text-[12.5px] font-semibold text-[#B3261E]">{err}</p>}
            {done && <p className="mt-3 text-[12.5px] text-grey">{done}</p>}
            <div className="mt-3">
              <Button onClick={finish} disabled={busy}>
                {busy ? "Working…" : "Verified — send to settlement"}
              </Button>
            </div>
          </>
        )}
        {!editable && trip.status === "awaiting_finance_review" && (
          <p className="mt-3 text-[12.5px] text-grey-2">
            This claim is with Finance. Whoever is named on the Finance step in Settings can verify
            it.
          </p>
        )}
      </Card>
    </div>
  );
}
