import { useNavigate } from "react-router-dom";
import { useSandbox, type Persona } from "./SandboxContext";

/**
 * Topbar "Acting as …" control shown only in demo mode. Picking a persona sets the
 * effective identity, which re-scopes nav, queues, actions and the bell, and drops
 * you onto that persona's dashboard so you see their world from the top. The empty
 * option = act as yourself (the real admin / coordinator view).
 *
 * The cast is passed in, not imported: each FMS derives its own personas from its
 * own seeded step owners.
 */
export default function PersonaSwitcher({ personas }: { personas: Persona[] }) {
  const { personaId, setPersonaId, homePath } = useSandbox();
  const navigate = useNavigate();

  const onChange = (id: string) => {
    setPersonaId(id || null);
    navigate(homePath);
  };

  return (
    <label className="inline-flex items-center gap-2 rounded-lg border border-orange/40 bg-orange/5 pl-2.5 pr-1.5 py-1">
      <span className="hidden sm:inline text-[10.5px] font-semibold uppercase tracking-wide text-orange">Acting as</span>
      <select
        value={personaId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[220px] bg-transparent text-[12.5px] font-medium text-navy cursor-pointer focus:outline-none"
      >
        <option value="">You · Admin / Coordinator</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.stepLabel} — {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
