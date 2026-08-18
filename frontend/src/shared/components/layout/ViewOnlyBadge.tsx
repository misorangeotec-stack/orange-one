import { useLocation } from "react-router-dom";
import { currentAppId } from "@/apps/currentApp";
import { useSession } from "@/core/platform/session";

/**
 * "View only" marker in the top bar, shown whenever the signed-in user holds the
 * app they are currently in at view-only.
 *
 * ⚠ NOT decoration. An app that silently drops half its buttons reads as broken,
 *   and the first thing the user does is report a bug — the queue loads, the rows
 *   are there, the row they need to act on is right in front of them, and the
 *   button they used yesterday is gone. This is the one place that says why.
 *
 * Self-contained on purpose: it reads the route rather than taking an appId prop,
 * so it works for all fifteen apps without every layout having to thread its own
 * id through AppShell. Renders nothing outside an app (the launcher, Admin, the
 * account page), and nothing for anyone who can edit — which includes every
 * admin, since a level never applies to them.
 */
export default function ViewOnlyBadge() {
  const { pathname } = useLocation();
  const { canEditModule } = useSession();
  const appId = currentAppId(pathname);
  if (!appId || canEditModule(appId)) return null;

  return (
    <span
      title="You can open this app and read everything in it, but you cannot add, edit or action anything. Ask an admin if you need to make changes."
      className="hidden sm:inline-flex items-center gap-1.5 rounded-pill border border-orange/40 bg-orange-soft px-2.5 py-1 text-[11.5px] font-semibold text-orange"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
      View only
    </span>
  );
}
