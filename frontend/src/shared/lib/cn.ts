/** Tiny classname joiner (avoids pulling clsx for now). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
