import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import Card from "@/shared/components/ui/Card";

const ROLES = ["Admin", "HOD", "Sub-HOD", "Employee"] as const;

// [capability, [admin, hod, sub_hod, employee]]
const MATRIX: [string, boolean[]][] = [
  ["View & create own tasks", [true, true, true, true]],
  ["Edit / delete own pending tasks", [true, true, true, true]],
  ["Revise tasks (max/week limit)", [true, true, true, true]],
  ["Shift / reschedule own tasks", [true, true, true, true]],
  ["Assign tasks to others", [true, true, true, false]],
  ["View team tasks", [true, true, true, false]],
  ["View all organization tasks", [true, false, false, false]],
  ["Manage recurring tasks", [true, true, true, false]],
  ["Set weekly RYG plans", [true, true, false, false]],
  ["View team / department reports", [true, true, true, false]],
  ["Manage users & departments", [true, false, false, false]],
  ["Manage locations", [true, false, false, false]],
  ["Edit workspace settings", [true, false, false, false]],
];

/** Read-only role → permission matrix (fixed for MVP). */
export default function Permissions() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-orange-soft/60 px-4 py-3 text-[12.5px] text-[#9a5418]">
        Permissions are fixed for this version. Role-based access is enforced throughout the app
        (and by the database). Custom roles can be added later.
      </div>

      <Card className="overflow-hidden">
        <ScrollableTable>
          <table className="w-full text-[13px] min-w-[560px]">
            <thead>
              <tr className="border-b border-line bg-page/60">
                <th className="text-left font-semibold text-navy px-5 py-3">Capability</th>
                {ROLES.map((r) => (
                  <th key={r} className="text-center font-semibold text-navy px-3 py-3 w-24">{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map(([cap, vals]) => (
                <tr key={cap} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-3 text-ink">{cap}</td>
                  {vals.map((v, i) => (
                    <td key={i} className="text-center px-3 py-3">
                      {v ? (
                        <svg className="inline text-[#27AE60]" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                      ) : (
                        <span className="text-line text-[16px]">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </Card>
    </div>
  );
}
