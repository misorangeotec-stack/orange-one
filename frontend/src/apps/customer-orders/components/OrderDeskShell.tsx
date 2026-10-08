import { NavLink, useNavigate } from "react-router-dom";
import { deskPaths } from "../lib/paths";
import type { ReactNode } from "react";
import { useAuth } from "@/core/platform/auth";
import Logo from "@/shared/components/ui/Logo";
import { cn } from "@/shared/lib/cn";
import { callUs } from "../lib/customerLabels";

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

/*
  ⚠ ABSOLUTE, AND THEY HAVE TO BE. A relative `to` resolves against the current
    route, so "orders" meant /order-desk/orders from the index, but
    /order-desk/orders/orders from My orders (which matched `orders/:id` and read
    "We cannot find that order") and /order-desk/orders/:id/orders from an order
    (which matched nothing and bounced to Place an order). See lib/paths.ts.

  `end` is true only on Place an order: My orders should stay lit while the
  customer is reading one of them.
*/
const TABS = [
  { to: deskPaths.place, label: "Place an order", end: true },
  { to: deskPaths.orders, label: "My orders", end: false },
  { to: deskPaths.password, label: "Password", end: false },
];

/*
  THE INK PALETTE (OD-19). Brand orange and the two blues come from
  orangeotec.com (#F6891F / #E07A18, #1976D2 / #1565C0); the rest is the process
  ink set a textile printer runs — cyan, magenta, yellow, black — which is what
  this customer is buying from us. Kept here, in the Order Desk's own frame, so
  the staff portal's theme is untouched.
*/
const INK = {
  navy: "#0B1A36",
  blue: "#1565C0",
  blueLight: "#1976D2",
  orange: "#F6891F",
  cyan: "#00AEEF",
  magenta: "#EC008C",
  yellow: "#FFD400",
  black: "#1D1D1B",
};

/** Soft ink blooms behind the header — decoration only, hidden from readers. */
function InkSplash() {
  const bloom = (color: string, cls: string, opacity: number) => (
    <span
      className={cn("absolute rounded-full blur-3xl", cls)}
      style={{ background: color, opacity }}
    />
  );
  const drop = (color: string, cls: string) => (
    <span className={cn("absolute rounded-full", cls)} style={{ background: color, opacity: 0.85 }} />
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* a faint dot screen, like a print raster */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1.2px)",
          backgroundSize: "18px 18px",
        }}
      />
      {bloom(INK.cyan, "w-[420px] h-[420px] -top-40 right-[-80px]", 0.45)}
      {bloom(INK.magenta, "w-[300px] h-[300px] top-16 right-[22%]", 0.32)}
      {bloom(INK.yellow, "w-[220px] h-[220px] -bottom-24 right-[8%]", 0.3)}
      {bloom(INK.orange, "w-[340px] h-[340px] -bottom-48 -left-24", 0.38)}
      {/* a few crisp droplets */}
      {drop(INK.cyan, "w-3 h-3 top-[38%] right-[12%]")}
      {drop(INK.magenta, "w-2 h-2 top-[22%] right-[30%]")}
      {drop(INK.yellow, "w-2.5 h-2.5 bottom-[30%] right-[20%]")}
      {drop(INK.orange, "w-2 h-2 top-[60%] left-[40%]")}
    </div>
  );
}

/** The four process inks and our orange, as the band under the header. */
function InkStripe() {
  return (
    <div aria-hidden className="relative flex h-1.5">
      {[INK.cyan, INK.magenta, INK.yellow, INK.black, INK.orange].map((c) => (
        <span key={c} className="flex-1" style={{ background: c }} />
      ))}
    </div>
  );
}

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
    <div
      className="min-h-screen font-sans text-ink flex flex-col"
      style={{ background: "linear-gradient(180deg, #EEF3FB 0%, #F6F8FC 40%, #FBF7F2 100%)" }}
    >
      <header
        className="relative text-white"
        style={{ background: `linear-gradient(125deg, ${INK.navy} 0%, #10295A 50%, ${INK.blue} 100%)` }}
      >
        <InkSplash />

        <div className="relative max-w-5xl mx-auto px-5 sm:px-8">
          <div className="h-[68px] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Logo variant="dark" height={28} withLink={false} />
              <span className="hidden sm:block h-6 w-px bg-white/25" />
              <span className="hidden sm:inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-semibold text-white/90 ring-1 ring-white/15 backdrop-blur">
                Order Desk
              </span>
            </div>
            <button
              onClick={leave}
              className="rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-white/85 ring-1 ring-white/20 hover:bg-white/10 hover:text-white transition shrink-0"
            >
              Sign out
            </button>
          </div>

          <nav className="flex gap-1.5 overflow-x-auto pb-1">
            {TABS.map((t) => (
              <NavLink
                key={t.label}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-full px-4 py-2 text-[13.5px] font-semibold whitespace-nowrap transition",
                    isActive
                      ? "bg-white text-navy shadow-[0_6px_20px_-6px_rgba(0,0,0,0.45)]"
                      : "text-white/75 hover:text-white hover:bg-white/10",
                  )
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>

          <div className="pt-7 pb-16 sm:pb-20">
            <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight leading-tight">{title}</h1>
            {subtitle ? (
              /* Pages pass grey text and links meant for a white page; lift them for the dark band. */
              <div className="text-[14.5px] text-white/80 mt-1.5 [&_*]:!text-white/80 [&_a:hover]:!text-white">
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>

        <InkStripe />
      </header>

      {/* The cards rise over the band — the page reads as one piece, not a strip and a sheet. */}
      <main className="relative flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 -mt-10 sm:-mt-12 pb-14">
        {children}
      </main>

      <footer className="border-t border-line/70 bg-white/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-grey">
          <span className="flex items-center gap-2">
            <span aria-hidden className="flex gap-1">
              {[INK.cyan, INK.magenta, INK.yellow, INK.orange].map((c) => (
                <span key={c} className="w-2 h-2 rounded-full" style={{ background: c }} />
              ))}
            </span>
            Orange O Tec · Inks and machines for digital textile printing
          </span>
          <span>{callUs("Need help? Call us")}</span>
        </div>
      </footer>
    </div>
  );
}
