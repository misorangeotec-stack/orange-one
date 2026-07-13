import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Demo ("act as persona") mode, shared by every FMS app. When active, an admin can
 * impersonate any workflow persona so stakeholders see how each person experiences
 * the flow. This only overrides the app's EFFECTIVE identity (useEffectiveIdentity)
 * — the real Supabase auth session is untouched, and all reads/writes still run
 * under the real (admin) JWT. `personaId === null` means "act as yourself" (the real
 * admin / coordinator view).
 *
 * State is held here (mount the provider at the app's root so in-app navigation
 * preserves it) and mirrored to sessionStorage so a page refresh mid-demo does not
 * kick you out.
 *
 * `scope` namespaces the sessionStorage keys. It exists because the personas of two
 * FMS apps are different casts: without it, entering the HR demo would flip Purchase
 * into demo mode too, pointing it at a persona id that means nothing there.
 */
export interface Persona {
  /** Directory profile id to impersonate. */
  id: string;
  /** Person's display name. */
  name: string;
  /** Their role in the workflow, e.g. "Approver", "Inward (GRN)". */
  stepLabel: string;
}

interface SandboxValue {
  active: boolean;
  personaId: string | null;
  enter: () => void;
  exit: () => void;
  setPersonaId: (id: string | null) => void;
  /** Where exiting the demo, or switching persona, lands you. */
  homePath: string;
}

const Ctx = createContext<SandboxValue | null>(null);

export function SandboxProvider({
  scope,
  homePath,
  children,
}: {
  scope: string;
  homePath: string;
  children: ReactNode;
}) {
  const ssActive = `${scope}-sandbox-active`;
  const ssPersona = `${scope}-sandbox-persona`;

  const [active, setActive] = useState<boolean>(() => sessionStorage.getItem(ssActive) === "1");
  const [personaId, setPersona] = useState<string | null>(() => sessionStorage.getItem(ssPersona) || null);

  const enter = useCallback(() => {
    setActive(true);
    sessionStorage.setItem(ssActive, "1");
  }, [ssActive]);

  const exit = useCallback(() => {
    setActive(false);
    setPersona(null);
    sessionStorage.removeItem(ssActive);
    sessionStorage.removeItem(ssPersona);
  }, [ssActive, ssPersona]);

  const setPersonaId = useCallback(
    (id: string | null) => {
      setPersona(id);
      if (id) sessionStorage.setItem(ssPersona, id);
      else sessionStorage.removeItem(ssPersona);
    },
    [ssPersona],
  );

  const value = useMemo(
    () => ({ active, personaId, enter, exit, setPersonaId, homePath }),
    [active, personaId, enter, exit, setPersonaId, homePath],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSandbox(): SandboxValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSandbox must be used within SandboxProvider");
  return ctx;
}
