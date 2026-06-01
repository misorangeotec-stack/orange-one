import { useState } from "react";
import type { ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import Logo from "@/shared/components/ui/Logo";

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
        <div className="relative z-10">
          <Logo variant="dark" height={40} />
        </div>

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
          {/* mobile brand (light background → light-variant logo) */}
          <div className="lg:hidden mb-8 flex justify-center">
            <Logo variant="light" height={34} />
          </div>

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
  value,
  onChange,
  required,
  disabled,
  autoFocus,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (show ? "text" : "password") : type;
  return (
    <label className="block mb-4">
      <span className="block text-[13px] font-medium text-navy mb-1.5">{label}</span>
      <div className="relative">
        <input
          type={inputType}
          placeholder={placeholder}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          value={value}
          onChange={onChange}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          className={`w-full rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-grey-2 outline-none transition focus:border-orange focus:ring-4 focus:ring-orange/10 disabled:opacity-60${isPassword ? " pr-12" : ""}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            title={show ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-grey-2 hover:text-orange transition disabled:opacity-60"
            disabled={disabled}
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        )}
      </div>
    </label>
  );
}
