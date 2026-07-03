import { useNavigate } from "react-router-dom";
import { useSandbox } from "./SandboxContext";
import { useEffectiveIdentity } from "./useEffectiveIdentity";

/**
 * Persistent "you're in the demo" strip, rendered above the page content in demo
 * mode via the AppShell `banner` seam. Makes it unmistakable that nothing shown
 * is production, names who you're acting as, and offers a one-click exit.
 */
export default function DemoBanner() {
  const { active, personaId, exit } = useSandbox();
  const { user } = useEffectiveIdentity();
  const navigate = useNavigate();
  if (!active) return null;

  const onExit = () => {
    exit();
    navigate("/procurement");
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-orange/40 bg-[#FFF7ED] px-4 py-2.5 text-[12.5px]">
      <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wide text-orange">
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2h4M12 2v6l4.5 8a2 2 0 0 1-1.8 3H9.3a2 2 0 0 1-1.8-3L12 8" /></svg>
        Demo Sandbox
      </span>
      <span className="text-grey">
        {personaId ? <>Acting as <b className="text-navy">{user.name}</b>.</> : <>Acting as <b className="text-navy">yourself</b> (Admin / Coordinator).</>}{" "}
        Nothing here is production data.
      </span>
      <button
        onClick={onExit}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-orange/50 px-2.5 py-1 font-semibold text-orange hover:bg-orange hover:text-white transition-colors"
      >
        Exit demo
      </button>
    </div>
  );
}
