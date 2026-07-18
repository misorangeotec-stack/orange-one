import type { ReactNode } from "react";
import NotificationsBell from "./NotificationsBell";
import UserMenu from "./UserMenu";
import type { NotificationItem, ShellUser } from "./types";

/** Application top bar: page title, dev role switcher, notifications, user menu. */
export default function Topbar({
  title,
  user,
  notifications,
  onMarkRead,
  onMarkUnread,
  roleSwitcher,
  onMenu,
}: {
  title: string;
  user: ShellUser;
  notifications: NotificationItem[];
  onMarkRead?: (ids: string[]) => void;
  onMarkUnread?: (ids: string[]) => void;
  roleSwitcher?: ReactNode;
  onMenu: () => void;
}) {
  return (
    <header className="h-[68px] shrink-0 border-b border-line bg-white/80 backdrop-blur sticky top-0 z-30">
      <div className="h-full px-4 sm:px-6 flex items-center gap-3">
        {/* mobile hamburger */}
        <button
          onClick={onMenu}
          className="lg:hidden w-10 h-10 rounded-xl border border-line flex items-center justify-center text-navy"
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>

        <h1 className="text-[17px] font-semibold text-navy truncate">{title}</h1>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {roleSwitcher}
          <NotificationsBell items={notifications} onMarkRead={onMarkRead} onMarkUnread={onMarkUnread} />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
