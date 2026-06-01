import { cn } from "@/shared/lib/cn";
import type { PaginationState } from "@/shared/lib/usePagination";

/**
 * Shared table/list pagination bar — "Showing X–Y of N", an optional rows-per-page
 * selector, and numbered page buttons with prev/next. PROJECT RULE: render this
 * under every table/long list, driven by usePagination(). Hidden when empty.
 */
export default function Pagination<T>({
  state,
  rowsLabel = "rows",
  pageSizeOptions = [25, 50, 100],
  showPageSize = true,
  className,
}: {
  state: PaginationState<T>;
  rowsLabel?: string;
  pageSizeOptions?: number[];
  showPageSize?: boolean;
  className?: string;
}) {
  const { page, pageCount, total, from, to, pageSize, setPage, setPageSize } = state;
  if (total === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-line", className)}>
      <span className="text-[12.5px] text-grey-2">
        Showing <b className="text-navy font-semibold">{from}–{to}</b> of{" "}
        <b className="text-navy font-semibold">{total}</b> {rowsLabel}
      </span>

      <div className="flex items-center gap-3">
        {showPageSize && (
          <label className="hidden sm:flex items-center gap-1.5 text-[12.5px] text-grey-2">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-lg border border-line bg-white px-2 py-1 text-[12.5px] text-navy outline-none focus:border-orange"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}

        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <PageButton disabled={page === 1} onClick={() => setPage(page - 1)} label="Previous page">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </PageButton>
            {pageList(page, pageCount).map((p, i) =>
              p === "…" ? (
                <span key={`gap-${i}`} className="px-1.5 text-grey-2 text-[13px]">…</span>
              ) : (
                <PageButton key={p} active={p === page} onClick={() => setPage(p)} label={`Page ${p}`}>
                  {p}
                </PageButton>
              )
            )}
            <PageButton disabled={page === pageCount} onClick={() => setPage(page + 1)} label="Next page">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </PageButton>
          </div>
        )}
      </div>
    </div>
  );
}

function PageButton({
  children,
  onClick,
  active,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "min-w-[30px] h-[30px] px-2 inline-flex items-center justify-center rounded-lg text-[13px] font-medium transition border",
        active
          ? "bg-orange border-orange text-white"
          : "border-line text-navy hover:border-orange/50 hover:text-orange",
        disabled && "opacity-40 cursor-not-allowed hover:border-line hover:text-navy"
      )}
    >
      {children}
    </button>
  );
}

/** Page numbers with ellipsis: 1 … p-1 p p+1 … last (first/last always shown). */
function pageList(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) out.push("…");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pageCount - 1) out.push("…");
  out.push(pageCount);
  return out;
}
