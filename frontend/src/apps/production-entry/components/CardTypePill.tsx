import { CARD_TYPE_LABEL } from "../lib/format";
import type { ProductionCardType } from "../types";

/**
 * Production / Repackaging badge. Shown next to the status on the job-card detail
 * page so it is immediately obvious why a card has no raw materials and skipped
 * six stages. Production is the overwhelming majority, so it stays quiet (grey);
 * repackaging is the exception worth spotting, so it carries the teal accent.
 */
export default function CardTypePill({ cardType }: { cardType: ProductionCardType }) {
  const repack = cardType === "repackaging";
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${
        repack ? "bg-teal/10 text-teal" : "bg-page text-grey-2"
      }`}
    >
      {CARD_TYPE_LABEL[cardType]}
    </span>
  );
}
