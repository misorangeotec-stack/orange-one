import { NavLink, useNavigate } from "react-router-dom";
import { deskPaths } from "../lib/paths";
import type { ReactNode } from "react";
import { useAuth } from "@/core/platform/auth";
import Logo from "@/shared/components/ui/Logo";
import { cn } from "@/shared/lib/cn";
import { List, Lock, LogOut, ShoppingCart } from "lucide-react";
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
  { to: deskPaths.place, label: "Place an order", end: true, Icon: ShoppingCart },
  { to: deskPaths.orders, label: "My orders", end: false, Icon: List },
  { to: deskPaths.password, label: "Password", end: false, Icon: Lock },
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
  navy2: "#13306B",
  orange: "#F6891F",
  cyan: "#00AEEF",
  magenta: "#EC008C",
  yellow: "#FFD400",
  black: "#1D1D1B",
  page: "#F3F5F9",
};

/**
 * The ink-can picture supplied for the Order Desk (public/assets/order-desk-inks.png),
 * used as it is. Its left and bottom edges fade into the navy so it sits in the
 * band rather than on it. Decoration only.
 *
 * ⚠ IT IS SMALL (298×140, cut from the design mock-up), so it is shown near its
 *   own size. A higher-resolution original can replace the file as-is.
 */
function InkCans() {
  return (
    <img
      src="/assets/order-desk-inks.png"
      alt=""
      aria-hidden
      draggable={false}
      className="h-full w-auto select-none object-cover object-right"
      style={{
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0%, #000 28%), linear-gradient(to bottom, transparent 0%, #000 16%, #000 78%, transparent 100%)",
        WebkitMaskComposite: "source-in",
        maskImage:
          "linear-gradient(to right, transparent 0%, #000 28%), linear-gradient(to bottom, transparent 0%, #000 16%, #000 78%, transparent 100%)",
        maskComposite: "intersect",
      }}
    />
  );
}

/** Title with its last word in orange — "Place an <order>". */
function BrandTitle({ text }: { text: string }) {
  const i = text.lastIndexOf(" ");
  if (i < 0) return <span className="text-orange">{text}</span>;
  return (
    <>
      {text.slice(0, i)} <span className="text-orange">{text.slice(i + 1)}</span>
    </>
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
    <div className="min-h-screen font-sans text-ink flex flex-col overflow-x-hidden" style={{ background: INK.page }}>
      <header
        className="relative text-white"
        style={{ background: `linear-gradient(120deg, ${INK.navy} 0%, ${INK.navy2} 70%, #1A4A9A 100%)` }}
      >
        {/* light streaks across the navy */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{
            backgroundImage:
              "linear-gradient(115deg, transparent 0 55%, rgba(255,255,255,0.05) 55% 60%, transparent 60% 66%, rgba(255,255,255,0.04) 66% 69%, transparent 69%)",
          }}
        />
        {/* the ink cans, right-hand side, desktop only */}
        <div aria-hidden className="pointer-events-none absolute right-0 top-[64px] h-[190px] hidden md:flex justify-end">
          <InkCans />
        </div>

        <div className="relative max-w-5xl mx-auto px-5 sm:px-8">
          <div className="h-[80px] flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {/* The full-colour mark, as the website shows it — on a white plate,
                  because the artwork is drawn for a white background. */}
              <span className="inline-flex items-center rounded-xl bg-white px-3 py-2 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.55)]">
                <Logo variant="light" height={34} withLink={false} />
              </span>
              <span className="hidden sm:inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-semibold text-white/90 ring-1 ring-white/15">
                Order Desk
              </span>
            </div>
            <button
              onClick={leave}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-white/85 ring-1 ring-white/20 hover:bg-white/10 hover:text-white transition shrink-0"
            >
              <LogOut size={14} strokeWidth={2.4} />
              Sign out
            </button>
          </div>

          <nav className="flex gap-1.5 overflow-x-auto pb-1">
            {TABS.map(({ to, label, end, Icon }) => (
              <NavLink
                key={label}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-semibold whitespace-nowrap transition",
                    isActive
                      ? "bg-orange-grad text-white shadow-cta"
                      : "text-white/85 hover:text-white hover:bg-white/10",
                  )
                }
              >
                <Icon size={15} strokeWidth={2.4} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="pt-7 pb-24 sm:pb-28 md:pr-[380px]">
            <span aria-hidden className="block w-9 h-1 rounded-full bg-orange mb-3" />
            <h1 className="text-[30px] sm:text-[38px] font-bold tracking-tight leading-tight">
              <BrandTitle text={title} />
            </h1>
            {subtitle ? (
              /* Pages pass grey text and links meant for a white page; lift them for the band. */
              <div className="text-[14.5px] text-white/80 mt-1.5 [&_*]:!text-white/80 [&_a:hover]:!text-white">
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>

        {/* the curved foot of the band: an orange swoosh, then the page */}
        <svg
          aria-hidden
          className="absolute bottom-0 left-0 w-full h-[70px] sm:h-[90px]"
          viewBox="0 0 1440 100"
          preserveAspectRatio="none"
        >
          <path d="M0 18 C 260 80, 520 96, 780 96 S 1260 70, 1440 18 L1440 44 C 1260 92, 1000 100, 780 100 S 300 96, 0 52 Z" fill={INK.orange} />
          <path d="M0 52 C 300 96, 560 100, 780 100 S 1260 92, 1440 44 L1440 100 L0 100 Z" fill={INK.page} />
        </svg>
      </header>

      {/* The card rises over the curve, as in the design. */}
      <main className="relative flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 -mt-14 sm:-mt-16 pb-14">
        {children}
      </main>

      <footer className="border-t border-line bg-white">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-grey">
          <span className="flex items-center gap-2">
            <span aria-hidden className="flex gap-1">
              {[INK.cyan, INK.magenta, INK.yellow, INK.black, INK.orange].map((c) => (
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
