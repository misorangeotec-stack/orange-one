import { cn } from "@/shared/lib/cn";

const COLORS: Record<string, string> = {
  blue: "#3B82F6",
  orange: "#FF6A1F",
  teal: "#2EC4B6",
  violet: "#7C5CFC",
  rose: "#F43F8E",
  green: "#27AE60",
  navy: "#15294F",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Circular initials avatar tinted by the profile's avatar color. */
export default function Avatar({
  name,
  color = "navy",
  size = 36,
  className,
}: {
  name: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  // Accept either a named palette color (mock) or a raw hex value (live DB).
  const bg = color.startsWith("#") ? color : COLORS[color] ?? COLORS.navy;
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0", className)}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.4 }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
