import { useEffect } from "react";
import type { ReactNode } from "react";

/**
 * Full-screen viewer for one already-resolved image url, with room for actions.
 *
 * WHY IT EXISTS. A proof-of-delivery photo is checked, not admired: is the
 * signature legible, is the stamp in frame, is this even the right sheet? On a
 * 6" screen a 90px thumbnail cannot answer any of that, and the answer has to
 * arrive while the person is still standing where they could retake the shot.
 *
 * ⚠ NOT A `Modal`. That component owns `body.overflow`, renders a titled card
 *   and drops its footer in read-only mode — all wrong for an edge-to-edge
 *   image. This sits at z-70, ABOVE Modal's z-60 dialog, so it can be opened
 *   from inside one.
 *
 * Modelled on the lightbox inside leads-dashboard's LeadMediaDialog. Written
 * separately rather than lifted out of it: `build` is this repo's only gate, so
 * changing a working screen in another app to share thirty lines is the more
 * expensive side of the trade. Worth deduplicating if a third caller appears.
 */
export default function PhotoLightbox({
  url,
  alt = "Attachment",
  caption,
  actions,
  onClose,
}: {
  /** A resolved, displayable url — signed or an object url. Null renders nothing. */
  url: string | null;
  alt?: string;
  /** Shown bottom-left, e.g. "Page 2 of 3". */
  caption?: ReactNode;
  /** Buttons rendered along the bottom — Make front, Remove, and the like. */
  actions?: ReactNode;
  onClose: () => void;
}) {
  // Escape closes the viewer and nothing else. Capture phase, and the event is
  // stopped: without that, a lightbox opened from inside a Modal would close
  // BOTH on one keypress, throwing away a half-filled form.
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-navy/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <div className="flex justify-end p-3 shrink-0">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-11 h-11 rounded-full bg-white/90 text-navy flex items-center justify-center hover:bg-white transition"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
        </button>
      </div>

      {/* `min-h-0` lets the image shrink inside the flex column instead of
          pushing the action bar off the bottom of the screen. */}
      <div className="grow min-h-0 flex items-center justify-center px-4">
        <img
          src={url}
          alt={alt}
          className="max-w-full max-h-full object-contain rounded-lg shadow-card"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {(caption || actions) && (
        <div
          className="shrink-0 flex flex-wrap items-center justify-between gap-3 p-4 pb-6"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-[12.5px] font-medium text-white/80">{caption}</span>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
    </div>
  );
}
