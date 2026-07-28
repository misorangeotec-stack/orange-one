/**
 * The lifecycle rail on a request's detail page — five nodes, left to right,
 * captioned with who owns each step.
 *
 * Hub-native twin of shared/components/ui/PoStageRail. Not an import: that one
 * hard-codes Orange One's portal tokens (border-line, text-navy, accent-orange),
 * which .hub-root does NOT remap because they are global Tailwind theme colours
 * rather than the scoped shadcn CSS vars. Dropped into a hub page it renders as
 * a different product on the same screen.
 *
 * ⚠ House rule: Progress is ALWAYS the first block on a detail page.
 */
import { Check, X, Pause } from "lucide-react";
import { cn } from "@hub/lib/utils";
import { STEPS, type StepKey } from "@hub/lib/customerOnboarding/steps";
import { openStep } from "@hub/lib/customerOnboarding/queues";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";
import { dmy } from "@hub/lib/customerOnboarding/format";

type NodeState = "done" | "current" | "todo" | "skipped" | "stopped";

interface RailNode {
  key: StepKey;
  label: string;
  state: NodeState;
  when: string | null;
  who: string;
}

export default function RequestStageRail({
  request, personName,
}: {
  request: CustomerRequest;
  /** Resolves a user id to a display name — pass store.personName. */
  personName: (id: string | null | undefined) => string;
}) {
  const r = request;
  const current = openStep(r);
  const halted = r.status === "rejected" || r.status === "cancelled";
  const held = r.status === "on_hold";

  const stampFor = (key: StepKey): string | null =>
    key === "submission"            ? r.submittedAt
    : key === "accounts_verification" ? r.accVerifiedAt
    : key === "sales_head_approval"   ? r.shDecidedAt
    : key === "director_approval"     ? r.dirDecidedAt
    : r.tallyAt;

  const actorFor = (key: StepKey): string | null =>
    key === "submission"            ? r.raisedBy
    : key === "accounts_verification" ? r.accVerifiedBy
    : key === "sales_head_approval"   ? r.shDecidedBy
    : key === "director_approval"     ? r.dirDecidedBy
    : r.tallyBy;

  const nodes: RailNode[] = STEPS.map((step) => {
    const stamp = stampFor(step.key);

    // The director node is a real part of the lifecycle only when this request
    // needed one. Once the sales head has decided and dirRequired is false, show
    // it greyed as "not required" rather than pretending it is still ahead.
    const notRequired =
      step.key === "director_approval" && r.shDecidedAt !== null && !r.dirRequired;

    const state: NodeState =
      notRequired            ? "skipped"
      : halted && current === null && !stamp ? "stopped"
      : stamp                ? "done"
      : current === step.key ? "current"
      : "todo";

    return {
      key: step.key,
      label: step.short,
      state,
      when: stamp,
      who: step.key === "submission"
        ? (r.raisedByName ?? personName(actorFor(step.key)))
        : personName(actorFor(step.key)),
    };
  });

  return (
    <div className="w-full overflow-x-auto">
      <ol className="flex min-w-[640px] items-start gap-0">
        {nodes.map((n, i) => (
          <li key={n.key} className="flex-1 flex flex-col items-center text-center">
            <div className="flex w-full items-center">
              {/* connector in */}
              <span
                className={cn(
                  "h-px flex-1",
                  i === 0 ? "bg-transparent" : nodes[i - 1].state === "done" ? "bg-primary" : "bg-border",
                )}
              />
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                  n.state === "done"    && "bg-primary text-primary-foreground border-primary",
                  n.state === "current" && "bg-primary/15 text-primary border-primary ring-2 ring-primary/30",
                  n.state === "todo"    && "bg-muted text-muted-foreground border-border",
                  n.state === "skipped" && "bg-muted/50 text-muted-foreground/60 border-dashed border-border",
                  n.state === "stopped" && "bg-destructive/10 text-destructive border-destructive/40",
                )}
                aria-current={n.state === "current" ? "step" : undefined}
              >
                {n.state === "done" ? <Check className="h-4 w-4" />
                  : n.state === "stopped" ? <X className="h-4 w-4" />
                  : held && n.state === "current" ? <Pause className="h-4 w-4" />
                  : i + 1}
              </span>
              {/* connector out */}
              <span
                className={cn(
                  "h-px flex-1",
                  i === nodes.length - 1 ? "bg-transparent" : n.state === "done" ? "bg-primary" : "bg-border",
                )}
              />
            </div>

            <div className="mt-2 px-1">
              <div
                className={cn(
                  "text-xs font-medium",
                  n.state === "current" ? "text-primary"
                    : n.state === "skipped" ? "text-muted-foreground/60"
                    : "text-foreground",
                )}
              >
                {n.label}
              </div>
              <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                {n.state === "skipped" ? "Not required"
                  : n.state === "done"  ? <>{dmy(n.when)}<br />{n.who}</>
                  : n.state === "current" ? (held ? "On hold" : "In progress")
                  : "—"}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
