import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../../store";
import { fetchOcCounter } from "../../data/ocpiFetch";
import { fyCode, ocNoFor } from "../../lib/format";

/**
 * Where the ORDER-CONFIRMATION series stands, and the one control that moves it.
 *
 * ⚠ A DIFFERENT SERIES FROM THE QUOTATION'S, AND THE MORE EXPENSIVE ONE TO GET
 *   WRONG. A quotation number goes out on an offer that may never be taken up.
 *   An OC number goes out on the contract the customer signs, countersigns and
 *   files — and Finance books against. Until this screen existed there was no
 *   way to see where the series stood or to move it, so the first order
 *   confirmation raised here would have been `OTPL/OC/2627/0001` on a company
 *   that has been issuing them on paper for years.
 *
 * ⚠ IT RESTARTS EACH APRIL, WHICH THE QUOTATION SERIES DOES NOT. The number
 *   carries the financial year (`OTPL/OC/2627/0009`), so the counter is per
 *   year — `fms_ocpi_counters.scope = 'oc:2627'` — and so is the confirmation.
 *   Confirming this April's series must NOT silence the question next April,
 *   when a fresh year starts at zero against a paper series that kept running.
 *   That is why `config.ocSeries` is a map keyed by year and not a single flag.
 *
 * ⚠ FORWARD-ONLY, AND THE DATABASE IS WHAT ENFORCES IT. Raising the number only
 *   ever skips values, which costs nothing. Lowering it duplicates a number on a
 *   signed contract, so `fms_ocpi_set_oc_series` refuses it — the form below
 *   merely explains the refusal early.
 *
 * ⚠ THE COUNTER IS READ FRESH, NOT FROM THE STORE, for the same reason the
 *   quotation counter is: it moves every time a Director approves a quotation,
 *   and a cached copy would let an admin confirm against a figure already passed.
 */
export default function OcNumberingSection() {
  const s = useOcpiStore();
  const fy = fyCode();
  const series = s.config.ocSeries[fy];

  const {
    data: counter,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["ocpiOcCounter", fy],
    queryFn: () => fetchOcCounter(fy),
    enabled: s.isAdmin,
    staleTime: 0,
  });

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const current = counter ?? null;
  const typed = value.trim() === "" ? null : Number(value.trim());
  const invalid = typed !== null && (!Number.isInteger(typed) || typed < 0 || typed > 9999);
  const goingBackwards = typed !== null && current !== null && !invalid && typed < current;

  async function save() {
    if (typed === null || invalid || goingBackwards) return;
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const now = await s.setOcSeries(typed, fy);
      await refetch();
      setValue("");
      setSaved(`Confirmed. The next order confirmation will be ${ocNoFor(now + 1, fy)}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl space-y-4 p-5">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Order confirmation numbering</h3>
        <p className="mt-1 text-[12.5px] text-grey">
          A <b>separate series from the quotation</b>, issued when the Directors approve and the
          quotation becomes the contract. It carries the financial year and{" "}
          <b>starts again each April</b>, so this sets the year now running &mdash;{" "}
          <span className="font-semibold text-navy">{fy}</span>.
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
                {current === null ? "none yet this year" : ocNoFor(current, fy)}
              </span>
            </p>
            <p className="mt-0.5 text-[12.5px] text-grey">
              The next order confirmation will be{" "}
              <span className="font-medium text-navy">{ocNoFor((current ?? 0) + 1, fy)}</span>.
            </p>
          </>
        )}
      </div>

      {series?.confirmed ? (
        <p className="text-[12.5px] text-ryg-green">
          Confirmed at {ocNoFor(series.confirmedAtValue ?? 0, fy)}
          {series.confirmedAt
            ? ` on ${new Date(series.confirmedAt).toLocaleDateString("en-GB")}`
            : ""}
          . It can still be moved forward if a stray paper order confirmation turns up.
        </p>
      ) : (
        <p className="text-[12.5px] text-ryg-red">
          Not confirmed for {fy}. Nobody has checked this against the order-confirmation register, so
          the next approval may re-issue a number a customer already holds &mdash; on a contract, not
          an offer. Check it before the first quotation is approved.
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
            placeholder={current === null ? "e.g. 0" : String(current)}
            inputMode="numeric"
            disabled={!s.isAdmin || busy}
          />
        </div>
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!s.isAdmin || busy || typed === null || invalid || goingBackwards}
        >
          {busy ? "Saving…" : series?.confirmed ? "Move series forward" : "Confirm series"}
        </Button>
        {saved && <span className="text-[12.5px] text-ryg-green">{saved}</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>

      {invalid && (
        <p className="text-[12.5px] text-ryg-red">
          Enter a whole number between 0 and 9999 &mdash; the number prints as four digits.
        </p>
      )}
      {goingBackwards && (
        <p className="text-[12.5px] text-ryg-red">
          The {fy} series is already at {current}. It can only move forward &mdash; lowering it would
          re-issue a number that is already on a signed contract.
        </p>
      )}
    </Card>
  );
}
