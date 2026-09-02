import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import { useProductionStore } from "../../store";
import type { CoaOutputFormat } from "../../data/productionFetch";

/**
 * Which download formats the two COA copies offer.
 *
 * Print is deliberately absent from the choice: it is the browser dialog rather
 * than a generated file, it costs nothing to keep, and a QC team that wants paper
 * should never have to ask an admin for it.
 */
const OPTIONS: { value: CoaOutputFormat; label: string }[] = [
  { value: "both", label: "PDF and Excel" },
  { value: "pdf", label: "PDF only" },
  { value: "excel", label: "Excel only" },
];

export default function CoaOutputSection() {
  const s = useProductionStore();
  const [format, setFormat] = useState<CoaOutputFormat>(s.coaOutput);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setCoaOutput(format);
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-4 max-w-xl">
      <p className="text-[12.5px] text-grey">
        A Certificate of Analysis is generated in two copies, one for the customer and one for the
        factory. This decides which download formats each copy offers. Print stays available either way.
      </p>
      <div className="space-y-1.5">
        <div className="text-[13.5px] font-medium text-navy">Output format</div>
        <ChoiceButtons
          options={OPTIONS}
          value={format}
          onChange={(v) => { setFormat(v as CoaOutputFormat); setSaved(false); }}
        />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
        {saved && <span className="text-[12px] text-ryg-green font-medium">Saved</span>}
        {err && <span className="text-[12px] text-ryg-red font-medium">{err}</span>}
      </div>
    </Card>
  );
}
