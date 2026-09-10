import { fetchAll, invokeMuster, invokeMusterData } from "./musterApi";

/**
 * The two managed vocabularies a customer is mapped to: SALESPERSON and COLLECTION TEAM (RC-15).
 *
 * Until this existed, both were free text typed into a box whose suggestions came from whatever had
 * been typed before. Matching is exact and case-sensitive everywhere (lib/scopeParties.ts), so a
 * typo is not cosmetic — it is a scope that silently matches nothing, and two such tags were live on
 * real users: 'MAYANK', from a database that no longer exists, and 'Others' where the muster holds
 * 'OTHERS'. Neither read as wrong on any screen.
 *
 * READS come from the ConnectWave anon client, like every other muster.
 * WRITES go through the same `muster-write` Edge Function on the identity project — do not add a
 * second door. It re-verifies the caller is an Orange One admin, or a user an admin granted FULL
 * ACCESS to the Settings menu, and only then writes with ConnectWave's service key.
 *
 * ⚠ SWITCHED OFF, NEVER DELETED. `is_active = false` means NOT OFFERED FOR NEW MAPPINGS. Every
 *   customer already carrying the name keeps reading it, on the muster, on the dashboard and in
 *   every report. A name vanishing from a report because somebody left is worse than the typo this
 *   whole feature exists to prevent — so nothing here deletes, and no reader filters on is_active.
 *
 * ⚠ AND NOTHING HERE NORMALISES CASE. The master removes the OPPORTUNITY to disagree by being the
 *   only source of new values; it does not fold 'Others' into 'OTHERS' at match time, and must not.
 *   The masters' own case-insensitive unique index stops the LIST holding two spellings at once.
 */

/** Which vocabulary. The Edge Function maps this to a table; the client never names one. */
export type NameMasterKind = "salesperson" | "collection_team";

export interface NameMasterRow {
  /** The value itself, and the primary key — it is what the ledger columns actually store. */
  name: string;
  /** False = not offered for new mappings. Existing mappings are untouched and still render. */
  is_active: boolean;
  /** Locked: neither renameable nor switchable-off. 'OTHERS' only — see the note below. */
  is_protected: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

const COLUMNS = "name,is_active,is_protected,note,created_at,updated_at,updated_by";

/**
 * Ordered by `name`, which is the PRIMARY KEY.
 *
 * That is not cosmetic: fetchAll pages with .range(), and Postgres guarantees no row order without
 * an ORDER BY, so paging over a non-unique column can hand back the same row twice and drop
 * another. fetchTagRows/fetchGroupRows order by tally_name and are exposed to exactly that; these
 * are not.
 */
export function fetchSalespersonMaster(): Promise<NameMasterRow[]> {
  return fetchAll<NameMasterRow>("ext_salesperson_master", COLUMNS, "name");
}

export function fetchCollectionTeamMaster(): Promise<NameMasterRow[]> {
  return fetchAll<NameMasterRow>("ext_collection_team_master", COLUMNS, "name");
}

/** Add a value. Fails on a name that already exists in ANY casing — that is the point. */
export function addMasterName(input: {
  list: NameMasterKind;
  name: string;
  note?: string | null;
}): Promise<void> {
  return invokeMuster({ action: "add_list_value", ...input });
}

/** Switch a value on or off. Never deletes; refused on a protected value. */
export function setMasterNameActive(input: {
  list: NameMasterKind;
  name: string;
  is_active: boolean;
}): Promise<void> {
  return invokeMuster({ action: "set_list_value_active", ...input });
}

/**
 * What a rename moved, per target. Reported to the user rather than swallowed: the cascade spans
 * two Supabase projects with no shared transaction, so a partial result has to be visible.
 */
export interface RenameCounts {
  master: number;
  ledgers: number;
  /** ext_redmark rows. Salesperson only; always 0 for a collection team. */
  redmark: number;
  /**
   * The user tags this moved: `profiles.receivables_salespersons` for a salesperson,
   * `profiles.receivables_collection_teams` for a team. Both dimensions cascade (RC-11).
   */
  userTags: number;
  /** report_email_recipients.salesperson — renamed, or deleted where the new name already had a row. */
  recipients: number;
}

/**
 * Rename a value, carrying every row that holds it.
 *
 * ⚠ THE CASCADE IS THE WHOLE POINT. There is no foreign key anywhere — the name is stored as a bare
 *   string on ledgers in ConnectWave and on user tags in the identity project. Renaming the master
 *   alone would leave 319 customers reading 'NAKUL JI' against a master that no longer contains it,
 *   which is the exact bug this feature exists to remove, re-created by the tool meant to fix it.
 *
 * Renaming ONTO an existing name is refused rather than merged: merging would mean deleting a master
 * row, and no master row is ever deleted.
 */
export function renameMasterName(input: {
  list: NameMasterKind;
  from: string;
  to: string;
}): Promise<{ ok: true; counts: RenameCounts }> {
  return invokeMusterData<{ ok: true; counts: RenameCounts }>({ action: "rename_list_value", ...input });
}

// ── Reading a stored value ───────────────────────────────────────────────────

/**
 * Is a stored mapping unset?
 *
 * ⚠ '' AND NULL BOTH MEAN UNSET HERE, AND THEY ARE NOT THE SAME VALUE. The Edge Function has always
 *   written NULL, but the original sheet seed left an empty string on 1,631 of the 1,875 collection
 *   team rows. Without this, every one of them reads as a team named "".
 */
export function isUnset(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/**
 * The values a picker may offer for one row: the active master, plus whatever this row already
 * holds.
 *
 * ⚠ THE SECOND HALF IS LOAD-BEARING, not a nicety. A customer whose salesperson is switched off is
 *   left exactly as they are — no warning, no forced reassignment (decided 09-09-2026). If the
 *   picker dropped the value it could not offer, editing any OTHER field on one of those rows would
 *   silently blank the mapping on save. So an inactive value the row already holds stays selectable,
 *   and so does a value that is not in the master at all (which is how a name that drifted in
 *   through the sync or a spreadsheet announces itself instead of being quietly erased).
 */
export function optionsForRow(rows: NameMasterRow[], current: string | null | undefined): string[] {
  const out = rows.filter((r) => r.is_active).map((r) => r.name);
  if (!isUnset(current) && !out.includes(current as string)) out.push(current as string);
  return out.sort((a, b) => a.localeCompare(b));
}

/** Every name the master knows, active or not — what a WRITE is validated against. */
export function knownNames(rows: NameMasterRow[]): Set<string> {
  return new Set(rows.map((r) => r.name));
}

/**
 * Why a value is not a plain active entry, for the marker beside it in a picker or a chip list.
 * `null` when it is one.
 */
export function offMasterReason(
  rows: NameMasterRow[],
  value: string | null | undefined,
): "inactive" | "unknown" | null {
  if (isUnset(value)) return null;
  const row = rows.find((r) => r.name === value);
  if (!row) return "unknown";
  return row.is_active ? null : "inactive";
}
