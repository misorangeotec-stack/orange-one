/**
 * Fans out to every work source and collects the results — without breaking the
 * Rules of Hooks.
 *
 * The obvious implementation, `providers.map(p => p.useMyWork())` in one
 * component, is illegal: the provider list changes length as apps are added and
 * as access gating filters it per user, so the hook count would vary between
 * renders. The FMS Control Center's adapter contract carries the same warning.
 *
 * So each provider gets its own <ProviderProbe>, which renders nothing and calls
 * exactly one hook. Results travel up through a reducer keyed by provider key.
 *
 * `useMyWork()` returns the state AND the probes to render, together, on purpose:
 * they share one activation instance and one reducer. Splitting them into two
 * exported hooks would give the page and the probes SEPARATE staged-loading state,
 * which drift apart immediately.
 */
import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { ReactNode } from "react";
import { useSession } from "@/core/platform/session";
import { myWorkProviders } from "./registry";
import { useDeferredActivation } from "./useDeferredActivation";
import { EMPTY_RESULT, type MyWorkProvider, type MyWorkResult, type WorkItem } from "./types";

export interface SourceState extends MyWorkResult {
  key: string;
  label: string;
  unit: MyWorkProvider["unit"];
  /** False while this source has not been switched on yet — reads as "queued". */
  activated: boolean;
}

export interface AggregateState {
  items: WorkItem[];
  sources: SourceState[];
  /** True while any visible source is still loading or waiting its turn. */
  isSettling: boolean;
  /** True when at least one source counts steps — drives the mixed-unit footnote. */
  hasStepUnits: boolean;
}

type ResultMap = Record<string, MyWorkResult>;

const resultReducer = (state: ResultMap, action: { key: string; result: MyWorkResult }): ResultMap => ({
  ...state,
  [action.key]: action.result,
});

export function useMyWork(): { state: AggregateState; probes: ReactNode } {
  const { hasModule } = useSession();

  // Access gating happens FIRST: a module the user cannot open is never probed, so
  // it never fetches. For most staff this removes four or five of the seven sources.
  const visible = useMemo(() => myWorkProviders.filter((p) => hasModule(p.appId)), [hasModule]);

  const activation = useDeferredActivation(visible);
  const [results, dispatch] = useReducer(resultReducer, {} as ResultMap);

  const onResult = useCallback((key: string, result: MyWorkResult) => dispatch({ key, result }), []);

  const sources: SourceState[] = visible.map((p) => {
    const r = results[p.key] ?? EMPTY_RESULT;
    const activated = activation.isActive(p.key);
    return {
      key: p.key,
      label: p.label,
      unit: p.unit,
      activated,
      items: r.items,
      error: r.error,
      // A source not yet switched on is still pending to the reader, even though
      // no query is running for it.
      isLoading: activated ? r.isLoading : true,
    };
  });

  const items = useMemo(() => visible.flatMap((p) => results[p.key]?.items ?? []), [visible, results]);

  const probes = (
    <>
      {visible.map((p) => (
        <ProviderProbe
          key={p.key}
          provider={p}
          active={activation.isActive(p.key)}
          onResult={onResult}
          onSettled={activation.notifySettled}
        />
      ))}
    </>
  );

  return {
    state: {
      items,
      sources,
      isSettling: sources.some((s) => s.isLoading),
      hasStepUnits: visible.some((p) => p.unit === "steps"),
    },
    probes,
  };
}

function ProviderProbe({
  provider,
  active,
  onResult,
  onSettled,
}: {
  provider: MyWorkProvider;
  active: boolean;
  onResult: (key: string, r: MyWorkResult) => void;
  onSettled: (key: string) => void;
}) {
  const result = provider.useMyWork(active);

  // Guarded by a cheap signature: without it, React StrictMode's double-invoke
  // (and every unrelated re-render) dispatches a fresh object identity and loops.
  const signature = `${result.isLoading}|${!!result.error}|${result.items.length}|${result.items[0]?.id ?? ""}`;

  useEffect(() => {
    onResult(provider.key, result);
    if (active && !result.isLoading) onSettled(provider.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, active, provider.key]);

  return null;
}
