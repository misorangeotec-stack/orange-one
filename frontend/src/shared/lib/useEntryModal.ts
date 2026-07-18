import { useState } from "react";

/**
 * One stage entry open in a modal, and why it is open: to be corrected, or just
 * to be looked at.
 *
 * A completed FMS row can be edited (you own the step and nothing downstream has
 * happened) or locked. Locked used to mean the row was a dead end — no way to see
 * what was actually recorded. It now opens the same modal read-only, which is why
 * the mode lives WITH the row rather than in a second `viewing` state: one state
 * means one mounted modal per stage instead of two, and a screen like the PO
 * queues drives six stages at once.
 */
export type EntryMode = "edit" | "view";

export function useEntryModal<T>() {
  const [target, setTarget] = useState<{ row: T; mode: EntryMode } | null>(null);
  return {
    /** The row to seed the modal from — `null` when the modal is closed. */
    row: target?.row ?? null,
    isView: target?.mode === "view",
    openEdit: (row: T) => setTarget({ row, mode: "edit" }),
    openView: (row: T) => setTarget({ row, mode: "view" }),
    close: () => setTarget(null),
  };
}
