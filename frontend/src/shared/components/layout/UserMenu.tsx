import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import { useAuth } from "@/core/platform/auth";
import type { ShellUser } from "./types";

/** Topbar avatar + dropdown (profile / switch app / sign out). */
export default function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const onSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 group">
        <Avatar name={user.name} color={user.color} size={36} />
        <span className="hidden md:block text-left leading-tight">
          <span className="block text-[13px] font-semibold text-navy">{user.name}</span>
          <span className="block text-[11px] text-grey-2">{user.roleLabel}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-grey-2 hidden md:block">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white border border-line rounded-card shadow-card overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-line">
            <p className="text-sm font-semibold text-navy truncate">{user.name}</p>
            <p className="text-[12px] text-grey-2 truncate">{user.designation}</p>
          </div>
          <div className="py-1">
            <MenuRow label="My account" onClick={() => navigate("/account")} />
            <MenuRow label="Switch app" onClick={() => navigate("/home")} />
          </div>
          <div className="py-1 border-t border-line">
            <MenuRow label="Sign out" danger onClick={onSignOut} />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuRow({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={
        "w-full text-left px-4 py-2.5 text-[13px] font-medium transition hover:bg-page " +
        (danger ? "text-[#d4493f]" : "text-ink")
      }
    >
      {label}
    </button>
  );
}
