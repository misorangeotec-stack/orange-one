/**
 * Daily Report — the shapes the screens work in.
 *
 * Money is carried in RUPEE LAKHS throughout this module, never in rupees. The
 * reference sheet the report replaces is written in lakhs, the CFO reads it in
 * lakhs, and every column is two decimal places wide. Converting once at the
 * edge (the ConnectWave loaders hand back rupees) and never again is what keeps
 * a grid scannable down its column.
 */

/** Cash credit, overdraft, current, savings — as Tally files the ledger. */
export type BankAccountType = "cc" | "od" | "current" | "savings";

/**
 * Where the report files an account.
 *
 * ⚠ DELHI IS A REPORTING LOCATION, NOT A TALLY BOOK. The Delhi account lives
 *   inside the Orange O Tec NOIDA company, so a Delhi filter narrows the bank
 *   block and leaves the sales, purchase, collection and payment sections
 *   structurally empty. Every screen that offers Delhi must say so in words —
 *   an empty table with no explanation reads as a broken query.
 */
export type ReportLocation = "Surat" | "Noida" | "Delhi";

export const REPORT_LOCATIONS: ReportLocation[] = ["Surat", "Noida", "Delhi"];

export interface BankAccount {
  id: string;
  /**
   * MasterCrud requires a `name`, and this is also the balance grid's column
   * head — they are deliberately the same string. Short: the grid gives each
   * account one narrow column and truncates rather than wraps.
   */
  name: string;
  companyId: string;
  /** mst_companies.alias — "O-tec", "Enterprise", "Colorix". */
  entityAlias: string;
  location: ReportLocation;
  bank: string;
  branch: string | null;
  accountNo: string | null;
  ifsc: string | null;
  accountType: BankAccountType;
  /**
   * ConnectWave v_ledger_detail.guid. NULL means this account has no ledger in
   * the mirror at all — which is a real, recorded state, not a broken row. The
   * master shows it as "not linked" rather than blank.
   */
  tallyLedgerGuid: string | null;
  tallyLedgerName: string | null;
  // ⚠ NO LIMITS HERE ANY MORE. The CC limit, LC/BC limit and held-by-bank figures
  //   used to hang off each account. They are per COMPANY and per DAY, so they
  //   moved to `CcLimit` (DR-1). The three columns still exist on the table —
  //   additive-only — and nothing reads or writes them.
  sortOrder: number;
  active: boolean;
  notes: string | null;
}

/**
 * One typed closing balance.
 *
 * ⚠ THERE IS NO "not recorded" VALUE HERE, AND THAT IS THE DESIGN. A day nobody
 *   typed has NO BankBalance at all — the reads hand back a sparse map and the
 *   renderers emit a dash on a miss. A stored 0 means the account genuinely
 *   stood at zero. Never default a missing day to 0 anywhere in this module.
 */
export interface BankBalance {
  bankAccountId: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  closingLacs: number;
  updatedAt: string;
}

/**
 * The four TYPED figures of a company's credit-limit block, ₹ lakhs.
 *
 * NULL is UNKNOWN, never zero — a free limit worked out from a blank utilised
 * figure is confidently wrong, so every derived figure goes null with it.
 */
export interface FacilityFigures {
  /** Sanctioned; carried forward on the form, rarely changes. */
  ccLimitLacs: number | null;
  /** Sanctioned; carried forward on the form, rarely changes. */
  lcBcLimitLacs: number | null;
  /** Typed daily. */
  lcBcUtilisedLacs: number | null;
  /** Typed daily. */
  holdByBankLacs: number | null;
}

/**
 * One stored credit-limit block: a company, a bank, a day.
 *
 * ⚠ KEYED ON THE ENTITY ALIAS, NEVER company_id. Orange O Tec and Enterprises
 *   each span a Surat and a Noida Tally book; a company_id key would give five
 *   blocks where the client's sheet has three, and split a company's cash in two.
 *
 * Like BankBalance there is no "not recorded" value: a company-day nobody typed
 * has no CcLimit at all.
 */
export interface CcLimit extends FacilityFigures {
  /** mst_companies.alias — "O-tec", "Enterprise", "Colorix". */
  entityAlias: string;
  /** Upper-case, "AXIS" today. A real column, so a second bank is data. */
  bank: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  updatedAt: string;
}

/** What `daily_report_balance_status()` answers. */
export interface BalanceStatus {
  date: string;
  expected: number;
  entered: number;
  missing: { id: string; shortLabel: string; location: string; company: string }[];
}
