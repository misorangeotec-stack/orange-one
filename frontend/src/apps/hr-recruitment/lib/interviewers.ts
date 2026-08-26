import type { Department } from "@/core/platform/types";
import type { Interview, Requisition } from "../types";

/**
 * The minimum a person needs to be offered as an interviewer.
 *
 * Deliberately structural rather than `Profile`: the pool is now fed from the
 * ORG-WIDE directory (`orgPeople` / `list_org_people`), not from the RLS-scoped
 * one. `profiles` only exposes self + downline + same-department peers, so a head
 * of department in another department never reached the browser and was silently
 * dropped from the picker — with the hint still claiming the list was correct.
 * Both `Profile` and `OrgPerson` satisfy this shape, so either can be passed.
 */
export interface InterviewerPerson {
  id: string;
  name: string;
  designation: string | null;
  departmentId: string | null;
}

/** The two headings the Round 2 picker splits its options under. */
export const ON_REQUISITION = "On this requisition";
export const MRF_OWNERS = "Set up to raise an MRF";

/**
 * WHO MAY TAKE EACH INTERVIEW ROUND.
 *
 * Offering the whole company for every round is not just noise — it lets the wrong
 * person be recorded as the interviewer, which quietly corrupts the one thing this app
 * exists to know: who owes what. Each round has a real owner:
 *
 *   R1 — HR's screening call  → the HR department
 *   R2 — the manager's round  → everyone set up to RAISE an MRF, plus whoever is
 *                               named on this requisition
 *   R3 — the final call       → the directors
 *
 * R2 used to read the requisition alone (`hiring_manager_ids` and `reporting_to_ids`),
 * and `fms_hr_submit_mrf` defaults that to whoever raised the MRF. So a stage LABELLED
 * "Interview R2 — HOD" reliably offered one name, usually not a head of department:
 * measured on live data, only 4 of 16 requisitions named a HOD at all. The heads ARE
 * set up in this module already — as the owners of the `mrf` step in Setup → Step
 * owners — so that list is what the round is offered to now.
 *
 * ⚠ Being OFFERED here grants nothing. `fms_hr_is_recruitment_staff` deliberately
 *   excludes the `mrf` step ("may raise a requisition ... is not a claim to work in
 *   recruitment, so it grants no read over candidates"). Only being BOOKED widens what
 *   someone may see, and only for that requisition — see `fms_hr_is_interview_panel`.
 *
 * This lives here, not in a modal, because an interview can be booked from two places
 * (dragging a card into a round, and scheduling a round the system auto-advanced into
 * after a "selected" result). Both must offer the same people, or the rule isn't a rule.
 */
export interface InterviewerPool {
  /** The people to offer. Falls back to everyone when the rule matches nobody. */
  people: InterviewerPerson[];
  /**
   * Of those, the ones named on the requisition itself. The picker heads them up
   * separately so whoever is booking can see at a glance who owns this vacancy.
   * Empty for every round but R2, the only one with two sources.
   */
  onRequisitionIds: Set<string>;
  /** False when we fell back — the caller should say why rather than pretend. */
  restricted: boolean;
  /** Who this round is for, in one line. */
  hint: string;
  /** Why the list isn't filtered, when it isn't. */
  fallbackNote: string;
}

export function interviewerPool(
  round: 0 | 1 | 2 | 3,
  people: InterviewerPerson[],
  departments: Department[],
  requisition: Requisition | undefined,
  /** Owners of the `mrf` step — the heads this module is set up with. */
  mrfOwnerIds: string[] = [],
): InterviewerPool {
  const hrDeptId = departments.find((d) => /human resource|^hr$/i.test(d.name))?.id ?? null;

  // Named on the requisition. Tracked separately from the pool so the picker can group
  // them, and so that grouping survives the fall-back below.
  const onRequisitionIds = new Set<string>(
    round === 2 ? [...(requisition?.hiringManagerIds ?? []), ...(requisition?.reportingToIds ?? [])] : [],
  );

  let pool: InterviewerPerson[] = [];
  // Round 0 (telephonic screening) is HR's call, same as Round 1.
  if (round === 0 || round === 1) {
    pool = hrDeptId ? people.filter((p) => p.departmentId === hrDeptId) : [];
  } else if (round === 2) {
    // The heads set up to raise an MRF, plus anyone this requisition names itself.
    const ids = new Set([...mrfOwnerIds, ...onRequisitionIds]);
    pool = people.filter((p) => ids.has(p.id));
  } else {
    // "Director - Sales" is still a director, so match the word, not the whole title.
    pool = people.filter((p) => /director/i.test(p.designation ?? ""));
  }

  const hint =
    round === 0 || round === 1
      ? "The HR team."
      : round === 2
        ? "The heads set up to raise an MRF, and whoever is named on this requisition."
        : "Directors.";

  const fallbackNote =
    round === 0 || round === 1
      ? "No Human Resources department is set up, so everyone is listed."
      : round === 2
        ? "Nobody is set up to raise an MRF and this requisition names no manager, so everyone is listed."
        : "Nobody is listed as a Director, so everyone is listed.";

  // Never dead-end: an empty dropdown would block a real booking. Fall back to everyone
  // and say so. The free-text interviewer box covers external consultants either way.
  const restricted = pool.length > 0;
  return { people: restricted ? pool : people, onRequisitionIds, restricted, hint, fallbackNote };
}

/** One option as the pickers want it — structurally a `MultiOption`. */
export interface InterviewerOption {
  value: string;
  label: string;
  group?: string;
}

/**
 * The people, sorted and labelled for a Combobox / MultiSelect.
 *
 * Grouped ONLY where there is genuinely more than one source to tell apart — i.e. R2
 * holding both a requisition-named manager and other MRF owners. A single heading over
 * a homogeneous list is noise, so R1 and R3 render exactly as they always did.
 *
 * `moduleUserIds`, when given, marks anyone who cannot open New Recruitment at all.
 * They are still offered — a head may genuinely be taking the interview — but booking
 * one silently would send a notification to somebody who lands on Access Denied.
 */
export const interviewerOptions = (
  pool: InterviewerPool,
  moduleUserIds?: ReadonlySet<string>,
): InterviewerOption[] => {
  const named = pool.people.filter((p) => pool.onRequisitionIds.has(p.id));
  const grouped = named.length > 0 && named.length < pool.people.length;

  const label = (p: InterviewerPerson) => {
    const base = p.designation ? `${p.name} · ${p.designation}` : p.name;
    return moduleUserIds && !moduleUserIds.has(p.id) ? `${base} · no access to this module` : base;
  };
  const byName = (a: InterviewerPerson, b: InterviewerPerson) => a.name.localeCompare(b.name);
  const toOption = (p: InterviewerPerson, group?: string): InterviewerOption =>
    group ? { value: p.id, label: label(p), group } : { value: p.id, label: label(p) };

  if (!grouped) return [...pool.people].sort(byName).map((p) => toOption(p));

  // Requisition-named people FIRST: MultiSelect renders groups in the order each one
  // first appears, and these are the people who actually own the vacancy.
  return [
    ...named.sort(byName).map((p) => toOption(p, ON_REQUISITION)),
    ...pool.people
      .filter((p) => !pool.onRequisitionIds.has(p.id))
      .sort(byName)
      .map((p) => toOption(p, MRF_OWNERS)),
  ];
};

/** Anyone picked who cannot open this module — named, so the caller can warn about them. */
export const withoutModuleAccess = (
  pool: InterviewerPool,
  ids: string[],
  moduleUserIds: ReadonlySet<string> | undefined,
): string[] =>
  moduleUserIds
    ? pool.people.filter((p) => ids.includes(p.id) && !moduleUserIds.has(p.id)).map((p) => p.name)
    : [];

/**
 * A round is BOOKED when somebody is actually on it.
 *
 * Recording "selected" auto-advances the candidate AND inserts a STUB row for the next
 * round — no panel, no date, status 'scheduled' (`fms_hr_record_interview_result`). So
 * the existence of an `fms_hr_interviews` row proves nothing. The board always tested
 * the panel; the Interviews queue tested only that a row existed, so the same round read
 * "To be scheduled" on one screen and "Booked" on the other, and its Book it button never
 * appeared. Three rows were live in that state when this was found.
 *
 * One predicate, used by both, so they cannot drift apart again.
 */
export const isBooked = (iv: Interview | undefined | null): boolean =>
  !!iv && (iv.interviewerIds.length > 0 || !!iv.interviewerName?.trim());

/**
 * A round's whole panel on one line: the portal users, then any free-text name.
 *
 * The two are ADDITIVE, not alternatives — a real panel is often two people from
 * the portal plus an external consultant who has no login, and showing only one
 * of those is how you end up chasing the wrong person about a result.
 *
 * ⚠ `nameOf` must resolve ORG-WIDE. Every caller used to pass the RLS-scoped
 *   `profileById`, and an unresolved id is dropped below — so an interviewer from
 *   another department rendered as no name at all and a booked round looked
 *   unassigned. Pass the store's `personNameOrNull`, which falls back to the org
 *   directory before giving up.
 *
 * Lives here beside the pool rule so the card, the drawer and the queue cannot
 * render the same panel three different ways.
 */
export function panelNames(
  interviewerIds: string[],
  interviewerName: string | null,
  nameOf: (id: string) => string | undefined,
): string {
  const names = interviewerIds.map(nameOf).filter((n): n is string => !!n);
  if (interviewerName?.trim()) names.push(interviewerName.trim());
  return names.join(", ");
}
