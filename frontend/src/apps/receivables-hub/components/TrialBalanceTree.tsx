/**
 * The Trial Balance table: Particulars on the left, a Debit and a Credit column under one "Closing
 * Balance" head, exactly as Tally prints it. Rows nest group → sub-group → ledger and start collapsed,
 * so the default view is the one-line-per-primary-group summary, and clicking drills in.
 *
 * A sibling of StatementTree rather than a reuse: StatementColumn renders a single amount column (plus
 * two optional reconcile columns), and a Debit/Credit pair would disturb its colSpans on the Balance
 * Sheet and P&L for no gain there. It copies StatementRow's chevron/indent/collapse idiom so the three
 * Tally reports feel identical.
 */
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { fmtAmount } from "@hub/components/StatementTree";
import type { TbNode, TbView } from "@hub/lib/trialBalance";

/** A side's amount, blank when zero — Tally leaves the cell empty rather than printing 0. */
function Amount({ value }: { value: number }) {
  return <>{Math.abs(value) < 0.5 ? "" : fmtAmount(value)}</>;
}

function TbRow({ node }: { node: TbNode }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <tr
        className={`border-b border-border/40 ${hasChildren ? "cursor-pointer hover:bg-muted/40" : ""} ${
          node.depth === 0 ? "font-semibold" : ""
        }`}
        onClick={hasChildren ? () => setOpen((o) => !o) : undefined}
      >
        <td className="py-1.5 pr-2 align-top" style={{ paddingLeft: `${8 + node.depth * 16}px` }}>
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
          <Amount value={node.debit} />
        </td>
        <td className="py-1.5 px-2 text-right text-sm tabular-nums whitespace-nowrap align-top">
          <Amount value={node.credit} />
        </td>
      </tr>
      {open &&
        node.children.map((c) => <TbRow key={`${c.name}-${c.depth}-${c.ledgerGuid ?? ""}`} node={c} />)}
    </>
  );
}

export function TrialBalanceTree({ view }: { view: TbView }) {
  const outOfBalance = Math.abs(view.difference) >= 0.5;
  return (
    <table className="w-full border-collapse min-w-[560px]">
      <thead>
        <tr className="border-b border-border">
          <th />
          <th
            colSpan={2}
            className="text-center py-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b-0"
          >
            Closing Balance
          </th>
        </tr>
        <tr className="border-b-2 border-border bg-muted/50">
          <th className="text-left py-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Particulars
          </th>
          <th className="text-right py-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
            Debit
          </th>
          <th className="text-right py-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
            Credit
          </th>
        </tr>
      </thead>
      <tbody>
        {view.rows.length === 0 ? (
          <tr>
            <td colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
              No ledgers for this company.
            </td>
          </tr>
        ) : (
          view.rows.map((n) => <TbRow key={`${n.name}-0`} node={n} />)
        )}
        <tr className="border-t-2 border-border bg-muted/40 font-semibold">
          <td className="py-2 pr-2 pl-[26px] text-sm">Grand Total</td>
          <td className="py-2 px-2 text-right text-sm tabular-nums whitespace-nowrap">
            {fmtAmount(view.totalDebit)}
          </td>
          <td className="py-2 px-2 text-right text-sm tabular-nums whitespace-nowrap">
            {fmtAmount(view.totalCredit)}
          </td>
        </tr>
        {outOfBalance && (
          <tr className="border-b border-border/40">
            <td className="py-1.5 pr-2 pl-[26px] text-sm italic text-destructive">
              Difference (does not balance)
            </td>
            <td colSpan={2} className="py-1.5 px-2 text-right text-sm tabular-nums whitespace-nowrap text-destructive">
              {fmtAmount(view.difference)}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
