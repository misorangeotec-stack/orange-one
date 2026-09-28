import type { MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import {
  LD_MASTER_TYPES,
  masterTypeLabel,
  type LdMasterType,
  type MasterRow,
  type SessionType,
  type Trainer,
  type Venue,
} from "../types";

export type MasterValues = Record<string, string>;

/**
 * ⚠⚠ THE WIRE CONTRACT FOR EVERY REQUESTABLE LEARNING & DEVELOPMENT MASTER.
 *
 * Each `key` below is a jsonb key of `fms_ld_master_requests.proposed_payload`,
 * read **verbatim** by the SECURITY DEFINER RPC `fms_ld_resolve_master_request`
 * (migration 20261215120000, under its own "WIRE CONTRACT" warning). ADD A FIELD
 * HERE WITHOUT ADDING IT TO THAT RPC'S INSERT CHAIN AND IT IS **SILENTLY DROPPED**
 * ON APPROVE — no error, no warning: the master row is simply created without the
 * value the requester typed and the approver read and agreed to. Change the two
 * together, always.
 *
 * The contract, as the RPC stands today:
 *   session_type     → name
 *   competency       → name
 *   need_source      → name
 *   venue            → name, address, capacity, is_online
 *   trainer          → name, trainer_type, employee_id, agency, contact_name,
 *                      email, phone, speciality, rate
 *   delay_reason     → name
 *   followup_action  → name
 *
 * ⚠ `code` IS NOT IN THE CONTRACT FOR `session_type`, and that is deliberate on
 *   both sides. The code is what the weekly report and the POSH / Safety
 *   compliance count match on; inventing one mid-request is how you end up with
 *   two rows both claiming to be 'posh'. A requested session type therefore
 *   arrives with a null code, and an owner gives it one on the Masters screen,
 *   where they can see the codes already taken. That is the one field the Masters
 *   form carries and the request form does not — hence `forRequest`, rather than
 *   two screens keeping two lists that would drift.
 *
 * ⚠ `sort_order` AND `active` ARE NOT HERE EITHER. They are an owner's concern,
 *   set on the Masters page — not something a requester should be asked to invent
 *   about a list they cannot see.
 */

export interface MasterFieldCtx {
  /** Every internal employee, for an internal trainer's portal account. */
  employeeOptions: ComboOption[];
  /**
   * True on the "ask for one" and "review a request" forms, false on the Masters
   * screen. Only `session_type` reads it — see the ⚠ on `code` above.
   */
  forRequest?: boolean;
}

const TRAINER_TYPES: ComboOption[] = [
  { value: "internal", label: "Internal — one of our own people" },
  { value: "external", label: "External — an agency or a freelancer" },
];

const YES_NO: ComboOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/**
 * The fields one master is described by.
 *
 * ⚠ `select`, NOT `choice`, FOR THE TWO FIXED PAIRS (trainer type, online).
 *   `MasterCrud` wraps every field in `FieldLabel`, which is a `<label>` element,
 *   and a label forwards a click on its text to its first labelable descendant.
 *   Over a `ChoiceButtons` strip that means clicking the QUESTION silently picks
 *   the FIRST OPTION — "Internal or external?" answering itself as Internal. Over
 *   a `Combobox`, whose trigger is one button, the same click merely opens the
 *   picker, which is harmless. The bug is MasterCrud's and is shared by every FMS
 *   in the hub; until it is fixed there, no new master here declares `choice`.
 */
export function masterFields(mt: LdMasterType, ctx: MasterFieldCtx): MasterFieldDef[] {
  switch (mt) {
    case "session_type":
      return [
        {
          key: "name",
          label: "Session type",
          type: "text",
          required: true,
          placeholder: "e.g. Vendor Product Training",
        },
        ...(ctx.forRequest
          ? []
          : ([
              {
                key: "code",
                label: "Report code",
                type: "text",
                placeholder: "e.g. vendor_product",
                hint:
                  "Lower-case, no spaces. Reports and the POSH / Safety count match on THIS, not on the name — a type with no code is countable only in the total. Never re-use a code another type already holds.",
              },
            ] as MasterFieldDef[])),
      ];

    case "competency":
      return [
        {
          key: "name",
          label: "Competency",
          type: "text",
          required: true,
          placeholder: "e.g. Customer handling",
        },
      ];

    case "need_source":
      return [
        {
          key: "name",
          label: "Need source",
          type: "text",
          required: true,
          placeholder: "e.g. Audit finding",
        },
      ];

    case "venue":
      return [
        {
          key: "name",
          label: "Venue",
          type: "text",
          required: true,
          placeholder: "e.g. Training Room, 2nd floor",
        },
        { key: "address", label: "Address", type: "textarea", placeholder: "Optional" },
        {
          key: "capacity",
          label: "Seats",
          type: "text",
          placeholder: "Optional",
          hint: "How many people fit. Left blank, nothing checks a nomination count against the room.",
        },
        {
          key: "is_online",
          label: "Is it online?",
          type: "select",
          options: YES_NO,
          hint: "An online venue carries no room — the session holds the joining link instead.",
        },
      ];

    case "trainer":
      return [
        {
          key: "name",
          label: "Trainer or agency name",
          type: "text",
          required: true,
          placeholder: "e.g. Bright Minds Consulting",
        },
        {
          key: "trainer_type",
          label: "Internal or external",
          type: "select",
          required: true,
          options: TRAINER_TYPES,
          hint:
            "An INTERNAL trainer is a portal user and runs their own session. An EXTERNAL one has no Orange Hub login at all — HR uploads their material and marks the session for them.",
        },
        {
          key: "employee_id",
          label: "Which employee",
          type: "select",
          options: ctx.employeeOptions,
          placeholder: "Internal trainers only",
          hint:
            "Required for an internal trainer, and must be EMPTY for an external one — the database refuses anything else.",
        },
        { key: "agency", label: "Agency", type: "text", placeholder: "External trainers" },
        { key: "contact_name", label: "Contact person", type: "text", placeholder: "Optional" },
        { key: "email", label: "Email", type: "text", placeholder: "Optional" },
        { key: "phone", label: "Phone", type: "text", placeholder: "Optional" },
        {
          key: "speciality",
          label: "Speciality",
          type: "text",
          placeholder: "e.g. Fire safety, ISO 9001",
        },
        {
          key: "rate",
          label: "Rate (₹)",
          type: "text",
          placeholder: "Optional",
          hint: "Their usual charge, as a reference when a proposal is costed. It prices nothing on its own.",
        },
      ];

    case "delay_reason":
      return [
        {
          key: "name",
          label: "Delay reason",
          type: "text",
          required: true,
          placeholder: "e.g. Awaiting purchase order",
        },
      ];

    case "followup_action":
      return [
        {
          key: "name",
          label: "Follow-up action",
          type: "text",
          required: true,
          placeholder: "e.g. On-the-job shadowing",
        },
      ];
  }
}

/** Every key of `mt`, at its sensible starting value — seeds a blank form. */
export function emptyValuesFor(mt: LdMasterType, ctx: MasterFieldCtx): MasterValues {
  const empty: MasterValues = {};
  for (const f of masterFields(mt, ctx)) empty[f.key] = "";
  // A trainer with no type picked cannot be saved at all (the CHECK sees to it),
  // and external is the overwhelming majority — an internal trainer is somebody
  // who already has a login, which is the rarer case.
  if (mt === "trainer") empty.trainer_type = "external";
  if (mt === "venue") empty.is_online = "no";
  return empty;
}

/** The first unmet required field, as a user-facing message. Null when valid. */
export function missingRequired(
  mt: LdMasterType,
  v: MasterValues,
  ctx: MasterFieldCtx,
): string | null {
  for (const f of masterFields(mt, ctx)) {
    if (f.required && !(v[f.key] ?? "").trim()) return `${f.label} is required.`;
  }
  /*
   * ⚠ SAID HERE RATHER THAN LEFT TO THE DATABASE. `fms_ld_trainers` carries a
   *   CHECK making the two shapes mutually exclusive, and a violation comes back
   *   as "new row … violates check constraint
   *   fms_ld_trainers_internal_has_employee", which tells the person nothing
   *   about what to do next.
   */
  if (mt === "trainer") {
    const internal = (v.trainer_type ?? "").trim() === "internal";
    const who = (v.employee_id ?? "").trim();
    if (internal && !who) {
      return "An internal trainer has to be one of our own people — pick the employee, or make them External.";
    }
    if (!internal && who) {
      return "An external trainer has no Orange Hub login, so they cannot be an employee. Clear the employee, or make them Internal.";
    }
  }
  return null;
}

/** Trim everything, drop empty optionals → the jsonb payload we post. */
export function payloadFromValues(mt: LdMasterType, v: MasterValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of masterFields(mt, { employeeOptions: [], forRequest: true })) {
    const val = (v[f.key] ?? "").trim();
    if (val || f.required) payload[f.key] = val;
  }
  /*
   * The RPC reads `is_online` through `(…)::boolean`, which throws on "yes". The
   * form's bag is strings by MasterCrud's own contract, so the translation
   * happens here — once — rather than in each screen.
   */
  if (mt === "venue") payload.is_online = (v.is_online ?? "").trim() === "yes";
  return payload;
}

/** A stored payload back into a form bag, so a reviewer can correct it. */
export function valuesFromPayload(
  mt: LdMasterType,
  payload: Record<string, unknown>,
  ctx: MasterFieldCtx,
): MasterValues {
  const out = emptyValuesFor(mt, ctx);
  for (const f of masterFields(mt, ctx)) {
    const raw = payload[f.key];
    if (raw === null || raw === undefined) continue;
    out[f.key] = typeof raw === "boolean" ? (raw ? "yes" : "no") : String(raw);
  }
  return out;
}

/**
 * A one-line human summary of a proposed payload, for the requests table.
 *
 * It reads the wire keys, so the reviewer sees the whole proposal rather than
 * just its name — a trainer row that says "Bright Minds" and nothing else hides
 * the one thing worth reviewing about it.
 */
export function describePayload(mt: LdMasterType, payload: Record<string, unknown>): string {
  const str = (k: string) => (typeof payload[k] === "string" ? String(payload[k]).trim() : "");
  const name = str("name");
  const bits: string[] = [];
  if (mt === "trainer") {
    if (str("trainer_type")) bits.push(str("trainer_type") === "internal" ? "internal" : "external");
    if (str("agency")) bits.push(str("agency"));
    if (str("speciality")) bits.push(str("speciality"));
  }
  if (mt === "venue") {
    if (payload.is_online === true || payload.is_online === "yes") bits.push("online");
    if (str("capacity")) bits.push(`${str("capacity")} seats`);
  }
  const suffix = bits.length ? ` · ${bits.join(" · ")}` : "";
  return name ? `${name}${suffix}` : "—";
}

/** The live rows of every requestable master, for the "does this exist?" check. */
export interface MasterLists {
  sessionTypes: SessionType[];
  competencies: MasterRow[];
  needSources: MasterRow[];
  venues: Venue[];
  trainers: Trainer[];
  delayReasons: MasterRow[];
  followupActions: MasterRow[];
}

const listFor = (
  mt: LdMasterType,
  lists: MasterLists,
): { id: string; name: string; active: boolean }[] => {
  switch (mt) {
    case "session_type": return lists.sessionTypes;
    case "competency": return lists.competencies;
    case "need_source": return lists.needSources;
    case "venue": return lists.venues;
    case "trainer": return lists.trainers;
    case "delay_reason": return lists.delayReasons;
    case "followup_action": return lists.followupActions;
  }
};

const eq = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Is this proposed entry already in the master? Case-INSENSITIVE, which is
 * stricter than the database's case-sensitive `unique(name)` — deliberately, so
 * we never end up with both "Fire Safety" and "fire safety".
 *
 * ⚠ IT MATCHES INACTIVE ROWS TOO. They are hidden from the pickers, so a
 *   requester has no way of knowing they exist — but the unique index still
 *   blocks the insert, so approving a request for one turns into a 23505 that
 *   reads like a bug in the app. Those need a REACTIVATION on the Masters screen,
 *   not a new row, and every caller of this says so.
 */
export function findExistingMaster(
  mt: LdMasterType,
  v: MasterValues,
  lists: MasterLists,
): { id: string; name: string; active: boolean } | undefined {
  const name = (v.name ?? "").trim();
  if (!name) return undefined;
  return listFor(mt, lists).find((row) => eq(row.name, name));
}

/** Every master type, as picker options. */
export const masterTypeOptions: ComboOption[] = LD_MASTER_TYPES.map((m) => ({
  value: m.value,
  label: masterTypeLabel(m.value),
}));
