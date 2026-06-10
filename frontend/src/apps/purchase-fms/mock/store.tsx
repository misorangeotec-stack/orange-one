import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, Designation, PurchaseEntry, StageState, StepOwner } from "../types";
import { STAGE_COUNT } from "../config/stages";
import { useSession } from "@/core/platform/session";
import { isOverdue } from "@/shared/lib/time";
import { fetchFmsData } from "../data/fmsFetch";
import * as writes from "../data/fmsWrites";
import type { NewOrderInput } from "../data/fmsWrites";

/**
 * Phase-3 Supabase-backed store for Purchase FMS. Despite the legacy `mock/`
 * path, this is the LIVE data layer: it loads the generic FMS engine rows via
 * React Query (data/fmsFetch) and routes every mutation through data/fmsWrites
 * (stage advancement goes through the fms_complete_stage RPC). The hook surface
 * is unchanged from Phase 1 so the screens didn't need rewriting; the only
 * difference is the mutating actions are now async (Promise-returning). The
 * provider gates the first load with a spinner so reads stay non-null.
 */

export type { NewOrderInput };

const FMS_QUERY_KEY = ["fmsData"] as const;

interface FmsStoreValue {
  entries: PurchaseEntry[];
  categories: Category[];
  designations: Designation[];
  stepOwners: StepOwner[];

  getEntry: (id: string) => PurchaseEntry | undefined;
  ownerForStep: (stepKey: string) => StepOwner | undefined;

  createEntry: (input: NewOrderInput) => Promise<string>;
  /** Complete the entry's active stage with the captured values; advances the pipeline. */
  completeStage: (entryId: string, values: Record<string, string | number | null>) => Promise<void>;

  updateStepOwner: (stepKey: string, patch: Partial<Omit<StepOwner, "stepKey">>) => Promise<void>;

  addCategory: (input: { name: string; unit: string }) => Promise<void>;
  updateCategory: (id: string, patch: { name?: string; unit?: string }) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  addDesignation: (name: string) => Promise<void>;
  updateDesignation: (id: string, name: string) => Promise<void>;
  deleteDesignation: (id: string) => Promise<void>;
}

const FmsStoreContext = createContext<FmsStoreValue | null>(null);

export function FmsStoreProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: [...FMS_QUERY_KEY, user.id],
    queryFn: fetchFmsData,
  });

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const categories = useMemo(() => data?.categories ?? [], [data]);
  const designations = useMemo(() => data?.designations ?? [], [data]);
  const stepOwners = useMemo(() => data?.stepOwners ?? [], [data]);
  const workflowId = data?.workflowId ?? "";

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: FMS_QUERY_KEY }),
    [queryClient]
  );

  const getEntry = useCallback((id: string) => entries.find((e) => e.id === id), [entries]);
  const ownerForStep = useCallback(
    (stepKey: string) => stepOwners.find((o) => o.stepKey === stepKey),
    [stepOwners]
  );

  const createEntry = useCallback<FmsStoreValue["createEntry"]>(
    async (input) => {
      const id = await writes.createEntry({
        workflowId,
        createdBy: user.id,
        input,
        existingCodes: entries.map((e) => e.code),
      });
      await invalidate();
      return id;
    },
    [workflowId, user.id, entries, invalidate]
  );

  const completeStage = useCallback<FmsStoreValue["completeStage"]>(
    async (entryId, values) => {
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) throw new Error("Entry not found");
      await writes.completeStage(entry, values);
      await invalidate();
    },
    [entries, invalidate]
  );

  const updateStepOwner = useCallback<FmsStoreValue["updateStepOwner"]>(
    async (stepKey, patch) => {
      await writes.updateStepOwner({ workflowId, stepKey, patch });
      await invalidate();
    },
    [workflowId, invalidate]
  );

  const addCategory = useCallback<FmsStoreValue["addCategory"]>(
    async (input) => {
      await writes.addCategory({ workflowId, name: input.name, unit: input.unit });
      await invalidate();
    },
    [workflowId, invalidate]
  );
  const updateCategory = useCallback<FmsStoreValue["updateCategory"]>(
    async (id, patch) => {
      await writes.updateCategory(id, patch);
      await invalidate();
    },
    [invalidate]
  );
  const deleteCategory = useCallback<FmsStoreValue["deleteCategory"]>(
    async (id) => {
      await writes.deleteCategory(id);
      await invalidate();
    },
    [invalidate]
  );

  const addDesignation = useCallback<FmsStoreValue["addDesignation"]>(
    async (name) => {
      await writes.addDesignation(name);
      await invalidate();
    },
    [invalidate]
  );
  const updateDesignation = useCallback<FmsStoreValue["updateDesignation"]>(
    async (id, name) => {
      await writes.updateDesignation(id, name);
      await invalidate();
    },
    [invalidate]
  );
  const deleteDesignation = useCallback<FmsStoreValue["deleteDesignation"]>(
    async (id) => {
      await writes.deleteDesignation(id);
      await invalidate();
    },
    [invalidate]
  );

  const value = useMemo<FmsStoreValue>(
    () => ({
      entries,
      categories,
      designations,
      stepOwners,
      getEntry,
      ownerForStep,
      createEntry,
      completeStage,
      updateStepOwner,
      addCategory,
      updateCategory,
      deleteCategory,
      addDesignation,
      updateDesignation,
      deleteDesignation,
    }),
    [entries, categories, designations, stepOwners, getEntry, ownerForStep, createEntry, completeStage, updateStepOwner, addCategory, updateCategory, deleteCategory, addDesignation, updateDesignation, deleteDesignation]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-[13.5px] text-grey">
        <span className="h-4 w-4 mr-2.5 rounded-full border-2 border-line border-t-orange animate-spin" />
        Loading Purchase FMS…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <p className="text-[14px] font-semibold text-navy">Couldn’t load Purchase FMS</p>
        <p className="text-[12.5px] text-grey mt-1">
          {error instanceof Error ? error.message : "Please refresh the page and try again."}
        </p>
      </div>
    );
  }

  return <FmsStoreContext.Provider value={value}>{children}</FmsStoreContext.Provider>;
}

export function useFmsStore(): FmsStoreValue {
  const ctx = useContext(FmsStoreContext);
  if (!ctx) throw new Error("useFmsStore must be used within FmsStoreProvider");
  return ctx;
}

// ---- derived helpers shared by screens ----

/** Entry-level status derived from pipeline position. */
export function entryStatus(entry: PurchaseEntry): "completed" | "in_progress" {
  return entry.currentIndex >= STAGE_COUNT ? "completed" : "in_progress";
}

/** Number of completed stages. */
export function doneCount(entry: PurchaseEntry): number {
  return entry.stages.filter((s) => s.status === "done").length;
}

/** Progress as a 0–100 percentage. */
export function progressPct(entry: PurchaseEntry): number {
  return Math.round((doneCount(entry) / STAGE_COUNT) * 100);
}

/** The currently-active stage state, or undefined when complete. */
export function activeStage(entry: PurchaseEntry): StageState | undefined {
  return entry.stages[entry.currentIndex];
}

/** In-progress entry whose active stage is past its planned date. */
export function isEntryOverdue(entry: PurchaseEntry): boolean {
  if (entryStatus(entry) !== "in_progress") return false;
  return isOverdue(activeStage(entry)?.plannedDate ?? null);
}

/** Whole days the active stage is past due (0 if not overdue). */
export function daysOverdue(entry: PurchaseEntry): number {
  const p = activeStage(entry)?.plannedDate;
  if (!isEntryOverdue(entry) || !p) return 0;
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  return Math.max(0, Math.round((today - Date.parse(p.slice(0, 10))) / 86400000));
}
