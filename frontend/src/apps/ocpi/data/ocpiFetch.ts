import { supabase } from "@/core/platform/supabase";
// fms_ocpi_* tables are not in the generated Database types; route table and rpc
// calls through an untyped alias (the row mappers below already treat rows as
// any). This is the standing FMS convention — see asset-maintenance/data/
// assetWrites.ts and order-to-dispatch/data/dispatchFetch.ts. Regenerating
// database.types.ts is a separate, overdue chore; it is already stale for six
// modules and nothing here should wait on it.
const db = supabase as any;

import type {
  OcpiCompanyProfile, OcpiDeal, OcpiDoc, OcpiMachine, OcpiMachineSection,
  OcpiNotification, OcpiStepOwner, QuotationVersion,
  OcpiMasterManager, OcpiMasterRequest, OcpiNamedMaster,
  OcpiDryer, OcpiMachineHead, OcpiSalesPage,
} from "../types";
import type { StepSla } from "../lib/sla";
// ⚠ A VALUE IMPORT, and safe: `fieldSpec` imports only from `../types`, so this
//   is not a cycle. See DEFAULT_GST_RATE's own note for why the number is shared
//   rather than written out here.
import { DEFAULT_GST_RATE } from "../lib/fieldSpec";

/**
 * A stored step_sla map as it comes OUT of the config table: every key optional,
 * every field optional, no promise that the step names still exist. Typed this
 * loosely on purpose — the strictness belongs in resolveStepSla, which merges it
 * over the defaults and drops what it cannot use.
 */
export type StoredStepSla = Partial<Record<string, Partial<StepSla>>>;

/**
 * OCPI read layer. One paginated pass over the module's tables, mapped
 * snake_case → camelCase, so the pure queue rules (lib/queues.ts) get plain data
 * and the Control Center adapter can reuse this exact react-query cache entry.
 *
 * ⚠ Every `.range()` is paired with an `.order()`. Postgres makes no ordering
 *   promise without one, so paging an unordered relation can return the same row
 *   on two pages and drop another entirely.
 *
 * ⚠ THE TALLY CUSTOMER MASTER IS NOT FETCHED HERE. mst_parties is large, shared
 *   and slow-changing, so it lives on its own query key with a long refresh
 *   interval (see ocpiMasters.ts) rather than being invalidated every time a
 *   deal is saved — the same split dispatchFetch.ts makes.
 */

const PAGE = 1000;

type Tbl =
  | "fms_ocpi_step_owners"
  | "fms_ocpi_config"
  | "fms_ocpi_company_profiles"
  | "fms_ocpi_machines"
  | "fms_ocpi_machine_sections"
  | "fms_ocpi_sales_pages"
  | "fms_ocpi_deals"
  | "fms_ocpi_quotation_versions"
  | "fms_ocpi_notifications"
  | "fms_ocpi_head_types"
  | "fms_ocpi_ink_types"
  | "fms_ocpi_dryer_types"
  | "fms_ocpi_machine_categories"
  | "fms_ocpi_dryers"
  | "fms_ocpi_machine_head_types"
  | "fms_ocpi_master_managers"
  | "fms_ocpi_master_requests";

async function fetchAll(table: Tbl, orderBy = "created_at"): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const OCPI_QK = ["ocpiData"] as const;
export const ocpiQueryKey = (userId: string | null) => [...OCPI_QK, userId] as const;

/**
 * Whether a person has vouched for where the quotation series stands.
 *
 * ⚠ THE COUNTER ITSELF IS ADMIN-READ ONLY, which is why this lives in config
 *   (`using (true)`) rather than being derived from fms_ocpi_counters. Every
 *   salesperson needs to be able to see that the series is unconfirmed — they
 *   are the ones about to send a customer a number.
 *
 * `confirmedAtValue` is a SNAPSHOT of what was confirmed and does not move as
 * quotations are minted afterwards. The live figure is the counter.
 */
export interface OcpiQuotationSeries {
  confirmed: boolean;
  confirmedAtValue: number | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

/**
 * The warranty periods, which are a company-wide POLICY and not a per-deal answer.
 *
 * ⚠ THIS REPLACED A PER-MACHINE MAPPING THAT WAS SPECIFIED AND THEN WITHDRAWN.
 *   The client settled on fixed periods — machine 12 months, head 18 — with no
 *   dryer or spare-parts warranty offered at all, and no dropdown anywhere. An
 *   exception is written into Special remarks instead.
 *
 * ⚠ THESE ARE MONTHS AS A BARE NUMBER, because the templates supply the word:
 *   "Machine Warranty period will be of {{machine_warranty_months}} months from
 *   the date of installation". A value of "12 Months" here would print
 *   "12 Months months".
 */
export interface OcpiWarranty {
  machineMonths: number;
  headMonths: number;
}

export interface OcpiConfig {
  processCoordinatorIds: string[];
  /**
   * The departments the Salesperson roster is drawn from — Sales, as seeded.
   *
   * ⚠ CONFIG RATHER THAN A CONSTANT so an admin can widen it (Management, say —
   *   both Directors carry a book) without a deploy. Empty means the picker
   *   offers nobody, which the Setup screen warns about rather than silently
   *   falling back to "everyone": a roster of 63 would put the whole warehouse
   *   on a customer's quotation.
   */
  salespersonDepartmentIds: string[];
  quotationValidityDays: number;
  defaultGstRate: number;
  warranty: OcpiWarranty;
  /**
   * OCPI-14 · the standing sentence printed beside every warranty, on the form
   * and on both papers. In config rather than in code because it is a clause on
   * a customer's contract, and rewording one should not need a deploy.
   */
  warrantyNote: string;
  quotationSeries: OcpiQuotationSeries;
  /**
   * Keyed by financial year, because the OC counter restarts each April and
   * confirming 2627 says nothing about 2728. An absent year is unconfirmed.
   */
  ocSeries: Record<string, OcpiQuotationSeries>;
}

export interface OcpiData {
  stepOwners: OcpiStepOwner[];
  config: OcpiConfig;
  /**
   * The RAW `step_sla` config value, unmerged.
   *
   * ⚠ DELIBERATELY NOT RESOLVED HERE. The defaults live in lib/sla.ts, which
   *   knows the step list; merging in the data layer would put a second copy of
   *   them behind the fetch, and a stored map naming a since-renamed step would
   *   then be indistinguishable from an unset one. The store calls
   *   `resolveStepSla` on this.
   */
  stepSla: StoredStepSla | null;
  companyProfiles: OcpiCompanyProfile[];
  machines: OcpiMachine[];
  machineSections: OcpiMachineSection[];
  /** Page 2 of a machine PI, per FAMILY. Empty until Stage 3 seeds them. */
  salesPages: OcpiSalesPage[];
  deals: OcpiDeal[];
  versions: QuotationVersion[];
  notifications: OcpiNotification[];
  headTypes: OcpiNamedMaster[];
  inkTypes: OcpiNamedMaster[];
  dryerTypes: OcpiNamedMaster[];
  machineCategories: OcpiNamedMaster[];
  dryers: OcpiDryer[];
  machineHeads: OcpiMachineHead[];
  masterManagers: OcpiMasterManager[];
  masterRequests: OcpiMasterRequest[];
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const mapStepOwner = (r: any): OcpiStepOwner => ({
  id: r.id,
  stepKey: r.step_key,
  departmentIds: r.department_ids ?? [],
  designationId: r.designation_id ?? null,
  employeeIds: r.employee_ids ?? [],
});

const mapCompanyProfile = (r: any): OcpiCompanyProfile => ({
  id: r.id,
  companyId: r.company_id ?? null,
  isDefault: !!r.is_default,
  legalName: r.legal_name ?? null,
  cin: r.cin ?? null,
  registeredAddress: r.registered_address ?? null,
  bankName: r.bank_name ?? null,
  bankBranch: r.bank_branch ?? null,
  bankAccountNo: r.bank_account_no ?? null,
  bankIfsc: r.bank_ifsc ?? null,
  exWorksCity: r.ex_works_city ?? null,
  letterheadPath: r.letterhead_path ?? null,
  active: r.active !== false,
  sortOrder: r.sort_order ?? 0,
});

const mapMachine = (r: any): OcpiMachine => ({
  id: r.id,
  name: r.name,
  billingName: r.billing_name ?? null,
  categoryId: r.category_id ?? null,
  needsDryer: r.needs_dryer ?? null,
  optAirBlade: r.opt_air_blade ?? null,
  optExternalCentering: r.opt_external_centering ?? null,
  optInkDustExhauster: r.opt_ink_dust_exhauster ?? null,
  optChillingSystem: r.opt_chilling_system ?? null,
  machineWarranty: r.machine_warranty ?? null,
  headWarranty: r.head_warranty ?? null,
  dryerWarranty: r.dryer_warranty ?? null,
  docTitle: r.doc_title,
  introText: r.intro_text ?? null,
  machineModelNo: r.machine_model_no ?? null,
  // OCPI-36 · the three the Performa Invoice prints only when they are filled.
  hsnCode: r.hsn_code ?? null,
  manufacturer: r.manufacturer ?? null,
  countryOfOrigin: r.country_of_origin ?? null,
  salesPageId: r.sales_page_id ?? null,
  supplyDescription: r.supply_description ?? null,
  specRows: Array.isArray(r.spec_rows) ? r.spec_rows : [],
  composition: Array.isArray(r.composition) ? r.composition : [],
  headerFields: Array.isArray(r.header_fields) ? r.header_fields : [],
  signoffStyle: r.signoff_style,
  hasTemplate: !!r.has_template,
  active: r.active !== false,
  sortOrder: r.sort_order ?? 0,
});

/**
 * A sales page row.
 *
 * ⚠ `blocks` IS DEFENSIVE ABOUT ITS SHAPE. It is jsonb, so a hand-edited row
 *   can hold anything; a malformed entry drops out here rather than reaching the
 *   renderer and printing `[object Object]` on a customer's invoice.
 */
const mapSalesPage = (r: any): OcpiSalesPage => ({
  id: r.id,
  name: r.name,
  heading: r.heading,
  blocks: Array.isArray(r.blocks)
    ? r.blocks.filter(
        (b: any) =>
          b && typeof b.text === "string" &&
          ["tagline", "para", "subhead", "bullet"].includes(b.kind),
      )
    : [],
  active: r.active !== false,
  sortOrder: r.sort_order ?? 0,
});

const mapSection = (r: any): OcpiMachineSection => ({
  id: r.id,
  machineId: r.machine_id,
  key: r.key,
  title: r.title,
  body: r.body ?? "",
  sortOrder: r.sort_order ?? 0,
  active: r.active !== false,
});

const mapNamed = (r: any): OcpiNamedMaster => ({
  id: r.id,
  name: r.name,
  active: r.active !== false,
  sortOrder: r.sort_order ?? 0,
  // ⚠ ONLY fms_ocpi_dryer_types HAS THIS COLUMN (OCPI-8). The other three
  //   vocabularies share this mapper and simply have no such field, so
  //   `undefined === true` reads false — "an ordinary entry", which is right.
  meansNoDryer: r.means_no_dryer === true,
  // OCPI-14 · MACHINE CATEGORIES ONLY, same shape as meansNoDryer above: the
  // other three vocabularies have no such columns and read as false.
  showsDryer: r.shows_dryer === true,
  showsCentering: r.shows_centering === true,
  showsExtras: r.shows_extras === true,
});

const mapDryer = (r: any): OcpiDryer => ({
  id: r.id,
  dryerTypeId: r.dryer_type_id,
  name: r.name,
  active: r.active !== false,
  sortOrder: r.sort_order ?? 0,
});

const mapMachineHead = (r: any): OcpiMachineHead => ({
  machineId: r.machine_id,
  headTypeId: r.head_type_id,
  sortOrder: r.sort_order ?? 0,
});

const mapManager = (r: any): OcpiMasterManager => ({
  id: r.id,
  masterType: r.master_type,
  managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): OcpiMasterRequest => ({
  id: r.id,
  masterType: r.master_type,
  proposedPayload: r.proposed_payload ?? {},
  status: r.status,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapDeal = (r: any): OcpiDeal => ({
  id: r.id,
  quotationNo: r.quotation_no ?? null,
  ocNo: r.oc_no ?? null,
  raisedBy: r.raised_by ?? null,
  salespersonName: r.salesperson_name ?? null,
  salespersonUserId: r.salesperson_user_id ?? null,

  customerId: r.customer_id ?? null,
  customerName: r.customer_name ?? null,
  customerAddress: r.customer_address ?? null,
  customerAttn: r.customer_attn ?? null,
  customerEmail: r.customer_email ?? null,
  customerMobile: r.customer_mobile ?? null,
  gstAvailable: r.gst_available ?? null,
  gstNo: r.gst_no ?? null,

  companyId: r.company_id ?? null,
  locationId: r.location_id ?? null,

  machineCount: r.machine_count ?? null,
  machineId: r.machine_id ?? null,
  machineCategoryId: r.machine_category_id ?? null,
  headType: r.head_type ?? null,
  headCount: r.head_count ?? null,
  inkType: r.ink_type ?? null,
  inkPrice: r.ink_price ?? null,
  inkCreditTerms: r.ink_credit_terms ?? null,

  inclInk: r.incl_ink ?? null,
  inkQtyIncluded: r.ink_qty_included ?? null,
  // OCPI-7 · the NO branch. Miss a line here and the column is fetched but
  // never reaches OcpiDeal — `r` is `any`, so it fails silently as a null.
  inkOfferAgreed: r.ink_offer_agreed ?? null,
  inkOfferQty: num(r.ink_offer_qty),
  inkOfferRate: num(r.ink_offer_rate),
  inkOfferSubtotal: num(r.ink_offer_subtotal),
  inclSpares: r.incl_spares ?? null,
  spareDetails: r.spare_details ?? null,
  inclCentering: r.incl_centering ?? null,
  centeringDetails: r.centering_details ?? null,
  inclHead: r.incl_head ?? null,
  headsIncluded: r.heads_included ?? null,
  headOfferAgreed: r.head_offer_agreed ?? null,
  headOfferQty: num(r.head_offer_qty),
  headOfferRate: num(r.head_offer_rate),
  headOfferSubtotal: num(r.head_offer_subtotal),
  dryerType: r.dryer_type ?? null,

  dealValueCurrency: r.deal_value_currency ?? null,
  dealValueAmount: num(r.deal_value_amount),
  fxRate: num(r.fx_rate),
  fxRateAt: r.fx_rate_at ?? null,
  fxRateSource: r.fx_rate_source ?? null,
  fxRateOverridden: r.fx_rate_overridden ?? null,
  dealValueInr: num(r.deal_value_inr),
  paymentType: r.payment_type ?? null,
  paymentTerms: r.payment_terms ?? null,
  deliveryDate: r.delivery_date ?? null,
  transportTerms: r.transport_terms ?? null,
  highSeasVia: r.high_seas_via ?? null,
  highSeasCostBy: r.high_seas_cost_by ?? null,
  localCostBy: r.local_cost_by ?? null,
  // OCPI-35 · the one delivery question and its three follow-ups.
  deliveryVia: r.delivery_via ?? null,
  deliveryPort: r.delivery_port ?? null,
  deliveryFactoryCity: r.delivery_factory_city ?? null,
  deliveryLeg: r.delivery_leg ?? null,
  remarks: r.remarks ?? null,
  dollarClauseAgreed: r.dollar_clause_agreed ?? null,

  headShipMode: r.head_ship_mode ?? null,
  headShipVia: r.head_ship_via ?? null,
  headBalanceRemarks: r.head_balance_remarks ?? null,
  headSeparateInvoice: r.head_separate_invoice ?? null,
  headInvoiceQty: r.head_invoice_qty ?? null,
  headInvoiceAmount: r.head_invoice_amount ?? null,
  headInvoiceSubtotal: r.head_invoice_subtotal ?? null,

  inkShipMode: r.ink_ship_mode ?? null,
  inkShipVia: r.ink_ship_via ?? null,
  inkSeparateInvoice: r.ink_separate_invoice ?? null,
  inkInvoiceQty: r.ink_invoice_qty ?? null,
  inkInvoiceAmount: r.ink_invoice_amount ?? null,
  inkInvoiceSubtotal: r.ink_invoice_subtotal ?? null,

  dryerShipMode: r.dryer_ship_mode ?? null,
  dryerShipVia: r.dryer_ship_via ?? null,
  dryerSeparateInvoice: r.dryer_separate_invoice ?? null,
  dryerInvoiceQty: r.dryer_invoice_qty ?? null,
  dryerInvoiceAmount: r.dryer_invoice_amount ?? null,
  dryerInvoiceSubtotal: r.dryer_invoice_subtotal ?? null,

  sparesShipMode: r.spares_ship_mode ?? null,
  sparesShipVia: r.spares_ship_via ?? null,
  sparesSeparateInvoice: r.spares_separate_invoice ?? null,
  sparesInvoiceQty: r.spares_invoice_qty ?? null,
  sparesInvoiceAmount: r.spares_invoice_amount ?? null,
  sparesInvoiceSubtotal: r.spares_invoice_subtotal ?? null,

  centeringShipMode: r.centering_ship_mode ?? null,
  centeringShipVia: r.centering_ship_via ?? null,
  centeringSeparateInvoice: r.centering_separate_invoice ?? null,
  centeringInvoiceQty: r.centering_invoice_qty ?? null,
  centeringInvoiceAmount: r.centering_invoice_amount ?? null,
  centeringInvoiceSubtotal: r.centering_invoice_subtotal ?? null,

  dryerName: r.dryer_name ?? null,
  dryerIncluded: r.dryer_included ?? null,
  dryerPrice: r.dryer_price ?? null,
  dryerValueInr: r.dryer_value_inr ?? null,
  dryerGstInr: r.dryer_gst_inr ?? null,
  grandTotalInr: r.grand_total_inr ?? null,
  dryerChambers: r.dryer_chambers ?? null,
  heatingMode: r.heating_mode ?? null,
  platterDetails: r.platter_details ?? null,
  dryerWarranty: r.dryer_warranty ?? null,

  airBlade: r.air_blade ?? null,
  externalCentering: r.external_centering ?? null,
  inkDustExhauster: r.ink_dust_exhauster ?? null,
  chillingSystem: r.chilling_system ?? null,
  otherInclusions: r.other_inclusions ?? null,

  otherCommitments: r.other_commitments ?? null,
  printerWarranty: r.printer_warranty ?? null,
  headWarranty: r.head_warranty ?? null,
  insuranceClauseAgreed: r.insurance_clause_agreed ?? null,

  refNo: r.ref_no ?? null,
  deliveryDays: r.delivery_days ?? null,
  tradeTerm: r.trade_term ?? null,
  gstRate: num(r.gst_rate),
  machineValueInr: num(r.machine_value_inr),
  gstAmountInr: num(r.gst_amount_inr),
  totalInr: num(r.total_inr),
  postWarrantyHeadPrice: num(r.post_warranty_head_price),
  consumablesSupplier: r.consumables_supplier ?? null,
  machineModelNo: r.machine_model_no ?? null,
  preparedBy: r.prepared_by ?? null,
  approvedBy: r.approved_by ?? null,

  status: r.status,
  currentStep: r.current_step ?? null,
  holdFromStatus: r.hold_from_status ?? null,
  quotationVersionNo: r.quotation_version_no ?? 0,

  qsAt: r.qs_at ?? null,

  qaDecision: r.qa_decision ?? null,
  qaNote: r.qa_note ?? null,
  qaAt: r.qa_at ?? null,
  qaBy: r.qa_by ?? null,

  ocAt: r.oc_at ?? null,
  ocBy: r.oc_by ?? null,

  ocaDecision: r.oca_decision ?? null,
  ocaNote: r.oca_note ?? null,
  ocaAt: r.oca_at ?? null,
  ocaBy: r.oca_by ?? null,

  csDocPath: r.cs_doc_path ?? null,
  // The column holds only the pages AFTER the first, and null when there are
  // none — never an empty array. Normalised here so no screen has to know that.
  csDocPages: Array.isArray(r.cs_doc_pages) ? (r.cs_doc_pages as OcpiDoc[]) : [],
  csAt: r.cs_at ?? null,
  csBy: r.cs_by ?? null,

  msDocPath: r.ms_doc_path ?? null,
  msDocPages: Array.isArray(r.ms_doc_pages) ? (r.ms_doc_pages as OcpiDoc[]) : [],
  msAt: r.ms_at ?? null,
  msBy: r.ms_by ?? null,
  fhAt: r.fh_at ?? null,
  fhBy: r.fh_by ?? null,
  frAt: r.fr_at ?? null,
  frBy: r.fr_by ?? null,

  rejectedAt: r.rejected_at ?? null,
  rejectStage: r.reject_stage ?? null,
  rejectReason: r.reject_reason ?? null,
  reworkAt: r.rework_at ?? null,
  reworkStage: r.rework_stage ?? null,
  reworkReason: r.rework_reason ?? null,
  reworkCount: r.rework_count ?? 0,
  holdAt: r.hold_at ?? null,
  holdReason: r.hold_reason ?? null,
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: r.cancel_reason ?? null,

  ocDocumentPayload: r.oc_document_payload ?? null,
  ocPdfPath: r.oc_pdf_path ?? null,
  piPdfPath: r.pi_pdf_path ?? null,
  ocSummaryPdfPath: r.oc_summary_pdf_path ?? null,

  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,

  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapVersion = (r: any): QuotationVersion => ({
  id: r.id,
  dealId: r.deal_id,
  versionNo: r.version_no,
  fieldPayload: r.field_payload ?? {},
  documentPayload: r.document_payload ?? {},
  ocDocumentPayload: r.oc_document_payload ?? {},
  pdfPath: r.pdf_path ?? null,
  ocPdfPath: r.oc_pdf_path ?? null,
  piPdfPath: r.pi_pdf_path ?? null,
  dealValueAmount: num(r.deal_value_amount),
  dealValueCurrency: r.deal_value_currency ?? null,
  fxRate: num(r.fx_rate),
  generatedAt: r.generated_at,
  generatedBy: r.generated_by ?? null,
});

const mapNotification = (r: any): OcpiNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

/** Load the whole module in one snapshot. */
export async function fetchOcpiData(): Promise<OcpiData> {
  const [ownerRows, configRows, profileRows, machineRows, sectionRows, dealRows, versionRows, notifRows,
         headRows, inkRows, dryerRows, managerRows, masterReqRows,
         categoryRows, dryerModelRows, machineHeadRows, salesPageRows] =
    await Promise.all([
      fetchAll("fms_ocpi_step_owners"),
      fetchAll("fms_ocpi_config", "key"),
      fetchAll("fms_ocpi_company_profiles", "sort_order"),
      fetchAll("fms_ocpi_machines", "sort_order"),
      fetchAll("fms_ocpi_machine_sections", "sort_order"),
      fetchAll("fms_ocpi_deals"),
      fetchAll("fms_ocpi_quotation_versions", "generated_at"),
      fetchAll("fms_ocpi_notifications"),
      fetchAll("fms_ocpi_head_types", "sort_order"),
      fetchAll("fms_ocpi_ink_types", "sort_order"),
      fetchAll("fms_ocpi_dryer_types", "sort_order"),
      fetchAll("fms_ocpi_master_managers"),
      fetchAll("fms_ocpi_master_requests"),
      fetchAll("fms_ocpi_machine_categories", "sort_order"),
      fetchAll("fms_ocpi_dryers", "sort_order"),
      fetchAll("fms_ocpi_machine_head_types", "sort_order"),
      fetchAll("fms_ocpi_sales_pages", "sort_order"),
    ]);

  const cfg = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));

  return {
    stepOwners: ownerRows.map(mapStepOwner),
    config: {
      processCoordinatorIds: cfg.get("process_coordinators")?.user_ids ?? [],
      salespersonDepartmentIds: cfg.get("salesperson_departments")?.department_ids ?? [],
      quotationValidityDays: cfg.get("quotation_validity_days")?.days ?? 30,
      // ⚠ ONE FALLBACK, SHARED (OCPI-29). This used to be a bare `?? 18`, a third
      //   copy of a tax rate alongside two more in fieldSpec. The config row is
      //   the source; the constant is what a database missing that row falls back
      //   to, and it is now the only literal 18 in the module.
      defaultGstRate: cfg.get("default_gst_rate")?.rate ?? Number(DEFAULT_GST_RATE),
      // The fallbacks are the client's settled figures, so a database where the
      // migration has not run still prints the right periods rather than a blank.
      warranty: {
        machineMonths: cfg.get("warranty_periods")?.machine_months ?? 12,
        headMonths: cfg.get("warranty_periods")?.head_months ?? 18,
      },
      warrantyNote:
        cfg.get("warranty_note")?.text ??
        "Warranty is applicable from the date of dispatch from the manufacturer.",
      // Missing row and `{"confirmed": false}` mean the same thing on purpose:
      // nobody has checked. Defaulting to `true` here would silence the warning
      // on any database where the migration had not run — the exact case where
      // it is most needed.
      quotationSeries: {
        confirmed: cfg.get("quotation_series")?.confirmed === true,
        confirmedAtValue: cfg.get("quotation_series")?.confirmed_at_value ?? null,
        confirmedAt: cfg.get("quotation_series")?.confirmed_at ?? null,
        confirmedBy: cfg.get("quotation_series")?.confirmed_by ?? null,
      },
      // ⚠ KEYED BY FINANCIAL YEAR, unlike the quotation series. The OC counter
      //   restarts each April, so confirming 2627 must NOT silence the warning
      //   the following April when 2728 starts at zero against a paper series
      //   that has kept running.
      ocSeries: Object.fromEntries(
        Object.entries((cfg.get("oc_series") ?? {}) as Record<string, any>).map(([fy, v]) => [
          fy,
          {
            confirmed: v?.confirmed === true,
            confirmedAtValue: v?.confirmed_at_value ?? null,
            confirmedAt: v?.confirmed_at ?? null,
            confirmedBy: v?.confirmed_by ?? null,
          },
        ]),
      ),
    },
    stepSla: cfg.get("step_sla") ?? null,
    companyProfiles: profileRows.map(mapCompanyProfile),
    machines: machineRows.map(mapMachine),
    machineSections: sectionRows.map(mapSection),
    salesPages: salesPageRows.map(mapSalesPage),
    deals: dealRows.map(mapDeal),
    versions: versionRows.map(mapVersion),
    notifications: notifRows.map(mapNotification),
    headTypes: headRows.map(mapNamed),
    inkTypes: inkRows.map(mapNamed),
    dryerTypes: dryerRows.map(mapNamed),
    machineCategories: categoryRows.map(mapNamed),
    dryers: dryerModelRows.map(mapDryer),
    machineHeads: machineHeadRows.map(mapMachineHead),
    masterManagers: managerRows.map(mapManager),
    masterRequests: masterReqRows.map(mapMasterRequest),
  };
}

/**
 * Re-read ONE deal, straight from the database.
 *
 * ⚠ THIS EXISTS BECAUSE A REFRESHED STORE IS NOT A REFRESHED CLOSURE. After
 *   `refresh()` invalidates the react-query cache, the component re-renders with
 *   new data — but the async callback that called it is still holding the array
 *   it captured when it was created. Looking a just-created deal up in that array
 *   finds nothing, which is exactly the "could not be re-read after generating"
 *   failure this replaced. Anything that needs the row it just wrote must ask the
 *   database, not the store it is standing in.
 */
export async function fetchDealById(id: string): Promise<OcpiDeal | null> {
  const { data, error } = await db.from("fms_ocpi_deals").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapDeal(data) : null;
}

/**
 * Where the quotation series actually stands, read straight from the counter.
 *
 * ⚠ ADMIN-ONLY BY RLS, and it returns null rather than throwing for everyone
 *   else — `fms_ocpi_counters` carries a select policy of is_admin() alone, so a
 *   salesperson simply sees no row. Only the Settings screen asks, and only an
 *   admin can open that.
 *
 * ⚠ NOT PART OF THE MODULE SNAPSHOT. The counter moves every time a quotation is
 *   generated, by anyone; folding it into the cached store would make every
 *   screen carry a figure that is stale the moment somebody else clicks
 *   Generate. The one screen that needs it reads it fresh.
 */
export async function fetchQuotationCounter(): Promise<number | null> {
  const { data, error } = await db
    .from("fms_ocpi_counters")
    .select("last_value")
    .eq("scope", "quotation")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data.last_value as number) : null;
}

/**
 * Where the ORDER-CONFIRMATION series stands, for one financial year.
 *
 * ⚠ THE SCOPE CARRIES THE YEAR — `oc:2627` — because this counter restarts each
 *   April while the quotation counter runs on forever. A year nobody has issued
 *   under yet has no row, and null here means "nothing issued", not "unknown".
 *
 * Same admin-only RLS and same freshness reasoning as the quotation counter.
 */
export async function fetchOcCounter(fy: string): Promise<number | null> {
  const { data, error } = await db
    .from("fms_ocpi_counters")
    .select("last_value")
    .eq("scope", `oc:${fy}`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data.last_value as number) : null;
}
