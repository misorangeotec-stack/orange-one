/**
 * THE IMS LINK — every IMS sheet's item master reads from, and saves into, Bushra Central Master.
 *
 * One store, not two. Before this, an IMS sheet kept its own copy of an item's code, group and
 * description, so a change made there never reached Bushra Central Master and every other report
 * went on showing the old value — and the same edit had to be typed twice. Now:
 *
 *   READ   an IMS item master shows Bushra Central Master's value for each linked item (the team's
 *          override, else Central Masters', exactly as that screen shows it).
 *   SAVE   an edit made in an IMS item master is written to `bushra_central_master_overrides`
 *          through the SAME `saveMany` the Bushra Central Master grid uses, so a value equal to
 *          Central's is not stored, and the item's other fields are kept.
 *   WINS   Bushra Central Master, wherever the team SET a field there. Where Central still holds
 *          only its default, a value typed earlier in an IMS sheet is kept and offered for copying
 *          up ("Copy to Central") instead of being dropped — see `pendingAdoption`.
 *
 * WHO MAY SAVE is Bushra Central Master's own grant: RLS on the table allows writes only to
 * `edit` on 'bushra-central-master' (admins always). An IMS editor without it sees the fields
 * read-only, rather than typing into boxes the database will refuse.
 *
 * LINKED means the item exists in Central Masters under the company whose Tally GUID is the IMS
 * book's, with the same name — the exact join closingStock.ts relies on. An item not in Central
 * has nothing to link to and keeps the IMS sheet's own value.
 *
 * Any IMS sheet plugs in with `loadImsLinks` + `saveImsEdits`; nothing here knows which one.
 */
import { fetchMasterCompanies, fetchMasterItems, fetchMasterLookup, type MasterItem } from "@/core/platform/liveMasters";
import { fetchOverrides } from "./overridesDb";
import { centralValue, cleanOverride, saveMany, type EditableKey, type MirrorEdit, type MirrorOverride, type OverrideMap } from "./store";

/** The fields an IMS item master shares with Bushra Central Master. */
export type ImsField = "code" | "groupName" | "description";
export const IMS_FIELDS: ImsField[] = ["code", "groupName", "description"];

/** One IMS item, tied to its Central Masters row. */
export interface ImsLink {
  item: MasterItem;
  centralGroupName: string | null;
  /** What Bushra Central Master shows for each shared field right now. */
  values: Record<ImsField, string>;
  /**
   * True where the TEAM set the field in Bushra Central Master (an override), false where it is
   * still Central Masters' / Tally's default. Only a field the team set beats an IMS sheet's own
   * value; a default never silently erases work typed in an IMS sheet — see `pendingAdoption`.
   */
  own: Record<ImsField, boolean>;
  /** Not synced, but read: Bushra Central Master's Category, for display. */
  category: string;
}

export interface ImsLinks {
  /** `linkKey(companyGuid, tallyItemName)` → link. */
  byKey: Map<string, ImsLink>;
  /** False when the team's overrides could not be read; then nothing may be saved. */
  canSave: boolean;
  /** Why the link is missing or partial, when it is. */
  note: string | null;
}

export const linkKey = (companyGuid: string, itemName: string) =>
  `${companyGuid}|${(itemName ?? "").trim().toUpperCase()}`;

/** Bushra Central Master's current value for one field, override first. */
function shown(item: MasterItem, o: MirrorOverride | undefined, key: EditableKey, groupName: string | null): string {
  if (o && key in o) return String(o[key] ?? "");
  return centralValue(item, key, groupName) ?? "";
}

/**
 * Every Central item of these Tally books, with Bushra Central Master's values.
 *
 * Never throws: an IMS sheet must open even when Central cannot be read. It then shows its own
 * values and refuses to save into Central, and `note` says why.
 */
export async function loadImsLinks(companyGuids: string[]): Promise<ImsLinks> {
  const byKey = new Map<string, ImsLink>();
  let companies, items, groups;
  try {
    [companies, items, groups] = await Promise.all([
      fetchMasterCompanies(),
      fetchMasterItems(),
      fetchMasterLookup("mst_item_groups"),
    ]);
  } catch (e) {
    return {
      byKey,
      canSave: false,
      note: `Bushra Central Master could not be read (${e instanceof Error ? e.message : "unknown error"}); this sheet's own values are shown.`,
    };
  }

  let overrides: OverrideMap = {};
  let canSave = true;
  let note: string | null = null;
  try {
    overrides = await fetchOverrides(cleanOverride);
  } catch {
    // Without the team's overrides a save would compare against the wrong values and could drop
    // other fields, so saving is refused rather than risked. Central's own values still show.
    canSave = false;
    note = "Bushra Central Master's saved changes could not be read, so its fields are read-only here.";
  }

  const guidOf = new Map(companies.map((c) => [c.id, c.tallyGuid]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const wanted = new Set(companyGuids);
  for (const item of items) {
    const guid = item.companyId ? guidOf.get(item.companyId) : null;
    if (!guid || !wanted.has(guid)) continue;
    const g = item.groupId ? groupName.get(item.groupId) ?? null : null;
    const o = overrides[item.id];
    byKey.set(linkKey(guid, item.name), {
      item,
      centralGroupName: g,
      values: {
        code: shown(item, o, "code", g),
        groupName: shown(item, o, "groupName", g),
        description: shown(item, o, "description", g),
      },
      own: {
        code: Boolean(o && "code" in o),
        groupName: Boolean(o && "groupName" in o),
        description: Boolean(o && "description" in o),
      },
      category: shown(item, o, "category", g),
    });
  }
  return { byKey, canSave, note };
}

/** One IMS edit: the link, and the fields the planner typed. */
export interface ImsEdit {
  link: ImsLink;
  values: Partial<Record<ImsField, string>>;
}

/**
 * Write IMS edits into Bushra Central Master. Returns how many items were written.
 *
 * The team's overrides are re-read IMMEDIATELY before writing, not taken from when the sheet
 * opened: `saveMany` folds each edit into what is stored, and a stale copy would silently undo a
 * change someone made in Bushra Central Master in the meantime.
 */
export async function saveImsEdits(edits: ImsEdit[], userId: string): Promise<number> {
  const real = edits.filter((e) => Object.keys(e.values).length);
  if (!real.length) return 0;
  const current = await fetchOverrides(cleanOverride);
  const mirror: MirrorEdit[] = real.map((e) => ({
    item: e.link.item,
    centralGroupName: e.link.centralGroupName,
    values: e.values,
  }));
  return saveMany(mirror, current, userId);
}

/**
 * An IMS sheet's own value that Bushra Central Master does not have yet.
 *
 * Bushra Central Master wins where the team SET a field there. Where it still holds only the
 * default, a value typed earlier in an IMS sheet is not a conflict — it is work Central has not
 * received. Such a value keeps showing in the IMS sheet and is offered for copying up, rather
 * than being dropped. Returns the fields to copy; empty when there is nothing.
 */
export function pendingAdoption(
  link: ImsLink,
  local: Partial<Record<ImsField, string | undefined>>,
): Partial<Record<ImsField, string>> {
  const out: Partial<Record<ImsField, string>> = {};
  for (const f of IMS_FIELDS) {
    const v = (local[f] ?? "").trim();
    if (!v || link.own[f]) continue;
    if (v.toUpperCase() !== link.values[f].trim().toUpperCase()) out[f] = v;
  }
  return out;
}

/** The value an IMS sheet shows for a linked field: Central's, unless the sheet holds one Central lacks. */
export function linkedValue(link: ImsLink, field: ImsField, local: string | undefined): string {
  const pending = pendingAdoption(link, { [field]: local });
  return pending[field] ?? link.values[field];
}

/* ------------------------------------------------------------------ item-master helpers */

/** How an IMS item master names the three shared fields, and the Central field each saves into. */
export const IMS_LOCAL_FIELD = { code: "code", group: "groupName", description: "description" } as const;
export type ImsLocalField = keyof typeof IMS_LOCAL_FIELD;
export type ImsLocalOverride = Partial<Record<ImsLocalField, string>>;
const LOCAL_FIELDS = Object.keys(IMS_LOCAL_FIELD) as ImsLocalField[];

const clean = (f: ImsLocalField, v: string | undefined) => {
  const t = (v ?? "").trim();
  return f === "code" ? t.toUpperCase() : t;
};

/** What a linked box shows: what was typed this session, else Central's value (or a pending one). */
export function shownLinkedValue(
  link: ImsLink,
  f: ImsLocalField,
  draft: ImsLocalOverride | undefined,
  saved: ImsLocalOverride | undefined,
): string {
  const d = draft?.[f];
  const s = saved?.[f];
  if ((d ?? "") !== (s ?? "")) return d ?? "";
  return linkedValue(link, IMS_LOCAL_FIELD[f], s);
}

/**
 * The edits Save sends: ONLY boxes changed since the last save, non-blank, and different from
 * Central. An old IMS value sitting untouched never overwrites what the team set in Central.
 * A box cleared to blank sends nothing — the item simply goes back to Central's value.
 */
export function editsFromDraft(
  linked: Map<string, ImsLink>,
  draft: Record<string, ImsLocalOverride>,
  saved: Record<string, ImsLocalOverride>,
): ImsEdit[] {
  const out: ImsEdit[] = [];
  for (const [key, link] of linked) {
    const values: Partial<Record<ImsField, string>> = {};
    for (const f of LOCAL_FIELDS) {
      const d = clean(f, draft[key]?.[f]);
      if (d === clean(f, saved[key]?.[f]) || !d) continue;
      if (d !== link.values[IMS_LOCAL_FIELD[f]].trim()) values[IMS_LOCAL_FIELD[f]] = d;
    }
    if (Object.keys(values).length) out.push({ link, values });
  }
  return out;
}

/** Values this sheet holds that Central has not received yet — what "Copy to Central" sends. */
export function adoptionEdits(
  linked: Map<string, ImsLink>,
  saved: Record<string, ImsLocalOverride>,
): ImsEdit[] {
  const out: ImsEdit[] = [];
  for (const [key, link] of linked) {
    const local = saved[key];
    if (!local) continue;
    const values = pendingAdoption(link, {
      code: clean("code", local.code),
      groupName: clean("group", local.group),
      description: clean("description", local.description),
    });
    if (Object.keys(values).length) out.push({ link, values });
  }
  return out;
}

/**
 * This sheet's own overrides after a save to Central. Unlinked items keep everything. A linked
 * item keeps only fields Central still has not received; whatever was just `sent`, or is now
 * Central's, is dropped so the sheet holds no second copy.
 */
export function keepLocal(
  linked: Map<string, ImsLink>,
  o: Record<string, ImsLocalOverride>,
  sent: ImsEdit[] = [],
): Record<string, ImsLocalOverride> {
  const sentFields = new Map(sent.map((e) => [e.link.item.id, e.values]));
  const out: Record<string, ImsLocalOverride> = {};
  for (const [key, v] of Object.entries(o)) {
    const link = linked.get(key);
    if (!link) {
      out[key] = v;
      continue;
    }
    const just = sentFields.get(link.item.id) ?? {};
    const row: ImsLocalOverride = {};
    for (const f of LOCAL_FIELDS) {
      const cf = IMS_LOCAL_FIELD[f];
      if (cf in just) continue;
      const val = clean(f, v[f]);
      if (pendingAdoption(link, { [cf]: val })[cf]) row[f] = v[f];
    }
    if (Object.keys(row).length) out[key] = row;
  }
  return out;
}
