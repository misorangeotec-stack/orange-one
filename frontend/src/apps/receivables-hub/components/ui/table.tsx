import * as React from "react";

import { FitHead, FitResizer, thFitStyle } from "@/shared/components/ui/ColumnResizer";
import { useColumnWidths, type FitTable } from "@/shared/lib/useColumnWidths";
import { cn } from "@hub/lib/utils";

/**
 * PF-20 — the drag, on the pages the user named.
 *
 * ⚠ THE CELLS ARE NOT TOUCHED. Every other module took the one-line look with the drag; these are
 *   finance tables whose rows run 61–123px because they carry real content, and the user has not
 *   seen what cutting them would look like. So this adds the header handle and nothing else: a row
 *   is exactly the height it was until somebody drags an edge.
 *
 * ⚠ A TABLE ONLY DRAGS IF IT IS GIVEN A `resizeKey`, and only on a page in `HUB_PAGES_ON`. Both
 *   gates are deliberate: this component is shared by ~60 pages, most of which are out of scope.
 */
const FitCtx = React.createContext<FitTable | null>(null);

/** The column id a header stores its width under: its own text, slugged. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement> & { resizeKey?: string }>(
  ({ className, resizeKey, ...props }, ref) => {
    // Always called — hooks cannot be conditional — but only handed to the headers when this table
    // was given a key, so every other table in the hub behaves exactly as before.
    const fit = useColumnWidths("tb", [], `hub.${resizeKey ?? "none"}`);
    return (
      <div className="relative w-full overflow-auto">
        <FitCtx.Provider value={resizeKey ? fit : null}>
          <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
        </FitCtx.Provider>
      </div>
    );
  },
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b transition-colors data-[state=selected]:bg-muted hover:bg-muted/50", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement> & { col?: string }>(
  ({ className, col, children, ...props }, ref) => {
    const fit = React.useContext(FitCtx);
    // The id is the header's own text where the author did not name one. A header with no text —
    // an icon, a checkbox — simply does not drag.
    const id = col ?? slug(textOf(children));
    // Only a header that stands for ONE column drags. A spanning header — "As on 28-09-2026"
    // sitting over six of them on the disputed-bills report — is not a column edge, and the
    // filter row below carries pickers with no text of their own, so it is skipped already.
    const on = !!fit?.on && !!id && (props.colSpan ?? 1) === 1;
    return (
      <th
        ref={ref}
        style={on && fit ? thFitStyle(fit, id) : undefined}
        className={cn(
          "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
          on && "relative",
          className,
        )}
        {...props}
      >
        {/* The width goes on a wrapper INSIDE the th, not on the th: these tables lay out
            automatically and a th's own width is ignored once the columns already fill the card.
            It is also the element the drag resizes live (see FitResizer). */}
        {on && fit ? <FitHead width={fit.width(id)}>{children}</FitHead> : children}
        {on && fit && <FitResizer fit={fit} col={id} label={textOf(children)} />}
      </th>
    );
  },
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props} />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
