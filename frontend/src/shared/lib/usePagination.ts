import { useEffect, useMemo, useState } from "react";

/**
 * Global table/list pagination. PROJECT RULE: every table or long list in the app
 * (existing and new) paginates through this hook + the <Pagination/> component —
 * 25 rows per page by default, with page numbers and a "showing X–Y of N" count.
 *
 * Pass a `resetKey` built from the active filters so changing a filter jumps back
 * to page 1. Page is clamped when the underlying list shrinks (e.g. live refetch).
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
  opts?: { pageSize?: number; resetKey?: unknown }
): PaginationState<T> {
  const [pageSize, setPageSize] = useState(opts?.pageSize ?? DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Reset to the first page when filters change or the page size changes.
  useEffect(() => {
    setPage(1);
  }, [opts?.resetKey, pageSize]);

  // Keep the page in range when the list shrinks.
  const safePage = Math.min(page, pageCount);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

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
