import { useMemo } from "react";
import Card from "@/shared/components/ui/Card";
import { snapshotFrom } from "@/apps/fms-control-center/lib/buckets";
import type { Bucket } from "@/shared/lib/dueBuckets";
import { useSuppliesStore } from "../../store";
import { STAGES, STEPS } from "../../lib/steps";
import { appName } from "@/apps/appInfo";

const BUCKETS: { key: Bucket; label: string; tone: string }[] = [
  { key: "delayed", label: "Delayed", tone: "text-ryg-red" },
  { key: "today", label: "Today", tone: "text-orange" },
  { key: "tomorrow", label: "Tomorrow", tone: "text-navy" },
  { key: "dayAfter", label: "Day after", tone: "text-grey" },
  { key: "noDate", label: "No date", tone: "text-grey-2" },
];

/**
 * The Supplies Control Center — the SAME queue entries every page counts, bucketed by
 * due date. Built through `snapshotFrom(store.queueEntries, STEPS, STAGES)`, exactly as
 * the cross-FMS scoreboard adapter does, so the two can never disagree.
 */
export default function ControlCenter() {
  const s = useSuppliesStore();
  const snapshot = useMemo(() => snapshotFrom(s.queueEntries, STEPS, STAGES), [s.queueEntries]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{appName("office-supplies")} Control Center</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Open work across the whole supply process, by how close it is to its due date.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {BUCKETS.map((b) => (
          <Card key={b.key} className="p-4">
            <div className={`text-[24px] font-bold ${b.tone}`}>{snapshot.total[b.key]}</div>
            <div className="text-[12.5px] text-grey-2 mt-0.5">{b.label}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left text-grey-2 border-b border-line">
              <th className="font-medium px-4 py-3">Stage / Step</th>
              {BUCKETS.map((b) => (
                <th key={b.key} className="font-medium px-4 py-3 text-center">{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(snapshot.stages ?? []).map((stage) => (
              <StageRows key={stage.label} label={stage.label} counts={stage.counts} steps={stage.steps} />
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function StageRows({
  label,
  counts,
  steps,
}: {
  label: string;
  counts: Record<Bucket, number>;
  steps: { stepKey: string; label: string; counts: Record<Bucket, number> }[];
}) {
  return (
    <>
      <tr className="bg-navy/[0.03] border-b border-line">
        <td className="px-4 py-2.5 font-semibold text-navy">{label}</td>
        {BUCKETS.map((b) => (
          <td key={b.key} className="px-4 py-2.5 text-center font-semibold text-navy">
            {counts[b.key] || <span className="text-grey-2">—</span>}
          </td>
        ))}
      </tr>
      {steps.map((st) => (
        <tr key={st.stepKey} className="border-b border-line/70 last:border-0">
          <td className="px-4 py-2.5 pl-8 text-grey">{st.label}</td>
          {BUCKETS.map((b) => (
            <td key={b.key} className="px-4 py-2.5 text-center text-grey">
              {st.counts[b.key] || <span className="text-grey-2">—</span>}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
