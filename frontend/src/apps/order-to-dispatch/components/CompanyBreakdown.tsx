/**
 * "What went out, under which company" — one card per selling company.
 *
 * ⚠ REPLACES THREE FLAT RANKED CARDS (company / location / customer, side by
 *   side), which were unreadable for a specific reason: both companies run a site called
 *   SURAT-HOJIWALA, so the location card printed that name twice with nothing to
 *   separate the two, and the customer card gave no hint which company had billed
 *   whom. Company is therefore the OUTER grouping here and site/customer are
 *   nested under it, which is the only arrangement in which either list means
 *   anything. See `lib/dispatchBoard.companyBlocks`.
 *
 * ⚠ NOT `DistributionCard` / `ProportionBar`. That pair renders its label as an
 *   UPPERCASE PILL in a fixed 150px box and prints exactly ONE number — it is
 *   built for short, fixed status sets. Here the label is a customer name
 *   ("SIDDHIVINAYAK TEXTRENDS PRIVATE LIMITED"), which a 150px pill clips and
 *   shouts, and every row carries TWO measures. Widening the shared pair would
 *   change four other dashboards, so the specific need gets a specific component.
 *
 * ⚠ QUANTITY IS THE MEASURE, COUNT IS THE FOOTNOTE. Bars are sized by quantity
 *   and the list is ordered by it; the consignment count rides along in a muted
 *   column. Ranking on count put four 30 KG parcels above one 400 KG load, which
 *   is the opposite of how the business reads its own day.
 */
import Card from "@/shared/components/ui/Card";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { qtyIn, qtyLabel, type CompanyBlock, type RankRow } from "../lib/dispatchBoard";

/** How many rows each nested list shows before collapsing to "+N more". */
const LOCATION_LIMIT = 5;
const CUSTOMER_LIMIT = 8;

const PlantIcon = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18M6 21V7l6-4 6 4v14M10 9h.01M14 9h.01M10 13h.01M14 13h.01M10 17h.01M14 17h.01" />
  </svg>
);

/**
 * One ranked row: name, a quantity-sized fill behind it, the quantity, the count.
 *
 * The bar is the row's own background rather than a separate line under it. The
 * old two-line stack put the name, the bar and the quantity on three different
 * horizontal positions, so nothing lined up down the card and every entry read as
 * three loose fragments.
 */
function QtyRow({ row, unit, max }: { row: RankRow; unit: string | null; max: number }) {
  const v = qtyIn(row.qtyByUnit, unit);
  // A 3% floor so a row with a real but tiny quantity still shows a mark; a fill
  // of zero width reads as "no data" rather than "not much".
  const pct = max > 0 ? Math.max(3, Math.round((v / max) * 100)) : 0;

  return (
    <div className="relative flex h-8 items-center gap-2.5 overflow-hidden rounded-lg bg-page/70 px-2.5">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange/30 to-orange/[0.12]"
        style={{ width: `${pct}%` }}
      />
      {/* `relative` on each span: an absolutely positioned sibling paints above
          static content, so without it the fill would cover the text. */}
      <span className="relative min-w-0 flex-1 truncate text-[12.5px] text-navy" title={row.label}>
        {row.label}
      </span>
      <span className="relative shrink-0 text-[12.5px] font-bold tabular-nums text-navy">
        {qtyLabel(row.qtyByUnit, 1)}
      </span>
      <span
        className="relative shrink-0 w-8 text-right text-[11px] tabular-nums text-grey-2"
        title={`${row.count} consignment${row.count === 1 ? "" : "s"}`}
      >
        {row.count}
      </span>
    </div>
  );
}

function Section({ title, rows, unit, limit }: { title: string; rows: RankRow[]; unit: string | null; limit: number }) {
  const shown = rows.slice(0, limit);
  const hidden = rows.length - shown.length;
  // Scaled against the biggest row IN THIS SECTION, so a site list and a customer
  // list each use their own full width instead of the customer bars being
  // squashed by the site total they add up to.
  const max = rows.reduce((m, r) => Math.max(m, qtyIn(r.qtyByUnit, unit)), 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">{title}</span>
        <span className="text-[10.5px] tabular-nums text-grey-2">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      <div className="space-y-1">
        {shown.map((r) => (
          <QtyRow key={r.key} row={r} unit={unit} max={max} />
        ))}
      </div>
      {hidden > 0 && (
        <p className="text-[11.5px] text-grey-2">+{hidden} more — the full list is in the table below.</p>
      )}
    </div>
  );
}

function CompanyCard({ block, unit }: { block: CompanyBlock; unit: string | null }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-navy/[0.025] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-navy">
          <span className="shrink-0 text-orange">{PlantIcon}</span>
          <h3 className="truncate text-[14px] font-bold" title={block.label}>
            {block.label}
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[19px] font-bold leading-tight tabular-nums text-navy">
            {qtyLabel(block.qtyByUnit, 2)}
          </div>
          <div className="text-[11px] text-grey">
            {block.count} consignment{block.count === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-3.5">
        <Section title="Dispatched from" rows={block.locations} unit={unit} limit={LOCATION_LIMIT} />
        <Section title="Customers" rows={block.customers} unit={unit} limit={CUSTOMER_LIMIT} />
      </div>
    </Card>
  );
}

/**
 * The whole breakdown: a card per company, side by side.
 *
 * Two companies is the real-world case and gives two columns. A third would wrap
 * to a second row rather than shrinking the grid, because these cards carry
 * customer names and stop being readable much below half a screen.
 */
export default function CompanyBreakdown({
  blocks,
  unit,
  emptyLabel,
}: {
  blocks: CompanyBlock[];
  unit: string | null;
  emptyLabel: string;
}) {
  if (blocks.length === 0) {
    return (
      <Card className="p-4 space-y-3">
        <div className="border-b border-line pb-2">
          <h3 className={SECTION_HEADING_CLASS}>Dispatched by company</h3>
        </div>
        <p className="py-2 text-[13px] text-grey-2">{emptyLabel}</p>
      </Card>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {blocks.map((b) => (
        <CompanyCard key={b.key} block={b} unit={unit} />
      ))}
    </div>
  );
}
