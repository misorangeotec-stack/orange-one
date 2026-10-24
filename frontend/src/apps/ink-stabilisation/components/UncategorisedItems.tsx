import { useMemo } from "react";
import { NOT_CATEGORISED } from "../lib/categories";
import { fmtDate, type InkLot } from "../lib/schedule";

/**
 * ITEMS NOT IN A CATEGORY — every ink item whose lots land under "Not categorised",
 * because neither Bushra Central Master nor Central Masters gives it an Ink type.
 * Fixing one is an edit in Bushra Central Master; the Overview picks it up on Refresh.
 */

export interface UncategorisedItem {
  item: string;
  family: string;
  inMaster: boolean;
  group: string | null;
  lots: number;
  latest: string;
}

export function useUncategorised(lots: InkLot[]): UncategorisedItem[] {
  return useMemo(() => {
    const m = new Map<string, UncategorisedItem>();
    for (const L of lots) {
      if (L.category !== NOT_CATEGORISED) continue;
      const e = m.get(L.item) ?? { item: L.item, family: L.family, inMaster: L.inMaster, group: L.categoryGroup, lots: 0, latest: L.prod };
      e.lots += 1;
      if (L.prod > e.latest) e.latest = L.prod;
      m.set(L.item, e);
    }
    return [...m.values()].sort((a, b) => Number(a.inMaster) - Number(b.inMaster) || b.lots - a.lots || a.item.localeCompare(b.item));
  }, [lots]);
}

export default function UncategorisedTable({ items }: { items: UncategorisedItem[] }) {
  const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-grey whitespace-nowrap";
  const td = "px-3 py-2 text-[12.5px]";
  if (items.length === 0) {
    return <div className="px-4 py-6 text-center text-[13px] text-ryg-green">Every ink item has a category. ✓</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-page">
          <tr>
            <th className={th}>Stock item</th><th className={th}>Tally stock group</th><th className={th}>What to fix</th>
            <th className={`${th} text-right`}>Lots</th><th className={th}>Latest production</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.item} className="border-t border-line">
              <td className={`${td} font-medium text-ink`}>{i.item}</td>
              <td className={`${td} text-grey`}>{i.family}</td>
              <td className={td}>
                {i.inMaster ? (
                  <span className="text-ink">
                    Set the Ink type in Bushra Central Master{i.group ? <span className="text-grey"> (Category: {i.group})</span> : null}
                  </span>
                ) : (
                  <span className="font-semibold text-ryg-red"
                    title="Bushra Central Master only lists items Central Masters has. This item's name is not there for Enterprises Surat, so it must reach Central Masters from Tally first.">
                    Not in Central Masters — must come through from Tally first
                  </span>
                )}
              </td>
              <td className={`${td} text-right tabular-nums`}>{i.lots}</td>
              <td className={`${td} text-grey`}>{fmtDate(i.latest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
