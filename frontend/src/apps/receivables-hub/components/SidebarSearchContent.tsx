import type { ReactNode } from "react";
import { SidebarContent, useSidebar } from "@hub/components/ui/sidebar";
import { useHubSearch } from "@/core/workspace/hubSearch";
import {
  NavSearchIconButton,
  NavSearchInput,
  NavSearchResults,
  useNavSearch,
} from "@/shared/components/layout/NavSearchBox";

/**
 * `SidebarContent` with the portal's "search any FMS or report" box on top.
 *
 * The Outstanding Dashboard (UserSidebar) and Reports (ReportsSidebar) draw their own left
 * panel rather than the shared one, so without this they were the only staff screens with
 * no search box. Same box, same index, same rights as the shared panel — while something is
 * typed, the results take the place of the app's own menu.
 */
export function SidebarSearchContent({ children }: { children: ReactNode }) {
  const { state, setOpen, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const finder = useNavSearch({
    entries: useHubSearch(),
    onNavigate: () => isMobile && setOpenMobile(false),
    // On a phone the panel is a slide-in sheet that isn't mounted until opened.
    shortcut: !isMobile,
    onShortcut: () => collapsed && setOpen(true),
  });

  return (
    <>
      <div className="px-2 pb-1">
        {collapsed ? (
          <NavSearchIconButton
            onClick={() => {
              setOpen(true);
              finder.focus();
            }}
          />
        ) : (
          <NavSearchInput s={finder} />
        )}
      </div>
      <SidebarContent>{finder.searching && !collapsed ? <NavSearchResults s={finder} /> : children}</SidebarContent>
    </>
  );
}
