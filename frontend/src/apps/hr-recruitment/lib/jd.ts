import type { ComboOption } from "@/shared/components/ui/Combobox";
import type { MultiOption } from "@/shared/components/ui/MultiSelect";
import type { Department } from "@/core/platform/types";
import {
  SKILL_CATEGORIES,
  type HrSkill,
  type JobTitle,
  type Qualification,
  type SkillCategory,
} from "../types";

/**
 * Option builders for the job-description pickers, in one place so the requisition
 * form, the Masters page (authoring a JD template) and the detail view all render
 * the same list in the same order.
 */

/** Category order for display — SKILL_CATEGORIES' order, not the DB's. */
const CATEGORY_RANK = new Map<string, number>(SKILL_CATEGORIES.map((c, i) => [c.value, i]));

const byCategoryThenOrder = (a: HrSkill, b: HrSkill) => {
  const ra = CATEGORY_RANK.get(a.category) ?? 99;
  const rb = CATEGORY_RANK.get(b.category) ?? 99;
  if (ra !== rb) return ra - rb;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name);
};

/**
 * Every active skill as ONE grouped list — the whole reason the form needs two
 * pickers instead of five. MultiSelect renders `group` as a sticky header and
 * keeps the sections in the order they first appear, so sorting is the only
 * control needed here.
 *
 * `keep` re-admits ids that are already selected even if the row was since
 * deactivated: hiding a chosen skill would silently drop it on the next save.
 */
export function skillOptions(skills: HrSkill[], keep: string[] = []): MultiOption[] {
  const keepSet = new Set(keep);
  return skills
    .filter((s) => s.active || keepSet.has(s.id))
    .sort(byCategoryThenOrder)
    .map((s) => ({
      value: s.id,
      label: s.name,
      group: SKILL_CATEGORIES.find((c) => c.value === s.category)?.label ?? "Other",
    }));
}

/** Just one category's skills, for the Masters page's category filter. */
export const skillsInCategory = (skills: HrSkill[], category: SkillCategory): HrSkill[] =>
  skills.filter((s) => s.category === category).sort(byCategoryThenOrder);

export function qualificationOptions(quals: Qualification[], keep: string[] = []): MultiOption[] {
  const keepSet = new Set(keep);
  return quals
    .filter((q) => q.active || keepSet.has(q.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((q) => ({ value: q.id, label: q.name }));
}

/**
 * Job titles for the requisition's first field, captioned with the department
 * they'll fill in — so the auto-fill is visible before it happens rather than
 * looking like the form changed something on its own.
 */
export function jobTitleOptions(
  jobTitles: JobTitle[],
  departments: Department[],
  keep?: string | null
): ComboOption[] {
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  return jobTitles
    .filter((t) => t.active || t.id === keep)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((t) => ({
      value: t.id,
      label: t.name,
      sublabel: (t.departmentId && deptName.get(t.departmentId)) || undefined,
    }));
}

/**
 * "2–5 years" / "5+ years" / "Freshers welcome". Null when nothing was asked for,
 * so the caller can drop the row entirely rather than print an empty label.
 */
export function experienceLabel(
  min: number | null,
  max: number | null,
  freshersOk: boolean
): string | null {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  let core: string | null = null;
  if (min !== null && max !== null) core = min === max ? `${n(min)} years` : `${n(min)}–${n(max)} years`;
  else if (min !== null) core = `${n(min)}+ years`;
  else if (max !== null) core = `Up to ${n(max)} years`;

  if (!core) return freshersOk ? "Freshers welcome" : null;
  return freshersOk ? `${core} · freshers welcome` : core;
}
