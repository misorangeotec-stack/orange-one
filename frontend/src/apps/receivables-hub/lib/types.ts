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
  creditPeriod: number;
  creditLimit: number;
  /** True when the source-sheet Credit Limit equals 1 (the "blocked" sentinel). */
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
  outstandingByType:  Record<SaleType, number>;
  overdueByType:      Record<SaleType, number>;
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
  /** Per-constituent AI-proposed-limit breakdowns (one entry per merged source row). */
  proposedConstituents: ProposedConstituent[];
}

// ── customer_groups.json ─────────────────────────────────────────────────────
// Maps a Tally customer name (UPPERCASE, as it appears in transaction sheets)
// to a parent group name. Customers absent from `mapping` are ungrouped and
// treated as their own single-row "group" by the frontend.
export interface CustomerGroupMap {
  /** Tally name (UPPERCASE) → group name */
  mapping: Record<string, string>;
  /** Group name → list of Tally names that belong to it */
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
}

export interface CreditNoteTransaction {
  date: string;
  voucherNo: string;
  amount: number;
  refInvoice: string | null;
  narration: string;
}

export interface JournalTransaction {
  date: string;
  voucherNo: string;
  amount: number;
  type: "Dr" | "Cr";
  signedAmount: number;
  refInvoice: string | null;
  narration: string;
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
}

export interface ReceiptTransaction {
  date: string | null;
  amount: number;
  type: string;
  refInvoice: string | null;
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
  totalOverdue: number;
  totalCustomers: number;
  criticalCustomers: number;
  overCreditLimit: number;
  overdue180Plus: number;
  /** Count of INK customers whose source-sheet Credit Limit is 0/blank. */
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
