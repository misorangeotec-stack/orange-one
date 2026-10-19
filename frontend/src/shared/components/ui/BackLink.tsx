import type { MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

/**
 * The "← Back" link at the top of a detail page.
 *
 * It used to be a plain link to the module's list ("← Requests"), so it always
 * landed on that list — even when you had come from somewhere else. Open a PO,
 * click its request, press "← Requests": you were on the Requests list, not on
 * the PO you just left.
 *
 * Now it steps back one page in this tab's history, exactly like the browser's
 * Back, so it returns to wherever you actually were (and a searched list comes
 * back with its search — see shared/lib/backState). Only when there is nowhere to
 * go back to — the page was opened in a new tab or from a shared link — does it
 * fall back to `to`, the list, and then it says which list.
 *
 * `href` stays `to`, so ctrl-click / middle-click still open the list in a new tab.
 */
export default function BackLink({
  to,
  label,
  className,
}: {
  /** Where to go when this tab has no earlier page: the module's list. */
  to: string;
  /** That list's name, shown only in the fallback case ("← Requests"). */
  label: string;
  className?: string;
}) {
  const navigate = useNavigate();
  // React Router numbers this tab's history entries; 0 is the page the tab opened on.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!canGoBack || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(-1);
  };

  return (
    <Link to={to} onClick={onClick} className={className}>
      ← {canGoBack ? "Back" : label}
    </Link>
  );
}
