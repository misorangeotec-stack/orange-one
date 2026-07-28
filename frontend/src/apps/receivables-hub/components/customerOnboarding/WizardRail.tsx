/**
 * The numbered progress rail down the left of the wizard.
 *
 * ⚠ `error` renders only for a step the user has ALREADY ATTEMPTED. Validating
 *   the whole form up front is what makes the Review pane instant, but painting
 *   six red badges on a form nobody has typed into yet reads as "you have done
 *   something wrong" before they have done anything at all. `attempted` is what
 *   separates "invalid" from "not filled in yet".
 *
 * Backwards navigation is always allowed — a user may jump to any step they have
 * already seen. Forwards is gated by the Next button, which validates.
 */
import { Check, AlertCircle } from "lucide-react";
import { cn } from "@hub/lib/utils";
import { FORM_STEPS, REVIEW_STEP_INDEX } from "@hub/lib/customerOnboarding/steps";

export interface RailStep {
  index: number;
  title: string;
  state: "done" | "current" | "todo" | "error";
}

export function buildRailSteps(
  currentIndex: number, attempted: Set<number>, invalid: Set<number>, furthest: number,
): RailStep[] {
  const all = [
    ...FORM_STEPS.map((s) => ({ index: s.index, title: s.title })),
    { index: REVIEW_STEP_INDEX, title: "Review & submit" },
  ];
  return all.map((s) => {
    const state: RailStep["state"] =
      s.index === currentIndex ? "current"
      : attempted.has(s.index) && invalid.has(s.index) ? "error"
      : s.index < furthest || attempted.has(s.index) ? "done"
      : "todo";
    return { ...s, state };
  });
}

export default function WizardRail({
  steps, onJump, className,
}: {
  steps: RailStep[];
  /** Only called for steps the user is allowed back into. */
  onJump: (index: number) => void;
  className?: string;
}) {
  return (
    <nav className={cn("space-y-0.5", className)} aria-label="Form steps">
      {steps.map((s, i) => {
        const clickable = s.state !== "todo";
        return (
          <button
            key={s.index}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onJump(s.index)}
            aria-current={s.state === "current" ? "step" : undefined}
            className={cn(
              "relative flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors",
              clickable ? "hover:bg-muted/60 cursor-pointer" : "cursor-default",
              s.state === "current" && "bg-primary/10",
            )}
          >
            {/* connector between badges */}
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[1.4rem] top-[2.15rem] h-[calc(100%-1.15rem)] w-px",
                  s.state === "done" ? "bg-primary/40" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                s.state === "done"    && "bg-primary text-primary-foreground border-primary",
                s.state === "current" && "bg-primary/15 text-primary border-primary ring-2 ring-primary/25",
                s.state === "todo"    && "bg-muted text-muted-foreground border-border",
                s.state === "error"   && "bg-destructive/10 text-destructive border-destructive",
              )}
            >
              {s.state === "done" ? <Check className="h-3.5 w-3.5" />
                : s.state === "error" ? <AlertCircle className="h-3.5 w-3.5" />
                : s.index}
            </span>
            <span
              className={cn(
                "text-sm leading-tight pt-0.5",
                s.state === "current" ? "font-medium text-foreground"
                  : s.state === "error" ? "text-destructive"
                  : s.state === "todo" ? "text-muted-foreground"
                  : "text-foreground",
              )}
            >
              {s.title}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
