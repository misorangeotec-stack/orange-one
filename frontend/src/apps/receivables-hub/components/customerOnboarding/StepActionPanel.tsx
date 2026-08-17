/**
 * The shell every decision panel sits in, plus the decision bar itself.
 *
 * ⚠ NOT A MODAL, and deliberately so. An Accounts verifier reads forty-odd
 *   fields and opens four documents before they can honestly tick "GST
 *   verified"; a dialog floating over the evidence is the wrong container. The
 *   panel is the last block on the detail page, so the decision is made at the
 *   bottom of what it is a decision about.
 *
 * ⚠ THE SERVER IS THE GATE. Everything here — who sees the panel, which buttons
 *   are enabled, whether a reason is demanded — is a courtesy. The RPC re-checks
 *   status, authorization and the reason, and its message is what surfaces on
 *   failure. Never add a rule here that does not already exist there.
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Label } from "@hub/components/ui/label";
import { Textarea } from "@hub/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@hub/components/ui/alert-dialog";
import { cn } from "@hub/lib/utils";

export function StepActionPanel({
  title, blurb, subhead, badge, children, footer, error,
}: {
  title: string;
  blurb?: string;
  /**
   * A standing fact about the request, restated at the point of decision — in
   * practice the company it is being onboarded into.
   *
   * ⚠ ITS OWN SLOT rather than reusing `badge`, which is already spoken for by
   *   "Waiting on you". A decision about a credit limit is a decision about a
   *   credit limit IN A PARTICULAR COMPANY, and the detail header alone is a
   *   scroll away by the time someone reaches this panel.
   */
  subhead?: ReactNode;
  /** e.g. "Waiting on you" — the reason this panel is on screen. */
  badge?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  error?: string | null;
}) {
  return (
    <Card className="border-primary/40 ring-1 ring-primary/10">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {blurb && <p className="text-xs text-muted-foreground mt-0.5">{blurb}</p>}
            {subhead && <div className="text-xs mt-1.5">{subhead}</div>}
          </div>
          {badge}
        </div>

        {children}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="pt-1 border-t -mx-5 px-5 -mb-1">
          <div className="pt-4 flex flex-wrap items-center gap-2">{footer}</div>
        </div>
      </CardContent>
    </Card>
  );
}

/** A read-only strip explaining why the panel is visible but unusable. */
export function PanelNotice({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        tone === "warn"
          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

export type PanelDecision = "go" | "rework" | "reject";

/**
 * The remarks box plus the three buttons, identical on all three approval steps.
 *
 * ONE remarks field, not three: the server stores one `*_remarks` column per
 * stage, and asking a reviewer to work out which of three boxes their sentence
 * belongs in is a way to lose the sentence.
 *
 * Reject goes through a confirm because it is terminal — only a coordinator can
 * reopen it — while Send back is a normal, cheap move and gets no dialog.
 */
export function DecisionBar({
  goLabel, goIcon, remarks, onRemarksChange, onDecide, busy, disabled, subject,
  remarksRequiredFor = "non-go", remarksLabel,
}: {
  goLabel: string;
  goIcon?: ReactNode;
  remarks: string;
  onRemarksChange: (v: string) => void;
  onDecide: (d: PanelDecision) => void;
  busy: boolean;
  disabled?: boolean;
  /** Named in the reject confirmation, so nobody rejects the wrong customer. */
  subject: string;
  remarksRequiredFor?: "non-go" | "none";
  remarksLabel?: string;
}) {
  const [touchedEmpty, setTouchedEmpty] = useState<PanelDecision | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const needsReason = remarksRequiredFor === "non-go";
  const blank = remarks.trim() === "";

  const attempt = (d: PanelDecision) => {
    if (d !== "go" && needsReason && blank) {
      setTouchedEmpty(d);
      return;
    }
    setTouchedEmpty(null);
    if (d === "reject") { setConfirmReject(true); return; }
    onDecide(d);
  };

  return (
    <>
      <div className="w-full space-y-2">
        <Label htmlFor="panel-remarks" className="text-xs font-medium">
          {remarksLabel ?? "Remarks"}
          {needsReason && (
            <span className="text-muted-foreground font-normal ml-1">
              (required to send back or reject)
            </span>
          )}
        </Label>
        <Textarea
          id="panel-remarks"
          rows={3}
          value={remarks}
          disabled={disabled || busy}
          onChange={(e) => { onRemarksChange(e.target.value); if (touchedEmpty) setTouchedEmpty(null); }}
          placeholder={
            needsReason
              ? "What you checked, or what needs to change…"
              : "Anything worth recording…"
          }
          aria-invalid={!!touchedEmpty}
        />
        {touchedEmpty && (
          <p className="text-[11px] text-destructive">
            {touchedEmpty === "reject"
              ? "Say why this is being rejected — it is recorded and shown to whoever raised it."
              : "Say what needs changing, or the person who raised this cannot act on it."}
          </p>
        )}
      </div>

      <div className="w-full flex flex-wrap items-center gap-2 pt-1">
        <Button onClick={() => attempt("go")} disabled={busy || disabled} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (goIcon ?? <Check className="h-4 w-4" />)}
          {goLabel}
        </Button>
        <Button
          variant="outline"
          onClick={() => attempt("rework")}
          disabled={busy || disabled}
          className="gap-1.5"
        >
          <RotateCcw className="h-4 w-4" /> Send back for changes
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          onClick={() => attempt("reject")}
          disabled={busy || disabled}
          className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <X className="h-4 w-4" /> Reject
        </Button>
      </div>

      <AlertDialog open={confirmReject} onOpenChange={setConfirmReject}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject {subject}?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends the request. Only a coordinator or an administrator can reopen it —
              if you want changes instead, use <strong>Send back for changes</strong>.
              <span className="block mt-2 rounded-md bg-muted p-2 text-foreground text-sm">
                {remarks.trim() || "(no reason given)"}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it open</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); setConfirmReject(false); onDecide("reject"); }}
            >
              Reject the request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The footer a panel wears when it is CORRECTING a step rather than deciding
 * one. No approve/reject/rework: a correction changes what was recorded, never
 * where the request went. Keeping it visibly different from DecisionBar is the
 * point — the two look nothing alike, so nobody corrects when they meant to
 * approve.
 */
export function CorrectionBar({
  onSave, onCancel, busy, saveLabel = "Save correction",
}: {
  onSave: () => void;
  onCancel?: () => void;
  busy: boolean;
  saveLabel?: string;
}) {
  return (
    <>
      <Button onClick={onSave} disabled={busy} className="gap-1.5">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {saveLabel}
      </Button>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      )}
      <p className="text-xs text-muted-foreground">
        The correction is stamped with your name and appears on the activity trail.
      </p>
    </>
  );
}

/** Small labelled slot for a panel input, matching the readout grid's rhythm. */
export function PanelField({
  id, label, hint, required, className, children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5" aria-hidden>*</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
