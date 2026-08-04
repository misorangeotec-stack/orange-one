/**
 * One icon per app category, used by the home screen's left menu (`homeNav.tsx`).
 *
 * The menu needs these because a collapsed rail shows nothing but icons — there
 * the icon IS the label, and without one every group renders the same generic
 * folder, which makes the rail unreadable.
 *
 * KEYED BY CATEGORY KEY, NOT BY LABEL. It used to be keyed by the display label,
 * which meant renaming a category silently dropped its icon — the "FMS" → real
 * departments rename is exactly the case that would have hit. `groupByCategory()`
 * hands back `key` alongside `label`, so the lookup costs nothing and a rename
 * cannot break it.
 *
 * House style for anything added here: 24-box, no fill, `currentColor` stroke at
 * width 2, round caps and joins — so a new mark sits at the same visual weight as
 * the app icons it will appear beside.
 */
import type { ReactNode } from "react";
import type { AppCategory } from "@/apps/categories";

/**
 * `"other"` is in the key type because `groupByCategory()` can emit it — an app
 * tagged with no category, or a stale one, lands in a trailing "Other" group. It
 * gets no mark here (there is no honest picture for "we don't know"), but naming
 * it in the type is what lets callers index straight off `group.key` without a
 * cast.
 */
export const GROUP_ICONS: Partial<Record<AppCategory | "other", ReactNode>> = {
  // Clipboard with a tick — personal work, checked off.
  productivity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4h6l1 3H8l1-3Z" />
      <rect x="4" y="7" width="16" height="14" rx="2" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  ),
  // Trolley — goods coming in against an order.
  purchase: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h2.5l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.2L20 7H5.2" />
      <circle cx="9" cy="20" r="1.6" />
      <circle cx="17" cy="20" r="1.6" />
    </svg>
  ),
  // Conical flask — the lab.
  sampling: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6" />
      <path d="M10 3v6.5L5.2 17.4A2 2 0 0 0 7 20.5h10a2 2 0 0 0 1.8-3.1L14 9.5V3" />
      <path d="M7.5 14h9" />
    </svg>
  ),
  // Factory roofline — the plant.
  production: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21V10l5 3.5V10l5 3.5V10l5 3.5V21z" />
      <path d="M18 10V4h3v17" />
      <path d="M7 17.5h2M13 17.5h2" />
    </svg>
  ),
  // Rising bars — the sales book and what it collects.
  sales: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 20h18" />
      <rect x="5" y="11" width="3.5" height="7" />
      <rect x="10.5" y="7" width="3.5" height="11" />
      <rect x="16" y="13" width="3.5" height="5" />
    </svg>
  ),
  // Two figures — people, joining and leaving.
  hr: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20c0-3.3 2.9-5 6.5-5s6.5 1.7 6.5 5" />
      <path d="M17 5.2a3.2 3.2 0 0 1 0 6M18.5 15.4c2 .7 3 2.2 3 4.6" />
    </svg>
  ),
  // Spanner — plant and equipment kept running.
  asset: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 3.5a5.5 5.5 0 0 0-6.9 7L3 16.1V21h4.9l5.6-5.6a5.5 5.5 0 0 0 7-6.9L17.6 11 13 6.4z" />
    </svg>
  ),
  // Sliders — the levers over everything else.
  control: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="1.8" fill="currentColor" />
      <circle cx="15" cy="12" r="1.8" fill="currentColor" />
      <circle cx="8" cy="18" r="1.8" fill="currentColor" />
    </svg>
  ),
  // No `mobile` mark on purpose: that grant has no web app and never renders in a
  // menu or on the launcher — it exists only on the permission screens.
};
