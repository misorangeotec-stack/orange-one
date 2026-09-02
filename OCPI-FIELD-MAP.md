# OCPI · field → document map

> **Generated — do not edit by hand.** Regenerate with `cd frontend && npm run field-map`.
> Produced 2026-09-02 from `fieldSpec.ts`, `quotationPdf.ts`,
> `ocPdf.ts`, `tokens.ts` and the live `fms_ocpi_machine_sections` table.

**The short form** is the summary one-pager (`quotationPdf.ts`) — the same four sections on every
deal. **The long form** is the detailed order confirmation (`ocPdf.ts`) plus the machine's own
template sections, and it is **per machine**: a field reaching it through a `{{token}}` appears only
on the machines whose template uses that token. That is why the last column carries a **count**, not
a tick.

**The denominator is 21** — the active machines that have a template. The 7 without one print
no long form at all and are neither "prints" nor "missing": *Book Printer*, *Foil Machine*, *KoloRado Alpha 3.2 — 16 heads*, *Label Printer*, *Mini Lario*, *Pengda PD-1700XD-800*, *Pengda PD-1800XD-800*.

⚠ **This is a static claim, not proof.** A field can be referenced in a renderer and still never
appear — inside a branch that never fires, in a section the machine has no rows for, or in a column
that overflows. OCPI-12's rendered PDFs are what settle it.

## The 18 fields that reach no document at all

Captured, stored, and printed nowhere on any machine — with no token a template could even use.
Each is a question for the client rather than automatically a bug, but nobody has decided that it
should be invisible.

| Field | Label |
|---|---|
| `salespersonUserId` | Salesperson (user) |
| `customerId` | Customer |
| `customerEmail` | Email |
| `customerMobile` | Mobile |
| `gstAvailable` | GST registered |
| `companyId` | Selling company |
| `locationId` | Location |
| `machineId` | Machine |
| `inkOfferRate` | Ink — subsidized rate (₹ per litre) |
| `headOfferRate` | Head — subsidized rate (₹ per head) |
| `paymentType` | Type of payment |
| `fxRateAt` | Rate fetched at |
| `fxRateSource` | Rate source |
| `fxRateOverridden` | Rate entered by hand |
| `externalCentering` | External centering system |
| `postWarrantyHeadPrice` | Head price after the warranty |
| `insuranceClauseAgreed` | Insurance clause agreed |
| `deliveryDays` | Delivery days |

## The 1 offered as a token that no template uses

Different from the list above, and a question for the template authors rather than the client: the
placeholder exists, so any machine's deck *could* print this, and not one of them does.

| Field | Label | Token |
|---|---|---|
| `machineModelNo` | Manufacturer's model no. | `{{machine_model_no}}` · **0/21** |

## Every field

| Field | Label | Short form | Long form (direct) | Long form (via token) | Verdict |
|---|---|---|---|---|---|
| `salespersonName` | Salesperson | ✓ (section undetermined) | — | — | prints |
| `salespersonUserId` | Salesperson (user) | — | — | — | 🔴 **screen only — deliberate?** |
| `customerId` | Customer | — | — | — | 🔴 **screen only — deliberate?** |
| `customerName` | Customer / party name | ✓ (section undetermined) | ✓ | `{{customer_name}}` · **0/21** | prints |
| `customerAddress` | Customer address | ✓ (section undetermined) | ✓ | `{{customer_address}}` · **0/21** | prints |
| `customerAttn` | Contact person (Attn) | ✓ (section undetermined) | ✓ | `{{customer_attn}}` · **0/21** | prints |
| `customerEmail` | Email | — | — | — | 🔴 **screen only — deliberate?** |
| `customerMobile` | Mobile | — | — | — | 🔴 **screen only — deliberate?** |
| `gstAvailable` | GST registered | — | — | — | 🔴 **screen only — deliberate?** |
| `gstNo` | GST number | ✓ (section undetermined) | — | — | prints |
| `companyId` | Selling company | — | — | — | 🔴 **screen only — deliberate?** |
| `locationId` | Location | — | — | — | 🔴 **screen only — deliberate?** |
| `machineCount` | No. of machines | A · Machine Details | — | `{{machine_count}}` · **0/21** | prints |
| `machineId` | Machine | — | — | — | 🔴 **screen only — deliberate?** |
| `machineCategoryId` | Machine category | ✓ (section undetermined) | — | — | prints |
| `headType` | Type of head | A · Machine Details | — | — | prints |
| `headCount` | No. of print heads required | A · Machine Details | — | `{{head_count}}` · **0/21** | prints |
| `inkType` | Type of ink | A · Machine Details | — | — | prints |
| `inkPrice` | Ink selling price | A · Machine Details | — | — | prints |
| `inkCreditTerms` | Ink credit terms (future) | A · Machine Details | — | — | prints |
| `inclInk` | Deal includes ink | B · Deal Inclusions | — | — | prints |
| `inkQtyIncluded` | Quantity of ink included | B · Deal Inclusions | — | — | prints |
| `inkOfferAgreed` | Ink — offered at a subsidized rate | B · Deal Inclusions | — | — | prints |
| `inkOfferQty` | Ink — subsidized quantity (litres) | B · Deal Inclusions | — | — | prints |
| `inkOfferRate` | Ink — subsidized rate (₹ per litre) | — | — | — | 🔴 **screen only — deliberate?** |
| `inclSpares` | Deal includes spare parts | B · Deal Inclusions | — | — | prints |
| `spareDetails` | Spare part details and quantity | B · Deal Inclusions | — | — | prints |
| `inclCentering` | Deal includes centering device | B · Deal Inclusions | ✓ | — | prints |
| `centeringDetails` | Centering device details and quantity | B · Deal Inclusions | ✓ | — | prints |
| `inclHead` | Deal includes head | B · Deal Inclusions | — | — | prints |
| `headsIncluded` | No. of heads included | B · Deal Inclusions | — | `{{heads_included}}` · **0/21** | prints |
| `headOfferAgreed` | Head — offered at a subsidized rate | B · Deal Inclusions | — | — | prints |
| `headOfferQty` | Head — subsidized quantity (nos.) | B · Deal Inclusions | — | — | prints |
| `headOfferRate` | Head — subsidized rate (₹ per head) | — | — | — | 🔴 **screen only — deliberate?** |
| `dryerType` | Dryer category | A · Machine Details | ✓ | — | prints |
| `dealValueCurrency` | Currency | C · Commercial Terms | ✓ | — | prints |
| `dealValueAmount` | Total deal value (excl. GST) | C · Commercial Terms | ✓ | — | prints |
| `paymentType` | Type of payment | — | — | — | 🔴 **screen only — deliberate?** |
| `paymentTerms` | Terms of payment | C · Commercial Terms | — | `{{payment_terms}}` · **21/21** | prints |
| `deliveryDate` | Tentative machine delivery date | C · Commercial Terms | — | `{{delivery_date}}` · **21/21** | prints |
| `transportTerms` | Deal type | C · Commercial Terms | — | — | prints |
| `highSeasVia` | High seas delivery via | ✓ (section undetermined) | — | — | prints |
| `highSeasCostBy` | High seas cost borne by | ✓ (section undetermined) | — | — | prints |
| `localCostBy` | Local delivery cost borne by | ✓ (section undetermined) | — | — | prints |
| `fxRate` | USD to INR rate | C · Commercial Terms | ✓ | — | prints |
| `fxRateAt` | Rate fetched at | — | — | — | 🔴 **screen only — deliberate?** |
| `fxRateSource` | Rate source | — | — | — | 🔴 **screen only — deliberate?** |
| `fxRateOverridden` | Rate entered by hand | — | — | — | 🔴 **screen only — deliberate?** |
| `remarks` | Special remarks | D · Special Remarks | — | — | prints |
| `headBalanceRemarks` | Remarks — balance heads to be sold later | D · Special Remarks | — | — | prints |
| `otherCommitments` | Any other commitments on charges made by us | D · Special Remarks | — | — | prints |
| `dollarClauseAgreed` | Dollar-exchange clause agreed | C · Commercial Terms | — | — | prints |
| `headShipMode` | Head — how it ships | — | ✓ | — | prints |
| `headShipVia` | Head — separate shipment sent via | — | ✓ | — | prints |
| `headSeparateInvoice` | Head — separate invoice | — | ✓ | — | prints |
| `headInvoiceQty` | Head — invoice quantity | — | ✓ | — | prints |
| `headInvoiceAmount` | Head — invoice amount (excl. tax) | — | ✓ | — | prints |
| `inkShipMode` | Ink — how it ships | — | ✓ | — | prints |
| `inkShipVia` | Ink — separate shipment sent via | — | ✓ | — | prints |
| `inkSeparateInvoice` | Ink — separate invoice | — | ✓ | — | prints |
| `inkInvoiceQty` | Ink — invoice quantity | — | ✓ | — | prints |
| `inkInvoiceAmount` | Ink — invoice amount (excl. tax) | — | ✓ | — | prints |
| `dryerShipMode` | Dryer — how it ships | — | ✓ | — | prints |
| `dryerShipVia` | Dryer — separate shipment sent via | — | ✓ | — | prints |
| `dryerSeparateInvoice` | Dryer — separate invoice | — | ✓ | — | prints |
| `dryerInvoiceQty` | Dryer — invoice quantity | — | ✓ | — | prints |
| `dryerInvoiceAmount` | Dryer — invoice amount (excl. tax) | — | ✓ | — | prints |
| `sparesShipMode` | Spare parts — how they ship | — | ✓ | — | prints |
| `sparesShipVia` | Spare parts — separate shipment sent via | — | ✓ | — | prints |
| `sparesSeparateInvoice` | Spare parts — separate invoice | — | ✓ | — | prints |
| `sparesInvoiceQty` | Spare parts — invoice quantity | — | ✓ | — | prints |
| `sparesInvoiceAmount` | Spare parts — invoice amount (excl. tax) | — | ✓ | — | prints |
| `centeringShipMode` | Centering device — how it ships | — | ✓ | — | prints |
| `centeringShipVia` | Centering device — separate shipment sent via | — | ✓ | — | prints |
| `centeringSeparateInvoice` | Centering device — separate invoice | — | ✓ | — | prints |
| `centeringInvoiceQty` | Centering device — invoice quantity | — | ✓ | — | prints |
| `centeringInvoiceAmount` | Centering device — invoice amount (excl. tax) | — | ✓ | — | prints |
| `dryerName` | Dryer | A · Machine Details | ✓ | `{{dryer_name}}` · **0/21** | prints |
| `dryerIncluded` | Dryer included in the deal | A · Machine Details | ✓ | — | prints |
| `dryerChambers` | How many chambers with the dryer | A · Machine Details | ✓ | `{{dryer_chambers}}` · **0/21** | prints |
| `heatingMode` | Heating medium | A · Machine Details | ✓ | `{{heating_medium}}` · **0/21** | prints |
| `dryerWarranty` | Dryer warranty period | C · Commercial Terms | — | `{{dryer_warranty_months}}` · **0/21** | prints |
| `platterDetails` | Platter | A · Machine Details | — | — | prints |
| `airBlade` | Air blade | B · Deal Inclusions | ✓ | — | prints |
| `externalCentering` | External centering system | — | — | — | 🔴 **screen only — deliberate?** |
| `inkDustExhauster` | Ink dust exhauster | B · Deal Inclusions | ✓ | — | prints |
| `chillingSystem` | Chilling system | B · Deal Inclusions | ✓ | — | prints |
| `otherInclusions` | Other inclusions | B · Deal Inclusions | ✓ | — | prints |
| `printerWarranty` | Printer warranty period | C · Commercial Terms | — | `{{machine_warranty_months}}` · **21/21** | prints |
| `headWarranty` | Print-head warranty period | C · Commercial Terms | — | `{{head_warranty_months}}` · **10/21** | prints |
| `postWarrantyHeadPrice` | Head price after the warranty | — | — | — | 🔴 **screen only — deliberate?** |
| `consumablesSupplier` | Consumables to be bought from | — | — | `{{consumables_supplier}}` · **12/21** | prints |
| `insuranceClauseAgreed` | Insurance clause agreed | — | — | — | 🔴 **screen only — deliberate?** |
| `refNo` | Reference no. | — | ✓ | `{{ref_no}}` · **0/21** | prints |
| `deliveryDays` | Delivery days | — | — | — | 🔴 **screen only — deliberate?** |
| `tradeTerm` | Delivery term | — | — | `{{trade_term}}` · **21/21** | prints |
| `machineModelNo` | Manufacturer's model no. | — | — | `{{machine_model_no}}` · **0/21** | **token offered, no template uses it** |
| `preparedBy` | Prepared by | — | ✓ | — | prints |
| `approvedBy` | Approved by | — | ✓ | — | prints |
| `gstRate` | GST % | C · Commercial Terms | ✓ | `{{gst_rate}}` · **0/21** | prints |
| `machineValueInr` | Machine value (₹) | — | ✓ | `{{machine_value_inr}}` · **0/21** | prints |
| `gstAmountInr` | GST amount (₹) | C · Commercial Terms | ✓ | `{{gst_amount_inr}}` · **0/21** | prints |
| `totalInr` | Total (₹) | C · Commercial Terms | ✓ | `{{total_inr}}` · **0/21** | prints |

## Token usage across the templated machines

| Token | Machines |
|---|---|
| `{{bank_block}}` | **21/21** |
| `{{delivery_date}}` | **21/21** |
| `{{machine_warranty_months}}` | **21/21** |
| `{{payment_terms}}` | **21/21** |
| `{{trade_term}}` | **21/21** |
| `{{quotation_validity_days}}` | **19/21** |
| `{{consumables_supplier}}` | **12/21** |
| `{{head_warranty_months}}` | **10/21** |
