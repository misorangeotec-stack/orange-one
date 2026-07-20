import Card from "@/shared/components/ui/Card";
import { useSession } from "@/core/platform/session";
import { formatDate } from "@/shared/lib/time";
import { fmsAdapters } from "../adapters/registry";
import { addDaysIso, todayLocalIso } from "../lib/buckets";
import FmsRow from "../components/FmsRow";

const TH = "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-grey-2 whitespace-nowrap";

/**
 * The master scoreboard: one row per FMS, showing the step-work due today
 * (split into In Queue vs already Delayed), tomorrow, and the day after.
 *
 * Counts come straight from each FMS's own queue predicates via its adapter, so
 * a number here always matches that FMS's queue pages.
 */
export default function MasterControlCenter() {
  const today = todayLocalIso();
  const { hasModule } = useSession();

  // Only score the FMS this viewer is actually granted (admins keep all, since
  // hasModule returns true for them). Without this a coordinator with the
  // fms-control-center grant would see rows — names and counts — for FMS apps
  // they were never given, e.g. Employee Exit / Office Supplies.
  const rows = fmsAdapters.filter((a) => hasModule(a.appId));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">FMS Control Center</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Pending work across every process, by the day it falls due. A count is one <strong>step</strong> of work on one
          entry — the same entry can be waiting at two steps at once. Click a process to open its own control center.
        </p>
      </div>

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th rowSpan={2} className={`${TH} text-left align-bottom`}>
                  Process
                </th>
                <th colSpan={2} className={`${TH} text-center border-b border-line/60`}>
                  Today · {formatDate(today)}
                </th>
                <th rowSpan={2} className={`${TH} text-center align-bottom`}>
                  Tomorrow
                  <div className="font-normal normal-case tracking-normal text-grey-2/70">{formatDate(addDaysIso(today, 1))}</div>
                </th>
                <th rowSpan={2} className={`${TH} text-center align-bottom`}>
                  Day after
                  <div className="font-normal normal-case tracking-normal text-grey-2/70">{formatDate(addDaysIso(today, 2))}</div>
                </th>
                <th rowSpan={2} className={`${TH} text-center align-bottom`} title="Open work with no due date set">
                  No date
                </th>
              </tr>
              <tr>
                <th className={`${TH} text-center`}>In Queue</th>
                <th className={`${TH} text-center text-ryg-red/80`}>Delayed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <FmsRow key={a.key} adapter={a} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-grey-2">
          <strong className="text-ryg-red">Delayed</strong> means the due date has already passed — those entries are counted
          separately, not inside today's queue.
        </p>
      </Card>
    </div>
  );
}
