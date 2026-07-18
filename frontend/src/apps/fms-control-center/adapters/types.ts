/**
 * The contract every FMS implements to appear on the master Control Center.
 *
 * Adding an FMS is deliberately small: write one adapter file that exposes a
 * `useSnapshot()` hook returning bucketed counts, then add it to
 * `adapters/registry.ts`. Nothing else in this app needs to change.
 */

// The bucket vocabulary lives in shared/lib so the procurement app can use it
// too without importing from this app (which would be a cycle).
export type { Bucket } from "@/shared/lib/dueBuckets";
export { EMPTY_COUNTS } from "@/shared/lib/dueBuckets";
import type { Bucket } from "@/shared/lib/dueBuckets";

/** One workflow step's counts, for the expanded per-step breakdown. */
export interface StepBreak {
  stepKey: string;
  label: string;
  counts: Record<Bucket, number>;
}

/**
 * A stage — several steps rolled into the one thing a reader actually asks about
 * ("is it stuck getting approved, or stuck finding people?").
 *
 * Optional, and that is the point. Purchase's nine steps are one journey, so it declares
 * no stages and expands to the nine, exactly as it always has. HR's eighteen span four
 * unrelated processes, and eighteen rows on a scoreboard is a wall you read nothing from.
 */
export interface StageBreak {
  label: string;
  counts: Record<Bucket, number>;
  steps: StepBreak[];
}

export interface FmsSnapshot {
  total: Record<Bucket, number>;
  steps: StepBreak[];
  /** Present only for an FMS that declares stages; every queue step appears in exactly one. */
  stages?: StageBreak[];
}

export interface FmsAdapter {
  /** Stable identifier, e.g. "purchase". */
  key: string;
  /**
   * The REGISTRY app id — deliberately separate from `key`, which is this
   * scoreboard's own short handle. They differ for two apps (`purchase` →
   * `procurement`, `hr` → `hr-recruitment`), so reusing `key` to look up a display
   * name would silently miss and print the raw id.
   */
  appId: string;
  /** Display name — always `appName(appId)`, never a hand-typed string. */
  name: string;
  /** Where a click on the row lands — that FMS's own control center. */
  controlCenterPath: string;
  status: "live" | "coming-soon";
  /**
   * Exactly one React hook, called by exactly one <FmsRow>. Never call these in
   * a loop from a parent — that would break the Rules of Hooks the moment the
   * adapter list changes length. A "coming-soon" adapter still exposes a no-op.
   */
  useSnapshot: () => { snapshot: FmsSnapshot | null; isLoading: boolean; error: unknown };
}
