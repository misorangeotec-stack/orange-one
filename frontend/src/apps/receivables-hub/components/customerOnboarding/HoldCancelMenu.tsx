/**
 * The exception actions — hold, resume, cancel, reopen.
 *
 * Parked in an overflow menu rather than sitting on the page as buttons: they
 * are rare, three of the four are terminal or near-terminal, and putting them
 * next to "Approve" is how someone cancels a customer they meant to send back.
 *
 * Every one of them demands a written reason, enforced by the RPC. The menu
 * simply refuses to submit an empty one so the user is told before the round
 * trip, not after.
 *
 * ⚠ Visibility here MIRRORS the server. hold/resume and reopen are coordinator
 *   (or admin) only; cancel is the raiser's own withdrawal OR a coordinator's.
 *   Hiding an item is a courtesy — the RPC is the gate.
 */
import { useState } from "react";
import { MoreHorizontal, Pause, Play, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Label } from "@hub/components/ui/label";
import { Textarea } from "@hub/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@hub/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { useToast } from "@hub/hooks/use-toast";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { requestSubject } from "@hub/lib/customerOnboarding/format";
import { isTerminal } from "@hub/lib/customerOnboarding/queues";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";

type Action = "hold" | "resume" | "cancel" | "reopen";

const COPY: Record<Action, { title: string; blurb: string; label: string; cta: string }> = {
  hold: {
    title: "Put this request on hold",
    blurb: "It disappears from the queue and stops accruing overdue days until someone resumes it. Nothing is lost.",
    label: "Why is it being held?",
    cta: "Hold it",
  },
  resume: {
    title: "Resume this request",
    blurb: "It goes back to whichever step it was on when it was held.",
    label: "Anything worth noting? (optional)",
    cta: "Resume",
  },
  cancel: {
    title: "Cancel this request",
    blurb: "This ends the request. Only a coordinator or an administrator can reopen it afterwards.",
    label: "Why is it being cancelled?",
    cta: "Cancel the request",
  },
  reopen: {
    title: "Reopen this request",
    blurb: "It returns to the step it was on. The reason is recorded on the activity trail, so a rejection can never be quietly laundered into an edit.",
    label: "Why is it being reopened?",
    cta: "Reopen",
  },
};

export default function HoldCancelMenu({ request }: { request: CustomerRequest }) {
  const r = request;
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();

  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const held = r.status === "on_hold";
  const closed = isTerminal(r.status);
  // canActOn('submission') is exactly "the raiser, or a coordinator" — the same
  // pair fms_customer_cancel_request accepts. Don't re-derive it a second way.
  const canWithdraw = s.canEdit && s.canActOn("submission", r);

  const items: Action[] = [];
  if (s.isCoordinator && !held && !closed) items.push("hold");
  if (s.isCoordinator && held) items.push("resume");
  if (canWithdraw && r.status !== "completed" && r.status !== "cancelled") items.push("cancel");
  if (s.isCoordinator && (r.status === "rejected" || r.status === "cancelled")) items.push("reopen");

  if (items.length === 0) return null;

  const open = (a: Action) => { setAction(a); setReason(""); setError(null); };

  const confirm = async () => {
    if (!action) return;
    // 'resume' is the only one the server accepts without a reason.
    if (action !== "resume" && reason.trim() === "") {
      setError("A reason is required — it is recorded and shown to everyone involved.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await run(async () => {
        if (action === "hold")   return s.writes.holdRequest(r.id, true, reason);
        if (action === "resume") return s.writes.holdRequest(r.id, false, reason);
        if (action === "cancel") return s.writes.cancelRequest(r.id, reason);
        return s.writes.reopenRequest(r.id, reason);
      });
      toast({
        title:
          action === "hold" ? "Put on hold"
          : action === "resume" ? "Resumed"
          : action === "cancel" ? "Request cancelled"
          : "Request reopened",
      });
      setAction(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = action ? COPY[action] : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="px-2" aria-label="More actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.includes("hold") && (
            <DropdownMenuItem onSelect={() => open("hold")} className="gap-2">
              <Pause className="h-4 w-4" /> Put on hold
            </DropdownMenuItem>
          )}
          {items.includes("resume") && (
            <DropdownMenuItem onSelect={() => open("resume")} className="gap-2">
              <Play className="h-4 w-4" /> Resume
            </DropdownMenuItem>
          )}
          {items.includes("reopen") && (
            <DropdownMenuItem onSelect={() => open("reopen")} className="gap-2">
              <RotateCcw className="h-4 w-4" /> Reopen
            </DropdownMenuItem>
          )}
          {items.includes("cancel") && (
            <DropdownMenuItem onSelect={() => open("cancel")} className="gap-2 text-destructive focus:text-destructive">
              <XCircle className="h-4 w-4" /> Cancel request
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!action} onOpenChange={(o) => !o && !busy && setAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>
              {requestSubject(r)}{r.reqNo ? ` · ${r.reqNo}` : ""} — {copy?.blurb}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="exception-reason" className="text-xs font-medium">{copy?.label}</Label>
            <Textarea
              id="exception-reason"
              rows={3}
              value={reason}
              disabled={busy}
              onChange={(e) => { setReason(e.target.value); if (error) setError(null); }}
              autoFocus
            />
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={busy}>Never mind</Button>
            <Button onClick={() => void confirm()} disabled={busy}>
              {busy ? "Working…" : copy?.cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
