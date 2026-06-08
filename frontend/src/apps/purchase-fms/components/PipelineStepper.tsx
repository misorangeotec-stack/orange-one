import type { StageState } from "../types";
import { PURCHASE_STAGES, STAGE_COUNT } from "../config/stages";
import { cn } from "@/shared/lib/cn";

/**
 * Horizontal numbered stepper across the top of the entry detail view — every
 * stage as a node (done = green ✓, active = orange, pending = grey hollow),
 * connected by a line, with a "% done" progress bar beneath. Nodes are clickable
 * to focus a stage in the timeline below.
 */
export default function PipelineStepper({
  stages,
  selectedKey,
  onSelect,
}: {
  stages: StageState[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  const done = stages.filter((s) => s.status === "done").length;
  const pct = Math.round((done / STAGE_COUNT) * 100);
  const complete = done >= STAGE_COUNT;

  return (
    <div>
      <div className="flex items-start overflow-x-auto pb-1">
        {PURCHASE_STAGES.map((def, i) => {
          const st = stages[i];
          const status = st?.status ?? "pending";
          const selected = selectedKey === def.key;
          return (
            <div key={def.key} className="flex items-start shrink-0">
              <button
                type="button"
                onClick={() => onSelect?.(def.key)}
                className="flex flex-col items-center gap-1.5 w-[74px] group"
                title={def.title}
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-[12.5px] font-bold border-2 transition",
                    status === "done" && "bg-ryg-green border-ryg-green text-white",
                    status === "active" && "bg-orange border-orange text-white shadow-cta",
                    status === "pending" && "bg-white border-line text-grey-2",
                    selected && "ring-4 ring-orange/15"
                  )}
                >
                  {status === "done" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  ) : (
                    def.index
                  )}
                </span>
                <span
                  className={cn(
                    "text-[10.5px] leading-tight text-center px-0.5 transition",
                    status === "pending" ? "text-grey-2" : "text-navy font-medium",
                    selected && "text-orange font-semibold"
                  )}
                >
                  {def.short}
                </span>
              </button>
              {i < PURCHASE_STAGES.length - 1 && (
                <span
                  className={cn(
                    "h-0.5 w-3 sm:w-6 mt-4 rounded-full",
                    i < done ? "bg-ryg-green" : "bg-line"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef1f6]">
          <span
            className={cn("block h-full rounded-full transition-all", complete ? "bg-ryg-green" : "bg-orange-grad")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={cn("text-[12.5px] font-semibold whitespace-nowrap", complete ? "text-[#1f9d57]" : "text-navy")}>
          {complete ? "All stages done" : `${done} of ${STAGE_COUNT} done`}
        </span>
      </div>
    </div>
  );
}
