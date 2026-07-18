import { Lock } from "lucide-react";
import Button from "./Button";

/**
 * The leading Actions cell of a completed FMS stage row: Edit, or — when the
 * entry can't be changed — a lock that still opens it read-only.
 *
 * Locked means CAN'T CHANGE, not can't see. Previously every one of these
 * screens rendered a bare `<span>🔒 Locked</span>`, which left the entry
 * unviewable: the only links nearby go to the parent PO or requisition, never to
 * the payment / GRN / PI / decision that was actually recorded.
 *
 * Two gates, both shown honestly and both keeping the server's own wording:
 * the entry's own lock rule first, then whether this user owns the step at all.
 * Either way the server re-checks — this only decides what the row offers.
 *
 * Typed structurally on `lockReason` rather than on a `StageEntry`, because
 * procurement, import and office-supplies each define their own.
 */
export default function StageRowAction({
  lockReason,
  canEdit,
  permissionReason,
  onEdit,
  onView,
  as = "link",
  tone = "orange",
}: {
  /** The server's reason this entry is frozen, or `null` if it isn't. */
  lockReason: string | null;
  /** Does this user own the step? A non-owner sees a locked row on a live entry. */
  canEdit: boolean;
  /** Shown when `canEdit` is false — the step-owner rule, in that app's words. */
  permissionReason: string;
  onEdit: () => void;
  onView: () => void;
  /** Match the host screen's existing look; the two families differ today. */
  as?: "link" | "button";
  /**
   * Which Edit-link colour this screen already uses. The PO queues sit their
   * Edit beside an orange "Open" link and so render it navy; every other screen
   * has no neighbour and renders it orange. Kept as a prop rather than
   * harmonised, because restyling screens this change didn't ask about is a
   * separate decision.
   */
  tone?: "navy" | "orange";
}) {
  const reason = lockReason ?? (canEdit ? null : permissionReason);

  if (reason) {
    const label = (
      <>
        <Lock className="w-3 h-3" aria-hidden />
        View
      </>
    );
    // Title carries the reason it's locked — the word "View" alone would lose the
    // one piece of information the old dead label did convey.
    return as === "button" ? (
      <Button variant="ghost" size="sm" onClick={onView} title={reason} className="inline-flex items-center gap-1">
        {label}
      </Button>
    ) : (
      <button
        onClick={onView}
        title={reason}
        className="text-[12.5px] font-semibold text-grey-2 hover:text-orange inline-flex items-center gap-1"
      >
        {label}
      </button>
    );
  }

  return as === "button" ? (
    <Button variant="ghost" size="sm" onClick={onEdit}>
      Edit
    </Button>
  ) : (
    <button
      onClick={onEdit}
      className={
        tone === "navy"
          ? "text-[12.5px] font-semibold text-navy hover:text-orange"
          : "text-[12.5px] font-semibold text-orange hover:underline"
      }
    >
      Edit
    </button>
  );
}
