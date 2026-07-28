/**
 * The activity trail for one request.
 *
 * Rows come from fms_customer_activity, written by fms_customer_announce inside
 * each workflow RPC — so the trail is a by-product of the transition, not
 * something a screen remembers to write.
 *
 * ⚠ IT IS A LOG, NOT THE STATE. announce() is best-effort and swallows its own
 *   errors, so a missing row means a notification failed, never that a step did
 *   not happen. Nothing in this module may infer status from here — that is
 *   `status`'s job (see queues.ts).
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { dmyTime } from "@hub/lib/customerOnboarding/format";
import type { CustomerActivity } from "@hub/lib/customerOnboarding/types";

const SHOWN = 8;

export default function ActivityTimeline({
  items, personName,
}: {
  items: CustomerActivity[];
  personName: (id: string | null | undefined) => string;
}) {
  const [all, setAll] = useState(false);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>;
  }

  const shown = all ? items : items.slice(0, SHOWN);

  return (
    <>
      <ul className="space-y-3">
        {shown.map((a) => (
          <li key={a.id} className="flex gap-3 text-sm">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
            <div className="min-w-0">
              <div className="text-foreground">{a.note ?? a.type}</div>
              <div className="text-xs text-muted-foreground">
                {personName(a.actorId)} · {dmyTime(a.createdAt)}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {items.length > SHOWN && (
        <Button
          variant="ghost" size="sm" className="mt-2 gap-1 text-xs text-muted-foreground"
          onClick={() => setAll((v) => !v)}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${all ? "rotate-180" : ""}`} />
          {all ? "Show less" : `Show all ${items.length}`}
        </Button>
      )}
    </>
  );
}
