/** Compact Indian-scale rupee formatting for chart labels: ₹1.2Cr / ₹3.4L / ₹56k / ₹820. */
export function formatINRShort(n: number): string {
  const v = Math.round(n);
  if (v >= 1_00_00_000) return `₹${trim(v / 1_00_00_000)}Cr`;
  if (v >= 1_00_000) return `₹${trim(v / 1_00_000)}L`;
  if (v >= 1_000) return `₹${trim(v / 1_000)}k`;
  return `₹${v}`;
}

/** One decimal, but drop a trailing ".0". */
function trim(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, "");
}
