import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useOcpiStore } from "../../store";

/**
 * The warranty periods every contract prints.
 *
 * ⚠ THIS REPLACED A PER-MACHINE MAPPING THAT WAS SPECIFIED AND THEN WITHDRAWN.
 *   The first plan was to map a default warranty against each machine, prefill
 *   it on the quotation, let the salesperson override it, and highlight the
 *   override at approval. The client settled on something much simpler: FIXED
 *   periods, no dropdown anywhere, and any exception written into Special
 *   remarks. So there is nothing per-machine and nothing to override — which is
 *   also why the approval gate has no "warranty was changed" warning.
 *
 * ⚠ NO DRYER OR SPARE-PARTS WARRANTY EXISTS. The client offers neither, so
 *   neither is asked and neither prints. `{{dryer_warranty}}` was retired from
 *   the token list for the same reason — a template still using it is reported
 *   as unresolved rather than quietly printing a blank.
 *
 * ⚠ MONTHS AS A BARE NUMBER, because the template supplies the word: "Machine
 *   Warranty period will be of {{machine_warranty_months}} months from the date
 *   of installation". This is not a nicety — the field these replaced held
 *   "24 months warranty → maximum 25 months from the invoice date", which
 *   printed as "will be of 24 months warranty → maximum 25 months from the
 *   invoice date months from the date of installation" on a real contract. The
 *   head clause printed "of 24 Months months". Keep these numeric.
 *
 * ⚠ CHANGING THESE DOES NOT REWRITE ISSUED PAPERS. Each revision freezes its own
 *   resolved document, so a quotation already with a customer keeps the periods
 *   it was issued under. Only the next generation picks up a new figure — the
 *   same freeze rule the rest of the module runs on, and the right one.
 */
export default function WarrantySection() {
  const s = useOcpiStore();
  const current = s.config.warranty;

  const [machine, setMachine] = useState(String(current.machineMonths));
  const [head, setHead] = useState(String(current.headMonths));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parse = (v: string) => (v.trim() === "" ? null : Number(v.trim()));
  const m = parse(machine);
  const h = parse(head);
  const bad = (n: number | null) => n === null || !Number.isInteger(n) || n < 1 || n > 120;
  const invalid = bad(m) || bad(h);
  const dirty = !invalid && (m !== current.machineMonths || h !== current.headMonths);

  async function save() {
    if (invalid || !dirty) return;
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setWarranty(m as number, h as number);
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
        <h3 className="text-[15px] font-bold text-navy">Warranty periods</h3>
        <p className="mt-1 text-[12.5px] text-grey">
          Fixed for every deal. The salesperson does not choose a warranty &mdash; if one needs to
          differ, they write it into <b className="text-navy">Special remarks</b>. No warranty is
          offered on the dryer or on spare parts.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[12.5px] font-medium text-ink">Machine warranty (months)</label>
          <TextInput
            inputMode="numeric"
            value={machine}
            onChange={(e) => setMachine(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
          />
        </div>
        <div>
          <label className="text-[12.5px] font-medium text-ink">Print-head warranty (months)</label>
          <TextInput
            inputMode="numeric"
            value={head}
            onChange={(e) => setHead(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
          />
        </div>
      </div>

      <p className="rounded-lg border border-line bg-[#FBFCFE] px-3 py-2 text-[12px] leading-relaxed text-grey">
        These fill{" "}
        <code className="rounded bg-page px-1 py-0.5 text-[11.5px] text-navy">
          {"{{machine_warranty_months}}"}
        </code>{" "}
        and{" "}
        <code className="rounded bg-page px-1 py-0.5 text-[11.5px] text-navy">
          {"{{head_warranty_months}}"}
        </code>{" "}
        in every machine template &mdash; the machine clause is in all ten. Contracts already issued
        keep the periods they were issued under; only the next generation picks up a change.
      </p>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy || invalid || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {invalid && <span className="text-[12.5px] text-ryg-red">Enter a whole number of months, 1–120.</span>}
        {!invalid && saved && !dirty && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
