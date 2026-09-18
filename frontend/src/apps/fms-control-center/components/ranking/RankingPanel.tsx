import { useState } from "react";
import Combobox from "@/shared/components/ui/Combobox";
import { formatDateTime } from "@/shared/lib/time";
import AdminRanking from "./AdminRanking";
import Celebrate from "./Celebrate";
import EmployeesWall from "./EmployeesWall";
import Ladder from "./Ladder";
import MonthSoFar from "./MonthSoFar";
import MyCard from "./MyCard";
import MyStepsModal from "./MyStepsModal";
import Podium, { titleCase } from "./Podium";
import WhatIf from "./WhatIf";
import { monthLabel, useRankBoard } from "./data";

/**
 * The monthly ranking (CC-1), above the FMS Control Center's process table.
 *
 * FMS steps, company-wide, one calendar month at a time: on time = 1, late = ½,
 * missed = 0, score = points ÷ steps. Recomputed every night by the `fms-ranking`
 * edge function from each module's own code; a finished month is frozen, and its
 * top three are the employees of the month.
 */
export default function RankingPanel() {
  const [month, setMonth] = useState<string | null>(null);
  const [projection, setProjection] = useState<{ score: number; rank: number | null } | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  /** An admin previewing exactly what one person sees (admins are never ranked). */
  const [previewAs, setPreviewAs] = useState<string | null>(null);
  // The viewer's own board — also the admin's list of people to preview. With no
  // preview the two calls share one query key, so it is fetched once.
  const own = useRankBoard(month);
  const { data: board, isLoading, error } = useRankBoard(month, previewAs);
  const people = own.data?.admin?.people ?? [];
  const previewName = previewAs ? titleCase(people.find((p) => p.user_id === previewAs)?.name ?? "") : null;

  const pick = (m: string | null) => {
    setProjection(null);
    setMonth(m);
  };
  const preview = (uid: string) => {
    setProjection(null);
    setPreviewAs(uid || null);
  };

  // The what-if is for someone on (or on the way to) the ladder, in the running month.
  const showWhatIf =
    !!board?.is_current && !!board.me && (board.me.ranked || board.me.not_ranked === "under_minimum");

  return (
    <section aria-labelledby="rank-title" className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="rank-title" className="text-[20px] font-bold text-navy">Ranking</h2>
          <p className="mt-0.5 text-[13.5px] text-grey">
            Steps closed on time, company-wide.{" "}
            {board?.computed_at && (
              <span className="whitespace-nowrap">
                {board.frozen ? `Final, frozen on ${formatDateTime(board.frozen_at)}.` : `Updated every night · last run ${formatDateTime(board.computed_at)}.`}
              </span>
            )}
          </p>
        </div>
        {own.data?.viewer_is_admin && people.length > 0 && (
          <div className="w-full sm:w-64 order-last sm:order-none">
            <Combobox
              value={previewAs ?? ""}
              onChange={preview}
              options={people.map((p) => ({ value: p.user_id, label: titleCase(p.name) }))}
              placeholder="Preview as someone…"
              searchable
              clearable
            />
          </div>
        )}
        {board && board.months.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Month">
            {[...board.months].reverse().map((m) => {
              const on = m.month === board.month;
              const current = m.month === board.current_month;
              return (
                <button
                  key={m.month}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(current ? null : m.month)}
                  className={
                    "rounded-pill border px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange " +
                    (on ? "border-navy bg-navy text-white" : "border-line bg-white text-ink hover:border-grey-2")
                  }
                >
                  {monthLabel(m.month, true)}
                  <span className={on ? "text-white/70" : "text-grey-2"}>{current ? " · so far" : m.frozen ? " · final" : ""}</span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-12" aria-busy="true">
          <div className="lg:col-span-7 h-[360px] rounded-card-lg bg-navy/90 animate-pulse" />
          <div className="lg:col-span-5 h-[360px] rounded-card-lg bg-white border border-line animate-pulse" />
        </div>
      ) : error ? (
        <p className="rounded-card-lg border border-line bg-white px-5 py-4 text-[14px] text-ryg-red">
          The ranking could not be loaded: {(error as Error).message}
        </p>
      ) : !board || (!board.computed_at && board.months.length === 0) ? (
        <p className="rounded-card-lg border border-line bg-white px-5 py-6 text-[14px] text-grey">
          The first ranking is worked out tonight. Tomorrow morning this is where you will see where you stand.
        </p>
      ) : (
        <>
          {board.previewing ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy/20 bg-navy/[0.04] px-4 py-3 text-[14px] text-ink" role="status">
              <span>
                Previewing exactly what <strong>{previewName}</strong> sees. Only admins can do this, and nothing is changed.
              </span>
              <button type="button" onClick={() => preview("")} className="text-[13px] font-semibold text-orange hover:underline underline-offset-4">
                Back to my own view
              </button>
            </div>
          ) : (
            <Celebrate board={board} />
          )}
          {/* Two stacks, not a grid of row pairs: the viewer's card and what they can
              do about it on the left, the company on the right. A short card (an admin,
              an under-10 month) then never leaves a hole beside the podium. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
            <div className="min-w-0 lg:col-span-7 space-y-4">
              <MyCard board={board} projection={projection} onShowSteps={() => setStepsOpen(true)} />
              {showWhatIf ? (
                <WhatIf key={`${board.month}:${previewAs ?? ""}`} board={board} onProjection={setProjection} />
              ) : (
                <MonthSoFar board={board} />
              )}
            </div>
            <div className="min-w-0 lg:col-span-5 space-y-4">
              <Podium top={board.top} month={board.month} isCurrent={board.is_current} ladderSize={board.ladder_size} />
              {showWhatIf && <MonthSoFar board={board} />}
            </div>
          </div>
          <Ladder board={board} />
          <EmployeesWall />
          {board.is_admin && board.admin && <AdminRanking board={board} />}
          {board.me && (
            <MyStepsModal
              month={board.month}
              open={stepsOpen}
              onClose={() => setStepsOpen(false)}
              user={previewAs}
              name={previewName}
            />
          )}
        </>
      )}
    </section>
  );
}
