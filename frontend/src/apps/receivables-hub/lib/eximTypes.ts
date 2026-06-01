// ── EXIM Dashboard Types ──────────────────────────────────────────────────────

export interface EximKPIs {
  totalTransactions: number;
  totalQuantityKgs: number;
  totalValueUsd: number;
  totalBuyers: number;
  totalSellers: number;
  avgPricePerUnit: number;
}

export interface EximSubcategoryNode {
  name: string;
  totalQty: number;
  totalValue: number;
  transactionCount: number;
}

export interface EximCat3Node {
  name: string;
  totalQty: number;
  totalValue: number;
  transactionCount: number;
  subcategories: EximSubcategoryNode[];
  byYear: Record<string, { qty: number; value: number }>;
}

export interface EximEntitySummary {
  name: string;
  country: string;
  totalQty: number;
  totalValue: number;
  transactionCount: number;
  /** top sellers (for buyers) or top buyers (for sellers) */
  sellers?: string[];
  buyers?: string[];
  cat3Split: Record<string, number>;
}

export interface EximEntityIndex {
  name: string;
  country: string;
  totalValue: number;
}

export interface EximYearTrend {
  year: number;
  qty: number;
  value: number;
  transactions: number;
  avgPrice: number;
}

export interface EximCategoryByYear {
  year: number;
  [cat: string]: number;
}

export interface EximCountryDist {
  country: string;
  totalQty: number;
  totalValue: number;
  transactions: number;
}

export interface EximSummary {
  lastUpdated: string;
  years: number[];
  buyerCountries: string[];
  sellerCountries: string[];
  kpis: EximKPIs;
  cat3Tree: EximCat3Node[];
  topBuyers: EximEntitySummary[];
  topSellers: EximEntitySummary[];
  allBuyers: EximEntityIndex[];
  allSellers: EximEntityIndex[];
  yearTrend: EximYearTrend[];
  categoryByYear: EximCategoryByYear[];
  buyerCountryDist: EximCountryDist[];
  sellerCountryDist: EximCountryDist[];
}

export interface EximTransaction {
  date: string | null;
  year: number | null;
  buyer: string;
  buyerCountry: string;
  seller: string;
  sellerCountry: string;
  product: string;
  unit: string;
  qty: number;
  value: number;
  price: number;
  cat3: string;
  subcat3: string;
}

export interface EximFilters {
  year?: number | null;
  buyerCountries?: string[];  // multi-select — OR logic across selected buyer countries
  sellerCountries?: string[]; // multi-select — OR logic across selected seller countries
  cat3?: string[];    // multi-select — OR logic across selected categories
  subcat3?: string;   // only applied when exactly one cat3 is selected
  buyers?: string[];  // multi-select — OR logic across selected buyers
  sellers?: string[]; // multi-select — OR logic across selected sellers
}
