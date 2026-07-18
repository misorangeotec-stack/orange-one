import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { buildTrail, type Crumb } from "@/apps/currentApp";
import { cn } from "@/shared/lib/cn";

/**
 * The "where am I" trail, sitting on the left of the top strip where the page
 * heading used to be:
 *
 *     FMS → Purchase → RM Import → New Request
 *
 * It replaces that heading, which showed the PAGE name only — words like "New
 * Request" and "Masters" that read identically across five near-identical FMS
 * modules, so you could not tell which one you were in.
 *
 * Used by BOTH top strips: the shared Topbar (ten screens) and the Outstanding
 * Dashboard's own header, which was built separately and bypasses the shell. It
 * is styled with Orange One's tokens (`navy`, `orange`, `ink`) rather than the
 * shadcn ones on purpose — those tokens are global, so they also resolve inside
 * the Outstanding Dashboard's `.hub-root`, and one component serves both instead
 * of two copies drifting apart.
 */

/**
 * How much of the trail survives at each width. The current page never drops;
 * the family and group steps go first, because losing "FMS → Purchase" still
 * leaves the two steps a reader actually needs.
 *
 *   phone   New Request
 *   tablet  RM Import → New Request
 *   desktop FMS → Purchase → RM Import → New Request
 */
function visibility(crumb: Crumb, isLast: boolean): string {
  if (isLast) return "flex";
  return crumb.collapsible ? "hidden lg:flex" : "hidden md:flex";
}

export default function Breadcrumbs({ pageLabel }: { pageLabel?: string | null }) {
  const { pathname } = useLocation();
  const crumbs = useMemo(() => buildTrail(pathname, pageLabel), [pathname, pageLabel]);

  if (!crumbs.length) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <Fragment key={`${c.label}-${i}`}>
            {/* The separator takes the PREVIOUS step's visibility, so a hidden step
                never leaves a dangling arrow at the start of the trail. */}
            {i > 0 && (
              <span
                aria-hidden
                className={cn("shrink-0 select-none text-ink/30", visibility(crumbs[i - 1], false))}
              >
                &rarr;
              </span>
            )}
            <span className={cn("min-w-0 items-center", visibility(c, isLast))}>
              {c.to && !isLast ? (
                <Link
                  to={c.to}
                  className="truncate text-[13px] text-ink/60 transition-colors hover:text-orange"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(
                    "truncate",
                    isLast
                      ? "text-[17px] md:text-[15px] font-semibold text-navy"
                      : "text-[13px] text-ink/60"
                  )}
                >
                  {c.label}
                </span>
              )}
            </span>
          </Fragment>
        );
      })}
    </nav>
  );
}
