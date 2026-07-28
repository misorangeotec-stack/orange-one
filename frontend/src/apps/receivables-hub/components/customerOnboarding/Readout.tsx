/**
 * Read-only field primitives for the request detail page.
 *
 * Hub-native twin of shared/components/ui/Readout (Field / SectionHeading),
 * which is styled with Orange One's portal tokens. Same contract: a blank value
 * renders an em-dash rather than collapsing, so a missing optional field reads
 * as "not provided" instead of looking like a layout bug.
 */
import type { ReactNode } from "react";
import { cn } from "@hub/lib/utils";

export function Field({
  label, value, className, hint,
}: {
  label: string;
  value: ReactNode;
  className?: string;
  hint?: string;
}) {
  const blank = value === null || value === undefined || value === "" || value === "—";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("text-sm mt-0.5 break-words", blank ? "text-muted-foreground" : "text-foreground")}>
        {blank ? "—" : value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

export function SectionHeading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-sm font-semibold text-foreground">{children}</h2>
      {right}
    </div>
  );
}

/** The standard 1/2/3-column field grid used by every section of the detail page. */
export function FieldGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div
      className={cn(
        "grid gap-4 grid-cols-1 sm:grid-cols-2",
        cols === 3 && "lg:grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}
