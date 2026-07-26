import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Kpi from "@/shared/components/ui/Kpi";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { countInWindow, windowStartIso } from "@/shared/lib/fmsDashboard";

export interface ThroughputColumn {
  key: string;
  label: string;
  /** The FMS's completed StageEntry[] for this step (only `atIso` is read). */
  entries: { atIso: string }[];
}

/**
 * "Recently completed" — how many steps finished in the last 7 or 30 days, one
 * count per stage from the FMS's completed entries. Zero-state: all `0` + a
 * footer, never blank.
 */
export default function ThroughputCard({ columns, todayIso }: { columns: ThroughputColumn[]; todayIso: string }) {
  const [days, setDays] = useState<7 | 30>(7);
  const sinceIso = windowStartIso(todayIso, days);

  const counts = useMemo(
    () => columns.map((c) => ({ key: c.key, label: c.label, count: countInWindow(c.entries, sinceIso) })),
    [columns, sinceIso],
  );
  const anything = counts.some((c) => c.count > 0);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h3 className={SECTION_HEADING_CLASS}>Recently completed</h3>
        <div className="inline-flex rounded-lg border border-line overflow-hidden">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`h-7 px-3 text-[12px] font-semibold border-r border-line last:border-r-0 transition-colors ${
                days === d ? "bg-orange/10 text-orange" : "text-grey-2 hover:text-navy hover:bg-page/60"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 pt-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        {counts.map((c) => (
          <Kpi key={c.key} label={c.label} value={c.count} size="md" />
        ))}
      </div>
      {!anything && <p className="text-[12.5px] text-grey-2">No steps completed in the last {days} days.</p>}
    </Card>
  );
}
