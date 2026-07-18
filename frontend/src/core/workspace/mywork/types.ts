/**
 * The contract a module implements to put work on the home screen.
 *
 * Deliberately separate from `apps/fms-control-center/adapters/types.ts`, which it
 * is otherwise modelled on. That contract answers "how much work exists at each
 * step, org-wide" and returns COUNTS for a coordinator. This one answers "which
 * rows are mine right now, and where does each one open" and returns ITEMS for one
 * person. Different unit, different scoping — and Task Management and Receivables
 * have no steps at all, so forcing them into the FMS step vocabulary would not work.
 *
 * TWO RULES THAT MATTER:
 *
 * 1. A provider returns `dueIso` and NEVER buckets. The home layer buckets once,
 *    with `bucketOf` + `todayLocalIso` from shared/lib/dueBuckets.
 *
 *    Do NOT reach for `shared/lib/time.ts#todayIso()` anywhere under mywork/. That
 *    one is `toISOString().slice(0,10)` — the UTC date — and India is UTC+5:30, so
 *    between midnight and 05:30 local it returns YESTERDAY and every due-today item
 *    is reported overdue. Task Management and Receivables both use the UTC version
 *    internally today; bucketing centrally here is what stops that leaking onto
 *    this screen.
 *
 * 2. `useMyWork(active)` must pass `active` through to its query's `enabled`. The
 *    home screen turns providers on in stages so seven modules' worth of data does
 *    not hit the network at once. A provider that ignores the flag and fetches
 *    unconditionally defeats the whole loading strategy.
 */
import type { AppCategory } from "@/apps/categories";

/** One thing one person has to do, from any module. */
export interface WorkItem {
  /** `${source}:${entityId}:${stepKey}` — unique across providers. */
  id: string;
  source: string;
  /** Module name as shown to the reader, e.g. "Purchase FMS". */
  sourceLabel: string;
  /** Human reference — PR-1043, a task title, a customer name. */
  ref: string;
  detail?: string;
  /** Workflow step label. Undefined for sources that have no steps. */
  stage?: string;
  /** LOCAL yyyy-mm-dd, or null for deliberately untimed work. Never pre-bucketed. */
  dueIso: string | null;
  /** Absolute in-app path this row opens. */
  to: string;
  /**
   * "direct" = assigned to this user specifically (an approval routed to them, a
   * task assigned to them). "team" = they are one of several owners of the step.
   * Both are genuinely their work; the distinction is shown, not filtered on.
   */
  assignment: "direct" | "team";
  /** True when the row is waiting on this user's approval decision. */
  isApproval?: boolean;
}

export interface MyWorkResult {
  items: WorkItem[];
  isLoading: boolean;
  error: unknown;
}

export const EMPTY_RESULT: MyWorkResult = { items: [], isLoading: false, error: null };

export interface MyWorkProvider {
  /** Stable identifier, e.g. "purchase". Also the `source` on its items. */
  key: string;
  label: string;
  /** Gated through `session.hasModule` — no access, no fetch. */
  appId: string;
  category?: AppCategory;
  /**
   * "steps" = counts (step, entity) work-items, so one PO can appear twice; that
   * is intentional and matches the FMS Control Center. "items" = counts records.
   * Drives the mixed-unit footnote on the total.
   */
  unit: "steps" | "items";
  /** 1 = small and usually cached, load immediately. 2 = heavy, load after paint. */
  tier: 1 | 2;
  /**
   * Exactly one React hook, called by exactly one <ProviderProbe>. Never call
   * these in a loop from a parent — that breaks the Rules of Hooks the moment the
   * provider list changes length.
   */
  useMyWork: (active: boolean) => MyWorkResult;
}
