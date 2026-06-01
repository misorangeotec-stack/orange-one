import { useNavigate } from "react-router-dom";
import { apps } from "@/apps/registry";
import type { AppManifest } from "@/apps/types";
import Logo from "@/shared/components/ui/Logo";
import Avatar from "@/shared/components/ui/Avatar";
import { useSession } from "@/core/platform/session";

/**
 * Post-login app launcher ("Workspace Home"). Renders one card per app the current
 * user can see: live apps they have access to (admins → all), plus coming-soon
 * teasers. Admins get an entry point to the portal Admin area.
 */
export default function WorkspaceHome() {
  const navigate = useNavigate();
  const { user, isAdmin, hasModule } = useSession();
  const firstName = user.name.split(" ")[0];

  // Live apps are gated by module access; coming-soon cards are always shown as teasers.
  const visibleApps = apps.filter((app) => app.status !== "live" || hasModule(app.id));

  return (
    <div className="min-h-screen bg-page-grad font-sans">
      {/* top bar */}
      <header className="border-b border-line bg-white/70 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-[68px] flex items-center justify-between">
          <Logo variant="light" height={32} to="/home" />
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-grey">Orange O Tec Workspace</span>
            {isAdmin && (
              <button
                onClick={() => navigate("/admin")}
                className="inline-flex items-center gap-1.5 text-sm text-grey hover:text-orange font-medium transition"
                title="Admin"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" /></svg>
                <span className="hidden sm:inline">Admin</span>
              </button>
            )}
            <button onClick={() => navigate("/account")} title="My Account" className="shrink-0">
              <Avatar name={user.name} color={user.avatarColor} size={36} />
            </button>
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
            Welcome, {firstName} 👋
          </span>
          <h1 className="text-[32px] font-bold text-navy mt-5 tracking-tight">Your Workspace</h1>
          <p className="text-grey mt-2 max-w-xl leading-relaxed">
            Choose an application to get started. More apps are being added to your Orange One
            platform.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visibleApps.map((app) => (
            <AppCard key={app.id} app={app} onOpen={() => navigate(app.basePath)} />
          ))}
          <ComingSoonTile />
        </div>
      </main>
    </div>
  );
}

/**
 * Generic, identity-free placeholder closing out the grid. Signals more apps are
 * coming without naming or describing any specific (and confusing) future module.
 */
function ComingSoonTile() {
  return (
    <div className="relative text-left bg-white/60 border border-dashed border-line rounded-card p-6 opacity-80 select-none flex flex-col items-center justify-center text-center min-h-[180px]">
      <div className="w-[54px] h-[54px] rounded-[14px] flex items-center justify-center mb-4 bg-line text-grey-2">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
      </div>
      <h3 className="text-[15px] font-semibold text-grey-2">More apps coming soon</h3>
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
