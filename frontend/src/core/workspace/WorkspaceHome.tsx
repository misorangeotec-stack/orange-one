import { useNavigate } from "react-router-dom";
import { apps } from "@/apps/registry";
import type { AppManifest } from "@/apps/types";
import Logo from "@/shared/components/ui/Logo";

/**
 * Post-login app launcher ("Workspace Home"). Renders one card per registered app
 * from apps/registry.tsx — live apps open; coming-soon apps are disabled. Future
 * apps appear here automatically once registered.
 */
export default function WorkspaceHome() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-page-grad font-sans">
      {/* top bar */}
      <header className="border-b border-line bg-white/70 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-[68px] flex items-center justify-between">
          <Logo variant="light" height={32} to="/home" />
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-grey">Orange O Tec Workspace</span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-navy to-navy-2 text-white flex items-center justify-center text-sm font-semibold">
              A
            </div>
            <button
              onClick={() => navigate("/")}
              className="text-sm text-grey hover:text-orange font-medium transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-9">
          <span className="inline-flex items-center bg-orange-soft text-orange font-semibold text-[13px] px-4 py-2 rounded-pill">
            Good morning, Admin 👋
          </span>
          <h1 className="text-[32px] font-bold text-navy mt-5 tracking-tight">Your Workspace</h1>
          <p className="text-grey mt-2 max-w-xl leading-relaxed">
            Choose an application to get started. More apps are being added to your Orange One
            platform.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => (
            <AppCard key={app.id} app={app} onOpen={() => navigate(app.basePath)} />
          ))}
        </div>
      </main>
    </div>
  );
}

function AppCard({ app, onOpen }: { app: AppManifest; onOpen: () => void }) {
  const live = app.status === "live";
  return (
    <button
      onClick={live ? onOpen : undefined}
      disabled={!live}
      className={
        "group relative text-left bg-white border border-line rounded-card p-6 shadow-soft transition-all " +
        (live
          ? "cursor-pointer hover:-translate-y-1.5 hover:shadow-card hover:border-[#e4eaf4]"
          : "opacity-70 cursor-not-allowed")
      }
    >
      <span
        className={
          "absolute top-0 left-6 right-6 h-[3px] rounded-b bg-orange origin-left transition-transform " +
          (live ? "scale-x-0 group-hover:scale-x-100" : "scale-x-0")
        }
      />
      <div
        className={
          "w-[54px] h-[54px] rounded-[14px] flex items-center justify-center mb-5 transition-all " +
          (live ? "bg-orange-soft text-navy group-hover:bg-orange group-hover:text-white" : "bg-line text-grey-2")
        }
      >
        <span className="[&>svg]:w-[26px] [&>svg]:h-[26px]">{app.icon}</span>
      </div>

      <div className="flex items-center gap-2">
        <h3 className="text-[17px] font-semibold text-navy">{app.name}</h3>
        {!live && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-grey-2 bg-page border border-line rounded-pill px-2 py-0.5">
            Soon
          </span>
        )}
      </div>
      <p className="text-grey text-[13.5px] leading-relaxed mt-2 min-h-[42px]">{app.description}</p>

      {live && (
        <span className="mt-4 inline-flex items-center gap-1.5 text-orange text-sm font-semibold">
          Open
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-1">
            <line x1="4" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </span>
      )}
    </button>
  );
}
