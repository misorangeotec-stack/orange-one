/**
 * The Sales Register's ADMIN EDIT — Sales-Type, Ink Type, Group, Category and Colour, corrected
 * from the register line itself.
 *
 * There is ONE place these five are kept, and this is not a second one. An edit here is written to
 * `bushra_central_master_overrides`, the Bushra Central Master's own table, in the Central Master's
 * own shape — so the correction shows on that screen, on every Sales dashboard, in this report, in
 * the Excel export and in the scheduled mail, exactly as if it had been typed on the Central Master.
 * mst_items is never written.
 *
 * ⚠ EVERY COMPANY'S COPY. Tally files an item once per company book, so a register line's name
 *   matches several mst_items rows. The edit is applied to all of them (the user's call, 28-09-2026),
 *   so Surat and Noida never read the same product two ways.
 *
 * ⚠ THE CENTRAL MASTER'S RULES, NOT NEW ONES (see nextOverride in
 *   apps/bushra-central-master/lib/store.ts):
 *     · a value equal to Central's own is NOT stored — the field goes back to following Central;
 *     · a key the admin did not touch keeps whatever the row already holds — so correcting Category
 *       here never drops a Code or Description somebody typed there;
 *     · a row left holding nothing is deleted, not kept empty.
 *   The rows are read FRESH just before writing, not from the page's cached lookup, so an edit made
 *   on the Central Master since this page loaded is kept rather than overwritten.
 *
 * WHO MAY: the page offers it to admins only. The database's own rule (RLS on the table) is 'edit'
 * on bushra-central-master, which admins always hold — that, not this file, is the real gate.
 */
import { supabase } from "@/core/platform/supabase";
import { colourFromDescription } from "@/apps/bushra-central-master/lib/itemColour";
import type { MasterCopy } from "./bushraSalesRegister";
import { SALES_REGISTER_COLOURS, colourOf } from "./batchCostingRules";

const db = supabase as any;
const TABLE = "bushra_central_master_overrides";

/** The five fields this editor changes, named as the override row names them. */
export type EditField = "itemType" | "inkType" | "groupName" | "category" | "color";
export const EDIT_FIELDS: EditField[] = ["itemType", "inkType", "groupName", "category", "color"];

/** One field's edit: a value to hold (blank = cleared on purpose), or back to following Central. */
export type FieldEdit = { follow: true } | { follow: false; value: string };

const norm = (v: string | null | undefined) => (v ?? "").trim() || null;

/** What the field reads when nobody has overridden it — the Central Master's `centralValue`. */
function centralOf(copy: MasterCopy, key: EditField): string | null {
  switch (key) {
    case "itemType": return copy.central.itemType;
    case "inkType": return copy.central.inkType;
    case "category": return copy.central.category;
    case "groupName": return copy.central.groupName;
    case "color": return colourFromDescription(copy.name);
  }
}

/**
 * Is `mine` what the field would read with no override at all?
 *
 * ⚠ COLOUR HAS TWO READERS. With no override the Central Master shows colourFromDescription and this
 *   register shows colourOf — and they can disagree on the same name. Dropping the key because it
 *   matched the first would leave this report showing the second, not what the admin typed. So a
 *   colour is left unstored only when BOTH already read it.
 */
function isDefault(copy: MasterCopy, key: EditField, mine: string | null): boolean {
  if (mine !== norm(centralOf(copy, key))) return false;
  return key !== "color" || mine === norm(colourOf(copy.name, SALES_REGISTER_COLOURS));
}

/** Does any copy carry its own value for this field (so "Follow Central" would change something)? */
export const isOverridden = (copies: MasterCopy[], key: EditField) =>
  copies.some((c) => !!c.override && key in c.override);

/** One product's edits, to be written to every copy of it. */
export interface ItemEdit {
  copies: MasterCopy[];
  edits: Partial<Record<EditField, FieldEdit>>;
}

/** Ids per `.in()` read and rows per write — well under URL length and statement timeout. */
const CHUNK = 200;

/**
 * Write the admin's edits to every copy. Returns how many item rows changed.
 * Throws on any database refusal — a half-reported save is worse than a loud one.
 */
export async function saveItemClassification(
  copies: MasterCopy[],
  edits: Partial<Record<EditField, FieldEdit>>,
  userId: string,
): Promise<number> {
  return saveItemClassifications([{ copies, edits }], userId);
}

/**
 * Many products at once — the bulk editor's single Save. Same rules as one: every copy, fresh read
 * first, equal-to-central not stored, untouched keys kept, an emptied row deleted. Reads and writes
 * are chunked, so a few hundred products is a handful of round trips, not a few hundred.
 */
export async function saveItemClassifications(items: ItemEdit[], userId: string): Promise<number> {
  const work = items.filter((it) => it.copies.length && Object.keys(it.edits).length);
  if (!work.length) return 0;

  const ids = [...new Set(work.flatMap((it) => it.copies.map((c) => c.id)))];
  const stored = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from(TABLE).select("item_id,fields").in("item_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`${TABLE}: ${error.message}`);
    for (const r of (data ?? []) as { item_id: string; fields: unknown }[]) {
      if (r.fields && typeof r.fields === "object" && !Array.isArray(r.fields)) stored.set(r.item_id, r.fields as Record<string, unknown>);
    }
  }

  const now = new Date().toISOString();
  const toWrite = new Map<string, { item_id: string; fields: Record<string, unknown>; updated_by: string }>();
  const toClear = new Set<string>();
  for (const { copies, edits } of work) {
    const keys = Object.keys(edits) as EditField[];
    for (const copy of copies) {
      const current = stored.get(copy.id);
      const next: Record<string, unknown> = { ...(current ?? {}) };
      delete next.updatedAt;
      for (const key of keys) {
        const e = edits[key]!;
        const mine = e.follow ? undefined : norm(e.value);
        if (e.follow || isDefault(copy, key, mine ?? null)) delete next[key];
        else next[key] = mine;
      }
      // Kept current for a later product naming the same copy (never expected, but never lost).
      stored.set(copy.id, next);
      if (Object.keys(next).length) {
        toWrite.set(copy.id, { item_id: copy.id, fields: { ...next, updatedAt: now }, updated_by: userId });
        toClear.delete(copy.id);
      } else if (current) {
        toClear.add(copy.id);
        toWrite.delete(copy.id);
      }
    }
  }

  const writes = [...toWrite.values()];
  for (let i = 0; i < writes.length; i += CHUNK) {
    const { error: e } = await db.from(TABLE).upsert(writes.slice(i, i + CHUNK), { onConflict: "item_id" });
    if (e) throw new Error(`${TABLE}: ${e.message}`);
  }
  const clears = [...toClear];
  for (let i = 0; i < clears.length; i += CHUNK) {
    const { error: e } = await db.from(TABLE).delete().in("item_id", clears.slice(i, i + CHUNK));
    if (e) throw new Error(`${TABLE}: ${e.message}`);
  }
  return writes.length + clears.length;
}
