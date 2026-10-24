import { Suspense, lazy, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { HandoffTarget } from "../lib/orderHandoff";

/*
 * The purchase raise forms, loaded only when a slide-over first opens — the Ink sheet should not
 * carry two purchase apps in its own bundle.
 */
const ImportRaise = lazy(() => import("../../import/embed/RaiseFromInk"));
const DomesticRaise = lazy(() => import("../../procurement/embed/RaiseFromInk"));

/**
 * RAISE IN PLACE. The Purchase RM Import / Domestic New Request page, slid in from the right over
 * the Ink sheet, pre-filled from the order — no new tab to wait for (user, 2026-10-23).
 *
 * Deliberately NOT a Radix sheet: Radix makes everything outside the panel inert, and the purchase
 * forms' dropdowns render in a portal outside it, so they could not be clicked. This is a plain
 * fixed panel at z-65 — above the Place order dialog (z-60), below those dropdowns (z-70).
 */
export default function RaiseSlider({
  target,
  inkId,
  onClose,
  onSubmitted,
}: {
  target: HandoffTarget;
  inkId: string;
  onClose: () => void;
  onSubmitted: (requestId: string) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // An open dropdown (Combobox / MultiSelect menu) owns Escape — let it through untouched so
      // it closes just the menu. The Place order dialog underneath ignores it too (Modal checks
      // for the same marker).
      if (document.querySelector("[data-portal-menu]")) return;
      e.stopPropagation();
      // A dialog the form opened inside this panel (Map items, request a master …) is on top:
      // Escape must not throw away the whole half-filled request. Its own Close button closes it.
      if (panelRef.current?.querySelector(".fixed.inset-0")) return;
      onClose();
    };
    // Capture phase, so Escape closes this panel and not the dialog underneath.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const Form = target === "import" ? ImportRaise : DomesticRaise;
  // Portalled to <body>: opened from inside the Place order dialog, whose animation leaves a
  // transform on it — and a transformed ancestor would pin this "fixed" panel to the dialog.
  return createPortal(
    <div className="fixed inset-0 z-[65] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        ref={panelRef}
        role="dialog"
        aria-label={target === "import" ? "Raise Import request" : "Raise Domestic request"}
        className="relative flex h-full w-full max-w-5xl flex-col bg-background shadow-2xl animate-in slide-in-from-right duration-200"
      >
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-sm font-semibold">
            {target === "import" ? "Purchase RM Import — new request" : "Purchase RM Domestic — new request"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Opening the request form…</p>}>
            <Form inkId={inkId} onSubmitted={onSubmitted} />
          </Suspense>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
