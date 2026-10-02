import { useDispatchStore } from "../store";
import type { RoundReturn } from "../types";

/**
 * What is coming back on a return, line by line — what the Sales Return owner
 * punches the credit note for. On a full return every billed line is listed
 * whole, so the two kinds read the same way.
 */
export default function ReturnLines({ ret, className = "" }: { ret: RoundReturn; className?: string }) {
  const s = useDispatchStore();
  if (ret.lines.length === 0) return null;
  return (
    <ul className={`text-[12.5px] text-grey ${className}`}>
      {ret.lines.map((l, i) => (
        <li key={l.orderItemId ?? i}>
          <span className="text-navy">{l.itemName || s.itemName(l.itemId)}</span> ·{" "}
          <span className="font-semibold text-navy tabular-nums">
            {l.returnQty} {l.unit ?? ""}
          </span>
          {l.returnQty !== l.billedQty && <span className="text-grey-2"> of {l.billedQty} billed</span>}
          {l.lotNo ? ` · LOT ${l.lotNo}` : ""}
        </li>
      ))}
    </ul>
  );
}

/** One-line summary for a table cell / export: "KY CYAN 10 KGS, KY BLACK 5 KGS". */
export const returnLinesText = (ret: RoundReturn, itemName: (id: string | null) => string): string =>
  ret.lines
    .map((l) => `${l.itemName || itemName(l.itemId)} ${l.returnQty}${l.unit ? ` ${l.unit}` : ""}`)
    .join(", ");
