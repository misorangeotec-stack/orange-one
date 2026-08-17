import { useMemo, useState } from "react";
import { Lock, Save, Search } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { useToast } from "@hub/hooks/use-toast";
import {
  PERMISSION_MENUS, menuAccessLevel, setMenuAccessLevel, levelsForMenu, type MenuAccessLevel,
} from "@hub/lib/menus";
import ReportAccessTree from "@hub/components/ReportAccessTree";
import ReportEmailSettings from "@hub/components/ReportEmailSettings";
import { useDirectory } from "@/core/platform/store";
import type { Profile } from "@/core/platform/types";

// This app's id in the portal's app_access table (see meta.tsx).
const RECEIVABLES_APP_ID = "outstanding-dashboard";

/** Order-insensitive equality for two key lists. */
function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((k) => setB.has(k));
}

const LEVEL_LABEL: Record<MenuAccessLevel, string> = {
  hidden: "Hidden",
  standard: "Visible",
  full: "Full access",
};

/**
 * Admin-only editor for per-user receivables access — menus, reports and the source toggle.
 *
 * ── Why this is master-detail and not a matrix ──
 * It used to be one wide table: a row per user, a column per menu. That worked for seven menus.
 * Per-report grants add ~30 more decisions per user, and thirty more columns is not a table
 * anyone can read, let alone one that survives the next ten reports. So: pick a user on the
 * left, see everything about that user on the right.
 *
 * ── What is stored ──
 *   receivables_hidden_menus    DENY-list  — menus this user may NOT see
 *   receivables_admin_menus     ALLOW-list — menus used at ADMIN DEPTH (only `settings` now)
 *   receivables_allowed_reports ALLOW-list — the individual reports they may open
 *   receivables_allow_pipeline  bool       — may switch off the Live (Tally) source
 *
 * The polarities differ on purpose. A new MENU reaches everyone until an admin hides it; a new
 * REPORT reaches nobody until an admin grants it. Reports carry finance data whose audience is
 * narrower than the app's, and the catalogue grows steadily.
 *
 * ── Reports is a two-state menu again ──
 * Its old third level ("Full access") existed only to unlock the Dashboards + Insights
 * categories. Per-report grants say that directly, so the tier is gone; `levelsForMenu` drives
 * which levels each menu still offers, so this screen never has to know. Settings keeps its
 * Hidden / Full access pair — it has no standard tier to offer.
 *
 * ⚠ THIS SCREEN STAYS ADMIN-ONLY, even for a user granted full Settings access. It edits OTHER
 * people's profile rows, and on the identity project that is admin territory by RLS:
 * `profiles_select` shows a non-admin only themselves, their downline and their department, and
 * `profiles_update_own` refuses every row but their own. A delegated copy would therefore list a
 * fraction of the workspace and fail on save — it needs a SECURITY DEFINER RPC first.
 *
 * Admins are exempt from every grant here and always see everything, so they aren't listed.
 * The same controls are on the user form in Admin → Users; both go through the shared helpers
 * (setMenuAccessLevel, ReportAccessTree) so the two screens cannot drift.
 */
export function MenuPermissions() {
  const { profiles, updateUser } = useDirectory();
  const { toast } = useToast();

  // Only non-admins who actually have access to this app are worth listing.
  const users = useMemo(
    () => profiles.filter((p) => p.role !== "admin" && p.moduleAccess.includes(RECEIVABLES_APP_ID)),
    [profiles],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Pending edits, keyed by user id. A user not in a draft is shown from their saved profile.
  // Cleared per-user after a successful save (the refetch reflects it).
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [adminDraft, setAdminDraft] = useState<Record<string, string[]>>({});
  const [reportDraft, setReportDraft] = useState<Record<string, string[]>>({});
  const [pipelineDraft, setPipelineDraft] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const shown = users.filter((u) => u.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const selected = users.find((u) => u.id === selectedId) ?? shown[0] ?? null;

  const hiddenFor = (u: Profile): string[] => draft[u.id] ?? u.receivablesHiddenMenus ?? [];
  const adminFor = (u: Profile): string[] => adminDraft[u.id] ?? u.receivablesAdminMenus ?? [];
  const reportsFor = (u: Profile): string[] => reportDraft[u.id] ?? u.receivablesAllowedReports ?? [];
  const allowPipelineFor = (u: Profile): boolean => pipelineDraft[u.id] ?? u.receivablesAllowPipeline;
  const isDirty = (u: Profile): boolean =>
    (u.id in draft && !sameKeys(draft[u.id], u.receivablesHiddenMenus ?? [])) ||
    (u.id in adminDraft && !sameKeys(adminDraft[u.id], u.receivablesAdminMenus ?? [])) ||
    (u.id in reportDraft && !sameKeys(reportDraft[u.id], u.receivablesAllowedReports ?? [])) ||
    (u.id in pipelineDraft && pipelineDraft[u.id] !== u.receivablesAllowPipeline);

  /** Goes through setMenuAccessLevel so "hidden" also drops any full-access grant. */
  const setLevel = (u: Profile, menuKey: string, level: MenuAccessLevel) => {
    const next = setMenuAccessLevel(menuKey, level, hiddenFor(u), adminFor(u));
    setDraft((d) => ({ ...d, [u.id]: next.hidden }));
    setAdminDraft((d) => ({ ...d, [u.id]: next.admin }));
  };

  const save = async (u: Profile) => {
    setSavingId(u.id);
    try {
      await updateUser(u.id, {
        receivablesHiddenMenus: hiddenFor(u),
        receivablesAdminMenus: adminFor(u),
        receivablesAllowedReports: reportsFor(u),
        receivablesAllowPipeline: allowPipelineFor(u),
      });
      const drop = (d: Record<string, unknown>) => {
        const { [u.id]: _omit, ...rest } = d;
        return rest;
      };
      setDraft((d) => drop(d) as Record<string, string[]>);
      setAdminDraft((d) => drop(d) as Record<string, string[]>);
      setReportDraft((d) => drop(d) as Record<string, string[]>);
      setPipelineDraft((d) => drop(d) as Record<string, boolean>);
      toast({ title: "Access saved", description: `Updated receivables access for ${u.name}.` });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save access", description: (e as Error).message });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          Permissions
        </CardTitle>
        <CardDescription>
          Pick a user to set which left-nav menus they see and which individual reports they can
          open. Menus are visible by default; <span className="font-medium">reports are not</span> —
          each one has to be granted, so a newly added report reaches nobody until you say so.
          Admins always see everything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* GLOBAL, not per-user, and above the picker so it is never mistaken for part of the
            selected user's settings. Same screen because "who may open this report" and "may this
            report be emailed at all" are the same question one step apart — and it stays useful
            when there are no non-admin users to list, which is why it sits outside the branch. */}
        <ReportEmailSettings />

        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No non-admin users have access to this dashboard yet. Grant a user the Outstanding
            Dashboard module in the admin area, then set their access here.
          </p>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            {/* ── User rail ─────────────────────────────────────────────────── */}
            <div className="w-full shrink-0 lg:w-56">
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Find a user…"
                  className="h-8 rounded-input pl-8 text-xs"
                />
              </div>
              <ul className="max-h-[520px] divide-y divide-border overflow-auto rounded-lg border border-border">
                {shown.map((u) => {
                  const active = selected?.id === u.id;
                  const count = (reportsFor(u) ?? []).length;
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(u.id)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                          active ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted/50"
                        }`}
                      >
                        <span className="flex-1 truncate">{u.name}</span>
                        {isDirty(u) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                        <span className="shrink-0 text-[11px] text-muted-foreground">{count}</span>
                      </button>
                    </li>
                  );
                })}
                {shown.length === 0 && (
                  <li className="px-3 py-6 text-center text-xs text-muted-foreground">No match.</li>
                )}
              </ul>
            </div>

            {/* ── Detail ────────────────────────────────────────────────────── */}
            {selected && (
              <div className="min-w-0 flex-1 space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{selected.name}</h3>
                  {selected.receivablesSalespersons.length > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      scoped to {selected.receivablesSalespersons.join(", ")}
                    </span>
                  ) : (
                    // Worth saying out loud: an untagged non-admin sees an EMPTY dashboard, so
                    // granting them reports here achieves nothing on its own.
                    <span className="text-xs text-amber-700">
                      no salesperson assigned — scoped reports will be empty for this user
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={isDirty(selected) ? "default" : "outline"}
                    disabled={!isDirty(selected) || savingId === selected.id}
                    onClick={() => save(selected)}
                    className="ml-auto gap-1.5"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {savingId === selected.id ? "Saving…" : "Save"}
                  </Button>
                </div>

                {/* Menus */}
                <div className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Menus
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {PERMISSION_MENUS.map((m) => {
                      const levels = levelsForMenu(m);
                      const level = menuAccessLevel(m.key, hiddenFor(selected), adminFor(selected));
                      // Two-level menus are a tick; the one that still has three (Settings:
                      // Hidden / Full access) gets pills, so no level is ever offered that
                      // levelsForMenu says the menu cannot hold.
                      if (levels.length === 2 && !m.fullAccessOnly) {
                        return (
                          <label
                            key={m.key}
                            className="flex items-center gap-1.5 rounded-button border border-border px-2.5 py-1.5 text-xs"
                          >
                            <Checkbox
                              checked={level !== "hidden"}
                              onCheckedChange={(v) => setLevel(selected, m.key, v === true ? "standard" : "hidden")}
                            />
                            {m.title}
                          </label>
                        );
                      }
                      return (
                        <div
                          key={m.key}
                          className="flex items-center gap-1.5 rounded-button border border-border px-2.5 py-1.5 text-xs"
                        >
                          <span className="text-muted-foreground">{m.title}</span>
                          {levels.map((l) => (
                            <button
                              key={l}
                              type="button"
                              onClick={() => setLevel(selected, m.key, l)}
                              className={`rounded-button px-1.5 py-0.5 text-[11px] ${
                                level === l ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground"
                              }`}
                            >
                              {LEVEL_LABEL[l]}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                    <label className="flex items-center gap-1.5 rounded-button border border-border px-2.5 py-1.5 text-xs">
                      <Checkbox
                        checked={allowPipelineFor(selected)}
                        onCheckedChange={(v) =>
                          setPipelineDraft((d) => ({ ...d, [selected.id]: v === true }))
                        }
                      />
                      Legacy pipeline source
                    </label>
                  </div>
                </div>

                {/* Reports */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Reports
                  </p>
                  <ReportAccessTree
                    value={reportsFor(selected)}
                    onChange={(ids) => setReportDraft((d) => ({ ...d, [selected.id]: ids }))}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
