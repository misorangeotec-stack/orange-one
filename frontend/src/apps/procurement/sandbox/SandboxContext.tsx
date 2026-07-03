import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Demo ("act as persona") mode for the Purchase FMS app. When active, an admin
 * can impersonate any workflow persona so stakeholders see how each person
 * experiences the flow. This only overrides the app's EFFECTIVE identity
 * (useEffectiveIdentity) — the real Supabase auth session is untouched, and all
 * reads/writes still run under the real (admin) JWT. `personaId === null` means
 * "act as yourself" (the real admin / coordinator view).
 *
 * State is held here (mounted at the ProcurementApp root, so in-app navigation
 * preserves it) and mirrored to sessionStorage so a page refresh mid-demo does
 * not kick you out.
 */
interface SandboxValue {
  active: boolean;
  personaId: string | null;
  enter: () => void;
  exit: () => void;
  setPersonaId: (id: string | null) => void;
}

const Ctx = createContext<SandboxValue | null>(null);
const SS_ACTIVE = "proc-sandbox-active";
const SS_PERSONA = "proc-sandbox-persona";

export function SandboxProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<boolean>(() => sessionStorage.getItem(SS_ACTIVE) === "1");
  const [personaId, setPersona] = useState<string | null>(() => sessionStorage.getItem(SS_PERSONA) || null);

  const enter = useCallback(() => {
    setActive(true);
    sessionStorage.setItem(SS_ACTIVE, "1");
  }, []);

  const exit = useCallback(() => {
    setActive(false);
    setPersona(null);
    sessionStorage.removeItem(SS_ACTIVE);
    sessionStorage.removeItem(SS_PERSONA);
  }, []);

  const setPersonaId = useCallback((id: string | null) => {
    setPersona(id);
    if (id) sessionStorage.setItem(SS_PERSONA, id);
    else sessionStorage.removeItem(SS_PERSONA);
  }, []);

  return <Ctx.Provider value={{ active, personaId, enter, exit, setPersonaId }}>{children}</Ctx.Provider>;
}

export function useSandbox(): SandboxValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSandbox must be used within SandboxProvider");
  return ctx;
}
