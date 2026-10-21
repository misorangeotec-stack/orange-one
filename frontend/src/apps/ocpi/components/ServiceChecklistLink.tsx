import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import { useOcpiStore } from "../store";
import { serviceChecklistUrl } from "../data/ocpiServiceChecklists";

/**
 * The machine's service checklist PDF, offered for download on a deal.
 *
 * Shown on the Customer Sign step (so the salesperson can give it to the
 * customer before installation) and on the Service Check (the service team).
 * The PDF is uploaded once per machine on Masters → Service checklists (PDF).
 *
 * ⚠ IT SELF-HIDES when the deal has no machine. When the machine has no PDF yet
 *   it says so, rather than vanishing, so the gap gets noticed and filled.
 */
export default function ServiceChecklistLink({
  machineId,
  note,
}: {
  machineId: string | null;
  /** One line under the heading saying what to do with it on this step. */
  note: string;
}) {
  const s = useOcpiStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!machineId) return null;
  const machine = s.machineById(machineId);
  const machineName = machine?.salesName || machine?.name || "this machine";
  const row = s.serviceChecklistFor(machineId);

  async function open(download: boolean) {
    if (!row) return;
    setBusy(true);
    setError(null);
    // Opened synchronously so the browser does not treat it as a pop-up.
    const win = download ? null : window.open("", "_blank");
    try {
      const url = await serviceChecklistUrl(row, { download });
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      win?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-navy">Service checklist — {machineName}</p>
        {row ? (
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            {note} <span className="text-grey">({row.fileName})</span>
          </p>
        ) : (
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            No service checklist PDF is uploaded for this machine yet. Add it on Masters → Service
            checklists (PDF).
          </p>
        )}
        {error && <p className="mt-1 text-[12.5px] text-ryg-red">{error}</p>}
      </div>
      {row && (
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void open(false)}
            disabled={busy}
            className="rounded-xl border border-line px-3.5 py-2 text-[13px] font-semibold text-navy transition hover:border-orange hover:text-orange disabled:opacity-50"
          >
            View
          </button>
          <button
            type="button"
            onClick={() => void open(true)}
            disabled={busy}
            className="rounded-xl border border-orange bg-orange px-3.5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Download PDF
          </button>
        </div>
      )}
    </Card>
  );
}
