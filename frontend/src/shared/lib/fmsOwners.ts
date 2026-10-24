/**
 * Step ownership for the FMS apps that route work by step alone.
 *
 * HR Recruitment, HR Exit and General Purchase all answer "who owns this step?"
 * the same way — look up `fms_<domain>_step_owners` by `step_key` and read
 * `employee_ids`. That one rule lives here so the home screen's My Work list can
 * apply it without importing from any single app.
 *
 * Purchase and Import are NOT covered by this: both override the `approval` step
 * with a value-band matrix, so each keeps its own resolver in `lib/owners.ts`.
 *
 * A step owner list is a TEAM, not a person. Five owners on a step means the same
 * work-item is genuinely on five people's plates — callers that present this as
 * "my work" should say whether an item is personally or team-assigned rather than
 * silently implying sole ownership.
 *
 * ── COMPANY-WISE OWNERS ─────────────────────────────────────────────────────
 * An owner can be limited to some companies (Setup → Step Owners → Companies),
 * the way Order-to-Dispatch limits owners per location. Bharat Singh owns Inward
 * for Enterprise, Gorakh Pawar for O-tec: both stay on the step, each gets dues
 * only for their own company's records.
 *
 * ⚠ IT NARROWS, IT NEVER ADDS. The owner stays in `employee_ids`, so every
 *   server-side `*_is_step_owner` check keeps passing for them. The scope only
 *   decides whose bucket a record lands in — queues, My Work and Control Center.
 *   An owner with no scope covers every company, and a record with no company is
 *   everybody's, so nothing changes until an admin ticks a company.
 *
 * ⚠ NOT YET NARROWED: bell/email recipients worked out in SQL (`*_announce` /
 *   `*_step_owner_ids` — Complaint, Customer, Sampling, Asset), and the 9am mail
 *   until `supabase/functions/_shared/workSnapshot.bundle.js` is rebuilt and the
 *   work-snapshot function redeployed. Purchase and Import notify from the
 *   client, so theirs ARE narrowed.
 *
 * Stored per app in its own `fms_<domain>_config` row, key
 * {@link OWNER_COMPANY_SCOPE_KEY}: `{ steps: { [stepKey]: { [userId]: companyId[] } } }`.
 */

/** The shape every `fms_*_step_owners` row shares once mapped. */
export interface StepOwnerRow {
  stepKey: string;
  employeeIds: string[];
  /** userId → the companies this owner covers. Absent or empty = every company. */
  companyScope?: OwnerCompanyScope;
}

/** userId → companyIds, for one step. */
export type OwnerCompanyScope = Record<string, string[]>;
/** stepKey → that step's per-owner company scope. */
export type StepCompanyScopes = Record<string, OwnerCompanyScope>;

/** The `fms_<domain>_config` key every app stores its company-wise owners under. */
export const OWNER_COMPANY_SCOPE_KEY = "owner_company_scope";

/** Reads the config value defensively — a hand-edited row must not break a queue. */
export function parseStepCompanyScopes(value: unknown): StepCompanyScopes {
  const steps = (value as { steps?: unknown } | null)?.steps;
  if (!steps || typeof steps !== "object") return {};
  const out: StepCompanyScopes = {};
  for (const [step, byUser] of Object.entries(steps as Record<string, unknown>)) {
    if (!byUser || typeof byUser !== "object") continue;
    const scope: OwnerCompanyScope = {};
    for (const [uid, ids] of Object.entries(byUser as Record<string, unknown>)) {
      const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
      if (list.length) scope[uid] = list;
    }
    if (Object.keys(scope).length) out[step] = scope;
  }
  return out;
}

/** The config value to save. Owners left on "All companies" are dropped. */
export function serializeStepCompanyScopes(scopes: StepCompanyScopes): { steps: StepCompanyScopes } {
  return { steps: parseStepCompanyScopes({ steps: scopes }) };
}

/** Puts each step's scope onto its owner row, so every reader below sees it. */
export function withCompanyScopes<T extends { stepKey: string }>(rows: T[], scopes: StepCompanyScopes): (T & { companyScope?: OwnerCompanyScope })[] {
  return rows.map((r) => (scopes[r.stepKey] ? { ...r, companyScope: scopes[r.stepKey] } : r));
}

/**
 * Does this owner cover this company? No company on the record, or no scope for
 * the owner, means yes.
 */
export const ownerCoversCompany = (
  scope: OwnerCompanyScope | undefined,
  userId: string,
  companyId: string | null | undefined,
): boolean => {
  if (!companyId || !scope) return true;
  const list = scope[userId];
  return !list || list.length === 0 || list.includes(companyId);
};

/** Narrows an owner list to the people who cover this record's company. */
export const scopeOwnerIds = (
  ids: string[],
  scope: OwnerCompanyScope | undefined,
  companyId: string | null | undefined,
): string[] => (!companyId || !scope ? ids : ids.filter((id) => ownerCoversCompany(scope, id, companyId)));

/**
 * Owners of a step. Pass the record's company to get only the owners who cover
 * it; leave it out for the whole team (Setup, "is this person an owner at all").
 */
export const stepOwnerIdsFor = (stepKey: string, owners: StepOwnerRow[], companyId?: string | null): string[] => {
  const row = owners.find((o) => o.stepKey === stepKey);
  return scopeOwnerIds(row?.employeeIds ?? [], row?.companyScope, companyId);
};

export const isMineByStepOwners = (
  stepKey: string,
  userId: string,
  owners: StepOwnerRow[],
  companyId?: string | null,
): boolean => stepOwnerIdsFor(stepKey, owners, companyId).includes(userId);
