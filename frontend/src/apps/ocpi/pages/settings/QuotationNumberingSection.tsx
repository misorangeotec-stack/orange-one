import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../../store";
import { fetchQuotationCounter } from "../../data/ocpiFetch";
import { quotationNoFor } from "../../lib/format";

/**
 * Where the quotation series stands, and the one control that can move it.
 *
 * ⚠ THIS IS THE ONLY IRREVERSIBLE NUMBER IN THE MODULE. A quotation number goes
 *   out on a document a customer keeps. The series did not start here — `QT-M0023`
 *   was issued through the Microsoft form long before any of this existed — so
 *   the counter was seeded at 23 off a single scanned submission. 23 is a FLOOR,
 *   not a confirmed maximum. If the paper series actually reached 41, the first
 *   eight quotations raised here re-issue numbers customers already hold, and
 *   nothing after the fact can take them back.
 *
 * ⚠ SO THE FIGURE IS ASKED FOR, NOT ASSUMED. Until somebody confirms it, every
 *   screen that can mint a number says the series is unchecked (see
 *   SetupWarnings.tsx). Confirming is a deliberate act by a named person, and it
 *   is recorded — this is the setting most likely to be argued about later.
 *
 * ⚠ FORWARD-ONLY, AND THE DATABASE IS WHAT ENFORCES IT. Raising the number only
 *   ever skips values, which costs nothing. Lowering it is the single move that
 *   can duplicate a number, so `fms_ocpi_set_quotation_series` refuses it — the
 *   form below merely explains the refusal early.
 *
 * ⚠ THE COUNTER IS READ FRESH, NOT FROM THE STORE. It moves every time anybody
 *   generates a quotation; a cached copy would let an admin confirm against a
 *   figure that had already been passed.
 */
export default function QuotationNumberingSection() {
  const s = useOcpiStore();
  const series = s.config.quotationSeries;

  const {
    data: counter,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["ocpiQuotationCounter"],
    queryFn: fetchQuotationCounter,
    enabled: s.isAdmin,
    staleTime: 0,
  });

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const current = counter ?? null;
  const typed = value.trim() === "" ? null : Number(value.trim());
  const invalid =
    typed !== null && (!Number.isInteger(typed) || typed < 0 || typed > 999999);
  const goingBackwards = typed !== null && current !== null && !invalid && typed < current;

  async function save() {
    if (typed === null || invalid || goingBackwards) return;
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const now = await s.setQuotationSeries(typed);
      await refetch();
      setValue("");
      setSaved(`Confirmed. The next quotation will be ${quotationNoFor(now + 1)}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl space-y-4 p-5">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Quotation numbering</h3>
        <p className="mt-1 text-[12.5px] text-grey">
          Quotations continue the series that was already running on paper. Enter the{" "}
          <b>last number that was used before this module went live</b> &mdash; the next quotation
          raised here will be the one after it.
        </p>
      </div>

      <div className="rounded-md border border-line bg-page px-3.5 py-3">
        {!s.isAdmin ? (
          <p className="text-[12.5px] text-grey-2">Admins only.</p>
        ) : isLoading ? (
          <p className="text-[12.5px] text-grey-2">Reading the counter&hellip;</p>
        ) : (
          <>
            <p className="text-[13px] text-navy">
              Last number issued:{" "}
              <span className="font-semibold">
                {current === null ? "none yet" : quotationNoFor(current)}
              </span>
            </p>
            <p className="mt-0.5 text-[12.5px] text-grey">
              The next quotation generated will be{" "}
              <span className="font-medium text-navy">{quotationNoFor((current ?? 0) + 1)}</span>.
            </p>
          </>
        )}
      </div>

      {series.confirmed ? (
        <p className="text-[12.5px] text-ryg-green">
          Confirmed at {quotationNoFor(series.confirmedAtValue ?? 0)}
          {series.confirmedAt ? ` on ${new Date(series.confirmedAt).toLocaleDateString("en-GB")}` : ""}.
          It can still be moved forward if a stray paper quotation turns up.
        </p>
      ) : (
        <p className="text-[12.5px] text-ryg-red">
          Not confirmed. The seeded figure was read off one scanned submission and may be behind the
          real series &mdash; check it against the quotation register before the first one goes out.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <TextInput
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(null);
              setErr(null);
            }}
            placeholder={current === null ? "e.g. 23" : String(current)}
            inputMode="numeric"
            disabled={!s.isAdmin || busy}
          />
        </div>
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!s.isAdmin || busy || typed === null || invalid || goingBackwards}
        >
          {busy ? "Saving…" : series.confirmed ? "Move series forward" : "Confirm series"}
        </Button>
        {saved && <span className="text-[12.5px] text-ryg-green">{saved}</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>

      {invalid && (
        <p className="text-[12.5px] text-ryg-red">Enter a whole number between 0 and 999999.</p>
      )}
      {goingBackwards && (
        <p className="text-[12.5px] text-ryg-red">
          The series is already at {current}. It can only move forward &mdash; lowering it would
          re-issue a number a customer already holds.
        </p>
      )}
    </Card>
  );
}
