import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";

export interface ComboOption {
  value: string;
  label: string;
  sublabel?: string;
  icon?: ReactNode;
}

/**
 * Searchable single-select dropdown used across the app instead of native <select>.
 * Shows a search box automatically when the list is long (configurable). Closes on
 * outside-click / Escape. Themed to match the form fields.
 */
export default function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
  searchable,
  className,
  align = "left",
  onCreate,
  createLabel = (q) => `Add “${q}”`,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Force search box on/off; default: show when > 6 options. */
  searchable?: boolean;
  className?: string;
  align?: "left" | "right";
  /**
   * When provided, an "Add …" row appears for a search term that doesn't exactly
   * match an existing option. Should create the option and return its value so it
   * can be selected immediately.
   */
  onCreate?: (label: string) => string | void;
  /** Render text for the create row; defaults to `Add “<query>”`. */
  createLabel?: (q: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; minWidth: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? (!!onCreate || options.length > 6);
  const selected = options.find((o) => o.value === value);

  // Position the portalled menu under the trigger using fixed coords so it
  // escapes any `overflow-hidden` ancestor (e.g. a Card) that would clip it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      setPos({
        top: r.bottom + 4,
        minWidth: r.width,
        ...(align === "right" ? { right: window.innerWidth - r.right } : { left: r.left }),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    if (showSearch) setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, showSearch]);

  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const s = q.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(s) || o.sublabel?.toLowerCase().includes(s));
  }, [q, options]);

  // Offer creation only when the term doesn't already exactly match an option.
  const trimmed = q.trim();
  const canCreate =
    !!onCreate && trimmed.length > 0 && !options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());

  const create = () => {
    if (!onCreate) return;
    const created = onCreate(trimmed);
    if (typeof created === "string") onChange(created);
    setOpen(false);
    setQ("");
  };

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-left transition",
          "outline-none focus:border-orange focus:ring-4 focus:ring-orange/10",
          disabled ? "bg-page text-grey-2 cursor-not-allowed" : "text-ink hover:border-[#d9e2f0] cursor-pointer",
          open && "border-orange ring-4 ring-orange/10"
        )}
      >
        {selected?.icon && <span className="shrink-0 flex items-center">{selected.icon}</span>}
        <span className={cn("flex-1 truncate", !selected && "text-grey-2")}>{selected?.label ?? placeholder}</span>
        <svg className={cn("text-grey-2 transition-transform shrink-0", open && "rotate-180")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, right: pos.right, minWidth: pos.minWidth }}
          className="z-[70] w-max max-w-[320px] bg-white border border-line rounded-xl shadow-card overflow-hidden"
        >
          {showSearch && (
            <div className="p-2 border-b border-line">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-grey-2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canCreate && filtered.length === 0) {
                      e.preventDefault();
                      create();
                    }
                  }}
                  placeholder={onCreate ? "Search or add…" : "Search…"}
                  className="w-full rounded-lg border border-line bg-page pl-8 pr-2 py-1.5 text-[13px] text-ink placeholder:text-grey-2 outline-none focus:border-orange"
                />
              </div>
            </div>
          )}
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && !canCreate ? (
              <li className="px-3 py-3 text-center text-[12.5px] text-grey-2">No matches</li>
            ) : (
              filtered.map((o) => {
                const on = o.value === value;
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                        setQ("");
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition hover:bg-page",
                        on && "bg-orange-soft/60"
                      )}
                    >
                      {o.icon && <span className="shrink-0 flex items-center">{o.icon}</span>}
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[13.5px] truncate", on ? "text-orange font-semibold" : "text-navy")}>{o.label}</span>
                        {o.sublabel && <span className="block text-[11px] text-grey-2 truncate">{o.sublabel}</span>}
                      </span>
                      {on && (
                        <svg className="text-orange shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                      )}
                    </button>
                  </li>
                );
              })
            )}
            {canCreate && (
              <li className={cn(filtered.length > 0 && "border-t border-line mt-1 pt-1")}>
                <button
                  type="button"
                  onClick={create}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition hover:bg-orange-soft/40"
                >
                  <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-orange-soft text-orange">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] text-orange font-semibold truncate">{createLabel(trimmed)}</span>
                </button>
              </li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
