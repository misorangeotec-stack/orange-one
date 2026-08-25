import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../../store";

/**
 * How long a quotation stands before it lapses.
 *
 * ⚠ THIS SCREEN EXISTS BECAUSE THE VALUE HAD NO SOURCE. `{{quotation_validity_days}}`
 *   was offered to template authors as a placeholder, and the CANCELLATION
 *   clause on the machine decks uses it — "Our offer and quotation is valid for
 *   {{quotation_validity_days}} days only" — but nothing could ever write
 *   `fms_ocpi_config.quotation_validity_days`. There was no row, so every
 *   contract printed the hardcoded fallback of 30 and no one could change it.
 *   A placeholder with no way to set it is worse than a literal number: it looks
 *   configurable and is not. The client found it by asking where the setting
 *   was; there wasn't one.
 *
 * ⚠ IT IS THE ONLY TOKEN THAT IS A SETTING. Every other placeholder comes off
 *   the deal (the salesperson types it) or off the selling entity (bank block,
 *   Ex-Works city). This one is a company-wide policy, which is exactly why it
 *   belongs here and not on the quotation form — changing 30 to 45 should
 *   change every machine template at once, not 28 templates by hand.
 *
 * ⚠ CHANGING IT DOES NOT REWRITE ISSUED PAPERS. The value is frozen onto each
 *   version's document payload at generation, so a quotation already with a
 *   customer keeps the validity it was issued under. Only the next generation
 *   picks up the new figure — which is the same freeze rule the rest of the
 *   module runs on, and the right one: a customer's copy must not change
 *   because somebody edited a setting.
 */
export default function QuotationValiditySection() {
  const s = useOcpiStore();
  const current = s.config.quotationValidityDays;

  const [value, setValue] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const typed = value.trim() === "" ? null : Number(value.trim());
  const invalid = typed === null || !Number.isInteger(typed) || typed < 1 || typed > 365;
  const dirty = !invalid && typed !== current;

  async function save() {
    if (invalid || !dirty) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setQuotationValidityDays(typed);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl space-y-4 p-5">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Quotation validity</h3>
        <p className="mt-1 text-[12.5px] text-grey">
          How many days an offer stands. This is what{" "}
          <code className="rounded bg-page px-1 py-0.5 text-[11.5px] text-navy">
            {"{{quotation_validity_days}}"}
          </code>{" "}
          prints as in a machine template &mdash; the cancellation clause reads &ldquo;valid for{" "}
          <b>{current}</b> days only&rdquo;.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32">
          <TextInput
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
              setErr(null);
            }}
            inputMode="numeric"
            disabled={!s.isAdmin || busy}
          />
        </div>
        <Button size="sm" onClick={() => void save()} disabled={!s.isAdmin || busy || invalid || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {saved && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>

      {!s.isAdmin && <p className="text-[12.5px] text-grey-2">Admins only.</p>}
      {invalid && value.trim() !== "" && (
        <p className="text-[12.5px] text-ryg-red">Enter a whole number of days between 1 and 365.</p>
      )}
      <p className="text-[12.5px] text-grey-2">
        Quotations already issued keep the validity they were printed with &mdash; each version is
        frozen. Only the next one generated uses the new figure.
      </p>
    </Card>
  );
}
