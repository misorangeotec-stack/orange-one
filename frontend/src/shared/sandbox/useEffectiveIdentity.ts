import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import type { AppRole, Profile } from "@/core/platform/types";
import { useSandbox } from "./SandboxContext";

export interface EffectiveIdentity {
  user: Profile;
  isAdmin: boolean;
  role: AppRole;
}

/**
 * The identity the FMS app should act AS. In demo mode with a persona selected,
 * this resolves to that persona's directory profile; otherwise it is exactly the
 * signed-in user from useSession(). UI-only — Supabase auth, RLS and RPC
 * actor-stamping all still use the real session. Every capability flag, queue and
 * notification feed in an FMS store derives from this, so switching the persona
 * re-scopes the whole app.
 */
export function useEffectiveIdentity(): EffectiveIdentity {
  const session = useSession();
  const { active, personaId } = useSandbox();
  const { profileById } = useDirectory();

  if (active && personaId) {
    const persona = profileById(personaId);
    if (persona) {
      const role: AppRole = persona.role;
      return { user: persona, isAdmin: role === "admin", role };
    }
  }
  return { user: session.user, isAdmin: session.isAdmin, role: session.role };
}
