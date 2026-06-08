import type { Designation, PurchaseEntry, StageState, StepOwner } from "../types";
import { PURCHASE_STAGES } from "../config/stages";

/**
 * In-memory seed data for Phase 1. None of this persists. A few hand-crafted
 * entries demonstrate specific states, then a deterministic generator fills the
 * set out to ~24 entries (varied stages, categories, on-time/delayed/overdue) so
 * the dashboard and reports look realistic. Deterministic = no Math.random, so
 * the demo is stable across reloads.
 */

export const SEED_DESIGNATIONS: Designation[] = [
  { id: "desig-pm", name: "Purchase Manager" },
  { id: "desig-pe", name: "Purchase Executive" },
  { id: "desig-erp", name: "ERP Executive" },
  { id: "desig-acc", name: "Accounts Executive" },
  { id: "desig-accm", name: "Accounts Manager" },
  { id: "desig-store", name: "Store / Gate Keeper" },
];

/** One owner row per stage, seeded with the sheet's names (no live ids yet). */
export const SEED_STEP_OWNERS: StepOwner[] = PURCHASE_STAGES.map((s) => ({
  stepKey: s.key,
  departmentId: null,
  designationId: null,
  employeeIds: [],
  employeeNames: s.defaultOwner.split("/").map((n) => n.trim()).filter(Boolean),
}));

// ---- date helpers (UTC, calendar + working-day) ----
const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addWorkingDays = (iso: string, n: number): string => {
  let d = iso;
  let added = 0;
  while (added < n) {
    d = addDays(d, 1);
    if (new Date(d + "T00:00:00Z").getUTCDay() !== 0) added++; // skip Sunday
  }
  return d;
};

type SeedStage = {
  values?: Record<string, string | number | null>;
  planned?: string | null;
  actual?: string | null;
};

/** Build the 9 stage states for an entry given per-stage data and the active index. */
function buildStages(perStage: SeedStage[], currentIndex: number): StageState[] {
  return PURCHASE_STAGES.map((s, i): StageState => ({
    key: s.key,
    status: i < currentIndex ? "done" : i === currentIndex ? "active" : "pending",
    plannedDate: perStage[i]?.planned ?? null,
    actualDate: i < currentIndex ? perStage[i]?.actual ?? null : null,
    values: perStage[i]?.values ?? {},
  }));
}

// ---- hand-crafted anchor entries ----
const HANDCRAFTED: PurchaseEntry[] = [
  {
    id: "entry-1042",
    code: "PO-1042",
    createdAt: "2026-06-04T13:18:00.000Z",
    category: "RAW MATERIAL",
    itemName: "CL-6",
    quantity: 2000,
    unit: "KGS",
    remarks: "10 DAYS",
    currentIndex: 8,
    stages: buildStages(
      [
        { values: { category: "RAW MATERIAL", itemName: "CL-6", quantity: 2000, unit: "KGS", remarks: "10 DAYS" }, actual: "2026-06-04" },
        { values: { status: "Approved", vendorName: "BLOOMS", finalQty: 5000, finalRate: 550, purchaseRemarks: "RATE CHANGE" }, planned: "2026-06-05", actual: "2026-06-04" },
        { values: { status: "Done", systemPoNo: "PO-2526SD", poRemarks: "" }, planned: "2026-06-05", actual: "2026-06-04" },
        { values: { status: "Done", vendorPiNo: "PI-8841", materialDispatchDate: "2026-06-04", paymentTerms: "Advance", totalGstValue: 2500000, sharedRemarks: "" }, planned: "2026-06-06", actual: "2026-06-04" },
        { values: { status: "Done", advRemarks: "Advance released" }, planned: "2026-06-06", actual: "2026-06-04" },
        { values: { status: "Dispatched", dispatchLr: "LR-5521", transportDetails: "VRL Logistics", followUpRemarks: "" }, planned: "2026-06-03", actual: "2026-06-04" },
        { values: { status: "Received", gateRegisterNo: "123", receivedQty: 5000, receivedCondition: "Good", remarks: "" }, planned: "2026-06-05", actual: "2026-06-04" },
        { values: { status: "Done", tallyPiNo: "TPI-2526", systemRemarks: "" }, planned: "2026-06-06", actual: "2026-06-05" },
        { values: { dueDate: "2026-06-25", pendingAmount: 500000, datePaid: "" }, planned: "2026-06-25" },
      ],
      8
    ),
  },
  {
    id: "entry-1043",
    code: "PO-1043",
    createdAt: "2026-06-06T09:30:00.000Z",
    category: "PACKING MATERIAL",
    itemName: "10L Drum",
    quantity: 1200,
    unit: "PCS",
    remarks: "For Q3 packing line",
    currentIndex: 2,
    stages: buildStages(
      [
        { values: { category: "PACKING MATERIAL", itemName: "10L Drum", quantity: 1200, unit: "PCS", remarks: "For Q3 packing line" }, actual: "2026-06-06" },
        { values: { status: "Approved", vendorName: "Shree Containers", finalQty: 1200, finalRate: 95, purchaseRemarks: "Negotiated rate" }, planned: "2026-06-08", actual: "2026-06-07" },
        { planned: "2026-06-09" },
      ],
      2
    ),
  },
  {
    id: "entry-1044",
    code: "PO-1044",
    createdAt: "2026-06-08T07:15:00.000Z",
    category: "CARTRIDGE/FILTER",
    itemName: "Sub F-Series Cartridge",
    quantity: 40,
    unit: "PCS",
    remarks: "Replacement stock",
    currentIndex: 1,
    stages: buildStages(
      [
        { values: { category: "CARTRIDGE/FILTER", itemName: "Sub F-Series Cartridge", quantity: 40, unit: "PCS", remarks: "Replacement stock" }, actual: "2026-06-08" },
        { planned: "2026-06-09" },
      ],
      1
    ),
  },
];

// ---- deterministic generator ----
const CATS: { name: string; unit: string; items: string[] }[] = [
  { name: "RAW MATERIAL", unit: "KGS", items: ["RIG6 Base", "Reactive H Series", "Sub F Series", "Pigment Black", "KY Reactive Pro", "Disperse Blue", "Digistar BIB"] },
  { name: "PACKING MATERIAL", unit: "PCS", items: ["5L Drum (White)", "10L-Cap Black", "KY Sticker Yellow", "RIG6 Sticker Cyan", "10L-Cap Blue", "5L-Cap Red"] },
  { name: "CARTRIDGE/FILTER", unit: "PCS", items: ["Inline Filter 5u", "Capping Filter", "Damper Assembly", "Sub S3200 Filter"] },
];
const VENDORS = ["BLOOMS", "Shree Containers", "Apex Chemicals", "NovaInk Pvt Ltd", "FilterTech", "ColorLab Industries"];
const CONDITIONS = ["Good", "Good", "Partial Damage"];
const TERMS = ["Advance", "Credit", "Partial Advance", "On Delivery"];

// Working-day lead time per stage j (1..9). Advance Payment (5) & Follow Up (6) are
// intentionally slower so a bottleneck is visible in the reports.
const LEAD: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 3, 6: 5, 7: 1, 8: 2, 9: 5 };

// Spread of where each generated entry currently sits (the live funnel + completions).
const CURRENT = [9, 2, 5, 3, 8, 4, 6, 5, 9, 4, 3, 7, 2, 5, 6, 9, 4, 8, 3, 6, 5];

/** Calendar-day slip applied to a done stage's actual vs its planned date. */
function slip(i: number, j: number): number {
  let d = ((i * 3 + j * 5) % 7) - 2; // -2..+4, skewed late
  if (j === 5 || j === 6) d += 2; // the bottleneck stages run later
  return d;
}

function valuesFor(j: number, ctx: { vendor: string; qty: number; rate: number; i: number }): Record<string, string | number | null> {
  switch (j) {
    case 1: return { status: "Approved", vendorName: ctx.vendor, finalQty: ctx.qty, finalRate: ctx.rate, purchaseRemarks: "" };
    case 2: return { status: "Done", systemPoNo: `PO-25${260 + ctx.i}`, poRemarks: "" };
    case 3: return { status: "Done", vendorPiNo: `PI-${4400 + ctx.i}`, paymentTerms: TERMS[ctx.i % TERMS.length] ?? "Advance", totalGstValue: ctx.qty * ctx.rate, sharedRemarks: "" };
    case 4: return { status: "Done", advRemarks: "Advance released" };
    case 5: return { status: "Dispatched", dispatchLr: `LR-${5000 + ctx.i}`, transportDetails: "VRL Logistics", followUpRemarks: "" };
    case 6: return { status: "Received", gateRegisterNo: `${100 + ctx.i}`, receivedQty: ctx.qty, receivedCondition: CONDITIONS[ctx.i % CONDITIONS.length] ?? "Good", remarks: "" };
    case 7: return { status: "Done", tallyPiNo: `TPI-${2600 + ctx.i}`, systemRemarks: "" };
    case 8: return { dueDate: "", pendingAmount: Math.round(ctx.qty * ctx.rate * 0.2), datePaid: "" };
    default: return {};
  }
}

function generate(): PurchaseEntry[] {
  const baseStart = "2026-04-10";
  return CURRENT.map((currentIndex, i): PurchaseEntry => {
    const cat = CATS[i % CATS.length]!;
    const item = cat.items[i % cat.items.length]!;
    const qty = 200 + ((i * 137) % 4800);
    const rate = 40 + ((i * 53) % 560);
    const vendor = VENDORS[i % VENDORS.length]!;
    const created = addDays(baseStart, Math.round((i * 56) / CURRENT.length));
    const ctx = { vendor, qty, rate, i };

    let prevActual = created;
    const stages: StageState[] = PURCHASE_STAGES.map((s, j): StageState => {
      if (j === 0) {
        return { key: s.key, status: "done", plannedDate: null, actualDate: created, values: { category: cat.name, itemName: item, quantity: qty, unit: cat.unit, remarks: "" } };
      }
      const status: StageState["status"] = j < currentIndex ? "done" : j === currentIndex ? "active" : "pending";
      const planned = addWorkingDays(prevActual, LEAD[j] ?? 1);
      if (status === "done") {
        const actual = addDays(planned, slip(i, j));
        prevActual = actual;
        return { key: s.key, status, plannedDate: planned, actualDate: actual, values: valuesFor(j, ctx) };
      }
      if (status === "active") {
        return { key: s.key, status, plannedDate: planned, actualDate: null, values: {} };
      }
      return { key: s.key, status, plannedDate: null, actualDate: null, values: {} };
    });

    return {
      id: `entry-gen-${i}`,
      code: `PO-${1045 + i}`,
      createdAt: created + "T08:00:00.000Z",
      category: cat.name,
      itemName: item,
      quantity: qty,
      unit: cat.unit,
      remarks: "",
      currentIndex,
      stages,
    };
  });
}

export const SEED_ENTRIES: PurchaseEntry[] = [...HANDCRAFTED, ...generate()];
