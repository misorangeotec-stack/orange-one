import { cn } from "@/shared/lib/cn";
import type { PurchaseOrder } from "../types";

/** The PO lifecycle stages, in order, for the detail stepper. */
const STAGES = [
  { key: "generated", label: "Generated" },
  { key: "share_po", label: "Share PO" },
  { key: "collect_pi", label: "Collect PI" },
  { key: "advance_payment", label: "Advance" },
  { key: "follow_up", label: "Follow-up" },
  { key: "inward", label: "Inward" },
  { key: "tally", label: "Tally" },
  { key: "final_payment", label: "Final Pay" },
  { key: "closed", label: "Closed" },
];

function activeIndex(po: PurchaseOrder): number {
  // Terminal stages sit at the final "Closed" node.
  if (po.currentStage === "closed" || po.currentStage === "cancelled") return STAGES.length - 1;
  const i = STAGES.findIndex((st) => st.key === po.currentStage);
  // The leading 'generated' node is always done for a live PO — the earliest
  // real stage is share_po (index 1). Unknown stages fall back to share_po.
  return i < 1 ? 1 : i;
}

/** Horizontal lifecycle stepper for a PO. */
export default function PoStepper({ po }: { po: PurchaseOrder }) {
  const active = activeIndex(po);
  // A 'closed' PO has finished its final stage — the last node is DONE (green
  // check), not an in-progress step. (Cancelled stays highlighted, not ticked.)
  const finished = po.currentStage === "closed";
  return (
    <div className="flex items-center overflow-x-auto py-1">
      {STAGES.map((st, i) => {
        const done = i < active || (finished && i === active);
        const current = i === active && !finished;
        return (
          <div key={st.key} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-1 px-1">
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold border-2",
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
              <span className={cn("text-[10.5px] whitespace-nowrap", current ? "text-orange font-semibold" : "text-grey-2")}>{st.label}</span>
            </div>
            {i < STAGES.length - 1 && <div className={cn("w-8 h-0.5 mt-[-14px]", i < active ? "bg-ryg-green" : "bg-line")} />}
          </div>
        );
      })}
    </div>
  );
}
