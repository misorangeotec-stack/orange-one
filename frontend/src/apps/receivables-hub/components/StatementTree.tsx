/**
 * The classic two-column statement Tally prints: Particulars on the left of each column, amount on the
 * right, with the Dr side and Cr side laid side by side.
 *
 * Rows nest group -> sub-group -> ledger and start collapsed, so the default view is the one-line-per
 * primary-group summary the user recognises from Tally; clicking drills in.
 *
 * When "Show reconcile" is on, each row also shows what OUR mirrored ledgers sum to and the gap against
 * Tally. A non-zero gap is a real finding (forex/bill-wise ledgers under-report in a bulk collection),
 * so it is highlighted rather than hidden.
 */
import { useState } from "react";
import { ChevronRight, ChevronDown, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@hub/components/ui/tooltip";
import { fmtINRMoney } from "@hub/lib/utils";
import type { FsNode, GapExplanation } from "@hub/lib/financialStatements";

/**
 * Money formatter for the statements.
 *
 * fmtINRMoney always scales to lakhs/crores, which renders a real Rs 30 as "Rs 0.00 L" — indistinguishable
 * from zero, and baffling next to a row that is flagged as different. Anything below a lakh is therefore
 * shown in exact rupees; a lakh and above keeps the familiar L/Cr scaling. Applies to every figure on the
 * statement, not just gaps, so "Sales Bills to Make" reads Rs 30 rather than Rs 0.00 L.
 */
export function fmtAmount(n: number): string {
  const a = Math.abs(n);
  if (a < 0.5) return "0";
  if (a < 100000) {
    return `${n < 0 ? "-" : ""}₹${Math.round(a).toLocaleString("en-IN")}`;
  }
  return fmtINRMoney(n);
}

interface RowProps {
  node: FsNode;
  depth: number;
  showReconcile: boolean;
  /** Amounts are rendered from the caller's perspective, so a liability reads positive. */
  negate?: boolean;
  /** Shared with the reconcile summary so a row can never be red while the summary says "all agree". */
  isExplained?: (gap: number | null, name: string) => GapExplanation | null;
}

function StatementRow({ node, depth, showReconcile, negate, isExplained }: RowProps) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const sign = negate ? -1 : 1;
  const gap = node.gap;
  const rawGap = gap !== null && Math.abs(gap) >= 0.005;
  const explained = rawGap ? isExplained?.(node.gap, node.name) ?? null : null;
  const hasGap = rawGap && !explained;

  return (
    <>
      <tr
        className={`border-b border-border/40 ${hasChildren ? "cursor-pointer hover:bg-muted/40" : ""} ${
          depth === 0 ? "font-semibold" : ""
        }`}
        onClick={hasChildren ? () => setOpen((o) => !o) : undefined}
      >
        <td className="py-1.5 pr-2 align-top" style={{ paddingLeft: `${8 + depth * 16}px` }}>
          <span className="inline-flex items-center gap-1">
            {hasChildren ? (
              open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                   : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className={`text-sm ${node.synthetic ? "italic text-foreground/80" : "text-foreground"}`}>
              {node.name}
            </span>
          </span>
        </td>
        <td className="py-1.5 px-2 text-right text-sm tabular-nums whitespace-nowrap align-top">
          {fmtAmount(node.tally * sign)}
        </td>
        {showReconcile && (
          <>
            <td className="py-1.5 px-2 text-right text-sm tabular-nums whitespace-nowrap align-top text-muted-foreground">
              {node.ours === null ? "—" : fmtAmount(node.ours * sign)}
            </td>
            <td
              className={`py-1.5 px-2 text-right text-sm tabular-nums whitespace-nowrap align-top ${
                hasGap ? "text-destructive font-medium" : "text-muted-foreground"
              }`}
            >
              {gap === null ? (
                "—"
              ) : explained ? (
                // Accounted for, not a problem — but still real money, so it gets its own AMBER
                // treatment rather than being greyed out as if it were noise. Hovering gives the
                // full reason in plain English.
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help text-amber-700 dark:text-amber-400">
                        {fmtAmount(gap * sign)}
                        <Info className="h-3 w-3 shrink-0" />
                      </span>
                    </TooltipTrigger>
                    {/* The shared TooltipContent is not portalled, so it inherits this cell's
                        `whitespace-nowrap` and `text-right` and the sentence gets clipped. Reset both
                        here rather than editing the shared component, which other pages depend on. */}
                    <TooltipContent
                      side="left"
                      align="start"
                      collisionPadding={12}
                      className="w-[19rem] max-w-[calc(100vw-2rem)] whitespace-normal break-words text-left py-2.5"
                    >
                      <p className="font-semibold mb-1">{explained.label}</p>
                      <p className="text-xs leading-relaxed font-normal">{explained.detail}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : hasGap ? (
                fmtAmount(gap * sign)
              ) : (
                "0"
              )}
            </td>
          </>
        )}
      </tr>
      {open &&
        node.children.map((c) => (
          <StatementRow key={`${c.name}-${c.topLevel}`} node={c} depth={depth + 1} showReconcile={showReconcile} negate={negate} isExplained={isExplained} />
        ))}
    </>
  );
}

interface ColumnProps {
  title: string;
  rows: FsNode[];
  total: number;
  /** The same total from our ledgers; omitted when there is no counterpart to show. */
  totalOurs?: number | null;
  totalLabel?: string;
  showReconcile: boolean;
  negate?: boolean;
  /** Extra italic rows appended after the data (Gross Profit c/o, Nett Profit), with our counterpart. */
  footRows?: Array<{ label: string; amount: number; ours?: number | null }>;
  isExplained?: (gap: number | null, name: string) => GapExplanation | null;
}

export function StatementColumn({ title, rows, total, totalOurs, totalLabel = "Total", showReconcile, negate, footRows, isExplained }: ColumnProps) {
  return (
    <div className="flex-1 min-w-0">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-border bg-muted/50">
            <th className="text-left py-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </th>
            <th className="text-right py-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Tally
            </th>
            {showReconcile && (
              <>
                <th className="text-right py-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  Our ledgers
                </th>
                <th className="text-right py-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  Gap
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !footRows?.length ? (
            <tr>
              <td colSpan={showReconcile ? 4 : 2} className="py-6 text-center text-sm text-muted-foreground">
                Nothing on this side.
              </td>
            </tr>
          ) : (
            rows.map((n) => (
              <StatementRow key={`${n.name}-${n.topLevel}`} node={n} depth={0} showReconcile={showReconcile} negate={negate} isExplained={isExplained} />
            ))
          )}
          {footRows?.map((f) => {
            const fGap = f.ours === null || f.ours === undefined ? null : f.amount - f.ours;
            const fHasGap = fGap !== null && Math.abs(fGap) >= 0.005;
            return (
              <tr key={f.label} className="border-b border-border/40">
                <td className="py-1.5 pr-2 pl-[26px] text-sm italic text-foreground/90">{f.label}</td>
                <td className="py-1.5 px-2 text-right text-sm tabular-nums italic whitespace-nowrap">
                  {fmtAmount(f.amount)}
                </td>
                {showReconcile && (
                  <>
                    <td className="py-1.5 px-2 text-right text-sm tabular-nums italic whitespace-nowrap text-muted-foreground">
                      {f.ours === null || f.ours === undefined ? "—" : fmtAmount(f.ours)}
                    </td>
                    <td className={`py-1.5 px-2 text-right text-sm tabular-nums italic whitespace-nowrap ${
                      fHasGap ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                      {fGap === null ? "—" : fHasGap ? fmtAmount(fGap) : "0"}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
          <tr className="border-t-2 border-border bg-muted/40 font-semibold">
            <td className="py-2 pr-2 pl-[26px] text-sm">{totalLabel}</td>
            <td className="py-2 px-2 text-right text-sm tabular-nums whitespace-nowrap">{fmtAmount(total)}</td>
            {showReconcile && (
              <>
                <td className="py-2 px-2 text-right text-sm tabular-nums whitespace-nowrap text-muted-foreground">
                  {totalOurs === null || totalOurs === undefined ? "—" : fmtAmount(totalOurs)}
                </td>
                <td className={`py-2 px-2 text-right text-sm tabular-nums whitespace-nowrap ${
                  totalOurs !== null && totalOurs !== undefined && Math.abs(total - totalOurs) >= 0.005
                    ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                  {totalOurs === null || totalOurs === undefined
                    ? "—"
                    : fmtAmount(total - totalOurs)}
                </td>
              </>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
