import { useEffect, useState } from "react";
import { Button } from "@hub/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { Label } from "@hub/components/ui/label";
import { Textarea } from "@hub/components/ui/textarea";
import { describeClear, type ClearFields } from "@hub/lib/clearStatus";

/**
 * Close a settled case, or reopen one (RC-12).
 *
 * ── Why the note is required ──
 * A partly-paid case may always be cleared — the client decided there is no balance check, because
 * a settlement or a write-off must be closeable. That makes the note the ONLY thing that explains a
 * cleared row with money still owed against it a month later ("settled at 9L", "legal, written
 * off"). It is enforced three times over: here, in the Edge Function, and by a check constraint on
 * the table. This dialog is the one that can say so politely.
 *
 * ── Reopen shows the last note rather than asking for a new one ──
 * Reopening is rare and usually means "they stopped paying again". The useful thing on screen is
 * how it was closed last time, which is exactly what the row still carries.
 *
 * Shared with RC-13's disputed bills: the wording is parameterised by `subject`, nothing else.
 */
export function ClearNoteDialog({ mode, subject, row, busy, onCancel, onConfirm }: {
  mode: "clear" | "reopen" | null;
  /** What is being closed, in the user's words — e.g. "SAMEER ENTERPRISES · Otec Surat". */
  subject: string;
  /** The row's current clear fields, so reopen can show how it was closed last time. */
  row: ClearFields | null;
  busy: boolean;
  onCancel: () => void;
  /** Resolves when the write lands; the dialog stays open (and keeps the text) if it throws. */
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A fresh dialog starts empty — never carrying the previous customer's note into this one.
  useEffect(() => {
    if (mode) { setNote(""); setError(null); }
  }, [mode, subject]);

  const confirm = () => {
    if (mode === "clear" && note.trim() === "") {
      setError("A note is required — say how the case was settled (paid in full, settled at ₹9L, written off…).");
      return;
    }
    onConfirm(note.trim());
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "reopen" ? "Reopen this Red Mark?" : "Clear this Red Mark?"}</DialogTitle>
          <DialogDescription>
            {subject}
            {mode === "reopen"
              ? " will count as Red Mark again across the dashboard, the risk register and the reports."
              : " will stop counting as Red Mark everywhere. The record stays on the master, marked cleared — this is not a delete."}
          </DialogDescription>
        </DialogHeader>

        {mode === "clear" ? (
          <div className="space-y-2">
            <Label htmlFor="clear-note" className="text-xs font-medium">
              How was it settled? <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="clear-note"
              rows={3}
              value={note}
              disabled={busy}
              onChange={(e) => { setNote(e.target.value); if (error) setError(null); }}
              placeholder="Paid in full on 12-09 / settled at ₹9L, balance written off / legal settlement"
              autoFocus
            />
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <p className="text-[11px] text-muted-foreground">
              A case can be cleared even with money still outstanding, so this note is what explains it later.
            </p>
          </div>
        ) : (
          row && (
            <p className="text-xs text-muted-foreground">
              {describeClear({ ...row, cleared: true })}
            </p>
          )
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Never mind</Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? "Working…" : mode === "reopen" ? "Reopen" : "Clear"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
