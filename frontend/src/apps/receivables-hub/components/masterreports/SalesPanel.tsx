import type { ReactNode } from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import { Card } from "@hub/components/ui/card";
import { cn } from "@hub/lib/utils";

/**
 * The card chrome for every Master Reports panel: a tight header (icon + title +
 * optional subtitle + right-hand slot) over a body that owns its own loading / error /
 * empty states.
 *
 * Deliberately OWNED BY MASTER REPORTS rather than borrowed from the C-Level dashboard's
 * WidgetCard — the C-Level screen is being reworked, and these reports must not move when
 * it does. Any shared look is a coincidence to be re-established later, not a dependency.
 */
export interface SalesPanelProps {
  title: string;
  icon?: LucideIcon;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export default function SalesPanel({
  title,
  icon: Icon,
  subtitle,
  actions,
  loading,
  error,
  empty,
  emptyMessage = "No data",
  className,
  bodyClassName,
  children,
}: SalesPanelProps) {
  return (
    <Card className={cn("rounded-card border-border bg-surface flex flex-col overflow-hidden shadow-sm", className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/70 bg-muted/20">
        {Icon && <Icon className="h-4 w-4 text-primary shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground truncate leading-tight">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className={cn("flex-1 p-3", bodyClassName)}>
        {loading ? (
          <div className="h-full min-h-[80px] w-full animate-pulse rounded-md bg-muted/50" />
        ) : error ? (
          <div className="flex items-center gap-2 text-xs text-destructive py-6 justify-center text-center">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : empty ? (
          <div className="py-8 text-center text-xs text-muted-foreground">{emptyMessage}</div>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}
