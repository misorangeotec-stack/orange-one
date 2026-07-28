/**
 * Labelled field wrappers for the wizard.
 *
 * A thin layer over the hub's shadcn inputs that does three things consistently:
 * marks required fields, reserves room for an error so the layout does not jump
 * when one appears, and ties label → input → error together for screen readers.
 */
import type { ReactNode } from "react";
import { cn } from "@hub/lib/utils";
import { Label } from "@hub/components/ui/label";

export function FieldShell({
  id, label, required, hint, error, className, children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5" aria-hidden>*</span>}
        {!required && <span className="text-muted-foreground font-normal ml-1">(optional)</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
      {/* min-height reserves the error line, so revealing one does not shove
          every field below it down the page mid-typing. */}
      <div className="min-h-[1.15rem] mt-1">
        {error
          ? <p id={`${id}-error`} className="text-[11px] text-destructive">{error}</p>
          : hint
            ? <p className="text-[11px] text-muted-foreground">{hint}</p>
            : null}
      </div>
    </div>
  );
}

/** The standard field grid for a wizard pane. */
export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) {
  return (
    <div className={cn("grid gap-x-5 gap-y-1", cols === 2 && "sm:grid-cols-2")}>
      {children}
    </div>
  );
}
