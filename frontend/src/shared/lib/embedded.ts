/**
 * "This page is rendering inside My Control Center's work panel."
 *
 * The panel (core/workspace/WorkPanel.tsx) shows an FMS page beside the home
 * screen so a reviewer can approve, reassign or review without leaving it. The
 * page inside is the REAL page — same store, same buttons, same permission
 * checks, same RPCs — so nothing about an action can drift between the panel and
 * the FMS. All it drops is the chrome: AppShell reads this and renders without
 * the sidebar, topbar and announcement strip, which would otherwise be squeezed
 * into the panel a second time.
 *
 * ⚠ SAME WINDOW, NOT AN IFRAME. An iframe was tried first: it had to boot a
 *   second copy of the whole app (session, directory, every FMS dataset) before
 *   showing anything, which took seconds even when kept warm. In the same window
 *   the page renders against the query cache My Control Center has already
 *   filled, under the very keys the FMS stores use — so it opens at once, and
 *   whatever it changes updates the list behind it directly.
 */
import { createContext, useContext } from "react";

export const InPanelContext = createContext(false);

export const useInPanel = (): boolean => useContext(InPanelContext);
