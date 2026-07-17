import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

/**
 * Global table/list pagination. PROJECT RULE: every table or long list in the app
 * (existing and new) paginates through this hook + the <Pagination/> component —
 * 25 rows per page by default, with page numbers and a "showing X–Y of N" count.
 *
 * Pass a `resetKey` built from the active filters so changing a filter jumps back
 * to page 1. Page is clamped when the underlying list shrinks (e.g. live refetch).
 *
 * Pass `pageState` to back the page number with sticky state (see shared/lib/
 * stickyState) so it survives leaving and re-entering the page.
 */
export const DEFAULT_PAGE_SIZE = 25;

export interface PaginationState<T> {
  pageItems: T[];
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  pageCount: number;
  total: number;
  /** 1-based index of the first row shown (0 when empty). */
  from: number;
  /** 1-based index of the last row shown. */
  to: number;
}

export function usePagination<T>(
  items: T[],
  opts?: {
    pageSize?: number;
    resetKey?: unknown;
    /**
     * Injects the page state, so a caller can back it with sticky state and have
     * restore-on-mount, reset-on-filter-change and the shrink-clamp all write
     * through ONE source of truth. Omit for the normal self-contained behaviour.
     */
    pageState?: readonly [number, Dispatch<SetStateAction<number>>];
  }
): PaginationState<T> {
  const [pageSize, setPageSize] = useState(opts?.pageSize ?? DEFAULT_PAGE_SIZE);
  // Always called (hook rules); only used when the caller supplies no pageState.
  const ownPage = useState(1);
  const [page, setPage] = opts?.pageState ?? ownPage;

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Reset to the first page when the filters or the page size CHANGE. Compared by
  // value rather than via a "first run" flag: StrictMode double-invokes mount
  // effects, so a flag would still fire the reset on pass 2 and clobber a restored
  // page (in dev only). The refs start out holding the first render's values, so
  // mount is a no-op — which is also why this stays identical for callers that
  // don't restore a page (their mount-time setPage(1) was already a no-op at 1).
  const lastReset = useRef<unknown>(opts?.resetKey);
  const lastSize = useRef(pageSize);
  useEffect(() => {
    if (Object.is(lastReset.current, opts?.resetKey) && lastSize.current === pageSize) return;
    lastReset.current = opts?.resetKey;
    lastSize.current = pageSize;
    setPage(1);
  }, [opts?.resetKey, pageSize, setPage]);

  // Keep the page in range when the list shrinks — but NOT while it is empty. An
  // empty list yields pageCount 1, which would permanently clamp a restored page 3
  // down to 1 on the render before the data hydrates. Nothing renders at total 0
  // anyway (Pagination returns null; the tables show their empty state).
  const safePage = Math.min(page, pageCount);
  useEffect(() => {
    if (total > 0 && page !== safePage) setPage(safePage);
  }, [total, page, safePage, setPage]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return {
    pageItems,
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    total,
    from: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
    to: Math.min(safePage * pageSize, total),
  };
}
