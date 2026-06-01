import { useNavigate } from "react-router-dom";
import Logo from "@/shared/components/ui/Logo";

/**
 * Temporary placeholder shown for a module whose data is mid-migration to live
 * Supabase (Stage B). Task Management is held here during the directory-first
 * read migration (B3a) and restored once its tasks go live (B3b). Remove the gate
 * in App.tsx when done.
 */
export default function ModuleMigrationNotice({ name }: { name: string }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-page-grad font-sans">
      <header className="border-b border-line bg-white/70 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 h-[68px] flex items-center justify-between">
          <Logo variant="light" height={32} to="/home" />
          <button onClick={() => navigate("/home")} className="text-sm text-grey hover:text-orange font-medium transition inline-flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Back to workspace
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-6 py-24 text-center">
        <div className="w-14 h-14 rounded-2xl bg-orange-soft text-orange flex items-center justify-center mx-auto mb-6">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /><polyline points="21 3 21 9 15 9" /></svg>
        </div>
        <h1 className="text-[24px] font-bold text-navy">{name} is being connected to live data</h1>
        <p className="text-grey mt-3 leading-relaxed">
          We've moved your real users and departments onto the live backend. {name}'s tasks and
          reports are next — this module will be back online in the following step. Your data is
          safe; nothing has been changed.
        </p>
      </main>
    </div>
  );
}
