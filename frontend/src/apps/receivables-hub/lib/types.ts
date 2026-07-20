// ── Shared types matching the JSON output from process_data.py ────────────────

export type RiskCategory = "critical" | "high" | "medium" | "low";
export type SaleType = "ink" | "spare_parts" | "machine" | "head" | "other";
export type InvoiceStatus = "paid" | "partial" | "overdue" | "pending";
export type AlertType =
  | "critical_customer"
  | "overdue_180"
  | "credit_breach"
  | "rising_trend"
  | "unapplied_receipt";
export type Severity = "critical" | "high" | "medium" | "low";

// ── customers.json ────────────────────────────────────────────────────────────

export interface AgingBuckets {
  "0_30": number;
  "31_60": number;
  "61_90": number;
  "91_120": number;
  "121_180": number;
  "180_plus": number;
}

export interface AdvanceBreakdown {
  onAccount:     number;
  agstRefExcess: number;
  creditNotes:   number;
  /** Advance arising from manual (non-Tally) other-payments on account. */
  otherPayment?: number;
}

export interface Customer {
  id: string;
  name: string;
  company: string;
  location: string;
  salesPerson: string;
  /** Sales/finance tier: 'A' | 'B' | 'C' | 'D' | 'E' | 'AA'; '' when Uncategorized. */
  category: string;
  /**
   * The ledger's immediate parent GROUP in Tally (`v_ledger_detail.sub_group`) — e.g.
   * "MACHINE DEBTORS", "BALANCE WITH RELATED PARTY(Debtors)", "Sundry Debtors", "Surat".
   *
   * Master data straight from Tally, NOT a category we assign. It is what lets the report explain
   * a credit balance ("this is a machine advance", "this is a group company") without any
   * hardcoded list of names: a new group created in Tally simply appears. Live (Tally) source
   * only — undefined on the default pipeline source, which does not carry it.
   */
  tallyGroup?: string;
  creditPeriod: number;
  creditLimit: number;
  /**
   * True = "Red Mark" customer. On the Live (Tally) source this is membership in the ext_redmark
   * master (hand-kept in Masters → Red Mark, keyed by Tally GUID). On the default pipeline it falls
   * back to the legacy credit-limit=1 sentinel. (Field name kept as `blocked` to avoid a churn across
   * ~140 references; the UI label is "Red Mark" everywhere.)
   */
  blocked: boolean;
  openingBalance: number;
  openingDrCr?: 'Dr' | 'Cr';
  remainingOpeningBalance: number;
  advanceBalance: number;
  advanceBreakdown: AdvanceBreakdown;
  sales: number;
  receipts: number;
  /** Manual (non-Tally) payments applied to this customer, tracked separately from receipts. */
  otherPayments?: number;
  /** Other-payments that landed on a specific invoice. */
  otherPaymentsApplied?: number;
  /** Other-payments with no invoice target (on account). */
  otherPaymentsOnAccount?: number;
  /**
   * The slice of `otherPayments` that actually came out of OVERDUE (not merely out of outstanding):
   * only bills already past their due date were in the overdue total to begin with.
   *
   * Live (ConnectWave) only — liveOtherPayments sets it. The pipeline nets other-payments in Python
   * and never reports this split, so it stays undefined there and readers MUST treat it as unknown
   * rather than as zero.
   *
   * Why it exists: the current month's Pending drops by this amount (via c.overdue), while a PAST
   * month has no bill-wise history to replay — so the report scales this same per-customer figure
   * to each past month. Without it the two months would sit on different bases and June could read
   * better than July for no real reason. See SalespersonCollectionReport.metricsForMonth.
   */
  otherPaymentsOverdueAdj?: number;
  creditNotes: number;
  debitNotes: number;
  journalDr: number;
  journalCr: number;
  journalAdjustments: number;
  openingBalanceAdjustment: number;
  checkReturns: number;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  utilization: number;
  risk: RiskCategory;
  agingBuckets: AgingBuckets;
  agingBucketsByType: Record<SaleType, AgingBuckets>;
  salesByType:        Record<SaleType, number>;
  receiptsByType:     Record<SaleType, number>;
  creditNotesByType:  Record<SaleType, number>;
  /** Yearly debit notes (gross) split by the sale type of the bill each references. */
  debitNotesByType?:  Partial<Record<SaleType, number>>;
  /** Yearly journals (signed Dr−Cr) split by the referenced bill's sale type. */
  journalByType?:     Partial<Record<SaleType, number>>;
  outstandingByType:  Record<SaleType, number>;
  overdueByType:      Record<SaleType, number>;
  /** Gross opening balance split by sale type (source-true from the 1wM3 bill-wise
   *  snapshot). Σ over types == openingBalance, so the per-type opening is an exact
   *  lookup, not a sales-mix estimate. */
  openingBalanceByType: Record<SaleType, number>;
  obReceiptsApplied:    number;
  obCreditNotesApplied: number;
  lastReceiptDate:             string | null;
  daysSinceLastReceipt:        number | null;
  receipts1M:                  number;
  receipts3M:                  number;
  receipts6M:                  number;
  monthlyReceipts:             Record<string, number>;
  consecutiveNoPaymentMonths:  number;
  paymentActiveMonths:         number;
  proposedCreditLimit3M:         number;
  proposedCreditLimit3MDeltaPct: number | null;
  proposedCreditLimitAI:         number;
  proposedCreditLimitAIDeltaPct: number | null;
  proposedCreditLimitReason:     ProposedCreditLimitReason;
}

export interface ProposedCreditLimitReason {
  avg3MMonthlySales:   number;
  cycleMultiplier:     number;
  base:                number;
  paymentFactor:       number;
  paymentReason:       string;
  overdueFactor:       number;
  overdueReason:       string;
  riskFactor:          number;
  riskReason:          string;
  computed:            number;
  floor:               number;
  ceiling:             number;
  finalBeforeRounding: number;
  final:               number;
  edgeCase:            "dormant" | null;
}

/** One row inside an aggregated proposed-credit-limit breakdown. Used to explain
 *  consolidated/grouped rows where the displayed AI Proposed is a sum of children. */
export interface ProposedConstituent {
  customerId:   string;
  customerName: string;
  company:      string;
  location:     string;
  creditLimit:  number;
  /** AI Proposed for this constituent + delta vs its own credit limit */
  proposedAI:   number;
  deltaPct:     number | null;
  /** 3M Proposed for this constituent + delta vs its own credit limit */
  proposed3M:   number;
  delta3MPct:   number | null;
  reason:       ProposedCreditLimitReason;
}

export interface ConsolidatedCustomer extends Customer {
  /** All companies this customer trades under (e.g. ["Enterprise", "O-tec"]) */
  companies: string[];
  /** All locations this customer trades from (e.g. ["Noida", "Surat"]) */
  locations: string[];
  /** Original customer IDs that were merged into this consolidated row */
  constituentIds: string[];
  /** All unique sales persons for this consolidated customer */
  salesPersons: string[];
  /** All unique categories (tiers) for this consolidated customer */
  categories: string[];
  /** Per-constituent AI-proposed-limit breakdowns (one entry per merged source row). */
  proposedConstituents: ProposedConstituent[];
}

// ── customer group muster ────────────────────────────────────────────────────
// Maps a customer to its parent group. Customers with no entry are ungrouped and
// treated as their own single-row "group" by the frontend.
//
// IDENTITY: the muster is stored against the Tally ledger GUID (`ext_ledger_group.ledger_id`),
// which is the only stable key — 387 ledger NAMES repeat across companies, so a name-keyed
// lookup silently returns another company's group, and a Tally rename detaches the row
// entirely. Always prefer `byLedgerId`; resolve through `groupNameOf()` rather than indexing
// a map directly.
//
// `mapping` is a name-keyed VIEW of the same data, derived from `byLedgerId`. It exists because
// (a) the default pipeline source reads `customer_groups`, which has no ledger ids at all, and
// (b) rollup/option lists are still keyed by name. Where one name carries different groups in
// different companies, the derived entry is deterministic and the conflict is logged.
export interface CustomerGroupMap {
  /** Tally ledger GUID → group name. The source of truth. Empty on the pipeline source. */
  byLedgerId: Record<string, string>;
  /** Customer name → group name. Derived from `byLedgerId`; lossy where names repeat. */
  mapping: Record<string, string>;
  /** Group name → list of customer names that belong to it */
  groups: Record<string, string[]>;
}

/**
 * A grouped customer row aggregates one or more ConsolidatedCustomer rows
 * (each of which is itself merged across company/location). Used by the
 * Risk Register's "By Group" view.
 */
export interface GroupedCustomer extends ConsolidatedCustomer {
  /** Group name from the mapping sheet (or the single child's Tally name when ungrouped). */
  groupName: string;
  /** Tally names rolled up into this group. */
  childNames: string[];
  /** True if this group has more than one Tally child. */
  isGroup: boolean;
}

// ── invoices.json ─────────────────────────────────────────────────────────────

export interface Invoice {
  id: string;
  number: string;
  billRefName: string;
  billType: string;
  date: string;
  amount: number;
  receiptAdj: number;
  creditNoteAdj: number;
  debitNoteAdj: number;
  journalAdj: number;
  /** Manual (non-Tally) other-payment applied to this invoice line. */
  otherPaymentAdj?: number;
  pending: number;
  dueDate: string;
  overdueDays: number;
  status: InvoiceStatus;
  voucherType: SaleType;
  isCarryforward: boolean;
}

export interface DebitNoteTransaction {
  date: string;
  voucherNo: string;
  amount: number;
  refInvoice: string | null;
  narration: string;
  /** Sale type of the bill this debit note referenced (null = Unallocated). */
  saleType?: SaleType | null;
}

export interface CreditNoteTransaction {
  date: string;
  voucherNo: string;
  amount: number;
  refInvoice: string | null;
  narration: string;
  /** Sale type of the bill this credit note settled (null = Unallocated). */
  saleType?: SaleType | null;
}

export interface JournalTransaction {
  date: string;
  voucherNo: string;
  amount: number;
  type: "Dr" | "Cr";
  signedAmount: number;
  refInvoice: string | null;
  narration: string;
  /** Sale type of the bill this journal referenced (null = Unallocated). */
  saleType?: SaleType | null;
}

export interface MonthlyTrend {
  month: string;
  sales: number;
  receipts: number;
  creditNotes: number;
  debitNotes?: number;
  journalAdjustments?: number;
  checkReturns?: number;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  risk: RiskCategory;
  outstandingByType: Record<SaleType, number>;
  maxOverdueDaysByType: Record<SaleType, number>;
  /** Receipts this month split by the sale type of the bill each one settled
   *  (lakhs, like the other trend amounts). Σ months == the customer's yearly
   *  receiptsByType. Absent on pre-tagging snapshots. */
  receiptsByType?: Partial<Record<SaleType, number>>;
  /** Sales this month split by the sale type of the voucher (lakhs, like the other
   *  trend amounts). Σ per-type == this month's `sales`. Absent on pre-tagging
   *  snapshots — callers fall back to the plain `sales` total. */
  salesByType?: Partial<Record<SaleType, number>>;
  /** GST contained in this month's `sales` (lakhs, like the other trend amounts).
   *  `sales` is booked INCLUSIVE of GST — it is the full invoice value the customer
   *  owes — so the taxable base is `sales - salesGst`.
   *  ABSENT (not zero) when the source can't supply it: only the live Tally mirror
   *  carries the per-voucher tax split, so the pipeline leaves this undefined and
   *  callers must hide the breakup rather than render a base equal to the total. */
  salesGst?: number;
  /** The same GST split by the sale type of the voucher (lakhs). Σ per-type ==
   *  `salesGst`. Lets a sale-type filter show that type's exact tax instead of
   *  apportioning it by sales mix. Absent under the same conditions as `salesGst`. */
  salesGstByType?: Partial<Record<SaleType, number>>;
}

export interface ReceiptTransaction {
  date: string | null;
  amount: number;
  type: string;
  refInvoice: string | null;
  /** Sale type of the bill this receipt settled (null = Unallocated). */
  saleType?: SaleType | null;
}

export interface OtherPaymentTransaction {
  date: string | null;
  amount: number;
  /** "AGST REF" | "ON ACCOUNT" (normalized allocation type). */
  type: string;
  refInvoice: string | null;
  paymentRef: string | null;
  /** Why it's on account (e.g. invoice before 01-04-2025), from the feed sheet. */
  remark: string | null;
}

export interface CustomerDetail {
  receiptTransactions: ReceiptTransaction[];
  otherPaymentTransactions?: OtherPaymentTransaction[];
  creditNoteTransactions?: CreditNoteTransaction[];
  debitNoteTransactions?: DebitNoteTransaction[];
  journalTransactions?: JournalTransaction[];
  invoices: Invoice[];
  trend: MonthlyTrend[];
}

// ── dashboard.json ────────────────────────────────────────────────────────────

export interface KPIs {
  totalSales: number;
  totalReceipts: number;
  totalOtherPayments?: number;
  totalCreditNotes: number;
  totalDebitNotes: number;
  totalJournalAdjustments: number;
  totalJournalDr: number;
  totalJournalCr: number;
  totalCheckReturns: number;
  totalOpeningBalance: number;
  totalRemainingOpeningBalance: number;
  totalAdvanceBalance: number;
  totalAdvanceBySource: AdvanceBreakdown;
  totalOutstanding: number;
  /**
   * Overdue NET of on-account money the customer has already paid us. This is the pipeline's
   * figure and the one the Dashboard has always shown. It is NOT the same as the bill-based
   * reports (Aging / Overdue-120 / Category), which show `totalOverdueOnBills` — see below.
   */
  totalOverdue: number;
  /**
   * Σ pending of the open bills that are past due — the figure the BILL-BASED reports show.
   *
   * The two reconcile exactly, per ledger and in total:
   *     totalOverdue  =  totalOverdueOnBills − totalOverdueCreditsApplied
   * Verified against the live book (13-Jul-2026): ₹38.00 cr − ₹2.75 cr = ₹35.26 cr, residual ₹0.
   * The Dashboard renders that bridge so the two views stop reading as a contradiction.
   */
  totalOverdueOnBills: number;
  /**
   * The on-account credits actually CONSUMED against those overdue bills.
   *
   * Capped per ledger (`min(overdue, credits)`) — a customer's surplus credit cannot push their
   * own overdue below zero. That cap matters enormously: on-bill credits across the book total
   * ₹16.16 cr, but only ₹2.75 cr of it is consumed. Summing the credits instead of capping them
   * would over-deduct by ~6×.
   */
  totalOverdueCreditsApplied: number;
  totalCustomers: number;
  criticalCustomers: number;
  overCreditLimit: number;
  overdue180Plus: number;
  /** Count of "Red Mark" customers (see Customer.blocked). */
  blockedCustomers: number;
}

export interface TrendPoint {
  month: string;
  sales: number;
  receipts: number;
  outstanding: number;
  overdue?: number;
}

export interface AgingPoint {
  bucket: string;
  amount: number;
}

export interface RiskTrendPoint {
  month: string;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface RiskSegment {
  name: string;
  value: number;
  count: number;
  color: string;
}

export interface TopRiskyCustomer {
  id: string;
  name: string;
  company: string;
  location: string;
  outstanding: number;
  overdue: number;
  maxODDays: number;
  risk: RiskCategory;
}

export interface AlertItem {
  id: string;
  type: AlertType;
  severity: Severity;
  title: string;
  description: string;
  customer?: string;
  customerId?: string;
  invoiceRef?: string;
  company: string;
  location: string;
  timestamp: string;
  seen: boolean;
}

export interface RefreshSourceInfo {
  name: string;
  /** ISO date (YYYY-MM-DD) of the most recent transactional entry, or null for master sheets. */
  lastEntryDate: string | null;
  rows: number;
}

export interface RefreshMetadata {
  /** ISO datetime of when the pipeline completed (mirrors `lastUpdated`). */
  refreshedAt: string;
  sources: RefreshSourceInfo[];
}

export interface DashboardData {
  asOfDate: string;
  lastUpdated: string;
  kpis: KPIs;
  trend: TrendPoint[];
  riskTrend: RiskTrendPoint[];
  aging: AgingPoint[];
  riskSegmentation: RiskSegment[];
  topRiskyCustomers: TopRiskyCustomer[];
  alerts: AlertItem[];
  /** Optional — present when the pipeline has been run with the refresh-metadata change. */
  refreshMetadata?: RefreshMetadata;
}

// ── Sale Type Reconciliation Table ────────────────────────────────────────────

export interface SaleTypeBreakdownRow {
  label: string;
  type: SaleType | "opening_balance" | "unmapped" | "total";
  openingBalance: number;
  sales: number;
  receipts: number;       // gross receipts attributed to this row
  creditNotes: number;
  checkReturns: number;
  advanceBalance: number;
  outstanding: number;    // net row balance = OB + Sales − Receipts + CR − CN + Advance
  overdue: number;
  criticalCount: number;
  overLimitCount: number;
  overdue180Count: number;
}

export interface SaleTypeBreakdown {
  rows: SaleTypeBreakdownRow[];   // [Opening Balance, Ink, Spare Parts, Machine, Other, Unmapped]
  total: SaleTypeBreakdownRow;    // Grand total row using KPI values
}
