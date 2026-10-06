import { useRef, type ReactNode } from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import { Card } from "@hub/components/ui/card";
import { cn } from "@hub/lib/utils";
import { BarsControl, HeightGrip, PanelSizeProvider, usePanelSizing } from "@hub/components/ResizeKit";

/**
 * The card chrome for every Master Reports panel: a tight header (icon + title +
 * optional subtitle + right-hand slot) over a body that owns its own loading / error /
 * empty states.
 *
 * Deliberately OWNED BY MASTER REPORTS rather than borrowed from the C-Level dashboard's
 * WidgetCard — the C-Level screen is being reworked, and these reports must not move when
 * it does. Any shared look is a coincidence to be re-established later, not a dependency.
 *
 * READER-SIZED, OPT-IN. Give a panel a `sizeKey` and it gets the Ink Expiry behaviour: a drag
 * strip along the bottom (taller / shorter, the body scrolls) and Bars − / + in the header,
 * remembered per browser (components/ResizeKit.tsx). Charts inside read the size through
 * `PanelFill` / `usePanelSize`. Without `sizeKey` the panel is exactly what it always was.
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
  /** Turns on drag-to-resize and Bars − / +; unique per screen. */
  sizeKey?: string;
  /** The body's height (px, padding included) before the reader drags it. */
  bodyHeight?: number;
  children: ReactNode;
}

export default function SalesPanel(props: SalesPanelProps) {
  if (props.sizeKey) return <SizedPanel {...props} sizeKey={props.sizeKey} />;
  const { title, icon, subtitle, actions, className, bodyClassName } = props;
  return (
    <Card className={cn("rounded-card border-border bg-surface flex flex-col overflow-hidden shadow-sm", className)}>
      <PanelHeader title={title} icon={icon} subtitle={subtitle} actions={actions} />
      <div className={cn("flex-1 p-3", bodyClassName)}>
        <PanelBody {...props} />
      </div>
    </Card>
  );
}

/** p-3 top + bottom — what the body's padding takes from its height. */
const PAD = 24;

function SizedPanel(props: SalesPanelProps & { sizeKey: string }) {
  const { title, icon, subtitle, actions, className, bodyClassName, sizeKey, bodyHeight = 324 } = props;
  const pad = bodyClassName?.includes("p-0") ? 0 : PAD;
  const s = usePanelSizing(sizeKey, bodyHeight, pad);
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <Card className={cn("rounded-card border-border bg-surface flex flex-col self-start overflow-hidden shadow-sm", className)}>
      <PanelHeader title={title} icon={icon} subtitle={subtitle}
                   actions={<div className="flex items-center gap-2">
                     {actions}
                     <BarsControl bs={s.bs} onStep={s.stepBars} onReset={s.resetBars} />
                   </div>} />
      {/* Fixed to the reader's height both ways: shorter scrolls, taller spreads the chart out. */}
      <div ref={bodyRef} className={cn("overflow-y-auto p-3", bodyClassName)} style={{ height: s.bodyPx }}>
        <PanelSizeProvider value={s.size}>
          <PanelBody {...props} />
        </PanelSizeProvider>
      </div>
      <HeightGrip bodyRef={bodyRef} hs={s.hs} setHScale={s.setHScale} />
    </Card>
  );
}

function PanelHeader({ title, icon: Icon, subtitle, actions }: Pick<SalesPanelProps, "title" | "icon" | "subtitle" | "actions">) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/70 bg-muted/20">
      {Icon && <Icon className="h-4 w-4 text-primary shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground truncate leading-tight">{title}</div>
        {subtitle && <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

function PanelBody({ loading, error, empty, emptyMessage = "No data", children }: SalesPanelProps) {
  return loading ? (
    <div className="h-full min-h-[80px] w-full animate-pulse rounded-md bg-muted/50" />
  ) : error ? (
    <div className="flex items-center gap-2 text-xs text-destructive py-6 justify-center text-center">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{error}</span>
    </div>
  ) : empty ? (
    <div className="py-8 text-center text-xs text-muted-foreground">{emptyMessage}</div>
  ) : (
    <>{children}</>
  );
}
