import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput } from "@/shared/components/ui/Form";
import { useProductionStore } from "../../store";

/**
 * The starting number for the continuous Lot/Batch (Issue Slip) counter. The
 * number is auto-generated as YYMM-#### and increments +1 per job card, running
 * continuously across months. Raising the start jumps the sequence forward; it is
 * never allowed to go backwards (no duplicate numbers).
 */
export default function BatchNumberingSection() {
  const s = useProductionStore();
  const [start, setStart] = useState(String(s.batchSeqStart));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const n = Math.max(1, Math.floor(Number(start) || 1));
      await s.setBatchSeqStart(n);
      setStart(String(n));
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const now = new Date();
  const prefix = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const preview = `${prefix}-${String(Math.max(1, Math.floor(Number(start) || 1))).padStart(4, "0")}`;

  return (
    <Card className="p-5 space-y-4 max-w-xl">
      <p className="text-[12.5px] text-grey">
        The Lot/Batch (Issue Slip) number is auto-generated as <span className="font-semibold text-navy">YYMM-####</span>. Set
        the starting number for the continuous counter — it increments by 1 for each job card and keeps counting across months.
        Raising it here jumps the sequence forward; it never goes backwards.
      </p>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13.5px] font-medium text-navy">Starting number</div>
          <div className="text-[11px] text-grey-2">Next card ≈ <span className="tabular-nums">{preview}</span></div>
        </div>
        <TextInput
          className="w-28 text-center tabular-nums"
          inputMode="numeric"
          value={start}
          onChange={(e) => { setStart(e.target.value); setSaved(false); }}
        />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        {saved && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
