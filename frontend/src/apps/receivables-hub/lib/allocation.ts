/**
 * allocation.ts — the one place that decides whether a payment was applied AGAINST a specific
 * invoice or left ON ACCOUNT.
 *
 * The Other Payments Report and the Salesperson Collection Report both split the same rupees this
 * way; when they each carried their own copy of the rule they disagreed on an unlabelled row that
 * carried a reference invoice. Import from here so the two reports can never diverge again.
 *
 * `type` is the pipeline's normalized allocation label ("AGST REF" / "ON ACCOUNT").
 */
export function isAgainstInvoice(
  type: string | null | undefined,
  refInvoice: string | null | undefined,
): boolean {
  const ty = (type ?? "").toUpperCase();
  if (ty.includes("ON ACC") || ty.includes("ADVANCE")) return false;
  if (ty.includes("AGST")) return true;
  return !!(refInvoice && refInvoice.trim());   // unlabelled but it names a bill → against it
}

export function allocLabel(
  type: string | null | undefined,
  refInvoice: string | null | undefined,
): "Against Invoice" | "On Account" {
  return isAgainstInvoice(type, refInvoice) ? "Against Invoice" : "On Account";
}
