import { useEffect } from "react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import Button from "./Button";

/** Centered modal dialog with backdrop, themed to the Orange One surfaces. */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
  stacked = false,
  readOnly = false,
  readOnlyHeader,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** `2xl` is for dense data grids (e.g. sourcing a whole requisition) where a
   *  narrower dialog forces item names to wrap onto two lines. `3xl` matches a
   *  full intake page (max-w-4xl) — used by multi-column step modals. */
  size?: "sm" | "md" | "lg" | "xl" | "3xl" | "2xl";
  /**
   * This modal opens on top of another one. Sits at z-65 — above the parent
   * dialog (z-60) but below the portalled Combobox menu (z-70), so its own
   * dropdowns still render on top. Leaves the parent's `body.overflow` lock
   * alone (ours would clear it on unmount while the parent is still open) and
   * takes Escape on the capture phase so it closes only the top dialog.
   */
  stacked?: boolean;
  /**
   * Render this dialog as a VIEW of what was recorded, not a form.
   *
   * The body goes inside a native `<fieldset disabled>`, which disables every
   * descendant form control in one shot — so a modal opts into read-only by
   * forwarding one prop, instead of threading `disabled` through dozens of
   * inputs it would be easy to miss one of. The caller's `footer` is dropped
   * (its Save has nothing to save) in favour of a single Close.
   *
   * Two things to know before using it:
   *  • A `stacked` child modal rendered inside `children` is inside the fieldset
   *    too, so it comes up disabled. Render it outside, or don't offer it.
   *  • Controls disabled by the FIELDSET never get their own `disabled:`
   *    styling — the prop is still unset — so anything whose greyed-out look is
   *    keyed on that prop (Combobox's trigger, file-picker labels) stays looking
   *    live while being inert. Hence the cursor overrides below.
   */
  readOnly?: boolean;
  /**
   * Rendered above the body and OUTSIDE the disabled fieldset, so it stays
   * clickable in read-only mode. This exists for the stored-document links: they
   * mint a signed URL on click, so they must be real buttons, and viewing the
   * attached file is usually the point of viewing the entry at all.
   */
  readOnlyHeader?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A Combobox/MultiSelect menu is open on top of us — Escape belongs to it
      // (it closes its own menu). Closing the dialog here would discard the
      // user's half-made selection.
      if (document.querySelector("[data-portal-menu]")) return;
      if (stacked) e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, stacked);
    if (!stacked) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, stacked);
      if (!stacked) document.body.style.overflow = "";
    };
  }, [open, onClose, stacked]);

  if (!open) return null;
  const width = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-3xl", "3xl": "max-w-4xl", "2xl": "max-w-6xl" }[size];

  return (
    <div className={cn("fixed inset-0 flex items-center justify-center p-4", stacked ? "z-[65]" : "z-[60]")}>
      <div className="absolute inset-0 bg-navy/45 backdrop-blur-[2px] animate-[fade-up_.2s_ease]" onClick={onClose} />
      {/* Flex column capped to the viewport: header + footer stay put, the body
          scrolls when its content grows (e.g. adding quotation rows) instead of
          pushing the dialog off-screen. */}
      <div role="dialog" aria-modal="true" className={cn("relative w-full bg-white rounded-card-lg shadow-card border border-line animate-fade-up flex flex-col max-h-[calc(100dvh-2rem)]", width)}>
        <div className="flex items-start justify-between p-5 pb-3 shrink-0">
          <div>
            <h2 className="text-[18px] font-bold text-navy">
              {title}
              {readOnly && (
                <span className="ml-2 align-middle rounded-full bg-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey-2">
                  View only
                </span>
              )}
            </h2>
            {subtitle && <p className="text-[12.5px] text-grey mt-0.5 leading-relaxed">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-grey-2 hover:text-navy transition w-8 h-8 rounded-lg flex items-center justify-center hover:bg-page shrink-0"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          </button>
        </div>
        {/* pt-1 so the first field's label isn't shaved by the scroll edge. */}
        <div className="px-5 pt-1 pb-3 overflow-y-auto grow min-h-0">
          {readOnly ? (
            <>
              {readOnlyHeader && <div className="mb-3">{readOnlyHeader}</div>}
              {/* `min-w-0` is load-bearing: Preflight resets a fieldset's margin,
                  padding and border but NOT its `min-width: min-content`, which
                  would let a wide inner grid push straight past the dialog's
                  max-width. The cursor overrides stop now-inert controls from
                  still advertising themselves as clickable. */}
              <fieldset
                disabled
                className="min-w-0 m-0 p-0 border-0 [&_label]:cursor-default [&_button]:cursor-default"
              >
                {children}
              </fieldset>
            </>
          ) : (
            children
          )}
        </div>
        {readOnly ? (
          <div className="flex items-center justify-end gap-2.5 p-5 pt-4 shrink-0 border-t border-line/60">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          footer && <div className="flex items-center justify-end gap-2.5 p-5 pt-4 shrink-0 border-t border-line/60">{footer}</div>
        )}
      </div>
    </div>
  );
}
