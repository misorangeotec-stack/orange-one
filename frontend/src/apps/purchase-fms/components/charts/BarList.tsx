import { cn } from "@/shared/lib/cn";

export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** Optional right-aligned secondary note (e.g. sample count). */
  note?: string;
}

/**
 * Labeled horizontal bars — a dependency-free chart for counts or averages.
 * The widest bar (or `highlightKey`) is accented in orange; the rest read muted.
 */
export default function BarList({
  items,
  unit,
  highlightKey,
  emptyText = "No data yet.",
}: {
  items: BarItem[];
  unit?: string;
  highlightKey?: string;
  emptyText?: string;
}) {
  if (items.length === 0 || items.every((i) => i.value === 0)) {
    return <p className="text-[12.5px] text-grey-2 py-2">{emptyText}</p>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-2.5">
      {items.map((it) => {
        const pct = Math.round((it.value / max) * 100);
        const accent = highlightKey ? it.key === highlightKey : it.value === max;
        return (
          <div key={it.key} className="flex items-center gap-3 text-[12.5px]">
            <span className="w-20 sm:w-24 shrink-0 truncate text-grey" title={it.label}>{it.label}</span>
            <div className="flex-1 h-5 rounded-md bg-[#eef1f6] overflow-hidden">
              <div
                className={cn("h-full rounded-md transition-all", accent ? "bg-orange" : "bg-[#9fb6dd]")}
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right tabular-nums font-semibold text-navy">
              {it.value}{unit ? <span className="text-grey-2 font-normal">{unit}</span> : null}
            </span>
            {it.note && <span className="w-14 shrink-0 text-right text-[11px] text-grey-2">{it.note}</span>}
          </div>
        );
      })}
    </div>
  );
}
