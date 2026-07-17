import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import type { Department, Profile } from "@/core/platform/types";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { fetchProcurementData, PROCUREMENT_QK, procurementQueryKey } from "./data/procFetch";
import type {
  Company,
  Category,
  ItemGroup,
  Item,
  Vendor,
  MasterManager,
  MasterRequest,
  MasterType,
  PoCancelRequest,
  Designation,
  StepOwner,
  ApprovalBand,
  PurchaseRequest,
  RequestItem,
  Quotation,
  PurchaseOrder,
  PoItem,
  Pi,
  PiItem,
  Grn,
  GrnItem,
  TallyBooking,
  Payment,
  Followup,
  Activity,
  ProcNotification,
  ProcEntityType,
} from "./types";
import { STEPS, type StepKey } from "./lib/steps";
import { masterTypeLabel } from "./lib/masterFields";
import {
  buildProcIndex,
  buildQueueEntries,
  dispatchDueForPo as dispatchDueForPoPure,
  isOpenPo,
  lineDueIso,
  lineInApproval,
  lineInPoDesk,
  lineInSourcing,
  poDueIso,
  completedShareEntries,
  completedPiEntries,
  completedAdvanceEntries,
  completedFollowupEntries,
  completedGrnEntries,
  completedTallyEntries,
  completedSourcingEntries,
  completedApprovalEntries,
  completedPoGenEntries,
  poShareLockReason,
  type ProcIndex,
  type ProcSnapshot,
  type QueueEntry,
  type StageEntry,
} from "./lib/queues";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import {
  insertCompany,
  updateCompany,
  insertCategory,
  updateCategory,
  insertItemGroup,
  updateItemGroup,
  insertItem,
  updateItem,
  insertVendor,
  updateVendor,
  setMasterManagers as setMasterManagersWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  setStepOwner as setStepOwnerWrite,
  insertApprovalBand,
  updateApprovalBand,
  deleteApprovalBand,
  setConfig as setConfigWrite,
  submitRequest as submitRequestWrite,
  saveSourcing as saveSourcingWrite,
  decideApproval as decideApprovalWrite,
  generatePo as generatePoWrite,
  cancelLine as cancelLineWrite,
  requestPoCancel as requestPoCancelWrite,
  cancelPo as cancelPoWrite,
  declinePoCancel as declinePoCancelWrite,
  sharePo as sharePoWrite,
  updateSharePo as updateSharePoWrite,
  updatePi as updatePiWrite,
  updatePayment as updatePaymentWrite,
  updateFollowup as updateFollowupWrite,
  updateGrn as updateGrnWrite,
  updateTally as updateTallyWrite,
  updateApproval as updateApprovalWrite,
  updatePoNo as updatePoNoWrite,
  addPi as addPiWrite,
  uploadPiDocument as uploadPiDocumentWrite,
  piDocumentUrl as piDocumentUrlWrite,
  uploadPoDocument as uploadPoDocumentWrite,
  poDocumentUrl as poDocumentUrlWrite,
  recordPayment as recordPaymentWrite,
  recordFollowup as recordFollowupWrite,
  recordGrn as recordGrnWrite,
  uploadGrnPhoto as uploadGrnPhotoWrite,
  grnPhotoUrl as grnPhotoUrlWrite,
  bookTally as bookTallyWrite,
  uploadTallyDocument as uploadTallyDocumentWrite,
  tallyDocumentUrl as tallyDocumentUrlWrite,
  announce as announceWrite,
  reassignLine as reassignLineWrite,
  markNotificationsRead as markNotificationsReadWrite,
  type ProcEntity,
  type CompanyInput,
  type CategoryInput,
  type ItemGroupInput,
  type ItemInput,
  type VendorInput,
  type StepOwnerInput,
  type ApprovalBandInput,
  type NewRequestLine,
  type QuotationInput,
  type ApprovalDecision,
  type PiItemInput,
  type GrnItemInput,
} from "./data/procWrites";

/** Prefix key for invalidation; the full key adds the real session user id. */
const QK = PROCUREMENT_QK;

interface ProcurementStoreValue {
  // masters
  companies: Company[];
  categories: Category[];
  itemGroups: ItemGroup[];
  items: Item[];
  vendors: Vendor[];
  activeCompanies: Company[];
  activeCategories: Category[];
  itemGroupsByCategory: (categoryId: string) => ItemGroup[];
  itemsByGroup: (itemGroupId: string) => Item[];
  categoryById: (id: string | null) => Category | undefined;
  itemGroupById: (id: string | null) => ItemGroup | undefined;
  itemById: (id: string | null) => Item | undefined;
  vendorById: (id: string | null) => Vendor | undefined;
  companyById: (id: string | null) => Company | undefined;

  // governance
  masterManagers: MasterManager[];
  masterRequests: MasterRequest[];
  pendingRequests: MasterRequest[];
  managerIdsFor: (masterType: MasterType) => string[];
  /** True when the current user may CRUD this master (admin or its manager). */
  canManage: (masterType: MasterType) => boolean;
  /** True when the user manages at least one master (sees Masters + Master Requests). */
  isAnyManager: boolean;
  /** Pending requests the current user may resolve (admin → all; manager → their types). */
  resolvableRequests: MasterRequest[];
  /** Requests I raised, newest first — the requester's worklist. */
  myMasterRequests: MasterRequest[];
  /** Who reviews a new request of this type: its managers, else the admins (who can always resolve). */
  masterReviewersFor: (masterType: MasterType) => string[];
  /** True when no manager is assigned to this master — its requests fall back to the admins. */
  isMasterUnassigned: (masterType: MasterType) => boolean;

  // config / setup
  designations: Designation[];
  activeDesignations: Designation[];
  stepOwners: StepOwner[];
  stepOwnerFor: (stepKey: string) => StepOwner | undefined;
  approvalBands: ApprovalBand[];
  /** Resolve the approver for an amount via the active matrix bands (null if none). */
  approverForAmount: (amount: number) => string | null;
  /** True when the current user is an approver in the matrix (or admin). */
  isApprover: boolean;
  processCoordinatorIds: string[];
  isProcessCoordinator: boolean;
  amountBasis: string;
  /** Per-step due-date rules (anchor step + working days), merged over the defaults. */
  stepSla: StepSlaMap;
  /** The due date for a request line sitting in `step` (never null). */
  dueIsoForLine: (line: RequestItem, step: StepKey) => string;
  /** The due date for a PO sitting in `step`. Null for `follow_up` with no promised dispatch, and for `inward`/`tally` before a GRN exists. */
  dueIsoForPo: (po: PurchaseOrder, step: StepKey) => string | null;
  /** True for admins — all Setup config is admin-managed. */
  canConfigure: boolean;

  // workflow data (Stages 1–4)
  requests: PurchaseRequest[];
  requestItems: RequestItem[];
  quotations: Quotation[];
  pos: PurchaseOrder[];
  poItems: PoItem[];
  requestById: (id: string | null) => PurchaseRequest | undefined;
  itemsForRequest: (requestId: string) => RequestItem[];
  lineById: (id: string | null) => RequestItem | undefined;
  quotationsForLine: (lineId: string) => Quotation[];
  poById: (id: string | null) => PurchaseOrder | undefined;
  poItemsForPo: (poId: string) => PoItem[];
  poItemForLine: (requestItemId: string) => PoItem | undefined;
  /** A short item label "Item · Group" for display. */
  itemLabel: (itemId: string) => string;
  /** O(1) lookups over the current snapshot, shared with `lib/queues.ts` predicates. */
  procIndex: ProcIndex;
  /**
   * Every open (step, entity) work-item, owner-agnostic — the same list the FMS
   * Control Center counts. Note `approvalQueue` below is the owner-scoped view.
   */
  queueEntries: QueueEntry[];
  /**
   * Every COMPLETED Share PO step, owner-agnostic — the "what was done here"
   * counterpart to the pending queue. Includes closed/cancelled POs (locked), so
   * a user's history never evaporates. Filter to `actorId === user.id` for "Mine".
   */
  completedShareEntries: StageEntry<PurchaseOrder>[];
  /** The same, for each remaining stage. Entries are the domain ROWS, not POs. */
  completedPiEntries: StageEntry<Pi>[];
  completedAdvanceEntries: StageEntry<Payment>[];
  completedFollowupEntries: StageEntry<Followup>[];
  completedGrnEntries: StageEntry<Grn>[];
  completedTallyEntries: StageEntry<TallyBooking>[];
  completedSourcingEntries: StageEntry<RequestItem>[];
  completedApprovalEntries: StageEntry<RequestItem>[];
  completedPoGenEntries: StageEntry<PurchaseOrder>[];
  /** Display name for an actor id, resolvable org-wide (not just your department). */
  personName: (id: string | null) => string;
  // role-scoped queues
  sourcingQueue: RequestItem[];
  approvalQueue: RequestItem[];
  poPool: RequestItem[];
  // PO lifecycle data (Stages 5–10)
  pis: Pi[];
  piItems: PiItem[];
  grns: Grn[];
  grnItems: GrnItem[];
  tallyBookings: TallyBooking[];
  payments: Payment[];
  followups: Followup[];
  pisForPo: (poId: string) => Pi[];
  piItemsForPi: (piId: string) => PiItem[];
  grnsForPo: (poId: string) => Grn[];
  /**
   * Goods receipts on this PO with no Tally invoice booked yet. Each GRN — partial
   * or full — is booked as its own invoice, so this drives the Tally step.
   */
  unbookedGrnsForPo: (poId: string) => Grn[];
  grnItemsForGrn: (grnId: string) => GrnItem[];
  tallyForPo: (poId: string) => TallyBooking[];
  paymentsForPo: (poId: string) => Payment[];
  paymentsForPi: (piId: string) => Payment[];
  /** Follow-up history for a PI, newest first. */
  followupsForPi: (piId: string) => Followup[];
  /** Follow-up history for a PO (PO-level records), newest first. */
  followupsForPo: (poId: string) => Followup[];
  /**
   * The dispatch date currently promised for a PO: the most recent revised date
   * from its follow-ups, else the PO's expected dispatch date (set at Share PO).
   */
  dispatchDueForPo: (poId: string) => string | null;
  /** Whether the PO's payment terms require an advance (full/partial advance). */
  needsAdvance: (po: PurchaseOrder) => boolean;
  pendingAmount: (po: PurchaseOrder) => number;
  /** Amount paid so far against a specific PI (advances + installments tagged to it). */
  paidForPi: (pi: Pi) => number;
  /** Outstanding on a specific PI = pi.piValue − paidForPi(pi). */
  pendingForPi: (pi: Pi) => number;

  // role flags
  isStepOwner: (stepKey: StepKey) => boolean;
  canSource: boolean;
  canGeneratePo: boolean;
  canApproveLine: (line: RequestItem) => boolean;
  canSharePo: boolean;
  canCollectPi: boolean;
  canRecordPayment: boolean;
  canAdvancePayment: boolean;
  canFollowup: boolean;
  canInward: boolean;
  canTally: boolean;

  // PO cancellation (vendor-requested, approver-only)
  poCancelRequests: PoCancelRequest[];
  /** The one open (pending) cancellation request for a PO, if any. */
  pendingCancelRequestForPo: (poId: string) => PoCancelRequest | undefined;
  /** Pending cancellation requests the current user (an approver/admin) may act on. */
  pendingPoCancelRequests: PoCancelRequest[];
  /** A PO-side owner (or admin) may LOG a vendor cancellation request while the PO is still cancellable and none is open. */
  canRequestPoCancel: (po: PurchaseOrder) => boolean;
  /** The PO's approver (a user stamped on its lines) or an admin may cancel it, while it has no GRN/Tally booking. */
  canCancelPo: (po: PurchaseOrder) => boolean;

  // workflow mutations
  submitRequest: (input: { companyId: string; categoryId: string; note: string | null; items: NewRequestLine[] }) => Promise<string>;
  saveSourcing: (input: {
    requestItemId: string;
    quotations: QuotationInput[];
    recommendedVendorId: string;
    finalQty: number;
    finalRate: number;
    gstPct: number | null;
    sourcingReason: string | null;
  }) => Promise<void>;
  decideApproval: (input: { requestItemId: string; decision: ApprovalDecision; overrideVendorId?: string | null; reason?: string | null }) => Promise<void>;
  generatePo: (input: { vendorId: string; companyId: string; requestItemIds: string[]; poNo?: string | null }) => Promise<string>;
  cancelLine: (requestItemId: string, reason: string) => Promise<void>;
  /** A PO-side owner logs the vendor's request to cancel a PO. Returns the request id. */
  requestPoCancel: (poId: string, reason: string, vendorRef?: string | null) => Promise<string>;
  /** Approver-only — cancel a PO (optionally resolving the logged request). */
  cancelPo: (poId: string, reason: string, requestId?: string | null) => Promise<void>;
  /** Approver-only — decline a cancellation request; the PO stays open. */
  declinePoCancel: (requestId: string, note?: string | null) => Promise<void>;

  // PO lifecycle mutations
  sharePo: (poId: string, input?: { path: string | null; name: string | null; tallyPoNo: string | null; remarks: string | null; paymentTerms: string | null; dispatchDate: string | null }) => Promise<void>;
  /**
   * Stage edits. Each is refused server-side once the next step is done — these
   * wrappers only carry the payload; the RPC is the gate.
   */
  updateSharePo: (input: { poId: string; tallyPoNo: string; paymentTerms: string; dispatchDate: string; remarks?: string | null; documentPath?: string | null; documentName?: string | null }) => Promise<void>;
  updatePi: (input: { piId: string; vendorPiNo: string; items: { poItemId: string; qty: number }[]; piValue: number; paymentTerms?: string | null; dispatchDate?: string | null; documentPath?: string | null; documentName?: string | null }) => Promise<void>;
  updatePayment: (input: { paymentId: string; amount: number; paidOn?: string | null; utrRef?: string | null; piRemarks?: string | null }) => Promise<void>;
  updateFollowup: (input: { followupId: string; dispatchStatus: string; actualDispatchDate?: string | null; lrNo?: string | null; transportDetails?: string | null; revisedDispatchDate?: string | null; remarks?: string | null; piRemarks?: string | null }) => Promise<void>;
  updateGrn: (input: { grnId: string; items: { poItemId: string; receivedQty: number; condition?: string }[]; poRef: string; piRef?: string | null; gateRegisterNo?: string | null; condition?: string | null; note?: string | null; photoPath?: string | null; photoName?: string | null }) => Promise<void>;
  updateTally: (input: { bookingId: string; tallyPiNo: string; documentPath?: string | null; documentName?: string | null; remarks?: string | null }) => Promise<void>;
  updateApproval: (input: { lineId: string; decision: string; overrideVendorId?: string | null; reason?: string | null }) => Promise<void>;
  updatePoNo: (poId: string, poNo: string) => Promise<void>;
  /** True while the Share PO entry may still be corrected. Mirrors the server rule. */
  canEditSharePo: (po: PurchaseOrder) => boolean;
  addPi: (input: { poId: string; vendorPiNo: string; piValue: number; items: PiItemInput[]; documentPath?: string | null; documentName?: string | null }) => Promise<string>;
  uploadPiDocument: (poId: string, file: File) => Promise<{ path: string; name: string }>;
  piDocumentUrl: (path: string) => Promise<string>;
  uploadPoDocument: (poId: string, file: File) => Promise<{ path: string; name: string }>;
  poDocumentUrl: (path: string) => Promise<string>;
  recordPayment: (input: { poId: string; piId: string | null; kind: "advance" | "installment"; amount: number; paidOn: string | null; utrRef: string | null; piRemarks?: string | null }) => Promise<string>;
  recordFollowup: (input: { poId: string; dispatchStatus: string; actualDispatchDate: string | null; lrNo: string | null; transportDetails: string | null; revisedDispatchDate: string | null; remarks: string | null; piRemarks?: string | null }) => Promise<void>;
  recordGrn: (input: { poId: string; piId: string | null; poRef?: string | null; piRef?: string | null; gateRegisterNo: string | null; condition: string; note: string | null; items: GrnItemInput[]; photoPath?: string | null; photoName?: string | null }) => Promise<string>;
  uploadGrnPhoto: (poId: string, file: File) => Promise<{ path: string; name: string }>;
  grnPhotoUrl: (path: string) => Promise<string>;
  bookTally: (input: { poId: string; grnId: string | null; tallyPiNo: string; documentPath?: string | null; documentName?: string | null; remarks?: string | null }) => Promise<string>;
  uploadTallyDocument: (poId: string, file: File) => Promise<{ path: string; name: string }>;
  tallyDocumentUrl: (path: string) => Promise<string>;

  // activity + notifications (Phase 5)
  activity: Activity[];
  notifications: ProcNotification[];
  /** Current user's notifications, newest first. */
  myNotifications: ProcNotification[];
  unreadCount: number;
  /** Activity rows for one entity, newest first. */
  activityFor: (entityType: ProcEntityType, entityId: string) => Activity[];
  markNotificationsRead: (ids: string[]) => Promise<void>;
  /** Send a reminder to the given recipients about a waiting entity. */
  nudge: (input: { entityType: ProcEntity; entityId: string; recipients: string[]; label: string }) => Promise<void>;
  /** Escalate a stuck entity to the process coordinators. */
  escalate: (input: { entityType: ProcEntity; entityId: string; label: string }) => Promise<void>;
  /** Reassign an approval line to a specific approver (coordinator/admin). */
  reassignLine: (input: { requestItemId: string; approverId: string; note: string | null }) => Promise<void>;

  // directory
  profiles: Profile[];
  departments: Department[];
  profileById: (id: string | null) => Profile | undefined;
  departmentById: (id: string | null) => Department | undefined;

  // mutations — masters
  createCompany: (input: CompanyInput) => Promise<string>;
  editCompany: (id: string, input: CompanyInput) => Promise<void>;
  createCategory: (input: CategoryInput) => Promise<string>;
  editCategory: (id: string, input: CategoryInput) => Promise<void>;
  createItemGroup: (input: ItemGroupInput) => Promise<string>;
  editItemGroup: (id: string, input: ItemGroupInput) => Promise<void>;
  createItem: (input: ItemInput) => Promise<string>;
  editItem: (id: string, input: ItemInput) => Promise<void>;
  createVendor: (input: VendorInput) => Promise<string>;
  editVendor: (id: string, input: VendorInput) => Promise<void>;

  // mutations — governance
  setMasterManagers: (masterType: MasterType, userIds: string[]) => Promise<void>;
  requestNewMaster: (masterType: MasterType, payload: Record<string, unknown>) => Promise<string>;
  resolveMasterRequest: (
    requestId: string,
    approve: boolean,
    payload: Record<string, unknown> | null,
    note: string | null
  ) => Promise<string | null>;

  // mutations — config
  setStepOwner: (stepKey: string, input: StepOwnerInput) => Promise<void>;
  createApprovalBand: (input: ApprovalBandInput) => Promise<string>;
  editApprovalBand: (id: string, input: ApprovalBandInput) => Promise<void>;
  removeApprovalBand: (id: string) => Promise<void>;
  setProcessCoordinators: (userIds: string[]) => Promise<void>;
  /** Persist the whole per-step due-date map (admin only, enforced by RLS). */
  setStepSla: (map: StepSlaMap) => Promise<void>;
}

const Ctx = createContext<ProcurementStoreValue | null>(null);

export function ProcurementStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  // Effective identity: the real signed-in user, or the impersonated persona in
  // demo mode. Every capability flag / queue / notification feed below derives
  // from this, so switching persona re-scopes the whole app. Data fetch stays
  // keyed on the REAL session id (admin RLS returns all rows) so switching
  // persona never triggers a refetch.
  const { user, isAdmin } = useEffectiveIdentity();
  const dir = useDirectory();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: procurementQueryKey(session.user?.id ?? null),
    queryFn: fetchProcurementData,
    enabled: !!session.user,
  });

  // Org-wide names so a colleague's completed entry never renders blank: the
  // normal directory is RLS-scoped (self + downline + same department), so a GRN
  // booked by warehouse and viewed by accounts would not resolve.
  // list_org_people() is the SECURITY DEFINER, name-only escape hatch — the same
  // pattern the receivables follow-ups screen uses.
  const { data: orgPeople } = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 5 * 60 * 1000 });

  const companies = data?.companies ?? [];
  const categories = data?.categories ?? [];
  const itemGroups = data?.itemGroups ?? [];
  const items = data?.items ?? [];
  const vendors = data?.vendors ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const poCancelRequests = data?.poCancelRequests ?? [];
  const designations = data?.designations ?? [];
  const stepOwners = data?.stepOwners ?? [];
  const approvalBands = data?.approvalBands ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const amountBasis = data?.config.amountBasis ?? "line_incl_gst";
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const requests = data?.requests ?? [];
  const requestItems = data?.requestItems ?? [];
  const quotations = data?.quotations ?? [];
  const pos = data?.pos ?? [];
  const poItems = data?.poItems ?? [];
  const pis = data?.pis ?? [];
  const piItems = data?.piItems ?? [];
  const grns = data?.grns ?? [];
  const grnItems = data?.grnItems ?? [];
  const tallyBookings = data?.tallyBookings ?? [];
  const payments = data?.payments ?? [];
  const followups = data?.followups ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];

  const value = useMemo<ProcurementStoreValue>(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    // Queue membership + due dates live in lib/queues.ts so the per-step queue
    // pages and the FMS Control Center count the identical work-items.
    // `config` rides along so the pure due-date rules can read the admin's per-step SLA.
    const snapshot: ProcSnapshot = {
      requests, requestItems, pos, poItems, pis, piItems, grns, grnItems, tallyBookings, payments, followups, activity,
      config: { processCoordinatorIds, amountBasis, stepSla },
    };
    const procIndex = buildProcIndex(snapshot);
    const byName = <T extends { name: string; sortOrder: number }>(a: T, b: T) =>
      a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

    const managerIdsFor = (masterType: MasterType) =>
      masterManagers.filter((m) => m.masterType === masterType).map((m) => m.managerUserId);

    const canManage = (masterType: MasterType) =>
      isAdmin || managerIdsFor(masterType).includes(user.id);

    const isAnyManager = isAdmin || masterManagers.some((m) => m.managerUserId === user.id);

    const resolvableRequests = masterRequests
      .filter((r) => r.status === "pending")
      .filter((r) => canManage(r.masterType));

    // A master with no assigned manager still has to go somewhere: admins can
    // always resolve, so they are the implicit reviewers. Nothing black-holes.
    const adminIds = () => dir.profiles.filter((p) => p.role === "admin").map((p) => p.id);
    const masterReviewersFor = (masterType: MasterType): string[] => {
      const ids = managerIdsFor(masterType);
      return ids.length ? ids : adminIds();
    };
    const isMasterUnassigned = (masterType: MasterType) => managerIdsFor(masterType).length === 0;

    const approverForAmount = (amount: number): string | null => {
      const band = [...approvalBands]
        .filter((b) => b.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.minAmount - b.minAmount)
        .find((b) => amount >= b.minAmount && (b.maxAmount === null || amount <= b.maxAmount));
      return band?.approverUserId ?? null;
    };

    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(user.id));

    // Resolves against the org-wide list, not `dir.profileById`: the directory is
    // RLS-scoped, so a cross-department colleague would render blank. Null actors
    // are real — every actor FK is `on delete set null`, and rows created before
    // their actor column existed were deliberately never backfilled.
    const personName = (id: string | null): string => {
      if (!id) return "—";
      if (id === user.id) return user.name;
      return (orgPeople ?? []).find((p) => p.id === id)?.name ?? "Unknown user";
    };

    const canApproveLine = (line: RequestItem): boolean =>
      isAdmin || (line.lineValue !== null && approverForAmount(line.lineValue) === user.id);

    // ---- PO cancellation helpers (approver-only, vendor-requested) ----
    const poScopeStepKeys = STEPS.filter((s) => s.scope === "po").map((s) => s.key);
    // The approver(s) of a PO = the distinct users stamped as approver_id on the
    // PO's request lines. Approval routes per-line, so total_value is NOT a basis.
    const poApproverIds = (po: PurchaseOrder): string[] => {
      const ids = new Set<string>();
      for (const poi of poItems) {
        if (poi.poId !== po.id) continue;
        const line = requestItems.find((l) => l.id === poi.requestItemId);
        if (line?.approverId) ids.add(line.approverId);
      }
      return [...ids];
    };
    const poCancellable = (po: PurchaseOrder): boolean =>
      isOpenPo(po) && !grns.some((g) => g.poId === po.id) && !tallyBookings.some((t) => t.poId === po.id);
    const pendingCancelRequestForPo = (poId: string): PoCancelRequest | undefined =>
      poCancelRequests.find((r) => r.poId === poId && r.status === "pending");
    const isPoApprover = (po: PurchaseOrder): boolean => isAdmin || poApproverIds(po).includes(user.id);

    const itemsByGroupId = new Map<string, RequestItem[]>();
    for (const ri of requestItems) {
      const list = itemsByGroupId.get(ri.requestId) ?? [];
      list.push(ri);
      itemsByGroupId.set(ri.requestId, list);
    }
    const poItemByLine = new Map(poItems.map((pi) => [pi.requestItemId, pi]));

    const itemLabel = (itemId: string): string => {
      const it = items.find((i) => i.id === itemId);
      if (!it) return "Unknown item";
      const g = itemGroups.find((gr) => gr.id === it.itemGroupId);
      return g ? `${it.name} · ${g.name}` : it.name;
    };

    // --- notification fan-out helpers ---
    const ownerIdsOf = (stepKey: StepKey): string[] =>
      stepOwners.find((o) => o.stepKey === stepKey)?.employeeIds ?? [];
    const requesterOfLine = (lineId: string): string[] => {
      const line = requestItems.find((l) => l.id === lineId);
      const req = line ? requests.find((r) => r.id === line.requestId) : undefined;
      return req?.requesterId ? [req.requesterId] : [];
    };
    /** Fan out a transition notification; never let it break the workflow action. */
    const safeAnnounce = async (input: {
      entityType: ProcEntity;
      entityId: string;
      type: string;
      text: string;
      recipients?: string[];
      meta?: Record<string, unknown>;
    }) => {
      try {
        await announceWrite(input);
      } catch (e) {
        // Best-effort: the state change already committed via its own RPC.
        console.warn("[procurement] announce failed", e);
      }
    };

    return {
      companies,
      categories,
      itemGroups,
      items,
      vendors,
      activeCompanies: companies.filter((c) => c.active).sort(byName),
      activeCategories: categories.filter((c) => c.active).sort(byName),
      itemGroupsByCategory: (categoryId) =>
        itemGroups.filter((g) => g.categoryId === categoryId).sort(byName),
      itemsByGroup: (itemGroupId) => items.filter((i) => i.itemGroupId === itemGroupId).sort(byName),
      categoryById: (id) => (id ? categories.find((c) => c.id === id) : undefined),
      itemGroupById: (id) => (id ? itemGroups.find((g) => g.id === id) : undefined),
      itemById: (id) => (id ? items.find((i) => i.id === id) : undefined),
      vendorById: (id) => (id ? vendors.find((v) => v.id === id) : undefined),
      companyById: (id) => (id ? companies.find((c) => c.id === id) : undefined),

      masterManagers,
      masterRequests,
      pendingRequests: masterRequests.filter((r) => r.status === "pending"),
      managerIdsFor,
      canManage,
      isAnyManager,
      resolvableRequests,
      myMasterRequests: masterRequests
        .filter((r) => r.requestedBy === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      masterReviewersFor,
      isMasterUnassigned,

      // ---- config / setup ----
      designations,
      activeDesignations: designations.filter((d) => d.active).sort((a, b) => a.name.localeCompare(b.name)),
      stepOwners,
      stepOwnerFor: (stepKey) => stepOwners.find((o) => o.stepKey === stepKey),
      approvalBands,
      approverForAmount,
      isApprover: isAdmin || approvalBands.some((b) => b.approverUserId === user.id),
      processCoordinatorIds,
      isProcessCoordinator: isAdmin || processCoordinatorIds.includes(user.id),
      amountBasis,
      canConfigure: isAdmin,

      // ---- workflow data + selectors (Stages 1–4) ----
      requests,
      requestItems,
      quotations,
      pos,
      poItems,
      requestById: (id) => (id ? requests.find((r) => r.id === id) : undefined),
      itemsForRequest: (requestId) =>
        (itemsByGroupId.get(requestId) ?? []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      lineById: (id) => (id ? requestItems.find((l) => l.id === id) : undefined),
      quotationsForLine: (lineId) => quotations.filter((q) => q.requestItemId === lineId),
      poById: (id) => (id ? pos.find((p) => p.id === id) : undefined),
      poItemsForPo: (poId) => poItems.filter((pi) => pi.poId === poId),
      poItemForLine: (requestItemId) => poItemByLine.get(requestItemId),
      itemLabel,
      procIndex,
      queueEntries: buildQueueEntries(snapshot, procIndex),
      completedShareEntries: completedShareEntries(snapshot, procIndex),
      completedPiEntries: completedPiEntries(snapshot, procIndex),
      completedAdvanceEntries: completedAdvanceEntries(snapshot, procIndex),
      completedFollowupEntries: completedFollowupEntries(snapshot, procIndex),
      completedGrnEntries: completedGrnEntries(snapshot, procIndex),
      completedTallyEntries: completedTallyEntries(snapshot),
      completedSourcingEntries: completedSourcingEntries(snapshot, procIndex),
      completedApprovalEntries: completedApprovalEntries(snapshot, procIndex),
      completedPoGenEntries: completedPoGenEntries(snapshot),
      personName,
      sourcingQueue: requestItems.filter(lineInSourcing),
      // The ONE owner-scoped queue: an approver sees only the lines they may act
      // on. The unfiltered predicate stays in lib/queues.ts for the Control Center.
      approvalQueue: requestItems.filter((l) => lineInApproval(l) && canApproveLine(l)),
      poPool: requestItems.filter(lineInPoDesk),
      isStepOwner,
      canSource: isStepOwner("sourcing"),
      canGeneratePo: isStepOwner("po"),
      canApproveLine,

      // ---- PO lifecycle data + selectors ----
      pis,
      piItems,
      grns,
      grnItems,
      tallyBookings,
      payments,
      followups,
      followupsForPi: (piId) => followups.filter((f) => f.piId === piId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      followupsForPo: (poId) => followups.filter((f) => f.poId === poId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      dispatchDueForPo: (poId) => dispatchDueForPoPure(procIndex, snapshot, poId),
      stepSla,
      dueIsoForLine: (line, step) => lineDueIso(snapshot, line, step),
      dueIsoForPo: (po, step) => poDueIso(procIndex, snapshot, po, step),
      pisForPo: (poId) => pis.filter((p) => p.poId === poId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      piItemsForPi: (piId) => piItems.filter((x) => x.piId === piId),
      grnsForPo: (poId) => grns.filter((g) => g.poId === poId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      unbookedGrnsForPo: (poId) =>
        grns
          .filter((g) => g.poId === poId && !tallyBookings.some((t) => t.grnId === g.id))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      grnItemsForGrn: (grnId) => grnItems.filter((x) => x.grnId === grnId),
      tallyForPo: (poId) => tallyBookings.filter((t) => t.poId === poId),
      paymentsForPo: (poId) => payments.filter((p) => p.poId === poId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      paymentsForPi: (piId) => payments.filter((p) => p.piId === piId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      needsAdvance: (po) => po.paymentTerms === "full_advance" || po.paymentTerms === "partial_advance",
      pendingAmount: (po) => Math.max(0, po.totalValue - payments.filter((p) => p.poId === po.id).reduce((a, p) => a + p.amount, 0)),
      paidForPi: (pi) => payments.filter((p) => p.piId === pi.id).reduce((a, p) => a + p.amount, 0),
      pendingForPi: (pi) => Math.max(0, pi.piValue - payments.filter((p) => p.piId === pi.id).reduce((a, p) => a + p.amount, 0)),
      canSharePo: isStepOwner("share_po"),
      canCollectPi: isStepOwner("collect_pi"),
      canRecordPayment: isStepOwner("advance_payment"),
      canAdvancePayment: isStepOwner("advance_payment"),
      canFollowup: isStepOwner("follow_up"),
      canInward: isStepOwner("inward"),
      canTally: isStepOwner("tally"),

      // ---- PO cancellation (vendor-requested, approver-only) ----
      poCancelRequests,
      pendingCancelRequestForPo,
      pendingPoCancelRequests: poCancelRequests.filter((r) => {
        if (r.status !== "pending") return false;
        const po = pos.find((p) => p.id === r.poId);
        return !!po && isPoApprover(po);
      }),
      canRequestPoCancel: (po) =>
        (isAdmin || poScopeStepKeys.some((k) => isStepOwner(k))) &&
        poCancellable(po) &&
        !pendingCancelRequestForPo(po.id),
      canCancelPo: (po) => isPoApprover(po) && poCancellable(po),

      // ---- workflow mutations ----
      submitRequest: async (input) => {
        const id = await submitRequestWrite(input);
        await safeAnnounce({
          entityType: "request",
          entityId: id,
          type: "submitted",
          text: "New purchase request raised — awaiting sourcing",
          recipients: ownerIdsOf("sourcing"),
        });
        await invalidate();
        return id;
      },
      saveSourcing: async (input) => {
        await saveSourcingWrite(input);
        const lineValue = Math.round(input.finalQty * input.finalRate * (1 + (input.gstPct ?? 0) / 100) * 100) / 100;
        const approver = approverForAmount(lineValue);
        await safeAnnounce({
          entityType: "line",
          entityId: input.requestItemId,
          type: "sourced",
          text: "A sourced line needs your approval",
          recipients: approver ? [approver] : [],
        });
        await invalidate();
      },
      decideApproval: async (input) => {
        await decideApprovalWrite(input);
        if (input.decision === "approve" || input.decision === "override") {
          await safeAnnounce({
            entityType: "line",
            entityId: input.requestItemId,
            type: "approved",
            text:
              input.decision === "override"
                ? `An approved line (vendor overridden) is ready for PO generation${input.reason ? ` — ${input.reason}` : ""}`
                : "An approved line is ready for PO generation",
            recipients: ownerIdsOf("po"),
          });
        } else if (input.decision === "reject") {
          await safeAnnounce({
            entityType: "line",
            entityId: input.requestItemId,
            type: "rejected",
            text: `A requested line was rejected${input.reason ? ` — ${input.reason}` : ""}`,
            recipients: requesterOfLine(input.requestItemId),
          });
        } else if (input.decision === "hold") {
          await safeAnnounce({
            entityType: "line",
            entityId: input.requestItemId,
            type: "on_hold",
            text: `A requested line was put on hold${input.reason ? ` — ${input.reason}` : ""}`,
            recipients: requesterOfLine(input.requestItemId),
          });
        }
        await invalidate();
      },
      generatePo: async (input) => {
        const id = await generatePoWrite(input);
        await safeAnnounce({
          entityType: "po",
          entityId: id,
          type: "po_generated",
          text: "A new PO is ready to share with the vendor",
          recipients: ownerIdsOf("share_po"),
        });
        await invalidate();
        return id;
      },
      cancelLine: async (requestItemId, reason) => {
        await cancelLineWrite(requestItemId, reason);
        await safeAnnounce({
          entityType: "line",
          entityId: requestItemId,
          type: "cancelled",
          text: `A requested line was cancelled${reason ? ` — ${reason}` : ""}`,
          recipients: requesterOfLine(requestItemId),
        });
        await invalidate();
      },

      // ---- PO cancellation mutations ----
      requestPoCancel: async (poId, reason, vendorRef) => {
        const id = await requestPoCancelWrite(poId, reason, vendorRef ?? null);
        const po = pos.find((p) => p.id === poId);
        await safeAnnounce({
          entityType: "po",
          entityId: poId,
          type: "cancel_requested",
          text: `Vendor cancellation requested for this PO — ${reason}`,
          recipients: po ? poApproverIds(po) : [],
        });
        await invalidate();
        return id;
      },
      cancelPo: async (poId, reason, requestId) => {
        await cancelPoWrite(poId, reason, requestId ?? null);
        const req = requestId ? poCancelRequests.find((r) => r.id === requestId) : undefined;
        await safeAnnounce({
          entityType: "po",
          entityId: poId,
          type: "po_cancelled",
          text: `PO cancelled — ${reason}`,
          recipients: [
            ...(req?.requestedBy ? [req.requestedBy] : []),
            ...ownerIdsOf("share_po"),
          ],
        });
        await invalidate();
      },
      declinePoCancel: async (requestId, note) => {
        const req = poCancelRequests.find((r) => r.id === requestId);
        await declinePoCancelWrite(requestId, note ?? null);
        await safeAnnounce({
          entityType: "po",
          entityId: req?.poId ?? "",
          type: "cancel_declined",
          text: `Cancellation request declined${note ? ` — ${note}` : ""}`,
          recipients: req?.requestedBy ? [req.requestedBy] : [],
        });
        await invalidate();
      },

      // ---- PO lifecycle mutations ----
      sharePo: async (poId, input) => {
        await sharePoWrite(poId, input?.path ?? null, input?.name ?? null, input?.tallyPoNo ?? null, input?.remarks ?? null, input?.paymentTerms ?? null, input?.dispatchDate ?? null);
        await safeAnnounce({
          entityType: "po",
          entityId: poId,
          type: "po_shared",
          text: "PO shared with the vendor — collect the PI(s)",
          recipients: ownerIdsOf("collect_pi"),
        });
        await invalidate();
      },
      // The edit counterpart. No announce() call here: unlike every other write
      // in this store, update_share_po logs its own activity row inside the same
      // transaction — an edit's audit trail must not be able to go missing the
      // way safeAnnounce's best-effort one can.
      updateSharePo: async (input) => {
        await updateSharePoWrite(input);
        await invalidate();
      },
      updatePi: async (input) => { await updatePiWrite(input); await invalidate(); },
      updatePayment: async (input) => { await updatePaymentWrite(input); await invalidate(); },
      updateFollowup: async (input) => { await updateFollowupWrite(input); await invalidate(); },
      updateGrn: async (input) => { await updateGrnWrite(input); await invalidate(); },
      updateTally: async (input) => { await updateTallyWrite(input); await invalidate(); },
      updateApproval: async (input) => { await updateApprovalWrite(input); await invalidate(); },
      updatePoNo: async (poId, poNo) => { await updatePoNoWrite(poId, poNo); await invalidate(); },
      canEditSharePo: (po) => isStepOwner("share_po") && poShareLockReason(procIndex, po) === null,
      addPi: async (input) => {
        const id = await addPiWrite(input);
        await safeAnnounce({
          entityType: "po",
          entityId: input.poId,
          type: "pi_added",
          text: "A PI was added — advance payment may be due",
          recipients: ownerIdsOf("advance_payment"),
        });
        await invalidate();
        return id;
      },
      uploadPiDocument: (poId, file) => uploadPiDocumentWrite(poId, file),
      piDocumentUrl: (path) => piDocumentUrlWrite(path),
      uploadGrnPhoto: (poId, file) => uploadGrnPhotoWrite(poId, file),
      grnPhotoUrl: (path) => grnPhotoUrlWrite(path),
      uploadPoDocument: (poId, file) => uploadPoDocumentWrite(poId, file),
      poDocumentUrl: (path) => poDocumentUrlWrite(path),
      recordPayment: async (input) => {
        const id = await recordPaymentWrite(input);
        await safeAnnounce({
          entityType: "po",
          entityId: input.poId,
          type: input.kind === "advance" ? "advance_paid" : "installment_paid",
          text:
            input.kind === "advance"
              ? "Advance paid — follow up on dispatch"
              : "An installment payment was recorded",
          recipients: input.kind === "advance" ? ownerIdsOf("follow_up") : [],
        });
        await invalidate();
        return id;
      },
      recordFollowup: async (input) => {
        await recordFollowupWrite(input);
        if (input.dispatchStatus === "dispatched") {
          await safeAnnounce({
            entityType: "po",
            entityId: input.poId,
            type: "dispatched",
            text: "Goods dispatched — expect inward (GRN)",
            recipients: ownerIdsOf("inward"),
          });
        }
        await invalidate();
      },
      recordGrn: async (input) => {
        const id = await recordGrnWrite(input);
        await safeAnnounce({
          entityType: "po",
          entityId: input.poId,
          type: "grn_recorded",
          text: "Goods received (GRN) — book the entry in Tally",
          recipients: ownerIdsOf("tally"),
        });
        await invalidate();
        return id;
      },
      // Tally is the last step — booking the invoice ends the flow, so there is
      // no downstream owner to notify.
      bookTally: async (input) => {
        const id = await bookTallyWrite(input);
        await invalidate();
        return id;
      },
      uploadTallyDocument: (poId, file) => uploadTallyDocumentWrite(poId, file),
      tallyDocumentUrl: (path) => tallyDocumentUrlWrite(path),

      // ---- activity + notifications (Phase 5) ----
      activity,
      notifications,
      myNotifications: notifications
        .filter((n) => n.userId === user.id)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      unreadCount: notifications.filter((n) => n.userId === user.id && !n.readAt).length,
      activityFor: (entityType, entityId) =>
        activity
          .filter((a) => a.entityType === entityType && a.entityId === entityId)
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        await invalidate();
      },
      nudge: async ({ entityType, entityId, recipients, label }) => {
        await safeAnnounce({
          entityType,
          entityId,
          type: "nudge",
          text: `Reminder: ${label} is waiting on you`,
          recipients,
        });
        await invalidate();
      },
      escalate: async ({ entityType, entityId, label }) => {
        await safeAnnounce({
          entityType,
          entityId,
          type: "escalate",
          text: `Escalated: ${label} is stuck and needs attention`,
          recipients: processCoordinatorIds,
        });
        await invalidate();
      },
      reassignLine: async (input) => {
        await reassignLineWrite(input);
        await invalidate();
      },

      profiles: dir.profiles,
      departments: dir.departments,
      profileById: dir.profileById,
      departmentById: dir.departmentById,

      // ---- master mutations ----
      createCompany: async (input) => {
        const id = await insertCompany({ ...input, createdBy: user.id });
        await invalidate();
        return id;
      },
      editCompany: async (id, input) => {
        await updateCompany(id, input);
        await invalidate();
      },
      createCategory: async (input) => {
        const id = await insertCategory({ ...input, createdBy: user.id });
        await invalidate();
        return id;
      },
      editCategory: async (id, input) => {
        await updateCategory(id, input);
        await invalidate();
      },
      createItemGroup: async (input) => {
        const id = await insertItemGroup({ ...input, createdBy: user.id });
        await invalidate();
        return id;
      },
      editItemGroup: async (id, input) => {
        await updateItemGroup(id, input);
        await invalidate();
      },
      createItem: async (input) => {
        const id = await insertItem({ ...input, createdBy: user.id });
        await invalidate();
        return id;
      },
      editItem: async (id, input) => {
        await updateItem(id, input);
        await invalidate();
      },
      createVendor: async (input) => {
        const id = await insertVendor({ ...input, createdBy: user.id });
        await invalidate();
        return id;
      },
      editVendor: async (id, input) => {
        await updateVendor(id, input);
        await invalidate();
      },

      // ---- governance mutations ----
      setMasterManagers: async (masterType, userIds) => {
        await setMasterManagersWrite(masterType, userIds);
        await invalidate();
      },
      requestNewMaster: async (masterType, payload) => {
        // requested_by MUST equal auth.uid() — the insert policy checks it. In demo
        // mode the effective identity is a persona but the JWT is still the real
        // signed-in user's, so stamp the REAL session id or RLS rejects the insert.
        const requesterId = session.user?.id ?? user.id;
        const id = await requestNewMasterWrite(masterType, payload, requesterId);
        const name = String(payload.name ?? "entry");
        await safeAnnounce({
          entityType: "master_request",
          entityId: id,
          type: "master_requested",
          text: `requested a new ${masterTypeLabel(masterType)} — “${name}”. Review it.`,
          recipients: masterReviewersFor(masterType),
          meta: { masterType },
        });
        await invalidate();
        return id;
      },
      resolveMasterRequest: async (requestId, approve, payload, note) => {
        const req = masterRequests.find((r) => r.id === requestId);
        const newId = await resolveMasterRequestWrite(requestId, approve, payload, note);
        // The reviewer's edits win server-side, so report the name they actually saved.
        const finalPayload = payload ?? req?.proposedPayload ?? {};
        const name = String(finalPayload.name ?? "entry");
        const label = req ? masterTypeLabel(req.masterType) : "entry";
        await safeAnnounce({
          entityType: "master_request",
          entityId: requestId,
          type: approve ? "master_approved" : "master_rejected",
          text: approve
            ? `approved your ${label} request — “${name}” is now selectable.`
            : `rejected your ${label} request — “${name}”${note ? `: ${note}` : "."}`,
          recipients: req?.requestedBy ? [req.requestedBy] : [],
          meta: { masterType: req?.masterType, resolvedMasterId: newId },
        });
        await invalidate();
        return newId;
      },

      // ---- config mutations ----
      setStepOwner: async (stepKey, input) => {
        await setStepOwnerWrite(stepKey, input);
        await invalidate();
      },
      createApprovalBand: async (input) => {
        const id = await insertApprovalBand(input);
        await invalidate();
        return id;
      },
      editApprovalBand: async (id, input) => {
        await updateApprovalBand(id, input);
        await invalidate();
      },
      removeApprovalBand: async (id) => {
        await deleteApprovalBand(id);
        await invalidate();
      },
      setProcessCoordinators: async (userIds) => {
        await setConfigWrite("process_coordinators", { user_ids: userIds });
        await invalidate();
      },
      setStepSla: async (map) => {
        await setConfigWrite("step_sla", map as unknown as Record<string, unknown>);
        await invalidate();
      },
    };
  }, [
    companies,
    categories,
    itemGroups,
    items,
    vendors,
    masterManagers,
    masterRequests,
    poCancelRequests,
    designations,
    stepOwners,
    approvalBands,
    processCoordinatorIds,
    amountBasis,
    requests,
    requestItems,
    quotations,
    pos,
    poItems,
    pis,
    piItems,
    grns,
    grnItems,
    tallyBookings,
    payments,
    followups,
    activity,
    notifications,
    dir,
    // `personName` closes over this: without it the memo would not recompute when
    // the org-wide people query resolves, and every actor would read "Unknown user".
    orgPeople,
    user,
    session,
    isAdmin,
    queryClient,
  ]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad text-grey text-sm">
        Loading procurement…
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad px-6 text-center">
        <div className="max-w-sm">
          <p className="text-[15px] font-semibold text-navy">Couldn't load procurement data</p>
          <p className="text-[13px] text-grey mt-1">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProcurementStore(): ProcurementStoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProcurementStore must be used within ProcurementStoreProvider");
  return ctx;
}
