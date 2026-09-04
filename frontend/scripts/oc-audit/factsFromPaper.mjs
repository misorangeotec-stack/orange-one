/**
 * factsFromPaper.mjs — build the deal our renderer is driven with, from the real
 * contract itself.
 *
 * 🔴 EVERY FACT IS READ OFF THE PAPER, NEVER INVENTED. A dryer/no-dryer mismatch
 *    reads as a template gap when it is only a different deal: our renderer drops
 *    the dryer spec row, the dryer bullet and the words "AND DRYER" from the
 *    priced line on a deal with no dryer (OCPI-31), so rendering a no-dryer deal
 *    against a with-dryer contract would report three fabricated gaps and hide
 *    the fact that the template is right. Same for head count, currency and the
 *    FX rate.
 *
 * ⚠ WHAT CANNOT BE READ IS LEFT NULL AND RECORDED. A value the paper does not
 *   state is not guessed at — it goes into `unread`, which the report prints, so
 *   a gap caused by a fact we could not supply is never mistaken for a gap in the
 *   template.
 */

const num = (s) => {
  if (s === null || s === undefined) return null;
  const m = String(s).replace(/[^\d.]/g, "");
  return m === "" ? null : Number(m);
};

const findRow = (rows, re) => rows.find((r) => re.test(r.label))?.value ?? null;
const findTerm = (terms, re) => terms.find((t) => re.test(t.label))?.value ?? null;

/** Header value by label — the header band is `{label, value}` pairs. */
function header(p, re) {
  const hit = p.headerFields.find((h) => h.label && re.test(h.label));
  return hit ? hit.value : null;
}

/**
 * The customer's posted address, which is the run of unlabelled header lines.
 *
 * ⚠ THE DECKS PUT IT IN THREE PLACES. Some type it after `Address:`, some after a
 *   bare `To,` and some simply stack it under the date with no label at all, so
 *   it is gathered from the unlabelled lines rather than from one field.
 */
function addressBlock(p) {
  const parts = p.headerFields
    .filter((h) => !h.label || /^(address|to)$/i.test(h.label))
    .map((h) => h.value)
    .filter((v) => v && !/^to,?$/i.test(v.trim()));
  return parts.length ? parts.join(", ") : null;
}

/**
 * @param p        a parsed real OC
 * @param base     an existing deal row, used only as a skeleton so every column
 *                 the renderer touches exists with the right shape
 * @param ctx      { machine, categories, dryerTypes }
 */
export function factsFromPaper(p, base, ctx) {
  const unread = [];
  const need = (label, v) => {
    if (v === null || v === undefined || v === "") unread.push(label);
    return v ?? null;
  };

  /*
    ⚠ TWO DIFFERENT "MODELS" LIVE ON THESE CONTRACTS AND THEY ARE NOT THE SAME
      FIELD. The specification table's `Model` row is the sales name — `Homer
      K24`. The priced supply line carries the MANUFACTURER's model —
      `(Model No: HM1800B-TK24)` — and that is what `{{machine_model_no}}`
      prints. Driven with the sales name our render printed
      `(Model No: Homer K24)` against the real `(Model No: HM1800B-TK24)`, which
      is the audit supplying the wrong fact, not the template being wrong.

      ⚠ Related, and reported separately as an INPUT finding: nothing prefills
        `machine_model_no` on a real deal, so a salesperson who leaves the box
        empty prints a ruled blank here. That is the standing OCPI-4 F18 defect.
  */
  const supplyModel = /model\s*no\.?\s*[:.]?\s*([A-Za-z0-9\-. ]+?)\s*\)/i.exec(p.supplyDescription.join(" "));
  const specModel = supplyModel ? supplyModel[1].trim() : findRow(p.specRows, /^model$/i);
  const machineCount = num(findRow(p.specRows, /machine supply/i));
  // "24", "8 Heads (Epson i3200)", "15 Heads (Epson i3200)" all mean a count.
  const headsRaw = findRow(p.specRows, /installed printing heads|number of print heads|print heads/i);
  const headCount = num((headsRaw ?? "").split(/heads/i)[0]) ?? num(headsRaw);

  /*
    ⚠ THE DRYER IS DECIDED BY THE PAPER, THREE WAYS ROUND. A `Dryer` spec row with
      a real value, or a dryer line in the electrical row, or the words "AND
      DRYER" in the priced block. Any of them means this contract sold a dryer, so
      the render must be given a dryer category — otherwise `[[if dryer]]` strips
      wording the real contract has and the audit invents a gap.
  */
  const dryerRow = findRow(p.specRows, /^dryer$/i);
  const electrical = findRow(p.specRows, /electrical voltage/i) ?? "";
  const supplyText = p.supplyDescription.join(" ");
  const hasDryer =
    (dryerRow !== null && dryerRow.trim() !== "") ||
    /dryer\s*[：:]/i.test(electrical) ||
    /\bdryer\b/i.test(supplyText);

  const category = ctx.categories.find((c) => c.id === ctx.machine.categoryId);
  const noDryerName = ctx.dryerTypes.find((t) => t.meansNoDryer)?.name ?? "Not Applicable";
  const aDryerName = ctx.dryerTypes.find((t) => !t.meansNoDryer)?.name ?? "Chinese";
  // A Sublimation machine takes no dryer at all, whatever the paper says.
  const dryerType = category?.showsDryer && hasDryer ? aDryerName : noDryerName;

  /*
    ⚠ CURRENCY COMES FROM THE MONEY BLOCK, NOT FROM AN ASSUMPTION. K32/78 is a
      dollar contract — `USD 1,83,000.00` / `@89 (Fluctuate Rate)` / `INR
      1,62,87,000.00` — and `isUsdDealRow` switches both the money rows and the
      `[[if usd]]` forex clause on it. Rendered as rupees it would drop a clause
      the real contract carries.
  */
  const moneyText = p.money.map((m) => m.label + " " + m.value).join(" | ");
  const isUsd = /\bUSD\b|\$/.test(moneyText);
  const usdRow = p.money.find((m) => /\bUSD\b/.test(m.label + " " + m.value));
  const inrRows = p.money.filter((m) => /\bINR\b|₹/.test(m.label + " " + m.value));
  const rateRow = p.money.find((m) => /^@/.test(m.label));

  const machineValueInr =
    num(p.money.find((m) => /machine value/i.test(m.label))?.value) ??
    (inrRows.length ? num(inrRows[0].value) : null);
  const gstAmountInr = num(p.money.find((m) => /gst/i.test(m.label))?.value);
  const totalInr =
    num(p.money.find((m) => /total value|final total/i.test(m.label))?.value) ?? machineValueInr;
  const gstRate = (() => {
    const m = /\+\s*(\d+(?:\.\d+)?)\s*%/.exec(moneyText);
    return m ? Number(m[1]) : gstAmountInr ? 18 : null;
  })();

  /*
    The ink note as the contract states it. Taken whole — including "included in
    above value" — because `includedInkNote` prints a value that already says
    "included" verbatim, so copying the contract's own sentence round-trips
    exactly and the comparison tests the real thing.
  */
  const inkMatch = /Note\s*:?\s*\d*[).]?\s*([^\n]*?ink[^\n]*?included[^\n]*?)(?:\.|$)/i.exec(supplyText);
  const inkNote = inkMatch ? inkMatch[1].trim() + "." : null;

  const dateText = header(p, /^date$/i);
  const ocDate = parseDmy(dateText);

  const deal = {
    ...base,
    id: "audit-" + (ctx.machine.name || "x").replace(/\W+/g, "-"),
    quotationNo: null,
    ocNo: p.ocNo,
    machineId: ctx.machine.id,
    machineCategoryId: ctx.machine.categoryId,
    machineCount: machineCount ?? 1,
    headCount: headCount ?? null,
    /*
      🔴 DRIVEN BLANK ON PURPOSE, BECAUSE THAT IS WHAT A REAL DEAL CARRIES. The
         form's model box is free text nothing prefills — blank on all 30 live
         deals, checked 03-Sep-2026 — so `ocPdf.ts` falls back to the machine
         master, and driving a value here would test a path no salesperson ever
         takes. It also used to supply the wrong fact: `specModel` is the SALES
         name off the specification table ("Homer K24"), not the manufacturer's
         code the priced line wants ("HM1800B-TK24"), so our render printed
         "(Model No: Homer K24)" against the real "(Model No: HM1800B-TK24)" and
         reported the template as wrong when the audit was.
    */
    machineModelNo: null,
    customerName: need("customer name", firstCustomerLine(p)),
    customerAddress: addressBlock(p),
    customerAttn: header(p, /^attn$/i),
    gstNo: header(p, /^gst/i),
    refNo: header(p, /^ref$/i),
    ocAt: ocDate ? ocDate.toISOString() : new Date().toISOString(),

    dryerType,
    dryerName: null,
    dryerChambers: null,
    heatingMode: null,
    dryerIncluded: false,
    dryerPrice: null,
    dryerValueInr: null,
    dryerGstInr: null,
    grandTotalInr: null,

    dealValueCurrency: isUsd ? "USD" : "INR",
    dealValueAmount: isUsd ? num(usdRow?.value ?? usdRow?.label) : machineValueInr,
    fxRate: rateRow ? num(rateRow.label) : null,
    machineValueInr,
    gstRate,
    gstAmountInr,
    totalInr,

    tradeTerm: findTerm(p.terms, /^(trade )?terms$/i),
    paymentTerms: findTerm(p.terms, /payment/i),
    deliveryDate: null,

    // ⚠ CLEARED, NOT COPIED. The skeleton deal carries another customer's
    //   inclusions and shipment rows; left in place they would print bullets and
    //   a whole invoice table this contract never had.
    /*
      ⚠ THE INCLUDED-INK NOTE IS A FACT ON THE PAPER, so it is copied like every
        other. Three of the real contracts state it under the price — "Note: 1)
        300 Kgs ink included in above value." — and until the renderer learned to
        print it (OCPI-37) our side had nothing to compare. Left cleared, the
        audit would report the note as missing for ever, even after the fix.
    */
    inclInk: inkNote !== null,
    inkQtyIncluded: inkNote,

    inclHead: false, headsIncluded: null, inclSpares: false,
    inclCentering: false, centeringDetails: null, airBlade: false,
    inkDustExhauster: false, chillingSystem: false, otherInclusions: null,
    headShipMode: null, headShipVia: null, headSeparateInvoice: null,
    headInvoiceQty: null, headInvoiceAmount: null, headInvoiceSubtotal: null,
    inkShipMode: null, inkShipVia: null, inkSeparateInvoice: null,
    inkInvoiceQty: null, inkInvoiceAmount: null, inkInvoiceSubtotal: null,
    dryerShipMode: null, dryerShipVia: null, dryerSeparateInvoice: null,
    dryerInvoiceQty: null, dryerInvoiceAmount: null, dryerInvoiceSubtotal: null,
    sparesShipMode: null, sparesShipVia: null, sparesSeparateInvoice: null,
    sparesInvoiceQty: null, sparesInvoiceAmount: null, sparesInvoiceSubtotal: null,
    centeringShipMode: null, centeringShipVia: null, centeringSeparateInvoice: null,
    centeringInvoiceQty: null, centeringInvoiceAmount: null, centeringInvoiceSubtotal: null,

    preparedBy: signoffName(p, /prepared/i),
    approvedBy: signoffName(p, /approved|checked/i),
    /*
      🔴 THE WARRANTY MONTHS ARE ON THE PAPER AND MUST BE READ OFF IT. Both
         numbers reach the contract as `{{machine_warranty_months}}` /
         `{{head_warranty_months}}`, which resolve from the DEAL first and fall
         back to the company-wide config (12 / 18). Left null, every specimen
         renders the config figure — and Amarasha's real K24 says **24 months**.
         The audit then reports "the warranty sentence differs" on the
         known-clean control, which is not a template defect at all: it is the
         audit failing to copy a fact the contract states.
    */
    printerWarranty: monthsIn(p, /machine warranty/i),
    headWarranty: monthsIn(p, /print\s*head (policy|warranty)/i),
  };

  need("head count", headCount);
  need("machine value INR", machineValueInr);
  need("payment terms", deal.paymentTerms);
  need("trade term", deal.tradeTerm);

  return { deal, unread, read: { hasDryer, isUsd, machineCount, headCount, specModel } };
}

/**
 * The month count stated inside a clause — "warranty period will be of 24
 * months", "a Print Head Warranty of 18 months".
 *
 * ⚠ THE FIRST NUMBER FOLLOWED BY "MONTHS", not any number in the clause. The
 *   print-head clause goes on to mention 12 months twice more, for replacement
 *   heads; taking the last would quote a replacement term as the original one.
 */
function monthsIn(p, titleRe) {
  const sec = p.sections.find((s) => titleRe.test(s.title));
  if (!sec) return null;
  const m = /(\d{1,3})\s*months?/i.exec(sec.body.join(" "));
  return m ? m[1] + " Months" : null;
}

function firstCustomerLine(p) {
  const attn = p.headerFields.find((h) => /^attn$/i.test(h.label ?? ""))?.value;
  if (attn && attn.trim()) return attn.trim().replace(/^m\/s\.?\s*/i, "");
  const first = p.headerFields.find((h) => !h.label && h.value && !/^to,?$/i.test(h.value.trim()));
  return first ? first.value.trim() : null;
}

function signoffName(p, re) {
  const line = p.signoff.find((s) => re.test(s));
  if (!line) return null;
  const after = line.split(/[:]/).slice(1).join(":").trim();
  return after || null;
}

/** `10/06/2025`, `27.08.2026`, `12 / 06 / 2025` — the three the decks use. */
function parseDmy(s) {
  if (!s) return null;
  const m = /(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})/.exec(s);
  if (!m) return null;
  const y = Number(m[3].length === 2 ? "20" + m[3] : m[3]);
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
  return isNaN(d.getTime()) ? null : d;
}
