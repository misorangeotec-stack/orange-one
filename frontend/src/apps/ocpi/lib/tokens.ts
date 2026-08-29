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
  /**
   * The warranty periods, from module config.
   *
   * ⚠ NOT OFF THE DEAL ANY MORE. They used to come from `printer_warranty` and
   *   `head_warranty`, which the salesperson picked per quotation — and the
   *   values in those dropdowns did not fit the sentences they were dropped
   *   into. `PRINTER_WARRANTY` offered "24 months warranty → maximum 25 months
   *   from the invoice date", and the clause reads "will be of {{…}} months from
   *   the date of installation", so a real contract printed "will be of 24
   *   months warranty → maximum 25 months from the invoice date months from the
   *   date of installation". The head clause printed "of 24 Months months".
   *
   *   Fixed periods from a setting fix both, and are what the client asked for.
   *   Optional so a caller that has not been updated fails loudly as a BLANK in
   *   the preview rather than silently printing a wrong number.
   */
  warranty?: { machineMonths: number; headMonths: number };
}

const money = (n: number | null): string | null =>
  n === null ? null : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * Build the token table for one deal.
 *
 * A value of null means "not answered" and becomes a blank. An empty string is
 * treated the same way — a field someone cleared is not an answer.
 */
export function tokensFor({ deal, profile, warranty }: TokenContext): Record<string, string | null> {
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
    // Company-wide policy, not a per-deal answer — see TokenContext.
    machine_warranty_months: warranty ? String(warranty.machineMonths) : null,
    head_warranty_months: warranty ? String(warranty.headMonths) : null,
    // ⚠ NO dryer_warranty TOKEN ANY MORE. The client offers no dryer warranty at
    //   all, so there is nothing for it to resolve to. It is left OUT rather than
    //   set to null so that a template still using it is reported as unresolved in
    //   the editor's "what will be blank?" warning, instead of quietly printing a
    //   ruled blank. No live template uses it — checked 27-Aug-2026, 0 of 82
    //   sections.
    // ⚠ NO post_warranty_head_price TOKEN ANY MORE (stage J.1), retired the same
    //   way and for the same reason as dryer_warranty above. The four clauses that
    //   used it were reworded first — client-approved 29-Aug-2026 — to “replacement
    //   print heads will be supplied at the prices prevailing at the time of
    //   purchase”, which needs no figure. It is left OUT rather than set to null so
    //   that a template still using it is REPORTED as unresolved rather than
    //   quietly printing a ruled blank. 0 of 82 sections use it — verified after
    //   the reword and before the field was removed.
    consumables_supplier: deal.consumablesSupplier,
    machine_model_no: deal.machineModelNo,
    /*
      ⚠ THE DRYER GETS TOKENS, THE MACHINE NAMES DELIBERATELY DO NOT (stage I).

        The dryer's details print in a block of their own on both papers, and a
        template may also want them inside a sentence — "supplied with a
        {{dryer_chambers}}-chamber {{dryer_name}}" — so they are offered here.

        The machine's code and billing name are NOT tokens. `tokensFor` is given
        the deal, the profile and the warranty; it is not given the machine, and
        threading it through four call sites to offer a placeholder nothing asked
        for is how a token list fills up with entries no template uses. Both
        names already print: the code in every deck's own intro text, and the
        billing name as a "Product:" header line the renderer adds. If a template
        ever needs them inline, add them then — and read this note first.
    */
    dryer_name: deal.dryerName,
    dryer_chambers: deal.dryerChambers,
    heating_medium: deal.heatingMode,
    dryer_price: money(deal.dryerPrice),
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
  { token: "machine_warranty_months", means: "machine warranty, in months — a fixed company setting" },
  { token: "head_warranty_months", means: "print-head warranty, in months — a fixed company setting" },
  { token: "consumables_supplier", means: "who consumables must be bought from" },
  { token: "machine_model_no", means: "manufacturer's model code, e.g. HM1800B-TK24" },
  { token: "dryer_name", means: "the dryer model on this deal — only on a machine that takes one" },
  { token: "dryer_chambers", means: "how many chambers the dryer has" },
  { token: "heating_medium", means: "how the dryer heats — electric, gas, thermic fluid" },
  { token: "dryer_price", means: "the dryer's price, EXCLUDING GST — only when it is not part of the deal" },
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
