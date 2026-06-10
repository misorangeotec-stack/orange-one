#!/usr/bin/env node
/**
 * seed-fms-demo.mjs — generate DEMO dummy data for the Purchase FMS pipeline.
 *
 * WHAT IT DOES
 *   Emits two plain-SQL files (no DB connection here, no secrets):
 *     supabase/seed/fms_demo_seed.sql      — inserts 26 demo purchase orders
 *                                            (codes PO-2001..PO-2026) spread
 *                                            across all 9 stages with backdated,
 *                                            staggered timestamps.
 *     supabase/seed/fms_demo_teardown.sql  — deletes exactly those rows.
 *
 * WHY A GENERATOR (not the app's RPC):
 *   fms_complete_stage() always stamps actual_date = now(), so it can't backdate.
 *   The Reports screen needs realistic delays / cycle times, which require
 *   backdated actual_date values — only possible via direct INSERT/UPDATE.
 *   Inserting an fms_entries row fires fms_materialize_entry_stages(), which
 *   auto-creates the 9 fms_entry_stages rows (origin 'active', rest 'pending');
 *   we then UPDATE those rows to set status/planned_date/actual_date/values.
 *
 * APPLY (from frontend/):  the secret URL is read by the apply wrapper, not here:
 *     node -e "...read BACKUP_IDENTITY_DB_URL..." | psql -f fms_demo_seed.sql
 *   (see the project notes — we spawn psql with the pooler URL).
 *
 * Field keys & select options mirror src/apps/purchase-fms/config/stages.ts.
 * Planned-date math mirrors src/apps/purchase-fms/lib/plannedDate.ts.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)); // frontend/scripts
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");          // repo root
const OUT_DIR = join(REPO_ROOT, "supabase", "seed");

// "Today" anchor for the demo — matches the plan (2026-06-10).
const TODAY = "2026-06-10";
const ADMIN_EMAIL = "master@taskflow.app";
const CODE_PREFIX = "PO-2";          // PO-2001..PO-2026
const CODE_LIKE = "PO-2%";           // teardown match

// ── date helpers (UTC, day-granular) ─────────────────────────────────────────
const DAY = 86400000;
const toDate = (iso) => new Date(iso.slice(0, 10) + "T00:00:00Z");
const isoDate = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
const dayOf = (iso) => toDate(iso).getUTCDay(); // 0 = Sunday
function addWorkingDays(iso, n) { let d = iso, a = 0; while (a < n) { d = addDays(d, 1); if (dayOf(d) !== 0) a++; } return d; }
function subWorkingDays(iso, n) { let d = iso, r = 0; while (r < n) { d = addDays(d, -1); if (dayOf(d) !== 0) r++; } return d; }
// actual_date timestamp = a working-hours time on the given day (deterministic).
const ts = (iso, hour) => `${iso}T${String(hour).padStart(2, "0")}:${String((hour * 7) % 60).padStart(2, "0")}:00Z`;
const daysAgo = (n) => addDays(TODAY, -n);

// ── deterministic PRNG (so reruns are stable) ────────────────────────────────
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

// ── SQL literal helpers ──────────────────────────────────────────────────────
const jsonb = (obj) => `$j$${JSON.stringify(obj)}$j$::jsonb`; // JSON never contains $j$
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── sample masters ───────────────────────────────────────────────────────────
const CATEGORIES = [
  { name: "RAW MATERIAL", unit: "KGS", items: ["Aluminium Oxide Powder", "Titanium Dioxide", "Activated Carbon Granules", "Sodium Hydroxide Flakes", "Calcium Carbonate", "Silica Gel Beads", "Zinc Sulphate", "Copper Sulphate"] },
  { name: "PACKING MATERIAL", unit: "PCS", items: ["Corrugated Boxes 5-Ply", "HDPE Drums 50L", "Stretch Wrap Rolls", "Wooden Pallets 1200x1000", "Bubble Wrap Rolls", "PP Woven Bags", "Shrink Film Rolls", "Carton Sealing Tape"] },
  { name: "CARTRIDGE/FILTER", unit: "PCS", items: ["PP Spun Filter 10in", "Carbon Block Cartridge", "RO Membrane 4040", "Pleated Filter Cartridge", "Bag Filter PP #2", "Sediment Filter 20in", "Micron Filter 5um", "AC Carbon Cartridge"] },
];
const VENDORS = ["Apex Materials Pvt Ltd", "Shree Chemicals", "Global Filtration Co", "Krishna Packaging", "Sunrise Industrial", "Meridian Supplies", "Nexus Polymers", "Veer Enterprises", "Orient Chem Agencies", "Pinnacle Traders"];
const TRANSPORTS = ["VRL Logistics", "TCI Express", "Gati Ltd", "Safexpress", "Delhivery Cargo"];
const PAY_TERMS = ["Advance", "Credit", "Partial Advance", "On Delivery"];

// Per-stage SLA lead (working days from the previous stage's actual).
const LEAD = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 3 };

// ── entry plan: 6 completed + 20 in-progress spread across active stages ─────
// activeIdx: 9 = completed; otherwise the 0-based index of the active stage.
// overdue: force the active stage's planned_date into the past.
const PLAN = [
  // 6 completed (varied cycle lengths)
  { activeIdx: 9 }, { activeIdx: 9 }, { activeIdx: 9 }, { activeIdx: 9 }, { activeIdx: 9 }, { activeIdx: 9 },
  // approval (idx 1) ×3  — one overdue
  { activeIdx: 1 }, { activeIdx: 1 }, { activeIdx: 1, overdue: true },
  // po_generation (idx 2) ×2
  { activeIdx: 2 }, { activeIdx: 2 },
  // share_po (idx 3) ×3 — one overdue
  { activeIdx: 3 }, { activeIdx: 3 }, { activeIdx: 3, overdue: true },
  // advance_payment (idx 4) ×2 — one overdue
  { activeIdx: 4 }, { activeIdx: 4, overdue: true },
  // follow_up (idx 5) ×2
  { activeIdx: 5 }, { activeIdx: 5 },
  // inward_entry (idx 6) ×3 — one overdue
  { activeIdx: 6 }, { activeIdx: 6 }, { activeIdx: 6, overdue: true },
  // system_entry (idx 7) ×2
  { activeIdx: 7 }, { activeIdx: 7 },
  // final_payment (idx 8) ×3 — one overdue
  { activeIdx: 8 }, { activeIdx: 8 }, { activeIdx: 8, overdue: true },
];

// ── per-stage captured values ────────────────────────────────────────────────
function stageValues(idx, ctx) {
  switch (idx) {
    case 0: return { category: ctx.category, itemName: ctx.itemName, quantity: ctx.quantity, unit: ctx.unit, remarks: ctx.remarks };
    case 1: return { status: "Approved", vendorName: ctx.vendor, finalQty: ctx.finalQty, finalRate: ctx.finalRate, purchaseRemarks: "Approved at agreed rate." };
    case 2: return { status: "Done", systemPoNo: ctx.poNo, poRemarks: "PO generated in ERP and shared." };
    case 3: return { status: "Done", vendorPiNo: ctx.piNo, materialDispatchDate: ctx.dispatchDate, paymentTerms: ctx.paymentTerms, totalGstValue: ctx.gstValue, sharedRemarks: "PI received from vendor." };
    case 4: return { status: "Done", advRemarks: `Advance released (${ctx.paymentTerms}).` };
    case 5: return { status: "Dispatched", dispatchLr: ctx.lrNo, transportDetails: ctx.transport, followUpRemarks: "Vendor confirmed dispatch." };
    case 6: return { status: "Received", gateRegisterNo: ctx.gateNo, receivedQty: ctx.receivedQty, receivedCondition: "Good", remarks: "Material received in good condition." };
    case 7: return { status: "Done", tallyPiNo: ctx.tallyNo, systemRemarks: "Purchase booked in Tally." };
    case 8: return { dueDate: ctx.dueDate, pendingAmount: ctx.pendingAmount, datePaid: ctx.datePaid };
    default: return {};
  }
}

// ── build one entry's SQL ────────────────────────────────────────────────────
function buildEntry(planRow, i) {
  const r = rng(1000 + i * 97);
  const code = `${CODE_PREFIX}${String(i + 1).padStart(3, "0")}`; // PO-2001..
  const cat = pick(CATEGORIES, r);
  const itemName = pick(cat.items, r);
  const quantity = (1 + Math.floor(r() * 20)) * 25;            // 25..500
  const vendor = pick(VENDORS, r);
  const finalQty = quantity;
  const finalRate = 80 + Math.floor(r() * 240) * 10;           // 80..2470
  const gstValue = Math.round(finalQty * finalRate * 1.18);
  const ctxBase = {
    category: cat.name, unit: cat.unit, itemName, quantity, remarks: "Standard procurement.",
    vendor, finalQty, finalRate, gstValue,
    poNo: `PO/2026/${3000 + i}`, piNo: `PI-26-${5500 + i}`,
    paymentTerms: pick(PAY_TERMS, r), lrNo: `LR${40000 + i * 7}`,
    transport: pick(TRANSPORTS, r), gateNo: `GR-${1200 + i}`,
    receivedQty: finalQty, tallyNo: `TLY/26/${800 + i}`,
    pendingAmount: Math.round(gstValue * 0.4),
  };

  const completed = planRow.activeIdx === 9;
  const lastDone = completed ? 8 : planRow.activeIdx - 1; // highest 'done' step index
  const currentStepIndex = completed ? 9 : planRow.activeIdx;

  // 1) calendar-day gaps between consecutive done-stage actuals (occasional delay).
  const delay = {};
  for (let k = 1; k <= lastDone; k++) delay[k] = r() < 0.25 ? (r() < 0.5 ? 1 : 2) : 0; // ~25% late
  const gap = (k) => (k === 0 ? 0 : LEAD[k] + delay[k]);

  // 2) anchor the LAST done stage at/just before today, then fill earlier actuals
  // BACKWARD — so every 'done' actual_date is <= today, while the active stage's
  // planned_date still lands in the future (on-track) or the past (overdue).
  let anchorAgo;
  if (completed) anchorAgo = 1 + Math.floor(r() * 8);                         // finished 1..8 days ago
  else if (planRow.overdue) anchorAgo = LEAD[planRow.activeIdx] + 1 + Math.floor(r() * 6); // active planned 1..6 days past
  else anchorAgo = 0;                                                          // on-track: last done = today
  const stageActual = {};   // step_index -> actual iso date
  stageActual[lastDone] = daysAgo(anchorAgo);
  for (let k = lastDone - 1; k >= 0; k--) stageActual[k] = addDays(stageActual[k + 1], -gap(k + 1));
  const startIso = stageActual[0];
  const lines = [];

  // dispatch / due dates depend on stage actuals (only meaningful once reached).
  if (lastDone >= 3 || completed) ctxBase.dispatchDate = addDays(stageActual[3], 4 + Math.floor(r() * 3));
  if (completed) {
    ctxBase.dueDate = addDays(stageActual[7], 5);
    ctxBase.datePaid = stageActual[8];
  }

  // 3) emit INSERT + stage UPDATEs.
  const summary = { category: cat.name, itemName, quantity, unit: cat.unit, remarks: ctxBase.remarks };
  const createdTs = ts(startIso, 9);
  lines.push(
    `INSERT INTO public.fms_entries (workflow_id, code, summary, created_by, created_at, current_step_index, status)`,
    `VALUES (:'wf', ${sqlStr(code)}, ${jsonb(summary)}, :'creator', ${sqlStr(createdTs)}, ${currentStepIndex}, ${sqlStr(completed ? "completed" : "in_progress")})`,
    `RETURNING id AS e \\gset`
  );

  for (let k = 0; k <= lastDone; k++) {
    // planned: origin = creation day; others = +LEAD working days after prev actual;
    // follow_up exception = the working day before the vendor's dispatch date.
    let planned;
    if (k === 0) planned = startIso;
    else if (k === 5 && ctxBase.dispatchDate) planned = subWorkingDays(ctxBase.dispatchDate, 1);
    else planned = addWorkingDays(stageActual[k - 1], LEAD[k]);
    const actualTs = ts(stageActual[k], 10 + (k % 6));
    const vals = stageValues(k, ctxBase);
    lines.push(
      `UPDATE public.fms_entry_stages SET status='done', planned_date=${sqlStr(planned)}, actual_date=${sqlStr(actualTs)}, values=${jsonb(vals)}, completed_by=:'creator' WHERE entry_id=:'e' AND step_index=${k};`
    );
  }

  // active stage (in-progress only): set 'active' + planned_date (no actual yet).
  if (!completed) {
    const aIdx = planRow.activeIdx;
    let planned;
    if (aIdx === 5 && ctxBase.dispatchDate) planned = subWorkingDays(ctxBase.dispatchDate, 1);
    else planned = addWorkingDays(stageActual[lastDone], LEAD[aIdx]);
    lines.push(
      `UPDATE public.fms_entry_stages SET status='active', planned_date=${sqlStr(planned)} WHERE entry_id=:'e' AND step_index=${aIdx};`
    );
  }

  return lines.join("\n");
}

// ── assemble files ───────────────────────────────────────────────────────────
const blocks = PLAN.map((p, i) => `-- ${CODE_PREFIX}${String(i + 1).padStart(3, "0")}  (active step ${p.activeIdx}${p.overdue ? ", overdue" : ""})\n${buildEntry(p, i)}`);

const seedSql = [
  `-- Purchase FMS demo seed — generated by frontend/scripts/seed-fms-demo.mjs`,
  `-- ${PLAN.length} dummy entries (${CODE_PREFIX}001..${CODE_PREFIX}${String(PLAN.length).padStart(3, "0")}). Remove with fms_demo_teardown.sql.`,
  `\\set ON_ERROR_STOP on`,
  `BEGIN;`,
  `SELECT id AS wf FROM public.fms_workflows WHERE key='purchase' \\gset`,
  `SELECT id AS creator FROM auth.users WHERE email=${sqlStr(ADMIN_EMAIL)} \\gset`,
  ``,
  blocks.join("\n\n"),
  ``,
  `COMMIT;`,
  ``,
].join("\n");

const teardownSql = [
  `-- Purchase FMS demo teardown — removes only the generated demo rows.`,
  `-- Stage rows cascade-delete with their entry. Real data (e.g. PO-1045) untouched.`,
  `\\set ON_ERROR_STOP on`,
  `DELETE FROM public.fms_entries`,
  ` WHERE workflow_id = (SELECT id FROM public.fms_workflows WHERE key='purchase')`,
  `   AND code LIKE ${sqlStr(CODE_LIKE)};`,
  ``,
].join("\n");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "fms_demo_seed.sql"), seedSql);
writeFileSync(join(OUT_DIR, "fms_demo_teardown.sql"), teardownSql);

console.log(`✓ wrote ${join(OUT_DIR, "fms_demo_seed.sql")}  (${PLAN.length} entries)`);
console.log(`✓ wrote ${join(OUT_DIR, "fms_demo_teardown.sql")}`);
