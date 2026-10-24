import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { holdAwareBucketOf, todayLocalIso, type WorkBucket } from "@/shared/lib/dueBuckets";
import { useHelpStore } from "../../store";
import { STAGES, stepByKey, type StepKey } from "../../lib/steps";
import { B } from "../../nav";

/**
 * The desk's own pipeline: where every open ticket is sitting, and how late.
 *
 * ⚠⚠ THIS IS "WHAT YOU CAN SEE", NOT "WHAT EXISTS", AND THE PAGE SAYS SO.
 *   Every other module's control centre is an org-wide count, because every
 *   other module's rows are readable by whoever opens the board. Help Desk's are
 *   not: `fms_help_can_see` withholds ordinary tickets from people outside the
 *   desk, and withholds the three confidential categories from everyone but
 *   their own owner. So two people can open this screen and read two different
 *   totals, both correct.
 *
 *   Printing a number here without that sentence is how somebody concludes there
 *   have been no grievances this year.
 *
 * ⚠ AN UNTIMED TICKET IS NOT LATE. Five categories are governed by policy rather
 *   than a number of working days; they land in "no date" and must never be
 *   rolled into overdue.
 */
export default function ControlCenter() {
  const s = useHelpStore();

  /**
   * ⚠ THE BUCKET NAMES ARE THE HUB'S, NOT THIS SCREEN'S: delayed / today /
   *   tomorrow / dayAfter / noDate, plus `hold`. Inventing a local vocabulary
   *   here is how two screens start disagreeing about what "overdue" means;
   *   `holdAwareBucketOf` is the one definition, shared with My Work Today and
   *   the 9am mail.
   */
  const byStep = useMemo(() => {
    const today = todayLocalIso();
    const out = new Map<StepKey, Partial<Record<WorkBucket, number>>>();
    for (const e of s.queueEntries) {
      const row = out.get(e.stepKey) ?? {};
      const t = s.tickets.find((x) => x.id === e.ticketId);
      const b = holdAwareBucketOf({ dueIso: e.dueIso, isHeld: t?.status === "on_hold" }, today);
      // `null` means the row is not due in the window this board covers. It is
      // still open — it is just not something to look at today.
      if (b) row[b] = (row[b] ?? 0) + 1;
      out.set(e.stepKey, row);
    }
    return out;
  }, [s.queueEntries, s.tickets]);

  const sum = (k: WorkBucket) => [...byStep.values()].reduce((n, r) => n + (r[k] ?? 0), 0);
  const total = s.queueEntries.length;
  const overdue = sum("delayed");
  const untimed = sum("noDate");

  return (
    <div>
      <h1 className="text-[20px] font-bold text-navy">Control Center</h1>
      <p className="mt-1 max-w-3xl text-[13.5px] text-grey-2">
        Every open ticket you are able to see, and where it is sitting. Grievance, POSH and
        disciplinary tickets are counted only by the person who owns them, so this is not a
        departmental total.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Tile label="Open" value={total} />
        <Tile label="Late" value={overdue} tone={overdue > 0 ? "bad" : undefined} />
        {/* Shown as its own tile rather than folded anywhere: "no deadline" and
            "not late" are different facts, and the SLA report has to state the
            first rather than quietly shrinking its denominator. */}
        <Tile label="No fixed deadline" value={untimed} />
      </div>

      {STAGES.map((stage) => {
        const rows = stage.keys.filter((k) => byStep.has(k));
        if (!rows.length) return null;
        return (
          <Card key={stage.label} className="mt-4 p-5">
            <h2 className="text-[15px] font-bold text-navy">{stage.label}</h2>
            <ul className="mt-3 divide-y divide-line">
              {rows.map((k) => {
                const r = byStep.get(k) ?? {};
                const n = s.queueEntries.filter((e) => e.stepKey === k).length;
                return (
                  <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link
                      to={`${B}/tickets`}
                      className="text-[13.5px] font-semibold text-navy hover:text-orange"
                    >
                      {stepByKey(k)?.title ?? k}
                    </Link>
                    <span className="flex items-center gap-3 text-[12.5px]">
                      <span className="text-grey-2">{n} open</span>
                      {(r.delayed ?? 0) > 0 && (
                        <span className="font-semibold text-ryg-red">{r.delayed} late</span>
                      )}
                      {(r.hold ?? 0) > 0 && <span className="text-yellow">{r.hold} on hold</span>}
                      {(r.noDate ?? 0) > 0 && (
                        <span className="text-grey-2">{r.noDate} untimed</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}

      {total === 0 && (
        <Card className="mt-4 p-5">
          <p className="text-[13px] text-grey-2">
            Nothing is open that you can see.
          </p>
        </Card>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <Card className="p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">{label}</p>
      <p className={"mt-1 text-[24px] font-bold " + (tone === "bad" ? "text-ryg-red" : "text-navy")}>
        {value}
      </p>
    </Card>
  );
}
