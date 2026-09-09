import type { MultiOption } from "@/shared/components/ui/MultiSelect";

/**
 * The minimum a person needs to be offered in one of this module's people pickers.
 * Structural rather than `OrgPerson` so a `Profile` satisfies it too.
 */
export interface PickablePerson {
  id: string;
  name: string;
  designation: string | null;
  departmentId?: string | null;
  role?: string;
}

/**
 * ONE list of people, marked ONE way, for every picker that names a person who will
 * be expected to do something in this module.
 *
 * ⚠ FEED IT `s.orgPeople`, NEVER `s.profiles`. The directory is RLS-scoped to self +
 *   downline + same-department peers, which is the root cause of NR-3: HR sees 5 of
 *   68 people, so every head they would need to name is simply not in the dropdown.
 *   They were not skipping the field — they could not fill it.
 *
 * TWO GRANTS ARE REQUIRED and neither is granted here, so both are marked:
 *
 *   * no `hr-recruitment` row at all → they cannot open the app. Naming them is still
 *     CORRECT (the mapping is a fact about who owns the hiring, not about who has a
 *     login), so they stay selectable — but silently is how somebody gets told they
 *     own seven steps and lands on Access Denied.
 *   * the row exists at **View only** → worse, because it looks fine. They see the
 *     vacancy and can press nothing: `fms_hr_can_act()` ANDs `module_can_edit()`.
 *
 * `moduleEditUserIds` is a strict subset of `moduleUserIds`, so "view only" is the set
 * difference. Pass both or neither — passing only the first would silently mark every
 * View-only grant as fine.
 */
export function personOptions(
  people: PickablePerson[],
  moduleUserIds?: ReadonlySet<string>,
  moduleEditUserIds?: ReadonlySet<string>,
): MultiOption[] {
  return [...people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.id, label: personLabel(p, moduleUserIds, moduleEditUserIds) }));
}

/** One person's label, with the access marking the pickers share. */
export function personLabel(
  p: PickablePerson,
  moduleUserIds?: ReadonlySet<string>,
  moduleEditUserIds?: ReadonlySet<string>,
): string {
  const base = p.designation ? `${p.name} · ${p.designation}` : p.name;
  // Same wording the interview pickers already use, so "no access" reads the same way
  // wherever this module says it.
  if (moduleUserIds && !moduleUserIds.has(p.id)) return `${base} · no access to this module`;
  if (moduleUserIds && moduleEditUserIds && !moduleEditUserIds.has(p.id)) return `${base} · view only`;
  return base;
}

/**
 * Of the people picked, the ones who cannot open the module at all, and the ones who
 * can only look. Returned as names, so a caller can warn about them by name rather
 * than leaving it to be discovered.
 */
export function accessWarnings(
  people: PickablePerson[],
  picked: string[],
  moduleUserIds: ReadonlySet<string>,
  moduleEditUserIds: ReadonlySet<string>,
): { cannotOpen: string[]; viewOnly: string[] } {
  const chosen = people.filter((p) => picked.includes(p.id));
  return {
    cannotOpen: chosen.filter((p) => !moduleUserIds.has(p.id)).map((p) => p.name),
    viewOnly: chosen
      .filter((p) => moduleUserIds.has(p.id) && !moduleEditUserIds.has(p.id))
      .map((p) => p.name),
  };
}
