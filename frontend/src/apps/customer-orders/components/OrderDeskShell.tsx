import { NavLink, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/core/platform/auth";
import Logo from "@/shared/components/ui/Logo";
import { cn } from "@/shared/lib/cn";

/**
 * The Order Desk's own frame. NOT `AppShell`, and that is the whole point.
 *
 * ⚠ THE SHARED SHELL IS THE DEFAULT AND THE WRONG DEFAULT HERE (Q12). It carries
 *   a module sidebar built from every app the reader can open, a breadcrumb whose
 *   first step is the internal category name, a notifications bell fed by our own
 *   activity trail, a "Home" link into the staff launcher, and `UserMenu` — which
 *   prints `roleLabel`, and `roleLabel` has no answer for a customer. It would
 *   caption the head of Bishen Dyeing as "Employee" of Orange O Tec.
 *
 *   `receivables-hub/layouts/UserLayout.tsx` is the precedent for a differently
 *   chromed shell riding the same `useAuth` / `useSession` stack. This one goes
 *   further and shares nothing but the logo.
 *
 * ⚠ AND THE LOGO DOES NOT LINK. Every other logo in the portal is a link to `/`,
 *   which is the marketing landing page — a dead end with a "Sign in" button on it
 *   for somebody already signed in. `withLink={false}`.
 *
 * There is no bell here either, and that is deliberate rather than unfinished:
 * the notifications a customer order generates are OURS — "fill in the billing
 * company", "Credit hold on SO-…: <reason>" — and the whole of Q6 is that those
 * words never reach the customer. The server already drops the customer from the
 * internal ones; not building a bell means a mistake there has nowhere to surface.
 */

const TABS = [
  { to: "", label: "Place an order", end: true },
  { to: "orders", label: "My orders", end: false },
  { to: "password", label: "Password", end: false },
];

export default function OrderDeskShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const leave = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-page font-sans text-ink">
      <header className="border-b border-line bg-white">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 h-[64px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Logo variant="light" height={28} withLink={false} />
            <span className="hidden sm:block h-6 w-px bg-line" />
            <span className="hidden sm:block text-[13px] font-semibold text-grey truncate">
              Orange Order Desk
            </span>
          </div>
          <button
            onClick={leave}
            className="text-[13px] font-semibold text-grey hover:text-orange transition shrink-0"
          >
            Sign out
          </button>
        </div>

        <nav className="max-w-5xl mx-auto px-5 sm:px-8 flex gap-1 -mb-px">
          {TABS.map((t) => (
            <NavLink
              key={t.label}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  "px-3 sm:px-4 py-2.5 text-[13.5px] font-semibold border-b-2 transition",
                  isActive
                    ? "border-orange text-orange"
                    : "border-transparent text-grey hover:text-ink"
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-5 sm:px-8 py-8">
        <h1 className="text-[24px] sm:text-[26px] font-bold tracking-tight">{title}</h1>
        {subtitle ? <div className="text-[14px] text-grey mt-1">{subtitle}</div> : null}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}
