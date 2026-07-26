/**
 * Shared categorical chart palette for the C-Level dashboard (and any hub chart).
 * Lifted out of ImportDashboard so widgets don't cross-import a page. Orange One theme —
 * brand orange accent + navy, no reference-app blue.
 */
export const CAT_COLORS = [
  "hsl(28,80%,52%)", // brand orange
  "hsl(220,45%,20%)", // navy
  "hsl(142,71%,45%)", // green
  "hsl(0,84%,60%)", // red
  "hsl(270,65%,60%)", // violet
  "hsl(180,65%,45%)", // teal
  "hsl(45,93%,47%)", // amber
  "hsl(320,65%,55%)", // magenta
  "hsl(195,80%,45%)", // cyan
] as const;

export const catColor = (i: number): string => CAT_COLORS[i % CAT_COLORS.length];

/** The two brand series colors used for current-vs-prior comparisons. */
export const SERIES_CURRENT = "hsl(28,80%,52%)"; // orange = this year
export const SERIES_PRIOR = "hsl(220,20%,65%)"; // muted grey = last year
export const ACCENT_NAVY = "hsl(220,45%,20%)";
export const RYG_GREEN = "hsl(142,71%,45%)";
export const RYG_RED = "hsl(0,84%,60%)";
