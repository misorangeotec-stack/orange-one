import { Link } from "react-router-dom";
import { cn } from "@/shared/lib/cn";

/**
 * Brand logo. Always pick the variant that matches the BACKGROUND it sits on:
 *   - variant="light"  → dark logo for use on light backgrounds (the index-page logo)
 *   - variant="dark"   → white logo for use on dark backgrounds
 * Both files live in /public/assets so they share one source of truth across the app.
 */
const LOGO_SRC = {
  light: "/assets/Orang_O_Tec_logo.jpg",
  dark: "/assets/orange-one-logo-dark.png",
} as const;

export default function Logo({
  variant = "light",
  height = 34,
  className,
  to = "/",
  withLink = true,
}: {
  variant?: "light" | "dark";
  height?: number;
  className?: string;
  to?: string;
  withLink?: boolean;
}) {
  const img = (
    <img
      src={LOGO_SRC[variant]}
      alt="Orange One — Orange O Tec"
      style={{ height }}
      className={cn("w-auto block select-none", className)}
      draggable={false}
    />
  );
  return withLink ? (
    <Link to={to} aria-label="Orange One home" className="inline-flex items-center">
      {img}
    </Link>
  ) : (
    img
  );
}
