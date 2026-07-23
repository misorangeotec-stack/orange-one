import Card from "@/shared/components/ui/Card";
import Kpi from "@/shared/components/ui/Kpi";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";

export interface MoneyTile {
  key: string;
  label: string;
  /** Pre-formatted amount (the caller applies its own currency formatter). */
  value: string;
  hint?: string;
}

/**
 * A value summary for FMS that carry money (purchase apps). The caller formats
 * each amount with its own `inr()`/`fxMoney()`, so this stays currency-agnostic.
 * Zero-state falls out for free — every tile reads the formatter's "0".
 */
export default function MoneyCard({ title = "Value", tiles }: { title?: string; tiles: MoneyTile[] }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="border-b border-line pb-2">
        <h3 className={SECTION_HEADING_CLASS}>{title}</h3>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
        {tiles.map((t) => (
          <Kpi key={t.key} label={t.label} value={t.value} hint={t.hint} size="md" />
        ))}
      </div>
    </Card>
  );
}
