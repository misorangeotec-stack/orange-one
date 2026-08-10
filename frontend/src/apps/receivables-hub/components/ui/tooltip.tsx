import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@hub/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * Portalled, and into `.hub-root` specifically.
 *
 * Rendered in place, a tooltip is at the mercy of whatever it is nested inside. Two things went
 * wrong on the report tables: a scroll container (ScrollableTable is `overflow-auto`) CLIPS it
 * at the table edge, and a cell's own text rules are INHERITED, so a tooltip inside a
 * `whitespace-nowrap` header refused to wrap and ran off its own max-width. Portalling lifts it
 * out of both.
 *
 * The container is `.hub-root` rather than document.body because that wrapper is what scopes the
 * hub's typography (see index.css). Portalling to the body would render every tooltip in the
 * portal shell's font. Falls back to the body if the hub isn't mounted, which is what happens
 * for any non-hub consumer.
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  // Resolved during render, not in an effect: the content only mounts once the tooltip opens, by
  // which time `.hub-root` is long since on the page. An effect would portal to the body for one
  // frame and flash the wrong font.
  const [container] = React.useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".hub-root"),
  );
  return (
    <TooltipPrimitive.Portal container={container ?? undefined}>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 overflow-hidden whitespace-normal rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
