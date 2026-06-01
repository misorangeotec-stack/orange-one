import { cn } from "@/shared/lib/cn";

export interface ActiveFilter {
  /** Stable key for React. */
  key: string;
  /** Human-readable chip text, e.g. `Department: Sales`. */
  label: string;
  /** Clears just this filter. */
  onClear: () => void;
}

/**
 * A strip of removable chips showing which filters are currently narrowing a
 * list, plus a "Clear all" action. Renders nothing when no filters are active,
 * so callers can drop it in unconditionally. Shared by every filterable table.
 */
export default function ActiveFilters({
  filters,
  onClearAll,
  className,
}: {
  filters: ActiveFilter[];
  onClearAll: () => void;
  className?: string;
}) {
  if (filters.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Filters</span>
      {filters.map((f) => (
        <FilterChip key={f.key} label={f.label} onClear={f.onClear} />
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-orange hover:underline"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        Clear all
      </button>
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white pl-3 pr-1.5 py-1 text-[12px] text-navy">
      <span className="truncate max-w-[220px]">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${label} filter`}
        className="flex items-center justify-center w-4 h-4 rounded-full text-grey-2 hover:bg-orange-soft hover:text-orange transition"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </span>
  );
}
