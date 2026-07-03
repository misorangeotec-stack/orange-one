import { useEffect } from "react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/** Centered modal dialog with backdrop, themed to the Orange One surfaces. */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" }[size];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy/45 backdrop-blur-[2px] animate-[fade-up_.2s_ease]" onClick={onClose} />
      {/* Flex column capped to the viewport: header + footer stay put, the body
          scrolls when its content grows (e.g. adding quotation rows) instead of
          pushing the dialog off-screen. */}
      <div role="dialog" aria-modal="true" className={cn("relative w-full bg-white rounded-card-lg shadow-card border border-line animate-fade-up flex flex-col max-h-[calc(100dvh-2rem)]", width)}>
        <div className="flex items-start justify-between p-5 pb-3 shrink-0">
          <div>
            <h2 className="text-[18px] font-bold text-navy">{title}</h2>
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
        <div className="px-5 pb-2 overflow-y-auto grow min-h-0">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2.5 p-5 pt-4 shrink-0 border-t border-line/60">{footer}</div>}
      </div>
    </div>
  );
}
