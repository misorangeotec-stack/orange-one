import { sumQty, type QtyEntry } from "../lib/format";

/**
 * A "Total Qty" figure: the summed quantity with its unit label. Units can differ
 * per line, so this delegates to `sumQty` — it shows the shared unit when every
 * line agrees, otherwise "mixed" with a hover listing the distinct units. The
 * counterpart to `MoneyCell` for the quantity column of a totals footer; the
 * wrapping `<td>`/element keeps its own weight/colour.
 */
export default function QtyTotal({ entries }: { entries: QtyEntry[] }) {
  const q = sumQty(entries);
  return (
    <span title={q.title} className="whitespace-nowrap">
      {q.total}
      {q.label && <span className="ml-1 text-[11.5px] font-normal text-grey-2">{q.label}</span>}
    </span>
  );
}
