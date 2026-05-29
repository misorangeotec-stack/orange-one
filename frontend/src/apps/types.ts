import type { ComponentType, ReactNode } from "react";

/**
 * Every business app in the Orange One portal is described by an AppManifest.
 * The workspace launcher renders a card per manifest; the router mounts each
 * live app's component at `${basePath}/*`. Adding a new app = create a folder
 * under src/apps/<name>/ that exports a manifest, then register it in registry.tsx.
 */
export interface AppManifest {
  /** Stable unique id, e.g. "task-management". */
  id: string;
  /** Display name shown on the launcher card. */
  name: string;
  /** One-line description for the launcher card. */
  description: string;
  /** Route base, e.g. "/task-management". The app owns everything under it. */
  basePath: string;
  /** "live" apps are clickable + routed; "coming-soon" render as disabled cards. */
  status: "live" | "coming-soon";
  /** Card icon (inline SVG). */
  icon: ReactNode;
  /** Root component for a live app; it renders its own internal <Routes>. */
  Component?: ComponentType;
}
