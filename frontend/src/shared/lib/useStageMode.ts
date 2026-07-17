/**
 * The two bits of state behind a stage view: which tab, and whose entries.
 *
 * In-memory only, matching the app's sticky-filter precedent — a hard refresh
 * gives you a clean slate rather than a remembered view you didn't ask for.
 *
 * `scopeMine` filters on the EFFECTIVE identity, i.e. the persona when demo mode
 * is active, because every other queue in the app is scoped that way and "Mine"
 * contradicting the queue beside it would be worse than the known quirk that
 * writes still stamp the real user. Callers pass the effective id and surface it
 * with StageTabs' `scopeNote` so the mismatch is at least legible.
 */
import { useMemo, useState } from "react";
import type { StageMode, StageScope } from "../components/ui/StageTabs";

export interface StageEntryLike {
  actorId: string | null;
  atIso: string;
}

export function useStageMode<E extends StageEntryLike>(entries: E[], userId: string) {
  const [mode, setMode] = useState<StageMode>("pending");
  const [scope, setScope] = useState<StageScope>("mine");

  // Newest first: "what did I just do" is the question this tab answers.
  const rows = useMemo(() => {
    const scoped = scope === "mine" ? entries.filter((e) => e.actorId === userId) : entries;
    return scoped.slice().sort((a, b) => b.atIso.localeCompare(a.atIso));
  }, [entries, scope, userId]);

  return { mode, setMode, scope, setScope, rows, showingCompleted: mode === "completed" };
}
