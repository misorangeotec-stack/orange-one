import { useMemo } from "react";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import type { OwnerCompanyScope } from "@/shared/lib/fmsOwners";

/**
 * Company-wise step owners — the Setup half of `shared/lib/fmsOwners`.
 *
 * Sits inside each FMS's "Owners — <step>" modal, under the Employees picker:
 * one line per chosen owner with the companies they cover. Left on "All
 * companies" they get every record, as before. See fmsOwners for the rule.
 */

export interface ScopeCompany {
  id: string;
  /** Short and unambiguous: "Enterprise Surat", not Tally's full book name. */
  label: string;
}

/** "Enterprise Surat" from a Central Masters company; the Tally name when it has no alias. */
export const companyScopeLabel = (c: { name: string; alias?: string | null; location?: string | null }): string =>
  c.alias ? [c.alias, c.location].filter(Boolean).join(" ") : c.name;

export function OwnerCompanyScopeFields({
  employeeIds,
  personName,
  companies,
  value,
  onChange,
  label = "Companies",
  allLabel = "All companies",
  note,
}: {
  /** The owners picked above — only they get a line. */
  employeeIds: string[];
  personName: (id: string) => string;
  companies: ScopeCompany[];
  value: OwnerCompanyScope;
  onChange: (next: OwnerCompanyScope) => void;
  /** Reused for other per-owner scopes (Purchase's Categories): the heading, the "all" word, the help line. */
  label?: string;
  allLabel?: string;
  note?: string;
}) {
  const options: MultiOption[] = useMemo(() => companies.map((c) => ({ value: c.id, label: c.label })), [companies]);
  if (companies.length < 2 || employeeIds.length === 0) return null;

  const set = (uid: string, ids: string[]) => {
    const next = { ...value };
    // Every company ticked is the same as none — store it as "all", so a new
    // company added later is covered too.
    if (ids.length === 0 || ids.length >= companies.length) delete next[uid];
    else next[uid] = ids;
    onChange(next);
  };

  return (
    <FieldLabel label={label} hint="per owner">
      <div className="space-y-1.5">
        {employeeIds.map((uid) => (
          <div key={uid} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-[12.5px] text-navy" title={personName(uid)}>
              {personName(uid)}
            </span>
            <MultiSelect
              className="min-w-0 flex-1"
              values={value[uid] ?? []}
              onChange={(ids) => set(uid, ids)}
              options={options}
              placeholder={allLabel}
            />
          </div>
        ))}
      </div>
      <span className="mt-1 block text-[11px] leading-snug text-grey-2">
        {note ??
          `An owner gets dues, queue rows and notifications only for the ${label.toLowerCase()} ticked here. Leave on “${allLabel}” to cover everything.`}
      </span>
    </FieldLabel>
  );
}

/** "Bharat Singh (Enterprise Surat), Javid" — the Setup table's Owners cell. */
export function ownerNamesWithScope(
  ids: string[],
  scope: OwnerCompanyScope | undefined,
  personName: (id: string) => string,
  companies: ScopeCompany[],
): string[] {
  const label = new Map(companies.map((c) => [c.id, c.label]));
  return ids.map((id) => {
    const list = scope?.[id];
    if (!list?.length) return personName(id);
    return `${personName(id)} (${list.map((c) => label.get(c) ?? "?").join(", ")})`;
  });
}

/** Keeps only the scope of owners still on the step — a removed owner's ticks go with them. */
export const pruneScope = (scope: OwnerCompanyScope, employeeIds: string[]): OwnerCompanyScope => {
  const keep = new Set(employeeIds);
  return Object.fromEntries(Object.entries(scope).filter(([uid]) => keep.has(uid)));
};
