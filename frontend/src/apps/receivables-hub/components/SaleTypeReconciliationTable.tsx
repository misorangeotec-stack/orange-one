import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@hub/components/ui/tooltip";
import { Button } from "@hub/components/ui/button";
import type { SaleTypeBreakdown, SaleTypeBreakdownRow } from "@hub/lib/types";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const fmt = (n: number) => {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000)    return `₹${(n / 100_000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};

const fmtNeg = (n: number) => {
  // For the Unmapped Outstanding which is 0, just show —
  if (n === 0) return "—";
  return fmt(Math.abs(n));
};

/* ── Row styling ─────────────────────────────────────────────────────────── */

function rowClass(type: SaleTypeBreakdownRow["type"]): string {
  switch (type) {
    case "opening_balance": return "bg-blue-50/60 text-blue-900";
    case "unmapped":        return "bg-amber-50/70 italic";
    case "total":           return "bg-muted/50 font-semibold border-t-2 border-border";
    default:                return "hover:bg-muted/30";
  }
}

/* ── Column header with optional tooltip ─────────────────────────────────── */

function ColHeader({ label, tip }: { label: string; tip?: string }) {
  if (!tip) return <span>{label}</span>;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-help">
            {label} <Info className="h-3 w-3 text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-56 text-xs">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ── Amount cell ─────────────────────────────────────────────────────────── */

function AmtCell({ value, zero = "—", className = "" }: { value: number; zero?: string; className?: string }) {
  if (value === 0) return <TableCell className={`text-right text-muted-foreground ${className}`}>{zero}</TableCell>;
  return <TableCell className={`text-right tabular-nums ${className}`}>{fmt(value)}</TableCell>;
}

/* ── Count cell ──────────────────────────────────────────────────────────── */

function CountCell({ value, inapplicable = false }: { value: number; inapplicable?: boolean }) {
  if (inapplicable) return <TableCell className="text-center text-muted-foreground">—</TableCell>;
  if (value === 0)  return <TableCell className="text-center text-muted-foreground">0</TableCell>;
  return <TableCell className="text-center font-medium text-destructive">{value}</TableCell>;
}

/* ── Main Component ──────────────────────────────────────────────────────── */

interface Props {
  breakdown: SaleTypeBreakdown;
}

export function SaleTypeReconciliationTable({ breakdown }: Props) {
  const [open, setOpen] = useState(true);

  const isCount = (type: SaleTypeBreakdownRow["type"]) =>
    type === "opening_balance" || type === "unmapped";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Sale Type Reconciliation</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} className="h-7 w-7 p-0">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
        {open && (
          <p className="text-xs text-muted-foreground mt-1">
            All figures year-to-date (Apr 2025 – Mar 2026). Receipts shown on gross basis; KPI card shows net (Receipts − Cheque Returns).
            Customer counts per type may overlap — Total row shows unique counts.
          </p>
        )}
      </CardHeader>

      {open && (
        <CardContent className="p-0 pb-4">
          <ScrollableTable>
            <Table className="text-sm min-w-[1100px]">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-36 font-semibold">Sale Type</TableHead>
                  <TableHead className="text-right">
                    <ColHeader label="Opening Bal." tip="Opening balance brought forward from prior period (Apr 2025)" />
                  </TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">
                    <ColHeader label="Receipts" tip="Gross receipts attributed to this row (before cheque return deduction)" />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColHeader label="Credit Notes" tip="Credit notes attributed to this row (directly linked + CN pool proportion)" />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColHeader label="Chq. Returns" tip="All cheque returns are in the Unmapped row (pool-level, not invoice-linked)" />
                  </TableHead>
                  <TableHead className="text-right">
                    <ColHeader label="Advance Bal." tip="Unallocated credit balance remaining after FIFO allocation" />
                  </TableHead>
                  <TableHead className="text-right font-semibold">
                    <ColHeader label="Outstanding" tip="Net receivable = Opening Bal + Sales − Receipts + Chq Returns − Credit Notes + Advance Bal" />
                  </TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="text-center">
                    <ColHeader label="Critical" tip="Customers with outstanding in this type AND risk = Critical (may overlap across types)" />
                  </TableHead>
                  <TableHead className="text-center">
                    <ColHeader label="Over Limit" tip="Customers with outstanding in this type AND credit utilization > 100%" />
                  </TableHead>
                  <TableHead className="text-center">
                    <ColHeader label="180+ Days" tip="Customers with outstanding in this type AND max overdue days > 180" />
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {breakdown.rows.map((row) => (
                  <TableRow key={row.type} className={rowClass(row.type)}>
                    <TableCell className="font-medium">
                      {row.type === "unmapped" ? (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 cursor-help">
                                {row.label} <Info className="h-3 w-3 text-amber-600" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-64 text-xs">
                              Receipts, credit notes, and cheque returns not linked to any specific sale-type invoice.
                              These represent On-Account / Advance pool entries.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : row.label}
                    </TableCell>

                    {/* Opening Balance */}
                    <AmtCell value={row.openingBalance} />

                    {/* Sales */}
                    <AmtCell value={row.sales} />

                    {/* Receipts */}
                    <AmtCell value={row.receipts} />

                    {/* Credit Notes */}
                    <AmtCell value={row.creditNotes} />

                    {/* Cheque Returns */}
                    <AmtCell value={row.checkReturns} />

                    {/* Advance Balance */}
                    <AmtCell value={row.advanceBalance} />

                    {/* Outstanding (row total / net balance) */}
                    {row.type === "unmapped" ? (
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                    ) : (
                      <TableCell className={`text-right tabular-nums font-semibold ${row.outstanding !== 0 ? "text-destructive" : ""}`}>
                        {row.outstanding !== 0 ? fmt(Math.abs(row.outstanding)) : "—"}
                      </TableCell>
                    )}

                    {/* Overdue */}
                    {row.type === "unmapped" ? (
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                    ) : (
                      <TableCell className={`text-right tabular-nums ${row.overdue > 0 ? "text-amber-700 font-medium" : "text-muted-foreground"}`}>
                        {row.overdue > 0 ? fmt(row.overdue) : "—"}
                      </TableCell>
                    )}

                    {/* Critical / Over Limit / 180+ counts */}
                    <CountCell value={row.criticalCount}   inapplicable={isCount(row.type)} />
                    <CountCell value={row.overLimitCount}  inapplicable={isCount(row.type)} />
                    <CountCell value={row.overdue180Count} inapplicable={isCount(row.type)} />
                  </TableRow>
                ))}

                {/* Total row */}
                <TableRow className={rowClass("total")}>
                  <TableCell className="font-bold">Total</TableCell>
                  <AmtCell value={breakdown.total.openingBalance} className="font-semibold" />
                  <AmtCell value={breakdown.total.sales}          className="font-semibold" />
                  <AmtCell value={breakdown.total.receipts}       className="font-semibold" />
                  <AmtCell value={breakdown.total.creditNotes}    className="font-semibold" />
                  <AmtCell value={breakdown.total.checkReturns}   className="font-semibold" />
                  <AmtCell value={breakdown.total.advanceBalance}  className="font-semibold" />
                  <TableCell className="text-right tabular-nums font-bold text-destructive">
                    {breakdown.total.outstanding !== 0 ? fmt(Math.abs(breakdown.total.outstanding)) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-amber-700">
                    {breakdown.total.overdue > 0 ? fmt(breakdown.total.overdue) : "—"}
                  </TableCell>
                  <TableCell className="text-center font-bold text-destructive">{breakdown.total.criticalCount}</TableCell>
                  <TableCell className="text-center font-bold text-destructive">{breakdown.total.overLimitCount}</TableCell>
                  <TableCell className="text-center font-bold text-destructive">{breakdown.total.overdue180Count}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </ScrollableTable>
        </CardContent>
      )}
    </Card>
  );
}
