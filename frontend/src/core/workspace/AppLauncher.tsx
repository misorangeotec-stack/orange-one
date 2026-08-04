/**
 * "Your apps" — every module this user can open, on the home screen itself,
 * grouped by the same categories as the left menu.
 *
 * The home screen dropped its card grid a while back because the cards told a
 * reader which apps existed but never what to do; "My Work Today" answers the
 * second question and is the reason this screen exists. This section answers the
 * first question again, but subordinate to the work list rather than instead of
 * it: it sits BELOW the approvals strip, it is collapsible, and folding it away
 * is remembered. Someone who lives in the work table closes it once and never
 * sees it again; someone who came here to open Sampling finds it without
 * hunting through a collapsed rail.
 *
 * ONE SOURCE OF TRUTH WITH THE MENU. The apps come from `visibleApps()` and the
 * grouping from `groupByCategory()` — the exact calls `homeNav.tsx` makes — so
 * the cards and the rail cannot list different apps, order them differently, or
 * disagree about which category something belongs to. The only thing this file
 * decides is what a card looks like.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { apps } from "@/apps/registry";
import { groupByCategory } from "@/apps/categories";
import type { AppManifest } from "@/apps/types";
import { useSession } from "@/core/platform/session";
import Card from "@/shared/components/ui/Card";
import { cn } from "@/shared/lib/cn";
import { visibleApps } from "./homeNav";
import { GROUP_ICONS } from "./groupIcons";

const OPEN_KEY = "orangeone.home.launcher";

function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — a view preference is never load-bearing */
  }
}

export default function AppLauncher() {
  const { hasModule } = useSession();
  const [open, setOpen] = useState<boolean>(() => readPref(OPEN_KEY, true));

  const groups = groupByCategory(visibleApps(apps, hasModule));
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  // A user with no modules at all would get a heading over nothing. Say nothing
  // instead — the work list below already carries the empty state.
  if (total === 0) return null;

  const toggle = () => {
    setOpen((prev) => {
      writePref(OPEN_KEY, !prev);
      return !prev;
    });
  };

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-orange-soft/25 transition-colors"
      >
        <svg
          width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          className={cn("shrink-0 text-grey-2 transition-transform duration-200", open && "rotate-90")}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <h2 className="text-[15px] font-semibold text-navy leading-tight">Your apps</h2>
        <span className="text-[11.5px] text-grey-2 tabular-nums">
          {total} app{total === 1 ? "" : "s"} · {groups.length} area{groups.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto text-[11px] text-grey-2">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-5 border-t border-line">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="flex items-center gap-2 pt-3.5 pb-2">
                <span className="shrink-0 w-6 h-6 rounded-lg bg-page text-navy flex items-center justify-center [&>svg]:w-3.5 [&>svg]:h-3.5">
                  {GROUP_ICONS[group.key] ?? <FolderIcon />}
                </span>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-grey-2">{group.label}</h3>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {group.rows.map((app) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * `description` comes straight off the manifest — every app already carries a
 * written one-liner, from back when the launcher was the whole home screen. Two
 * lines, clamped: these were written to fill a full-width card and several run
 * long enough to unbalance a three-up grid.
 */
function AppCard({ app }: { app: AppManifest }) {
  return (
    <Link
      to={app.basePath}
      className="group flex gap-3 rounded-xl border border-line bg-white p-3 transition hover:border-orange hover:shadow-soft"
    >
      {/* Neutral chip, and it does NOT invert on hover. Every app icon is drawn as
          a `currentColor` outline PLUS a hardcoded #FF6A1F accent detail — filling
          this with orange would swallow that accent on all sixteen of them. Navy on
          a pale ground is what makes both halves of the mark read. */}
      <span className="shrink-0 w-9 h-9 rounded-[10px] bg-page text-navy flex items-center justify-center [&>svg]:w-[19px] [&>svg]:h-[19px] transition-colors group-hover:bg-orange-soft">
        {app.icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-navy leading-snug group-hover:text-orange transition-colors">
          {app.name}
        </span>
        {/* No `block` here on purpose: `line-clamp-2` sets `display:-webkit-box`
            itself, and pairing the two leaves which one wins up to Tailwind's
            emit order. The clamp already gives the span a block-level box. */}
        <span className="mt-0.5 text-[11.5px] leading-snug text-grey-2 line-clamp-2">{app.description}</span>
      </span>
    </Link>
  );
}

/** Fallback mark for the "Other" group — an app tagged with no category. */
function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}
