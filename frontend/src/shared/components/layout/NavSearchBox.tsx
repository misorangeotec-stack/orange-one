import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/shared/lib/cn";
import { searchNav, type SearchEntry } from "./navSearch";

/**
 * The "search any FMS or report" box, as parts — the state hook, the input, the result list
 * and the collapsed-panel icon — so every left panel in the portal can carry the SAME box.
 *
 * Three panels use it: the shared one (Sidebar.tsx, on every AppShell app) and the two that
 * draw their own, Reports (ReportsSidebar) and the Outstanding Dashboard (UserSidebar). All
 * three are the dark navy panel, which is what the colours below assume. Customer Orders
 * deliberately has none: a customer must not be shown the staff modules.
 *
 * Parts rather than one component because the panels differ in where the results go — each
 * swaps its own menu for the results while something is typed.
 */
export function useNavSearch({
  entries,
  onNavigate,
  shortcut,
  onShortcut,
}: {
  entries: SearchEntry[];
  /** After a result is opened (e.g. close the mobile drawer). */
  onNavigate?: () => void;
  /** Listen for Ctrl+K. Only ONE mounted box should, or they fight over the keypress. */
  shortcut?: boolean;
  /** Ctrl+K pressed — e.g. expand a collapsed panel so the input exists to focus. */
  onShortcut?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const results = useMemo(() => searchNav(entries, query), [entries, query]);
  const searching = query.trim() !== "";
  useEffect(() => setCursor(0), [query]);

  // After the panel has expanded and the input exists.
  const focus = () => window.setTimeout(() => inputRef.current?.focus(), 0);

  const open = (to: string) => {
    setQuery("");
    inputRef.current?.blur();
    navigate(to);
    onNavigate?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && results[cursor]) {
      e.preventDefault();
      open(results[cursor].to);
    } else if (e.key === "Escape") {
      setQuery("");
      inputRef.current?.blur();
    }
  };

  const onShortcutRef = useRef(onShortcut);
  onShortcutRef.current = onShortcut;
  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onShortcutRef.current?.();
        focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  return { query, setQuery, cursor, setCursor, results, searching, inputRef, focus, open, onKeyDown, shortcut };
}

export type NavSearchState = ReturnType<typeof useNavSearch>;

export function NavSearchInput({ s, className }: { s: NavSearchState; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
        <SearchIcon />
      </span>
      <input
        ref={s.inputRef}
        type="search"
        value={s.query}
        onChange={(e) => s.setQuery(e.target.value)}
        onKeyDown={s.onKeyDown}
        placeholder="Search FMS, reports…"
        aria-label="Search FMS and reports"
        autoComplete="off"
        spellCheck={false}
        className="w-full h-10 rounded-xl bg-white/[0.07] border border-white/10 pl-9 pr-9 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-orange/70 focus:bg-white/[0.10] transition-colors [&::-webkit-search-cancel-button]:hidden"
      />
      {s.query ? (
        <button
          type="button"
          onClick={() => {
            s.setQuery("");
            s.inputRef.current?.focus();
          }}
          title="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08]"
        >
          ×
        </button>
      ) : (
        s.shortcut && (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-white/30">
            Ctrl K
          </kbd>
        )
      )}
    </div>
  );
}

/** What a collapsed (icons-only) panel shows instead of the box. */
export function NavSearchIconButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Search FMS & reports (Ctrl+K)"
      className={cn(
        "w-full h-10 rounded-xl flex items-center justify-center text-[#aebbd4] hover:bg-white/[0.08] hover:text-white transition-colors",
        className
      )}
    >
      <SearchIcon />
    </button>
  );
}

export function NavSearchResults({ s }: { s: NavSearchState }) {
  if (!s.results.length) {
    return <p className="px-3 py-6 text-center text-[12.5px] text-white/45">Nothing found for “{s.query.trim()}”.</p>;
  }
  return (
    <div className="space-y-0.5">
      {s.results.map((r, i) => (
        <ResultRow
          key={`${r.to}#${i}`}
          entry={r}
          active={i === s.cursor}
          onHover={() => s.setCursor(i)}
          onOpen={() => s.open(r.to)}
        />
      ))}
    </div>
  );
}

/** One search hit: the name, and faintly under it the menu group it lives in. */
function ResultRow({
  entry,
  active,
  onHover,
  onOpen,
}: {
  entry: SearchEntry;
  active: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    // A real link, so Ctrl+click / middle-click still opens a new tab.
    <a
      ref={ref}
      href={entry.to}
      onMouseEnter={onHover}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onOpen();
      }}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 transition-colors",
        active ? "bg-white/[0.10] text-white" : "text-[#aebbd4] hover:text-white"
      )}
    >
      <span className="[&>svg]:w-[18px] [&>svg]:h-[18px] shrink-0">{entry.icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[13.5px] font-medium">{entry.label}</span>
        {entry.hint && <span className="block truncate text-[11px] text-white/40">{entry.hint}</span>}
      </span>
    </a>
  );
}

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
