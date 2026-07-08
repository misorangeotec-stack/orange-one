import type { Profile } from "@/core/platform/types";
import type { PurchaseEntry, StepOwner } from "../types";
import { activeStage } from "../mock/store";
import { stageByKey } from "../config/stages";
import { ownerLabel } from "./owner";

/**
 * The single source of truth for "who would be notified that an entry now awaits
 * them, and about what". Purchase FMS doesn't *send* notifications — they're
 * derived in-app: an entry whose active stage is owned by a user surfaces in that
 * user's notification bell (FmsLayout) and My Queue. This helper packages the
 * recipient + message for whatever stage is currently active, so the live bell
 * and the Test Mode handoff preview can't drift apart.
 *
 * Returns null when the entry is complete (no active stage → nobody to notify).
 */
export interface OwnerNotice {
  /** Display name(s) of the stage owner who would be notified. */
  ownerLabel: string;
  /** Full title of the stage now awaiting action. */
  stageTitle: string;
  /** Planned date (yyyy-mm-dd) for that stage, if set. */
  plannedDate: string | null;
}

export function nextOwnerNotice(
  entry: PurchaseEntry,
  ownerForStep: (stepKey: string) => StepOwner | undefined,
  profileById: (id: string | null) => Profile | undefined
): OwnerNotice | null {
  const active = activeStage(entry);
  if (!active) return null;
  const def = stageByKey(active.key);
  return {
    ownerLabel: ownerLabel(ownerForStep(active.key), profileById),
    stageTitle: def?.title ?? "the next step",
    plannedDate: active.plannedDate,
  };
}
