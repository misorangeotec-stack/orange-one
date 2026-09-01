import { paperDate } from "./format";
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
  /** The standing sentence beside every warranty, from `fms_ocpi_config`. */
  warrantyNote?: string;
}

const money = (n: number | null): string | null =>
  n === null ? null : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * The NUMBER of months in a warranty answer — never the answer itself.
 *
 * 🔴 THIS FUNCTION IS THE WHOLE REASON PER-MACHINE WARRANTIES DID NOT REOPEN A
 *    BUG THIS MODULE HAS ALREADY PAID FOR ONCE. Read the note on `warranty`
 *    above: the clause prose supplies the word "months" itself —
 *    "Machine Warranty period will be of {{machine_warranty_months}} months
 *    from the date of installation" — so a token that resolves to TEXT prints
 *    "of 12 Months months", which is exactly what a real contract once said.
 *
 *    `{{machine_warranty_months}}` is in 21 live machine sections and
 *    `{{head_warranty_months}}` in 10 (checked 01-Sep-2026), so getting this
 *    wrong is 21 broken sentences on customer contracts, not one.
 *
 * ⚠ AN UNPARSEABLE ANSWER RESOLVES TO NULL, which prints a RULED BLANK. That is
 *   deliberate and is the module's standing failure mode: a blank is visible and
 *   gets fixed, a wrong number is not. So "1 Year" blanks the clause rather than
 *   printing "1".
 *
 * It reads the LEADING integer, which is right for every value on record —
 * "12 Months", "12 months from installation" and even the old dropdown's
 * "12 months warranty -> maximum 13 months from the invoice date" all mean 12.
 */
const months = (v: string | null): string | null => {
  const m = /^\s*(\d+)\b/.exec(v ?? "");
  return m ? m[1] : null;
};

/**
 * Build the token table for one deal.
 *
 * A value of null means "not answered" and becomes a blank. An empty string is
 * treated the same way — a field someone cleared is not an answer.
 */
export function tokensFor({ deal, profile, warranty, warrantyNote }: TokenContext): Record<string, string | null> {
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
    /*
      🔴 PER MACHINE AGAIN, AND FROZEN ON THE DEAL (OCPI-14) — with the config
         setting kept as the fallback.

         They became a company-wide setting because the per-deal dropdowns held
         sentences rather than numbers (see TokenContext). The client's 01-09
         sheet then showed the single setting was wrong the other way: 15 of the
         28 models carry NO head warranty, so a fixed 18 months was being printed
         for models that offer none.

         The deal's own `printerWarranty` / `headWarranty` — prefilled from the
         machine master and frozen onto every revision — are the source now, and
         `months()` is what stops the old bug returning. A deal that recorded
         nothing falls back to the setting, so nothing that printed before stops
         printing.

      ⚠ THE DEAL, NOT THE MACHINE, and that is the same rule as every other
        quoted term: a revision must print what was quoted, not what the master
        says today.
    */
    machine_warranty_months:
      months(deal.printerWarranty) ?? (warranty ? String(warranty.machineMonths) : null),
    head_warranty_months:
      months(deal.headWarranty) ?? (warranty ? String(warranty.headMonths) : null),
    /*
      ⚠ THE DRYER WARRANTY TOKEN IS BACK, and with NO fallback. It was retired
        because the client offered no dryer warranty at all; the 01-09 sheet
        gives one on all 11 Direct machines. There is no setting to fall back to
        and there must not be one — a machine with no dryer warranty resolves to
        null and rules a blank, which is the honest answer.

        No live template uses it yet (0 of 82 sections, checked 01-Sep-2026), so
        this changes no existing paper.
    */
    dryer_warranty_months: months(deal.dryerWarranty),
    /*
      OCPI-14 · the standing sentence the client asked to appear beside every
      warranty. Available to templates so a machine can place it inside its own
      warranty clause rather than only in the block the renderer draws.
    */
    warranty_note: warrantyNote ?? null,
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
    // ⚠ dryer_price IS RETIRED (OCPI-14) — the form no longer asks it, so it
    //   would resolve to null on every new deal. Left OUT rather than set to
    //   null so a template still using it is reported as UNRESOLVED in the
    //   editor's "what will be blank?" warning instead of quietly ruling a
    //   blank. No live template uses it — checked 01-Sep-2026, 0 of 82 sections.
    ex_works_city: profile?.exWorksCity ?? null,
    bank_block: bank,
    /*
      OCPI-18 · THE DELIVERY DATE REPLACED THE DELIVERY DAYS, on the form and on
      the contract, and the two halves had to land in this order.

      `{{delivery_days}}` was live in the SALE CONDITIONS OF THE SUPPLY clause of
      21 of the 28 machine decks. Removing the form field on its own would have
      printed "Delivery Days: ________" in the delivery clause of a signed
      document, so the same change rewrites those 21 sections to read

          Tentative Machine Delivery Date: {{delivery_date}}
          Applicable from the date of signing of this contract.

      ⚠ THIS TOKEN HAD TO EXIST BEFORE THE MIGRATION RAN. A section rewritten to
        use a token the resolver does not know resolves to `undefined`, which is
        reported as unresolved and printed as the very ruled blank the change was
        made to remove.

      ⚠ IT IS FORMATTED, AND WITH THE PAPERS' FORMATTER, NOT THE SCREEN'S. This
        token prints INSIDE the contract, three lines under a "Date:" header the
        same document draws with `paperDate`, so it reads through the same
        function rather than through the screen's `dmy`. The two happen to return
        identical text today — checked month by month — and `paperDate` carries
        the note on why that is a coincidence worth not depending on.

        An empty string is not an answer, hence the `|| null` — that is what makes
        an unanswered date rule a blank instead of printing nothing at all.
    */
    delivery_date: paperDate(deal.deliveryDate) || null,
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
  { token: "machine_warranty_months", means: "machine warranty, in MONTHS — from the machine master via the deal; the clause supplies the word “months” itself" },
  { token: "head_warranty_months", means: "print-head warranty, in MONTHS. Blank on the 15 models that offer none" },
  { token: "dryer_warranty_months", means: "dryer warranty, in MONTHS. Blank on a machine that carries no dryer" },
  { token: "warranty_note", means: "the standing sentence — warranty applies from the date of dispatch from the manufacturer" },
  { token: "consumables_supplier", means: "who consumables must be bought from" },
  { token: "machine_model_no", means: "manufacturer's model code, e.g. HM1800B-TK24" },
  { token: "dryer_name", means: "the dryer model on this deal — only on a machine that takes one" },
  { token: "dryer_chambers", means: "how many chambers the dryer has" },
  { token: "heating_medium", means: "how the dryer heats — electric, gas, thermic fluid" },
  { token: "ex_works_city", means: "Ex-Works city of the selling company" },
  { token: "bank_block", means: "the selling company's full bank details" },
  { token: "delivery_date", means: "the tentative machine delivery date, dd-mmm-yyyy" },
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
