import type { StageDef, StageState } from "../types";
import StageStatusChip from "./StageStatusChip";
import StageForm from "./StageForm";
import { formatDate } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";

/** Format a captured value for read-only display, honoring its field type. */
function displayValue(def: StageDef, key: string, value: string | number | null): string {
  const field = def.fields.find((f) => f.key === key);
  if (value == null || value === "") return "—";
  if (field?.type === "date") return formatDate(String(value));
  if (field?.type === "number") return Number(value).toLocaleString("en-IN");
  return String(value);
}

/**
 * One stage in the vertical timeline. Done stages show captured data read-only;
 * the active stage shows an inline entry form (when the viewer may act) or a
 * "waiting on …" note; future stages are locked with their planned date.
 */
export default function StageCard({
  def,
  state,
  ownerLabel,
  isLast,
  canAct,
  highlight,
  anchorId,
  onComplete,
}: {
  def: StageDef;
  state: StageState;
  ownerLabel: string;
  isLast: boolean;
  canAct: boolean;
  highlight?: boolean;
  anchorId?: string;
  onComplete: (values: Record<string, string | number | null>) => void;
}) {
  const { status } = state;
  const filledValues = def.fields.filter((f) => {
    const v = state.values[f.key];
    return v != null && v !== "";
  });

  return (
    <div id={anchorId} className="relative flex gap-3.5 scroll-mt-24">
      {/* left rail: dot + connector */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center text-[11.5px] font-bold border-2 shrink-0",
            status === "done" && "bg-ryg-green border-ryg-green text-white",
            status === "active" && "bg-orange border-orange text-white",
            status === "pending" && "bg-white border-line text-grey-2"
          )}
        >
          {status === "done" ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          ) : (
            def.index
          )}
        </span>
        {!isLast && <span className={cn("flex-1 w-0.5 my-1", status === "done" ? "bg-ryg-green/40" : "bg-line")} />}
      </div>

      {/* content */}
      <div
        className={cn(
          "flex-1 mb-4 rounded-card border bg-white p-4 transition",
          highlight ? "border-orange/60 shadow-cta" : "border-line shadow-soft",
          status === "pending" && "opacity-75"
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[14.5px] font-semibold text-navy">{def.title}</h3>
              <StageStatusChip status={status} />
            </div>
            <p className="text-[12px] text-grey mt-0.5">{def.what}</p>
          </div>
          <div className="text-right text-[11.5px] text-grey-2 shrink-0">
            <div>Owner: <span className="text-navy font-medium">{ownerLabel}</span></div>
            {state.plannedDate && status !== "done" && <div>Planned: <span className="text-navy">{formatDate(state.plannedDate)}</span></div>}
            {state.actualDate && status === "done" && <div>Done: <span className="text-navy">{formatDate(state.actualDate)}</span></div>}
          </div>
        </div>

        {/* body */}
        {status === "done" && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-3">
            {filledValues.length === 0 ? (
              <p className="text-[12.5px] text-grey-2">No details captured.</p>
            ) : (
              filledValues.map((f) => (
                <div key={f.key} className="flex justify-between gap-3 text-[12.5px]">
                  <span className="text-grey-2">{f.label}</span>
                  <span className="text-navy font-medium text-right">{displayValue(def, f.key, state.values[f.key] ?? null)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {status === "active" && (
          <div className="mt-3 border-t border-line pt-4">
            {canAct ? (
              <StageForm fields={def.fields} initial={state.values} onSubmit={onComplete} />
            ) : (
              <div className="flex items-center gap-2 text-[12.5px] text-grey">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                Awaiting <b className="text-navy font-semibold">{ownerLabel}</b> to complete this stage.
              </div>
            )}
          </div>
        )}

        {status === "pending" && (
          <p className="mt-2 text-[12px] text-grey-2">
            {def.when}{state.plannedDate ? ` · planned ${formatDate(state.plannedDate)}` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
