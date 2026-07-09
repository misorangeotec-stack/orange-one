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

export interface FmsSnapshot {
  total: Record<Bucket, number>;
  steps: StepBreak[];
}

export interface FmsAdapter {
  /** Stable identifier, e.g. "purchase". */
  key: string;
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
