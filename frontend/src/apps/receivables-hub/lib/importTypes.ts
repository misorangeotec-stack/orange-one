// ── Import Dashboard Types ─────────────────────────────────────────────────────

export interface ImportKPIs {
  totalTransactions: number;
  totalQuantityKgs: number;
  totalValueUsd: number;
  totalBuyers: number;
  totalSellers: number;
  avgPricePerUnit: number;
}

export interface ImportSubGroupNode {
  name: string;
  totalQty: number;
  totalValue: number;
  transactionCount: number;
}

export interface ImportGroupNode {
  name: string;
  totalQty: number;
  totalValue: number;
  transactionCount: number;
  subcategories: ImportSubGroupNode[];
  byYear: Record<string, { qty: number; value: number }>;
}

export interface ImportEntitySummary {
  name: string;
  country: string;
  totalQty: number;
  totalValue: number;
  transactionCount: number;
  sellers?: string[];
  buyers?: string[];
  groupSplit: Record<string, number>;
}

export interface ImportEntityIndex {
  name: string;
  country: string;
  totalValue: number;
}

export interface ImportYearTrend {
  year: number;
  qty: number;
  value: number;
  transactions: number;
  avgPrice: number;
}

export interface ImportGroupByYear {
  year: number;
  [group: string]: number;
}

export interface ImportProductDetail {
  name: string;
  totalQty: number;
  totalValue: number;
}

/** One row in the month×product pivot matrix. Each product key maps to {qty, value}. */
export interface ImportProductMonthRow {
  month: string;
  monthKey: string;
  [product: string]: string | { qty: number; value: number };
}

export interface ImportSummary {
  lastUpdated: string;
  years: number[];
  products: string[];
  productDetails: ImportProductDetail[];
  kpis: ImportKPIs;
  groupTree: ImportGroupNode[];
  productMonthMatrix: ImportProductMonthRow[];
  topBuyers: ImportEntitySummary[];
  topSellers: ImportEntitySummary[];
  allBuyers: ImportEntityIndex[];
  allSellers: ImportEntityIndex[];
  yearTrend: ImportYearTrend[];
  groupByYear: ImportGroupByYear[];
}

export interface ImportTransaction {
  date: string | null;
  year: number | null;
  month: string | null;
  buyer: string;
  seller: string;
  unit: string;
  qty: number;
  value: number;
  price: number;
  product: string;
  group: string;
  subGroup: string;
  colors: string;
}

export interface ImportFilters {
  year?: number | null;
  products?: string[];   // multi-select — OR logic
  groups?: string[];     // multi-select — OR logic (maps to GROUP column)
  subGroup?: string;     // only applied when exactly one group selected
  buyers?: string[];     // multi-select — OR logic
  sellers?: string[];    // multi-select — OR logic
  // Cross-filter from pivot table clicks (drive KPIs/groups/buyers/sellers)
  pivotMonth?: string;   // YYYY-MM — applied everywhere except productMonthMatrix
  pivotUnit?: string;    // e.g. "KGS" — applied everywhere except unitProductMatrix
  pivotProduct?: string; // single product — applied everywhere
}
