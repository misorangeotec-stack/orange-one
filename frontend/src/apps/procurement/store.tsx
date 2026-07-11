import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import type { Department, Profile } from "@/core/platform/types";
import { useEffectiveIdentity } from "./sandbox/useEffectiveIdentity";
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
import type { StepKey } from "./lib/steps";
import {
  buildProcIndex,
  buildQueueEntries,
  dispatchDueForPo as dispatchDueForPoPure,
  lineDueIso,
  lineInApproval,
  lineInPoDesk,
  lineInSourcing,
  poDueIso,
  type ProcIndex,
  type ProcSnapshot,
  type QueueEntry,
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
  sharePo as sharePoWrite,
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

  // PO lifecycle mutations
  sharePo: (poId: string, input?: { path: string | null; name: string | null; tallyPoNo: string | null; remarks: string | null; paymentTerms: string | null; dispatchDate: string | null }) => Promise<void>;
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

  const companies = data?.companies ?? [];
  const categories = data?.categories ?? [];
  const itemGroups = data?.itemGroups ?? [];
  const items = data?.items ?? [];
  const vendors = data?.vendors ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
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

    const approverForAmount = (amount: number): string | null => {
      const band = [...approvalBands]
        .filter((b) => b.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.minAmount - b.minAmount)
        .find((b) => amount >= b.minAmount && (b.maxAmount === null || amount <= b.maxAmount));
      return band?.approverUserId ?? null;
    };

    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(user.id));

    const canApproveLine = (line: RequestItem): boolean =>
      isAdmin || (line.lineValue !== null && approverForAmount(line.lineValue) === user.id);

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
        const id = await requestNewMasterWrite(masterType, payload, user.id);
        await invalidate();
        return id;
      },
      resolveMasterRequest: async (requestId, approve, payload, note) => {
        const newId = await resolveMasterRequestWrite(requestId, approve, payload, note);
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
    user,
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
