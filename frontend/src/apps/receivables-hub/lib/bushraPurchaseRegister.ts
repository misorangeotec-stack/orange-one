/**
 * Bushra Purchase Register — Reports → Bushra-Report.
 *
 * The purchase register (lib/purchaseRegister.ts) with the same five columns the Bushra Sales Register
 * adds, read the same way:
 *
 *   Purchase-Type  first of: the tag in PARTICULARS → Central Masters item Type → the word in the
 *                  voucher type name ('GST PURCHASE-INK' → Ink)
 *   Ink Type       Central Masters → Items → Ink type — ONLY on an Ink line
 *   Group          Central Masters → Items → Group
 *   Category       Central Masters → Items → Category
 *   Colour         the colour word in the item description (colourOf)
 *
 * The Central Masters lookup, its name matching and the near-duplicate merges are the Sales Register's
 * own (loadItemLookup in lib/bushraSalesRegister.ts), so both reports spell every value the same way.
 * COMPANY follows the same Bushra rule: the book's owner, or its BRANCH / RELATED class.
 */
import { itemTypeLabel, type ItemType } from "@/core/platform/liveMasters";
import { loadItemLookup, type ItemLookup } from "./bushraSalesRegister";
import { loadPurchaseRegister, type PurchaseRegisterRow } from "./purchaseRegister";
import { companyGuidOf, fetchCompanyMap, makeCompanyResolver } from "./companyMap";
import { SALES_REGISTER_COLOURS, colourOf } from "./batchCostingRules";

export type PurchaseTypeSource = "Particulars" | "Central Masters" | "Voucher Type" | "";

export interface BushraPurchaseRow extends PurchaseRegisterRow {
  purchase_type: string;
  purchase_type_source: PurchaseTypeSource;
  ink_type: string;
  item_group: string;
  item_category: string;
  colour: string;
  in_masters: boolean;
}

const wsKey = (s: string) => s.replace(/\s+/g, " ").trim();

type Copy = ItemLookup["exact"] extends Map<string, (infer C)[]> ? C : never;

/** The line's own company's copy if there is one, else the first copy that carries the field. */
function pick<K extends keyof Copy>(copies: Copy[], guid: string, field: K): Copy[K] | null {
  const own = copies.find((c) => c.companyGuid === guid && c[field]);
  return (own ?? copies.find((c) => c[field]))?.[field] ?? null;
}

/* ---------------------------------------------------------------- company */

const BOOK_NAME: Record<string, { pure: string; short: string }> = {
  "O-TEC": { pure: "ORANGE O TEC", short: "ORANGE O TEC" },
  ENTERPRISE: { pure: "ORANGE ENTERPRISE", short: "ORANGE ENT" },
  COLORIX: { pure: "COLORIX", short: "COLORIX" },
};

function bushraCompany(r: PurchaseRegisterRow, bookCompany: string): string {
  const book = BOOK_NAME[bookCompany.trim().toUpperCase()];
  if (!book) return r.company_label;
  if (/^branch\b/i.test(r.type)) return `${book.short} BRANCH`;
  if (/^related\b/i.test(r.type)) return `${book.short} RELATED`;
  return book.pure;
}

/* ---------------------------------------------------------- purchase-type */

/** 1 — a TAG in PARTICULARS: "(INK)", "-SPARE". Same rule as the Sales Register. */
const PARTICULARS_TAG = /(?:\(\s*(INK|SPARES?|HEADS?|MACHINES?|PAPER)\s*\)|-\s*(INK|SPARES?|HEADS?|MACHINES?|PAPER)\s*$)/i;
const TAG_LABEL: Record<string, string> = {
  INK: "Ink", SPARE: "Spare Parts", HEAD: "Heads", MACHINE: "Machine", PAPER: "Paper",
};

function fromParticulars(particulars: string): string {
  const m = PARTICULARS_TAG.exec(particulars);
  const word = (m?.[1] ?? m?.[2] ?? "").toUpperCase().replace(/S$/, "");
  return TAG_LABEL[word] ?? "";
}

/**
 * 3 — the word in the voucher type name. Purchase books name the product in the type
 * ('GST PURCHASE-INK', 'GST PURCHASE - HANGLORY HEAD'); a plain 'GST PURCHASE' says nothing.
 * Labels are Central Masters' own spellings.
 */
/** Central Masters' label for the service_expense item type. */
const SERVICE_TYPE = "Service Expense";

const VOUCHER_WORDS: [RegExp, string][] = [
  [/\bINK\b/i, "Ink"],
  [/\bHEADS?\b/i, "Heads"],
  [/\bSPARE/i, "Spare Parts"],
  [/\bMACHINE/i, "Machine"],
  [/\bPAPER\b/i, "Paper"],
  [/\bPACKING\b/i, "Packing Material"],
  [/\bDYES?\b/i, "Raw Material"],
  [/\bSERVICE\b/i, SERVICE_TYPE],
];

function fromVoucherType(voucherType: string): string {
  return VOUCHER_WORDS.find(([re]) => re.test(voucherType))?.[1] ?? "";
}

export function classifyPurchaseRow(r: PurchaseRegisterRow, lookup: ItemLookup, bookCompany: string): BushraPurchaseRow {
  const k = wsKey(r.particulars);
  const copies = lookup.exact.get(k) ?? lookup.folded.get(k.toUpperCase()) ?? [];
  const guid = companyGuidOf(r.tenant_id);
  const itemType = pick(copies, guid, "itemType") as ItemType | null;

  // A SERVICE BILL'S EXPENSE LINE IS A SERVICE, whatever its ledger is called. The tag rule was
  // written for sales discount lines; on a GST-INWARD SERVICE bill posting to "REPAIRS & MAINTENANCE -
  // MACHINE" it would read "-MACHINE" and file a repair as a machine purchase, off the Service
  // dashboard. Finance want goods vs service shown in Purchase-Type (2026-09-15), so it wins here.
  const serviceBill = r.kind === "ledger" && fromVoucherType(r.voucher_type) === SERVICE_TYPE;
  let purchase_type = serviceBill ? SERVICE_TYPE : fromParticulars(r.particulars);
  let purchase_type_source: PurchaseTypeSource = serviceBill ? "Voucher Type" : purchase_type ? "Particulars" : "";
  if (!purchase_type && itemType) {
    purchase_type = itemTypeLabel(itemType);
    purchase_type_source = purchase_type ? "Central Masters" : "";
  }
  if (!purchase_type) {
    purchase_type = fromVoucherType(r.voucher_type);
    purchase_type_source = purchase_type ? "Voucher Type" : "";
  }

  const company = bushraCompany(r, bookCompany);
  // A service bill has no stock item, so Central Masters gives it no Group or Category. Bushra reads
  // it as SERVICE in both (asked 2026-09-15) rather than a blank. A value masters DO give still wins.
  const service = purchase_type === SERVICE_TYPE;
  return {
    ...r,
    company,
    company_display: company,
    purchase_type,
    purchase_type_source,
    ink_type: itemType === "ink" && purchase_type === "Ink" ? pick(copies, guid, "inkType") ?? "" : "",
    item_group: pick(copies, guid, "group") ?? (service ? "SERVICE" : ""),
    item_category: pick(copies, guid, "category") ?? (service ? "SERVICE" : ""),
    colour: colourOf(r.particulars, SALES_REGISTER_COLOURS),
    in_masters: copies.length > 0,
  };
}

export async function loadBushraPurchaseRegister(from: string, to: string, lookup?: ItemLookup): Promise<BushraPurchaseRow[]> {
  const [rows, items, mapRows] = await Promise.all([
    loadPurchaseRegister(from, to),
    lookup ? Promise.resolve(lookup) : loadItemLookup(),
    fetchCompanyMap(),
  ]);
  const bookOf = makeCompanyResolver(mapRows);
  return rows.map((r) => classifyPurchaseRow(r, items, bookOf(r.tenant_id, "").company));
}
