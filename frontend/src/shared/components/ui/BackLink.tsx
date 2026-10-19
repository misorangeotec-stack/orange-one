import { useEffect, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

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
 * back with its search — see shared/lib/backState). It goes to `to`, the list,
 * instead when:
 *   - there is nowhere to go back to (opened in a new tab or from a shared link) —
 *     and then it says which list ("← Requests");
 *   - the page before was a FORM (…/new, …/edit, a draft). Submitting a new request
 *     lands on its page with the form one step behind; stepping back into a blank
 *     form is never what "Back" means.
 *
 * `href` stays `to`, so ctrl-click / middle-click still open the list in a new tab.
 */

/** What was at each history step of this tab (React Router's `idx`), as path + query. */
const trail = new Map<number, string>();
const currentIdx = (): number => (window.history.state as { idx?: number } | null)?.idx ?? 0;

/** Call once, at the app root, so BackLink knows what the previous page was. */
export function useHistoryTrail(): void {
  const { pathname, search } = useLocation();
  useEffect(() => {
    trail.set(currentIdx(), `${pathname}${search}`);
  }, [pathname, search]);
}

const isForm = (href: string): boolean => {
  const [path, query = ""] = href.split("?");
  return /\/(new|edit)\/?$/.test(path) || /\/drafts\/[^/]+\/?$/.test(path) || /(^|&)edit=1(&|$)/.test(query);
};

export function useBack(to: string): { canGoBack: boolean; onClick: (e: MouseEvent<HTMLAnchorElement>) => void } {
  const navigate = useNavigate();
  const idx = currentIdx();
  const prev = trail.get(idx - 1);
  // Unknown (the tab was reloaded since) is still an in-app page: step back to it.
  const canGoBack = idx > 0 && !(prev && isForm(prev));

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!canGoBack || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(-1);
  };
  return { canGoBack, onClick };
}

export default function BackLink({
  to,
  label,
  className,
}: {
  /** Where to go when there is no page to step back to: the module's list. */
  to: string;
  /** That list's name, shown only in the fallback case ("← Requests"). */
  label: string;
  className?: string;
}) {
  const { canGoBack, onClick } = useBack(to);
  return (
    <Link to={to} onClick={onClick} className={className}>
      ← {canGoBack ? "Back" : label}
    </Link>
  );
}
