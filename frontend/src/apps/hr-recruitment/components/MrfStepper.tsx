import { formatDateDMY } from "@/shared/lib/date";
import type { Requisition } from "../types";

/**
 * The requisition's journey, with the ACTUAL date each step completed.
 *
 * Every date here is read from the requisition's own timestamp column, stamped
 * inside the RPC that performed the step — never inferred from the activity trail,
 * which is best-effort and can be missing.
 */
export default function MrfStepper({ requisition: r }: { requisition: Requisition }) {
  const stages = [
    { label: "Raised", at: r.submittedAt },
    { label: "HR Head", at: r.hrApprovedAt },
    { label: "Management", at: r.mgmtApprovedAt },
    { label: "Posted", at: r.postedAt },
    { label: "Collecting CVs", at: r.status === "sourcing" ? r.postedAt : null },
  ];

  const dead = r.status === "rejected" || r.status === "cancelled";

  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
      {stages.map((st, i) => {
        const done = !!st.at;
        return (
          <div key={st.label} className="flex items-start gap-2">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                  done && !dead
                    ? "bg-ryg-green text-white"
                    : done
                      ? "bg-grey-2 text-white"
                      : "border border-line bg-white text-grey-2"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
            </div>
            <div className="min-w-[92px]">
              {/* A step not yet reached still needs its name legible — it used to sit in
                  the same grey as its own date, so name and date blurred into one. */}
              <div className={`text-[12.5px] font-semibold ${done ? "text-navy" : "text-grey"}`}>{st.label}</div>
              <div className={`text-[11px] ${st.at ? "font-medium text-navy" : "text-grey-2"}`}>
                {st.at ? formatDateDMY(st.at) : "—"}
              </div>
            </div>
            {i < stages.length - 1 && <div className="mt-3 hidden h-px w-6 bg-line sm:block" />}
          </div>
        );
      })}

      {dead && (
        <span className="ml-2 self-center rounded-full bg-[#FDECEC] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ryg-red">
          {r.status === "rejected" ? "Rejected" : "Cancelled"}
        </span>
      )}
    </div>
  );
}
