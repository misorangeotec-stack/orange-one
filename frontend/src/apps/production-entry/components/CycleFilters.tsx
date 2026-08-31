/**
 * The filter card both cycle-time reports share.
 *
 * It sits OUTSIDE the grid on purpose. `QueueTable`'s per-column filters are the
 * house default and stay exactly as they are, but they can only narrow their own
 * table — and the period here has to apply to the lot table and the stage table at
 * once, or the two screens would quietly be reporting different books.
 */
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import DateRangeFilter from "@/shared/components/ui/DateRangeFilter";
import { FieldLabel } from "@/shared/components/ui/Form";
import { CARD_TYPE_LABEL } from "../lib/format";
import type { CardTypeFilter, CycleLevel, CycleReport } from "../pages/reports/useCycleReport";

export default function CycleFilters({ r }: { r: CycleReport }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FieldLabel label="Lots started between">
          <DateRangeFilter value={r.range} onChange={r.setRange} />
        </FieldLabel>

        <FieldLabel label="Card type">
          <Combobox
            value={r.cardType}
            onChange={(v) => r.setCardType(v as CardTypeFilter)}
            options={Object.entries(CARD_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            placeholder="Both types"
            searchable
            clearable
          />
        </FieldLabel>

        <FieldLabel label="FG item">
          <Combobox
            value={r.fgItemId}
            onChange={r.setFgItemId}
            options={r.fgOptions}
            placeholder="Any FG item"
            searchable
            clearable
          />
        </FieldLabel>

        <FieldLabel label="Detail">
          <Combobox
            value={r.level}
            onChange={(v) => r.setLevel(v as CycleLevel)}
            options={[
              { value: "stage", label: "5 stages" },
              { value: "step", label: "11 steps" },
            ]}
          />
        </FieldLabel>
      </div>

      {r.anyFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-grey-2">{r.filters.join(" · ")}</span>
          <Button size="sm" variant="ghost" onClick={r.clear}>
            Clear filters
          </Button>
        </div>
      )}
    </Card>
  );
}
