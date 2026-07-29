/**
 * Asset Maintenance FMS domain types — the camelCase shape the store hands out,
 * mapped from the snake_case `fms_asset_*` tables in data/assetFetch.ts.
 *
 * THREE LAYERS, and the distinction matters everywhere downstream:
 *   Asset         — permanent. Never completes, never leaves the register.
 *   AssetSchedule — a permanent, self-advancing dated track. 1..N per asset.
 *   ServiceJob    — the short-lived workflow entity. THIS is what has steps.
 */

/* -------------------------------------------------------------------------- */
/*  Masters                                                                    */
/* -------------------------------------------------------------------------- */

/** Every master satisfies MasterCrud's contract: id / name / active / sortOrder. */
export interface NamedMaster {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

/** How a schedule's interval is counted. `one_time` parks the track once it fires. */
export type FrequencyUnit = "days" | "months" | "years" | "one_time";

export const FREQUENCY_UNITS: { value: FrequencyUnit; label: string }[] = [
  { value: "days", label: "Days" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
  { value: "one_time", label: "One time only" },
];

/**
 * `service` — work is performed ON the asset (a service, a calibration).
 * `renewal` — a DOCUMENT lapses and is replaced (insurance, PUC, AMC).
 *
 * The only behavioural difference, and it is a big one: closing a `renewal` job
 * REQUIRES the new expiry date off the renewed document, because computing it
 * from last-done + frequency is right only by luck for a policy.
 */
export type ScheduleKind = "service" | "renewal";

/**
 * THE master that answers "different assets need different reminders".
 *
 * Seeded with Periodic Service, Insurance, PUC, RC / Fitness, Warranty Expiry,
 * AMC Renewal, Calibration and Statutory Inspection — so the module works on day
 * one — and extensible by an admin without a code change. Deliberately neither
 * a hard-coded enum (which would need a developer for "Lift Licence") nor free
 * text (which drifts in spelling and breaks every report).
 */
export interface ScheduleType extends NamedMaster {
  kind: ScheduleKind;
  defaultFrequencyValue: number | null;
  defaultFrequencyUnit: FrequencyUnit | null;
  defaultLeadDays: number;
}

export interface AssetCategory extends NamedMaster {
  defaultLeadDays: number | null;
  /**
   * Which tracks a new asset of this category is pre-offered — a Vehicle gets
   * Insurance + PUC + RC + Service, a Computer gets Warranty + AMC.
   *
   * ⚠ A uuid[] carries no foreign key, so an id here can outlive its schedule
   *   type. Always filter against the live list before rendering.
   */
  defaultScheduleTypeIds: string[];
}

export interface AssetLocation extends NamedMaster {
  address: string | null;
}

/** Bought from and/or services it — one master, because usually they are the same firm. */
export interface Vendor extends NamedMaster {
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
}

export interface Company extends NamedMaster {
  gstin: string | null;
  address: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Master governance                                                          */
/* -------------------------------------------------------------------------- */

export type AssetMasterType =
  | "schedule_type" | "category" | "location" | "vendor" | "make"
  | "company" | "condition" | "usage_unit" | "cost_head";

export interface MasterTypeDef {
  value: AssetMasterType;
  label: string;
  plural: string;
  /** Which Masters tab group it belongs to. */
  group: "register" | "service" | "org";
}

/** Every master type, in Masters-tab order. All 9 are OWNABLE. */
export const ASSET_MASTER_TYPES: MasterTypeDef[] = [
  { value: "category",      label: "Asset category",  plural: "Asset categories",  group: "register" },
  { value: "make",          label: "Make",            plural: "Makes",             group: "register" },
  { value: "condition",     label: "Condition",       plural: "Conditions",        group: "register" },
  { value: "usage_unit",    label: "Usage unit",      plural: "Usage units",       group: "register" },
  { value: "schedule_type", label: "Schedule type",   plural: "Schedule types",    group: "service" },
  { value: "vendor",        label: "Vendor",          plural: "Vendors",           group: "service" },
  { value: "cost_head",     label: "Cost head",       plural: "Cost heads",        group: "service" },
  { value: "company",       label: "Company",         plural: "Companies",         group: "org" },
  { value: "location",      label: "Location",        plural: "Locations",         group: "org" },
];

/**
 * Not offered in the "Request a new entry" picker — these are structural choices
 * an admin makes, not day-to-day additions. They remain OWNABLE, and the split is
 * enforced here rather than in SQL so an admin can still resolve one raised by
 * hand.
 */
const NOT_REQUESTABLE: AssetMasterType[] = ["company", "schedule_type", "cost_head"];

export const REQUESTABLE_ASSET_MASTER_TYPES: MasterTypeDef[] =
  ASSET_MASTER_TYPES.filter((m) => NOT_REQUESTABLE.indexOf(m.value) === -1);

export interface MasterManager {
  id: string;
  masterType: AssetMasterType;
  managerUserId: string;
}

export type MasterRequestStatus = "pending" | "approved" | "rejected";

export interface MasterRequest {
  id: string;
  masterType: AssetMasterType;
  proposedPayload: Record<string, unknown>;
  status: MasterRequestStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/*  Layer 1 — the asset                                                        */
/* -------------------------------------------------------------------------- */

export interface Asset {
  id: string;
  /** ASSET-0001. NOT financial-year scoped — an asset is permanent. */
  assetNo: string;
  name: string;
  categoryId: string | null;
  makeId: string | null;
  model: string | null;
  serialNo: string | null;

  companyId: string | null;
  locationId: string | null;
  departmentId: string | null;
  /** Answerable for the asset. Gets every reminder; may schedule + record its services. */
  custodianUserId: string | null;

  purchaseDate: string | null;
  purchaseCost: number | null;
  vendorId: string | null;
  invoiceNo: string | null;
  invoicePath: string | null;
  invoiceName: string | null;
  /**
   * An INPUT CONVENIENCE, not a second reminder mechanism: submitting an asset
   * with this set auto-creates a one_time "Warranty Expiry" track. Nothing
   * reminds off this field — everything remind-able is a schedule.
   */
  warrantyMonths: number | null;

  conditionId: string | null;
  usageUnitId: string | null;
  currentUsage: number | null;
  usageAsOn: string | null;

  retiredOn: string | null;
  retiredReason: string | null;

  remarks: string | null;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;

  /** Joined in by the fetcher, not a column. */
  schedules: AssetSchedule[];
}

/* -------------------------------------------------------------------------- */
/*  Layer 2 — the dated track                                                  */
/* -------------------------------------------------------------------------- */

export interface AssetSchedule {
  id: string;
  assetId: string;
  scheduleTypeId: string;

  frequencyValue: number | null;
  frequencyUnit: FrequencyUnit;
  lastDoneDate: string | null;
  /** NULL parks the track — the generator skips it. Honest for "we don't know". */
  nextDueDate: string | null;
  /** Days before nextDueDate that the job opens. Also CAPS the reminder ladder. */
  leadDays: number;

  /** The optional second trigger, evaluated when a meter reading is logged. */
  usageInterval: number | null;
  usageAtLastDone: number | null;

  /** Renewal-track facts about the CURRENT document, replaced at each renewal. */
  refNo: string | null;
  provider: string | null;
  amount: number | null;

  notes: string | null;
  active: boolean;
}

export interface AssetReading {
  id: string;
  assetId: string;
  readingDate: string;
  reading: number;
  note: string | null;
  recordedBy: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/*  Layer 3 — the service job (THE workflow entity)                            */
/* -------------------------------------------------------------------------- */

/**
 * ⚠ STATUSES ARE NOT STEP KEYS. The three `awaiting_*` values map 1:1 onto the
 *   queue steps; the other four are exits.
 *
 *   `skipped` is specific to this module and distinct from `cancelled`: an asset
 *   sold or idled mid-cycle needs its open job retired WITHOUT implying anyone
 *   decided against the service. fms_asset_retire_asset skips en masse.
 */
export type JobStatus =
  | "awaiting_schedule"
  | "awaiting_service"
  | "awaiting_verification"
  | "closed"
  | "on_hold"
  | "cancelled"
  | "skipped";

export type RaisedSource = "auto" | "manual" | "usage";

export type VerifyOutcome = "satisfactory" | "rework_needed";

export interface ServiceJob {
  id: string;
  /** ASM-2627-0001 — FY-scoped, like every other FMS document. */
  jobNo: string;
  assetId: string;
  scheduleId: string;
  scheduleTypeId: string | null;
  /**
   * What the track said was due when the job was opened. NOT recomputed later:
   * it is the yardstick the reminder ladder and "was it late?" measure against.
   */
  dueDate: string | null;

  status: JobStatus;
  currentStep: string | null;
  holdFromStatus: string | null;

  raisedSource: RaisedSource;
  raisedBy: string | null;

  /* step 2 — schedule */
  scActualDate: string | null;
  scPlannedDate: string | null;
  scVendorId: string | null;
  scRemarks: string | null;
  scAt: string | null;
  scBy: string | null;

  /* step 3 — service done */
  sdActualDate: string | null;
  sdVendorId: string | null;
  sdCost: number | null;
  sdCostHeadId: string | null;
  sdBillNo: string | null;
  sdBillPath: string | null;
  sdBillName: string | null;
  sdMeterReading: number | null;
  sdRemarks: string | null;
  sdAt: string | null;
  sdBy: string | null;

  /* step 4 — verify & close */
  vcActualDate: string | null;
  vcOutcome: VerifyOutcome | null;
  /** Renewal tracks: the expiry on the RENEWED document. Required to close one. */
  vcNewDueDate: string | null;
  vcNewRefNo: string | null;
  vcNewAmount: number | null;
  vcRemarks: string | null;
  vcAt: string | null;
  vcBy: string | null;

  /* exits */
  holdReason: string | null;
  heldAt: string | null;
  heldBy: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  skippedReason: string | null;
  closedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/*  Supporting                                                                 */
/* -------------------------------------------------------------------------- */

export interface StepOwner {
  id: string;
  stepKey: string;
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

/** Portal-wide lookups this module reads but does not own. */
export interface Designation {
  id: string;
  name: string;
}

export interface Department {
  id: string;
  name: string;
}

export interface ActivityEntry {
  id: string;
  entityType: string;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface AssetNotification {
  id: string;
  userId: string;
  type: string;
  entityType: string;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ReminderLogEntry {
  id: string;
  jobId: string;
  reminderOn: string;
  tier: string;
  createdAt: string;
}
