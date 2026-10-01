import { useMemo, useState, type ReactNode } from "react";
import MultiSelect from "@/shared/components/ui/MultiSelect";

/**
 * Click-to-sort headings + a filter under every heading, for the Ink Expiry tables.
 *
 * Each column says how to show a value (`text`), how to order it (`sort`), and — optionally —
 * what to FILTER by (`bucket`). Numbers filter by band, not by exact value: nobody wants to
 * tick "147.5 KGS" out of 1,400 quantities, but "Expired" or "31–90 days" is a real question.
 * A column with `filter: false` gets no dropdown.
 *
 * Filter options cascade: each dropdown lists only values present under the OTHER filters, so
 * a choice never leads to an empty table. Sorting is heading click: ascending → descending → off.
 */

export interface Col<T> {
  key: string;
  label: string;
  align?: "right";
  /** Shown in the filter list, and used as the value when `bucket` is not given. */
  text: (r: T) => string;
  /** Sort value; null always sorts last. */
  sort: (r: T) => string | number | null;
  /** Filter group for this row (a band for numbers, a month for dates). */
  bucket?: (r: T) => string;
  /** Fixed order for bucket options (bands read in order, not alphabetically). */
  bucketOrder?: string[];
  filter?: boolean;
  render?: (r: T) => ReactNode;
  className?: string;
}

type Dir = "asc" | "desc";

export function useSortFilter<T>(rows: T[], cols: Col<T>[]) {
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);

  const val = (c: Col<T>, r: T) => (c.bucket ?? c.text)(r);
  const passes = (r: T, skip?: string) =>
    cols.every((c) => c.key === skip || !(filters[c.key]?.length) || filters[c.key].includes(val(c, r)));

  const view = useMemo(() => {
    const out = rows.filter((r) => passes(r));
    if (!sort) return out;
    const c = cols.find((x) => x.key === sort.key);
    if (!c) return out;
    const k = sort.dir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const x = c.sort(a), y = c.sort(b);
      if (x === null || x === "") return y === null || y === "" ? 0 : 1;
      if (y === null || y === "") return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * k;
    });
  }, [rows, filters, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = (c: Col<T>) => {
    // Options read in the column's own order (Jan before Apr, not alphabetical): each option is
    // placed by the smallest sort value among its rows; blanks last.
    const seen = new Map<string, { n: number; s: string | number | null }>();
    for (const r of rows) {
      if (!passes(r, c.key)) continue;
      const v = val(c, r), s = c.sort(r);
      const cur = seen.get(v);
      if (!cur) seen.set(v, { n: 1, s });
      else { cur.n++; if (s !== null && (cur.s === null || s < cur.s)) cur.s = s; }
    }
    const order = c.bucketOrder;
    const cmp = (a: string | number | null, b: string | number | null) =>
      a === null ? (b === null ? 0 : 1) : b === null ? -1
      : typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en", { numeric: true });
    return [...seen.entries()]
      .sort((a, b) => order ? order.indexOf(a[0]) - order.indexOf(b[0]) : cmp(a[1].s, b[1].s))
      .map(([v, { n }]) => ({ value: v, label: `${v || "(blank)"} (${n})` }));
  };

  const toggleSort = (key: string) => setSort((s) =>
    !s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null);
  const active = Object.values(filters).filter((v) => v.length).length;
  const clear = () => { setFilters({}); setSort(null); };
  /** A key that changes whenever the visible rows do — for resetting pagination. */
  const stamp = `${JSON.stringify(filters)}|${sort?.key}:${sort?.dir}`;

  return { view, filters, setFilters, sort, toggleSort, options, active, clear, stamp };
}

const filterClass =
  "h-8 w-full min-w-0 rounded-lg border border-line bg-white px-2 text-[12px] font-normal normal-case tracking-normal text-ink " +
  "focus:outline-none focus:ring-2 focus:ring-orange/25 focus:border-orange/50";

export function SortFilterHead<T>({ cols, ctl }: { cols: Col<T>[]; ctl: ReturnType<typeof useSortFilter<T>> }) {
  const th = "px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-grey whitespace-nowrap";
  return (
    <thead className="border-y border-line bg-page">
      <tr>
        {cols.map((c) => {
          const on = ctl.sort?.key === c.key ? ctl.sort.dir : null;
          return (
            <th key={c.key} className={`${th} ${c.align === "right" ? "text-right" : "text-left"}`}
              aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : "none"}>
              <button onClick={() => ctl.toggleSort(c.key)} title="Sort"
                className={"inline-flex items-center gap-1 uppercase hover:text-navy " + (on ? "text-navy" : "")}>
                {c.label}
                <span className="flex flex-col text-[8px] leading-[8px]">
                  <span className={on === "asc" ? "text-orange" : "text-grey-2/60"}>▲</span>
                  <span className={on === "desc" ? "text-orange" : "text-grey-2/60"}>▼</span>
                </span>
              </button>
            </th>
          );
        })}
      </tr>
      <tr className="border-t border-line bg-page/40">
        {cols.map((c) => (
          <th key={c.key} className="min-w-[96px] px-1.5 py-1.5 font-normal">
            {c.filter === false ? null : (
              <MultiSelect
                values={ctl.filters[c.key] ?? []}
                onChange={(next) => ctl.setFilters((f) => ({ ...f, [c.key]: next }))}
                options={ctl.options(c)}
                placeholder="All"
                searchable
                triggerClassName={filterClass}
              />
            )}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function SortFilterBody<T>({ cols, rows, rowKey, empty }: {
  cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; empty: string;
}) {
  const td = "px-3 py-2 text-[12.5px] whitespace-nowrap";
  return (
    <tbody>
      {rows.map((r) => (
        <tr key={rowKey(r)} className="border-b border-line">
          {cols.map((c) => (
            <td key={c.key} className={`${td} ${c.align === "right" ? "text-right" : ""} ${c.className ?? ""}`}>
              {c.render ? c.render(r) : c.text(r)}
            </td>
          ))}
        </tr>
      ))}
      {rows.length === 0 && (
        <tr><td colSpan={cols.length} className="px-4 py-10 text-center text-[13px] text-grey">{empty}</td></tr>
      )}
    </tbody>
  );
}

/** "3 column filters · Clear" — shown above a table when any heading filter or sort is on. */
export function ActiveFilters<T>({ ctl, shown, total }: { ctl: ReturnType<typeof useSortFilter<T>>; shown: number; total: number }) {
  if (!ctl.active && !ctl.sort) return null;
  return (
    <div className="flex items-center gap-3 border-b border-line bg-orange/5 px-4 py-1.5 text-[12px] text-navy">
      <span>
        {ctl.active ? <>{ctl.active} column filter{ctl.active === 1 ? "" : "s"} on — <b>{shown.toLocaleString("en-IN")}</b> of {total.toLocaleString("en-IN")} rows</> : "Sorted"}
      </span>
      <button onClick={ctl.clear} className="font-semibold text-orange hover:underline">Clear filters &amp; sort</button>
    </div>
  );
}

/* ------------------------------------------------------------------ shared bands -- */

export const DAYS_LEFT_BANDS = ["Expired", "0–30 days", "31–90 days", "91–180 days", "181–365 days", "Over 1 year", "No expiry"];
export function daysLeftBand(days: number | null): string {
  if (days === null) return "No expiry";
  if (days < 0) return "Expired";
  if (days <= 30) return "0–30 days";
  if (days <= 90) return "31–90 days";
  if (days <= 180) return "91–180 days";
  if (days <= 365) return "181–365 days";
  return "Over 1 year";
}

export const AGE_BANDS = ["0–90 days", "91–180 days", "181–365 days", "Over 1 year", "Unknown"];
export function ageBand(days: number | null): string {
  if (days === null) return "Unknown";
  if (days <= 90) return "0–90 days";
  if (days <= 180) return "91–180 days";
  if (days <= 365) return "181–365 days";
  return "Over 1 year";
}

export const QTY_BANDS = ["Up to 50", "51–200", "201–500", "501–1,000", "Over 1,000"];
export function qtyBand(q: number): string {
  if (q <= 50) return "Up to 50";
  if (q <= 200) return "51–200";
  if (q <= 500) return "201–500";
  if (q <= 1000) return "501–1,000";
  return "Over 1,000";
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** '2026-09-15' → 'Sep 2026'; sorts correctly because the column's `sort` uses the ISO date. */
export const monthOf = (iso: string | null, blank = "(none)") => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : blank);
