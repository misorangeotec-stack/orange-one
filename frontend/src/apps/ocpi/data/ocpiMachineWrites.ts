import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type { OcpiMachine, OcpiMachineSection } from "../types";

/**
 * Machine-master writes.
 *
 * ⚠ THESE GO STRAIGHT TO THE TABLE, NOT THROUGH AN RPC, and that is a deliberate
 *   exception to the module's "every mutation is an RPC" rule. The workflow
 *   tables carry per-step authorization that only the database can be trusted to
 *   enforce; these two are ADMIN-ONLY reference data whose RLS policy is a flat
 *   `is_admin(auth.uid())`. There is no per-row rule for an RPC to check, so an
 *   RPC would add a layer that re-states the policy and nothing else.
 *
 * ⚠ NOTHING IS HARD-DELETED. A machine is deactivated, because a deal that was
 *   quoted against it must keep resolving — fms_ocpi_deals.machine_id is
 *   `on delete restrict` precisely so a delete cannot orphan a historic
 *   quotation. Sections are the exception: they belong to their machine and are
 *   replaced wholesale when the template is edited.
 */

export interface MachineInput {
  name: string;
  billingName: string | null;
  categoryId: string | null;
  needsDryer: boolean | null;
  optAirBlade: string | null;
  optExternalCentering: string | null;
  optInkDustExhauster: string | null;
  optChillingSystem: string | null;
  machineWarranty: string | null;
  headWarranty: string | null;
  dryerWarranty: string | null;
  docTitle: string;
  introText: string | null;
  machineModelNo: string | null;
  /*
    OCPI-36 · the three the Performa Invoice prints, and the sales page it shows.
    ⚠ BLANK IS STORED AS NULL AND MEANS OMIT ON THE PAPER — the opposite of the
      rest of this module, where an unanswered value rules a blank. A Surat-built
      machine has no country of origin to state.
  */
  hsnCode: string | null;
  manufacturer: string | null;
  countryOfOrigin: string | null;
  salesPageId: string | null;
  supplyDescription: string | null;
  specRows: { label: string; value: string }[];
  composition: string[];
  headerFields: string[];
  signoffStyle: string;
  hasTemplate: boolean;
  active: boolean;
  sortOrder: number;
}

const toRow = (m: MachineInput) => ({
  name: m.name.trim(),
  billing_name: m.billingName?.trim() || null,
  category_id: m.categoryId || null,
  needs_dryer: m.needsDryer,
  opt_air_blade: m.optAirBlade || null,
  opt_external_centering: m.optExternalCentering || null,
  opt_ink_dust_exhauster: m.optInkDustExhauster || null,
  opt_chilling_system: m.optChillingSystem || null,
  // OCPI-14 · per-model warranties. NULL means NOT APPLICABLE, not "unknown", so
  // an empty box is stored as null and the question disappears from the form.
  machine_warranty: m.machineWarranty?.trim() || null,
  head_warranty: m.headWarranty?.trim() || null,
  dryer_warranty: m.dryerWarranty?.trim() || null,
  doc_title: m.docTitle,
  intro_text: m.introText?.trim() || null,
  machine_model_no: m.machineModelNo?.trim() || null,
  hsn_code: m.hsnCode?.trim() || null,
  manufacturer: m.manufacturer?.trim() || null,
  country_of_origin: m.countryOfOrigin?.trim() || null,
  sales_page_id: m.salesPageId || null,
  supply_description: m.supplyDescription?.trim() || null,
  spec_rows: m.specRows,
  composition: m.composition,
  header_fields: m.headerFields,
  signoff_style: m.signoffStyle,
  has_template: m.hasTemplate,
  active: m.active,
  sort_order: m.sortOrder,
});

export async function createMachine(input: MachineInput): Promise<string> {
  const { data, error } = await db.from("fms_ocpi_machines").insert(toRow(input)).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateMachine(id: string, input: Partial<MachineInput>): Promise<void> {
  const full = { ...input } as MachineInput;
  const row: Record<string, unknown> = {};
  // Only send what the caller actually set — a partial edit from the master
  // screen must not blank the spec rows it never showed.
  if (input.name !== undefined) row.name = full.name.trim();
  if (input.billingName !== undefined) row.billing_name = full.billingName?.trim() || null;
  if (input.categoryId !== undefined) row.category_id = full.categoryId || null;
  if (input.needsDryer !== undefined) row.needs_dryer = full.needsDryer;
  if (input.optAirBlade !== undefined) row.opt_air_blade = full.optAirBlade || null;
  if (input.optExternalCentering !== undefined) row.opt_external_centering = full.optExternalCentering || null;
  if (input.optInkDustExhauster !== undefined) row.opt_ink_dust_exhauster = full.optInkDustExhauster || null;
  if (input.optChillingSystem !== undefined) row.opt_chilling_system = full.optChillingSystem || null;
  if (input.machineWarranty !== undefined) row.machine_warranty = full.machineWarranty?.trim() || null;
  if (input.headWarranty !== undefined) row.head_warranty = full.headWarranty?.trim() || null;
  if (input.dryerWarranty !== undefined) row.dryer_warranty = full.dryerWarranty?.trim() || null;
  if (input.docTitle !== undefined) row.doc_title = full.docTitle;
  if (input.introText !== undefined) row.intro_text = full.introText?.trim() || null;
  if (input.machineModelNo !== undefined) row.machine_model_no = full.machineModelNo?.trim() || null;
  if (input.hsnCode !== undefined) row.hsn_code = full.hsnCode?.trim() || null;
  if (input.manufacturer !== undefined) row.manufacturer = full.manufacturer?.trim() || null;
  if (input.countryOfOrigin !== undefined) row.country_of_origin = full.countryOfOrigin?.trim() || null;
  if (input.salesPageId !== undefined) row.sales_page_id = full.salesPageId || null;
  if (input.supplyDescription !== undefined) row.supply_description = full.supplyDescription?.trim() || null;
  if (input.specRows !== undefined) row.spec_rows = full.specRows;
  if (input.composition !== undefined) row.composition = full.composition;
  if (input.headerFields !== undefined) row.header_fields = full.headerFields;
  if (input.signoffStyle !== undefined) row.signoff_style = full.signoffStyle;
  if (input.hasTemplate !== undefined) row.has_template = full.hasTemplate;
  if (input.active !== undefined) row.active = full.active;
  if (input.sortOrder !== undefined) row.sort_order = full.sortOrder;

  const { error } = await db.from("fms_ocpi_machines").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setMachineActive(id: string, active: boolean): Promise<void> {
  const { error } = await db.from("fms_ocpi_machines").update({ active }).eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Replace a machine's whole section list.
 *
 * ⚠ DELETE-THEN-INSERT, and it must stay one round trip each way rather than a
 *   per-row diff. The sections are an ORDERED document; a diff that upserts by
 *   key would leave a removed section behind whenever the editor also renamed
 *   one, and the reader would find a clause nobody meant to keep in a customer's
 *   contract. Replacing the set makes "what the editor shows is what prints" true
 *   by construction.
 */
export async function replaceSections(
  machineId: string,
  sections: Omit<OcpiMachineSection, "id" | "machineId">[],
): Promise<void> {
  const del = await db.from("fms_ocpi_machine_sections").delete().eq("machine_id", machineId);
  if (del.error) throw new Error(del.error.message);
  if (sections.length === 0) return;
  const rows = sections.map((s, i) => ({
    machine_id: machineId,
    key: s.key,
    title: s.title,
    body: s.body,
    sort_order: s.sortOrder ?? i,
    active: s.active !== false,
  }));
  const { error } = await db.from("fms_ocpi_machine_sections").insert(rows);
  if (error) throw new Error(error.message);
}

/** Copy one machine's whole template onto another — the usual way a variant starts. */
export async function copyTemplate(from: OcpiMachine, toId: string, sections: OcpiMachineSection[]): Promise<void> {
  await updateMachine(toId, {
    docTitle: from.docTitle,
    introText: from.introText,
    supplyDescription: from.supplyDescription,
    specRows: from.specRows,
    composition: from.composition,
    headerFields: from.headerFields,
    signoffStyle: from.signoffStyle,
    hasTemplate: true,
  });
  await replaceSections(
    toId,
    sections.map((s) => ({
      key: s.key,
      title: s.title,
      body: s.body,
      sortOrder: s.sortOrder,
      active: s.active,
    })),
  );
}
