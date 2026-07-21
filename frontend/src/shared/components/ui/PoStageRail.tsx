import { cn } from "@/shared/lib/cn";

/**
 * The PO lifecycle rail shown at the top of a PO detail screen: one node per
 * stage, each captioned with the DEPARTMENT and PEOPLE responsible for it.
 *
 * Pure and props-driven, like `StepPipeline`. It takes resolved NAMES only —
 * it never touches a store, a StepKey, or fms_*_step_owners — so the domestic
 * Purchase FMS and the Import FMS can share it without their step-ownership
 * differences leaking in. Each app's PoStepper is the adapter that resolves
 * ids to names.
 */

export interface PoStageRailNode {
  key: string;
  label: string;
  /** Resolved department names for this stage's owners. May be empty. */
  departments: string[];
  /** Resolved people names owning this stage. May be empty. */
  people: string[];
  /** False for stages with no backing workflow step (`closed`) — no caption. */
  hasStep: boolean;
}

/**
 * Owner lists run to 4 people and 3 departments in live config, which is more
 * than a column can show. We surface the first few and put the full list in a
 * title tooltip.
 */
const MAX_NAMES = 2;

/**
 * One node's department pill: first name + "+N" for the rest.
 *
 * The "+N" sits OUTSIDE the truncating span and never shrinks. Department
 * names are long ("Accounting & Finance", "Research & Development") and a
 * single span would let the ellipsis eat the count — which is the one part
 * that tells you there are more departments at all.
 *
 * Sentence case, not uppercase: uppercase + tracking costs ~25% width here and
 * pushed even the one-department nodes into truncation.
 */
function DeptPill({ departments, tone }: { departments: string[]; tone: string }) {
  if (!departments.length) return null;
  const extra = departments.length - 1;
  return (
    <span
      title={departments.join(", ")}
      className={cn(
        "flex max-w-full items-center gap-0.5 rounded-pill px-1.5 py-px text-[10px] font-semibold",
        tone
      )}
    >
      <span className="truncate">{departments[0]}</span>
      {extra > 0 && <span className="shrink-0 font-bold opacity-75">+{extra}</span>}
    </span>
  );
}

export default function PoStageRail({
  nodes,
  activeIndex,
  finished,
  fit = false,
}: {
  nodes: PoStageRailNode[];
  /** Index of the stage the PO is currently sitting on. */
  activeIndex: number;
  /** True once the final stage is itself complete (a closed PO). */
  finished: boolean;
  /**
   * Fit every node into the available width instead of scrolling. Fixed-width
   * nodes (the default) scroll when the rail is wider than its container — fine
   * on the full-width PO detail, but a narrow column would clip. `fit` makes the
   * nodes share the width evenly (they truncate rather than overflow).
   */
  fit?: boolean;
}) {
  return (
    // items-start (not center): captions make columns vary in height, and we
    // need every circle to stay on one line.
    <div className={cn("flex items-start py-1", !fit && "overflow-x-auto")}>
      {nodes.map((n, i) => {
        const done = i < activeIndex || (finished && i === activeIndex);
        const current = i === activeIndex && !finished;

        const shown = n.people.slice(0, MAX_NAMES);
        const extraPeople = n.people.length - shown.length;

        const deptTone = current
          ? "bg-orange-soft text-orange"
          : done
            ? "bg-page text-grey"
            : "bg-page text-grey-2/70";
        const peopleTone = current
          ? "text-navy font-medium"
          : done
            ? "text-grey-2"
            : "text-grey-2/60";

        return (
          <div
            key={n.key}
            className={cn(
              "relative flex flex-col items-center px-1",
              fit ? "min-w-0 flex-1 basis-0" : "w-[132px] shrink-0"
            )}
          >
            {/* Connector, anchored to the circle's centre rather than offset up
                from the column bottom — captions make column height vary. */}
            {i < nodes.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-[13px] left-1/2 h-0.5 w-full",
                  i < activeIndex ? "bg-ryg-green" : "bg-line"
                )}
              />
            )}

            <div
              className={cn(
                "relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-[12px] font-semibold",
                done && "bg-ryg-green border-ryg-green text-white",
                current && "bg-orange border-orange text-white",
                !done && !current && "bg-white border-line text-grey-2"
              )}
            >
              {done ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              ) : (
                i + 1
              )}
            </div>

            <span
              title={n.label}
              className={cn(
                "mt-1 w-full truncate text-center text-[10.5px]",
                current ? "text-orange font-semibold" : "text-grey-2"
              )}
            >
              {n.label}
            </span>

            {/* Fixed min-height keeps all columns bottom-aligned even where the
                caption is empty (the `closed` node). */}
            <div className="mt-1 flex min-h-[52px] w-full flex-col items-center gap-0.5">
              {n.hasStep && (
                <>
                  <DeptPill departments={n.departments} tone={deptTone} />
                  {shown.length ? (
                    <span
                      title={n.people.join(", ")}
                      className={cn(
                        "flex w-full flex-col items-center text-[10px] leading-tight",
                        peopleTone
                      )}
                    >
                      {shown.map((name) => (
                        <span key={name} className="w-full truncate text-center">
                          {name}
                        </span>
                      ))}
                      {extraPeople > 0 && (
                        <span className="text-grey-2/70">+{extraPeople} more</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[10px] italic text-grey-2/50">Unassigned</span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
