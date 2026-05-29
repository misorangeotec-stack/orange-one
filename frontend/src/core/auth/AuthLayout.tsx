import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Branded split-screen layout for auth pages, themed to the Orange One landing.
 * Left: navy brand panel with the value prop. Right: the form card.
 */
export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] font-sans">
      {/* Brand panel */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-sidebar text-white p-12">
        <div
          className="pointer-events-none absolute -top-32 -right-24 w-[420px] h-[420px] rounded-full"
          style={{ background: "radial-gradient(circle at 40% 40%, rgba(255,106,31,.28), rgba(255,106,31,0) 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-20 w-[360px] h-[360px] rounded-full"
          style={{ background: "radial-gradient(circle at 50% 50%, rgba(46,196,182,.16), rgba(46,196,182,0) 65%)" }}
        />
        <Link to="/" className="relative z-10 flex items-center gap-3">
          <svg viewBox="0 0 64 64" width="40" height="40" fill="none">
            <path d="M10 38a22 22 0 0 0 44 0Z" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinejoin="round" />
            <path d="M20 33c5-10 15-14 24-9" stroke="#FF6A1F" strokeWidth="5" strokeLinecap="round" />
            <path d="M30 32c5-6 12-7 18-3" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" />
          </svg>
          <span className="text-xl font-bold tracking-[3px]">ORANGE ONE</span>
        </Link>

        <div className="relative z-10 max-w-md">
          <h2 className="text-[34px] leading-tight font-bold">
            One platform.<br />
            Every <span className="text-orange-2">workflow.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[#aebbd4]">
            Track team tasks, revisions, follow-ups, and weekly execution accountability — all from
            one unified workspace built for Orange O Tec.
          </p>
        </div>

        <p className="relative z-10 text-xs text-[#7e8da8]">© 2026 Orange O Tec. All rights reserved.</p>
      </aside>

      {/* Form side */}
      <main className="relative flex items-center justify-center bg-page-grad px-6 py-12">
        <div className="w-full max-w-[400px]">
          {/* mobile brand */}
          <Link to="/" className="lg:hidden mb-8 flex items-center justify-center gap-2.5 text-navy">
            <svg viewBox="0 0 64 64" width="34" height="34" fill="none">
              <path d="M10 38a22 22 0 0 0 44 0Z" fill="none" stroke="#0B1B40" strokeWidth="3.4" strokeLinejoin="round" />
              <path d="M20 33c5-10 15-14 24-9" stroke="#FF6A1F" strokeWidth="5" strokeLinecap="round" />
            </svg>
            <span className="text-lg font-bold tracking-[2px]">ORANGE ONE</span>
          </Link>

          <div className="bg-white rounded-card-lg shadow-card border border-line p-8 sm:p-10">
            <h1 className="text-[26px] font-bold text-navy">{title}</h1>
            <p className="text-grey text-sm mt-2 leading-relaxed">{subtitle}</p>
            <div className="mt-7">{children}</div>
          </div>

          {footer && <div className="mt-6 text-center text-sm text-grey">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

/** Shared labelled text field used across auth forms. */
export function Field({
  label,
  type = "text",
  placeholder,
  autoComplete,
  defaultValue,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block mb-4">
      <span className="block text-[13px] font-medium text-navy mb-1.5">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-grey-2 outline-none transition focus:border-orange focus:ring-4 focus:ring-orange/10"
      />
    </label>
  );
}
