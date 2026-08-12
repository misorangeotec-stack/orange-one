import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { BOM_BASE_QTY, pctFromBaseQty, qtyAtBase, round3 } from "./bomMath";
import type { Bom, BomComponent, NamedMaster } from "../types";
import type { BomImportBlock } from "../data/productionWrites";

/**
 * The BOM master's spreadsheet round trip.
 *
 * The layout is NOT one-row-per-record — it is the block format the business
 * already writes these recipes in, so a file exported here and the file the
 * formulations arrived in are the same shape:
 *
 *   item name | BOM name | Particulars | Qty
 *   EP SUB…   | EP SUB…  |             | 1000     ← header: names the BOM, gives the batch base
 *   EP SUB…   |          | DM WATER    |  335     ← component: qty against that base
 *   EP SUB…   |          | COMB LIQUID |  290
 *
 * A row with a BOM name opens a new block; the rows after it are its components.
 * Quantities are stored as percentages (`qty / base * 100`), so the base only has
 * to be read, never kept.
 */

export const BOM_SHEET_COLUMNS = {
  fgItem: "item name",
  bomName: "BOM name",
  particulars: "Particulars",
  qty: "Qty",
} as const;

/* --------------------------------- export --------------------------------- */

interface SheetRow {
  fgItem: string;
  bomName: string;
  particulars: string;
  qty: number | "";
}

const sheetColumns = [
  { header: BOM_SHEET_COLUMNS.fgItem, width: 38, value: (r: SheetRow) => r.fgItem },
  { header: BOM_SHEET_COLUMNS.bomName, width: 32, value: (r: SheetRow) => r.bomName },
  { header: BOM_SHEET_COLUMNS.particulars, width: 42, value: (r: SheetRow) => r.particulars },
  { header: BOM_SHEET_COLUMNS.qty, width: 12, value: (r: SheetRow) => r.qty },
];

/** Flatten BOMs back into header-row + component-row blocks. */
export function bomsToSheetRows(
  boms: Bom[],
  lookups: {
    fgItemById: (id: string | null) => NamedMaster | undefined;
    rawMaterialById: (id: string | null) => NamedMaster | undefined;
    bomComponentsFor: (bomId: string | null) => BomComponent[];
  },
): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const b of boms) {
    const fgItem = lookups.fgItemById(b.fgItemId)?.name ?? "";
    rows.push({ fgItem, bomName: b.name, particulars: "", qty: BOM_BASE_QTY });
    for (const c of lookups.bomComponentsFor(b.id)) {
      rows.push({
        fgItem,
        bomName: "",
        particulars: lookups.rawMaterialById(c.rawMaterialId)?.name ?? "",
        qty: qtyAtBase(c.pct),
      });
    }
  }
  return rows;
}

export function exportBomsToXlsx(
  boms: Bom[],
  lookups: {
    fgItemById: (id: string | null) => NamedMaster | undefined;
    rawMaterialById: (id: string | null) => NamedMaster | undefined;
    bomComponentsFor: (bomId: string | null) => BomComponent[];
  },
): void {
  exportRowsToXlsx<SheetRow>({
    fileName: "Production_BOM_Master",
    sheetName: "BOMs",
    title: "Production BOM Master",
    columns: sheetColumns,
    rows: bomsToSheetRows(boms, lookups),
    notes: [
      `A row with a "${BOM_SHEET_COLUMNS.bomName}" starts a new BOM; the rows below it are its raw materials.`,
      `Quantities are shown against a ${BOM_BASE_QTY} batch. The system stores the percentage, so any batch size works.`,
      "A BOM does not have to total 100% — some formulations legitimately do not.",
      "Edit this file and import it back: BOMs are matched on item name + BOM name, and their raw materials are replaced.",
    ],
  });
}

/** A tiny illustrative file, so nobody has to reverse-engineer the block format. */
export function exportBomTemplate(): void {
  exportRowsToXlsx<SheetRow>({
    fileName: "Production_BOM_Template",
    sheetName: "BOMs",
    title: "Production BOM Master — import template",
    columns: sheetColumns,
    rows: [
      { fgItem: "EXAMPLE FG ITEM", bomName: "EXAMPLE BOM", particulars: "", qty: BOM_BASE_QTY },
      { fgItem: "EXAMPLE FG ITEM", bomName: "", particulars: "EXAMPLE RAW MATERIAL A", qty: 600 },
      { fgItem: "EXAMPLE FG ITEM", bomName: "", particulars: "EXAMPLE RAW MATERIAL B", qty: 400 },
    ],
    notes: [
      `Fill "${BOM_SHEET_COLUMNS.fgItem}" on every row. Put the "${BOM_SHEET_COLUMNS.bomName}" only on the BOM's first row, with the batch quantity (usually ${BOM_BASE_QTY}) in "${BOM_SHEET_COLUMNS.qty}".`,
      `Each raw material goes on its own row: "${BOM_SHEET_COLUMNS.particulars}" plus the quantity it contributes to that batch.`,
      "FG items and raw materials that do not exist yet will be created on import.",
    ],
  });
}

/* --------------------------------- import --------------------------------- */

export interface ParsedBom extends BomImportBlock {
  /** The batch quantity its component quantities were written against. */
  baseQty: number;
  /** Anything wrong with this block — it is reported, and the block is skipped. */
  problems: string[];
}

export interface BomImportPlan {
  boms: ParsedBom[];
  /** Blocks with no problems — the ones that will actually be sent. */
  valid: ParsedBom[];
  componentCount: number;
  /** Names not already in the masters; these get created on import. */
  newFgItems: string[];
  newRawMaterials: string[];
  /** Rows the parser could not place at all (e.g. a component before any BOM). */
  orphanRows: number;
}

const text = (v: unknown): string => String(v ?? "").trim();
const numOrNull = (v: unknown): number | null => {
  const s = text(v);
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Case-insensitive, trimmed — the same rule findExistingMaster uses, so an
 *  import never creates "DM Water" beside an existing "DM WATER". */
const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Parse the sheet into BOM blocks and work out what applying it would change.
 * Matching against the existing masters is case-insensitive and includes
 * INACTIVE rows — they are hidden from dropdowns but still hold the unique name,
 * so treating one as missing would just fail on insert.
 */
export function buildBomImportPlan(
  records: Record<string, unknown>[],
  masters: { fgItems: NamedMaster[]; rawMaterials: NamedMaster[] },
): BomImportPlan {
  const blocks: ParsedBom[] = [];
  let current: ParsedBom | null = null;
  let orphanRows = 0;

  for (const rec of records) {
    const fgItem = text(rec[BOM_SHEET_COLUMNS.fgItem]);
    const bomName = text(rec[BOM_SHEET_COLUMNS.bomName]);
    const particulars = text(rec[BOM_SHEET_COLUMNS.particulars]);
    const qty = numOrNull(rec[BOM_SHEET_COLUMNS.qty]);

    if (!fgItem && !bomName && !particulars && qty === null) continue; // spacer row

    if (bomName) {
      // A BOM name opens a new block. Its Qty is the batch base the component
      // quantities below are written against.
      current = {
        fgItem,
        bomName,
        baseQty: qty && qty > 0 ? qty : BOM_BASE_QTY,
        components: [],
        problems: [],
      };
      if (!fgItem) current.problems.push(`"${bomName}" has no ${BOM_SHEET_COLUMNS.fgItem}.`);
      blocks.push(current);
      continue;
    }

    if (!particulars) continue; // a stray row carrying only an item name

    if (!current) {
      orphanRows++;
      continue;
    }

    if (qty === null || qty < 0) {
      current.problems.push(`"${particulars}" has no usable ${BOM_SHEET_COLUMNS.qty}.`);
      continue;
    }

    // qty is against this block's own base, so a sheet written per 500 works too.
    const pct = current.baseQty > 0 ? pctFromBaseQty((qty * BOM_BASE_QTY) / current.baseQty) : 0;

    const dup = current.components.find((c) => norm(c.rawMaterial) === norm(particulars));
    if (dup) {
      // One raw material can only appear once in a BOM (the pair is unique), so
      // fold a repeat into the existing line rather than losing it silently.
      dup.pct = round3(dup.pct + pct);
      continue;
    }
    current.components.push({ rawMaterial: particulars, pct });
  }

  for (const b of blocks) {
    if (b.components.length === 0) b.problems.push(`"${b.bomName}" has no raw materials.`);
  }

  const knownFg = new Set(masters.fgItems.map((m) => norm(m.name)));
  const knownRm = new Set(masters.rawMaterials.map((m) => norm(m.name)));
  const valid = blocks.filter((b) => b.problems.length === 0);

  const newFgItems: string[] = [];
  const newRawMaterials: string[] = [];
  const seenFg = new Set<string>();
  const seenRm = new Set<string>();
  for (const b of valid) {
    if (b.fgItem && !knownFg.has(norm(b.fgItem)) && !seenFg.has(norm(b.fgItem))) {
      seenFg.add(norm(b.fgItem));
      newFgItems.push(b.fgItem);
    }
    for (const c of b.components) {
      if (!knownRm.has(norm(c.rawMaterial)) && !seenRm.has(norm(c.rawMaterial))) {
        seenRm.add(norm(c.rawMaterial));
        newRawMaterials.push(c.rawMaterial);
      }
    }
  }

  return {
    boms: blocks,
    valid,
    componentCount: valid.reduce((a, b) => a + b.components.length, 0),
    newFgItems,
    newRawMaterials,
    orphanRows,
  };
}
