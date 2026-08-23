import type { OcpiCompanyProfile, OcpiDeal } from "../types";

/**
 * Placeholder resolution for machine templates.
 *
 * The order-confirmation boilerplate is not constant text. The PowerPoint decks
 * carry literal blanks — "Machine Warranty period will be of _______months",
 * "New Print Head price will be @ INR ____________ plus GST" — which somebody
 * fills by hand before printing. Here the blanks are named tokens and the deal
 * fills them.
 *
 * ⚠ AN UNRESOLVED TOKEN RENDERS AS A RULED BLANK, NEVER AS LITERAL `{{…}}`.
 *   This is the whole point of the function. A contract that reaches a customer
 *   reading "warranty of {{machine_warranty_months}} months" is worse than one
 *   reading "warranty of ________ months", because the second is obviously a
 *   blank someone must fill and the first looks like software that broke. The
 *   blank is what the paper process produced anyway.
 *
 * ⚠ SPEC ROWS ARE TOKENISED TOO, not just prose. A real submission raised a K32
 *   — whose deck prints "Number of installed printing heads: 32" — with SIXTEEN
 *   heads. Anything the deal can vary has to come from the deal.
 */

/** What a blank looks like when nothing fills it. */
export const BLANK = "________";

export interface TokenContext {
  deal: OcpiDeal;
  profile?: OcpiCompanyProfile;
}

const money = (n: number | null): string | null =>
  n === null ? null : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * Build the token table for one deal.
 *
 * A value of null means "not answered" and becomes a blank. An empty string is
 * treated the same way — a field someone cleared is not an answer.
 */
export function tokensFor({ deal, profile }: TokenContext): Record<string, string | null> {
  const bank = profile
    ? [
        profile.legalName,
        profile.bankName ? `Bank: ${profile.bankName}` : null,
        profile.bankBranch ? `Branch: ${profile.bankBranch}` : null,
        profile.bankAccountNo ? `A/C no. ${profile.bankAccountNo}` : null,
        profile.bankIfsc ? `IFSC: ${profile.bankIfsc}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : null;

  return {
    head_count: deal.headCount === null ? null : String(deal.headCount),
    heads_included: deal.headsIncluded === null ? null : String(deal.headsIncluded),
    machine_count: deal.machineCount === null ? null : String(deal.machineCount),
    machine_warranty_months: deal.printerWarranty,
    head_warranty_months: deal.headWarranty,
    dryer_warranty: deal.dryerWarranty,
    post_warranty_head_price: money(deal.postWarrantyHeadPrice),
    consumables_supplier: deal.consumablesSupplier,
    machine_model_no: deal.machineModelNo,
    ex_works_city: profile?.exWorksCity ?? null,
    bank_block: bank,
    delivery_days: deal.deliveryDays,
    payment_terms: deal.paymentTerms,
    trade_term: deal.tradeTerm,
    machine_value_inr: money(deal.machineValueInr),
    gst_amount_inr: money(deal.gstAmountInr),
    total_inr: money(deal.totalInr),
    gst_rate: deal.gstRate === null ? null : String(deal.gstRate),
    customer_name: deal.customerName,
    customer_attn: deal.customerAttn,
    customer_address: deal.customerAddress,
    ref_no: deal.refNo,
    oc_no: deal.ocNo,
    quotation_validity_days: null, // filled by the caller from module config
  };
}

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Replace every `{{token}}` in a string.
 *
 * Unknown tokens and unanswered values both become `BLANK`. An unknown token is
 * a template-authoring mistake, and rendering it as a blank means a wrong token
 * name degrades to "somebody must fill this in" rather than leaking braces onto
 * a contract. `unresolved` reports them so a preview can warn the author.
 */
export function resolve(
  text: string,
  tokens: Record<string, string | null>,
): { text: string; unresolved: string[] } {
  const missing = new Set<string>();
  const out = text.replace(TOKEN_RE, (_m, name: string) => {
    const key = name.toLowerCase();
    const v = tokens[key];
    if (v === undefined) {
      missing.add(key);
      return BLANK;
    }
    if (v === null || v.trim() === "") {
      missing.add(key);
      return BLANK;
    }
    return v;
  });
  return { text: out, unresolved: [...missing] };
}

/** Every token name a template uses — for the "what will be blank?" warning. */
export function tokensUsedIn(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) out.add(m[1].toLowerCase());
  return [...out];
}

/** The tokens a template author may use, for the editor's help text. */
export const TOKEN_HELP: { token: string; means: string }[] = [
  { token: "head_count", means: "print heads on this deal (a K32 can be sold with 16)" },
  { token: "heads_included", means: "heads included free in the deal" },
  { token: "machine_count", means: "how many machines" },
  { token: "machine_warranty_months", means: "printer warranty period" },
  { token: "head_warranty_months", means: "print-head warranty period" },
  { token: "dryer_warranty", means: "dryer warranty period" },
  { token: "post_warranty_head_price", means: "head price after the warranty lapses" },
  { token: "consumables_supplier", means: "who consumables must be bought from" },
  { token: "machine_model_no", means: "manufacturer's model code, e.g. HM1800B-TK24" },
  { token: "ex_works_city", means: "Ex-Works city of the selling company" },
  { token: "bank_block", means: "the selling company's full bank details" },
  { token: "delivery_days", means: "committed delivery days" },
  { token: "payment_terms", means: "the agreed payment terms" },
  { token: "trade_term", means: "Ex-Work / CIF / FOB" },
  { token: "machine_value_inr", means: "machine value in rupees" },
  { token: "gst_rate", means: "GST percentage" },
  { token: "gst_amount_inr", means: "GST amount in rupees" },
  { token: "total_inr", means: "total in rupees" },
  { token: "customer_name", means: "the customer" },
  { token: "customer_attn", means: "the contact person" },
  { token: "customer_address", means: "the customer's address" },
  { token: "ref_no", means: "the reference on the order confirmation" },
  { token: "oc_no", means: "the order-confirmation number" },
  { token: "quotation_validity_days", means: "how long the offer stands" },
];
