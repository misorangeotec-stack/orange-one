import { useState } from "react";
import { Lock, Save } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Checkbox } from "@hub/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { useToast } from "@hub/hooks/use-toast";
import {
  PERMISSION_MENUS, menuAccessLevel, setMenuAccessLevel, type MenuAccessLevel,
} from "@hub/lib/menus";
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
  standard: "Standard",
  full: "Full access",
};

/**
 * Admin-only matrix to control per-user receivables access.
 *
 * SIMPLE MENU columns: a ticked box = the user CAN see that menu; un-ticking it hides the menu
 * for that user (writes the key into profiles.receivables_hidden_menus, a deny-list). Default is
 * everything visible.
 *
 * REPORTS / SETTINGS columns: three levels, because seeing these two is not the same as having
 * them. "Standard" is the everyday screen; "Full access" adds the parts that used to be welded to
 * role = admin (the Dashboards + Insights report categories; the Masters tab) by writing the key
 * into profiles.receivables_admin_menus, an ALLOW-list. Default is Standard — elevation is always
 * an explicit act.
 *
 * LEGACY PIPELINE column: the hub defaults everyone to the Live (Tally) source. Tick this to
 * let the user switch to the old pipeline source (writes profiles.receivables_allow_pipeline).
 * Default is off — most users only ever see Live and get no source toggle.
 *
 * ⚠ THIS SCREEN ITSELF STAYS ADMIN-ONLY, even for a user granted full Settings access. It edits
 * OTHER people's profile rows, and on the identity project that is admin territory by RLS:
 * `profiles_select` shows a non-admin only themselves, their downline and their department, and
 * `profiles_update_own` refuses every row but their own. A delegated copy of this matrix would
 * therefore list a fraction of the workspace and fail on save — it needs a SECURITY DEFINER RPC
 * (read + write, whitelisted to the receivables columns) before it can be handed out.
 *
 * Admins are exempt from every column above and always see everything, so they're not listed
 * here. Saving only touches the three receivables columns (never the password).
 *
 * The same three levels are editable in Admin → Users on the user form; both screens go through
 * menuAccessLevel / setMenuAccessLevel so they cannot drift.
 */
export function MenuPermissions() {
  const { profiles, updateUser } = useDirectory();
  const { toast } = useToast();

  // Only non-admins who actually have access to this app are worth listing.
  const users = profiles.filter(
    (p) => p.role !== "admin" && p.moduleAccess.includes(RECEIVABLES_APP_ID),
  );

  // Pending edits, keyed by user id. A user not in a draft is shown from their saved
  // profile. Cleared per-user after a successful save (the refetch reflects it).
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [adminDraft, setAdminDraft] = useState<Record<string, string[]>>({});
  const [pipelineDraft, setPipelineDraft] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const hiddenFor = (u: Profile): string[] => draft[u.id] ?? u.receivablesHiddenMenus ?? [];
  const adminFor = (u: Profile): string[] => adminDraft[u.id] ?? u.receivablesAdminMenus ?? [];
  const allowPipelineFor = (u: Profile): boolean => pipelineDraft[u.id] ?? u.receivablesAllowPipeline;
  const isDirty = (u: Profile): boolean =>
    (u.id in draft && !sameKeys(draft[u.id], u.receivablesHiddenMenus ?? [])) ||
    (u.id in adminDraft && !sameKeys(adminDraft[u.id], u.receivablesAdminMenus ?? [])) ||
    (u.id in pipelineDraft && pipelineDraft[u.id] !== u.receivablesAllowPipeline);

  /** Two-state menus: the tick is visibility only. */
  const toggle = (u: Profile, menuKey: string, canSee: boolean) => {
    setLevel(u, menuKey, canSee ? "standard" : "hidden");
  };

  /** Three-state menus. Goes through setMenuAccessLevel so "hidden" also drops the grant. */
  const setLevel = (u: Profile, menuKey: string, level: MenuAccessLevel) => {
    const next = setMenuAccessLevel(menuKey, level, hiddenFor(u), adminFor(u));
    setDraft((d) => ({ ...d, [u.id]: next.hidden }));
    setAdminDraft((d) => ({ ...d, [u.id]: next.admin }));
  };

  const togglePipeline = (u: Profile, allow: boolean) => {
    setPipelineDraft((d) => ({ ...d, [u.id]: allow }));
  };

  const save = async (u: Profile) => {
    setSavingId(u.id);
    try {
      await updateUser(u.id, {
        receivablesHiddenMenus: hiddenFor(u),
        receivablesAdminMenus: adminFor(u),
        receivablesAllowPipeline: allowPipelineFor(u),
      });
      const drop = (d: Record<string, unknown>) => {
        const { [u.id]: _omit, ...rest } = d;
        return rest;
      };
      setDraft((d) => drop(d) as Record<string, string[]>);
      setAdminDraft((d) => drop(d) as Record<string, string[]>);
      setPipelineDraft((d) => drop(d) as Record<string, boolean>);
      toast({ title: "Access saved", description: `Updated receivables access for ${u.name}.` });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Couldn't save access",
        description: (e as Error).message,
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          Menu Permissions
        </CardTitle>
        <CardDescription>
          Choose which left-nav menus each user can see (visible by default — un-tick to hide).
          <span className="font-medium"> Reports</span> and
          <span className="font-medium"> Settings</span> take three levels: Hidden, Standard, or
          Full access — the last one adds the Dashboards and Insights report categories, and the
          Masters tab in Settings. The <span className="font-medium">Legacy pipeline</span> tick
          gives a user the source toggle (everyone defaults to Live (Tally)). Admins always see
          every menu at full access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No non-admin users have access to this dashboard yet. Grant a user the Outstanding
            Dashboard module in the admin area, then set their access here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-card z-10 min-w-40">User</TableHead>
                  {PERMISSION_MENUS.map((m) => (
                    <TableHead key={m.key} className="text-center whitespace-nowrap">
                      {m.title}
                    </TableHead>
                  ))}
                  <TableHead className="text-center whitespace-nowrap border-l">Legacy pipeline</TableHead>
                  <TableHead className="text-right">Save</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const hidden = hiddenFor(u);
                  const admins = adminFor(u);
                  const dirty = isDirty(u);
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="sticky left-0 bg-card z-10 font-medium whitespace-nowrap">
                        {u.name}
                      </TableCell>
                      {PERMISSION_MENUS.map((m) => {
                        // Menus with a deeper tier get the three-level picker; the rest keep the tick.
                        if (m.fullAccessNote) {
                          const level = menuAccessLevel(m.key, hidden, admins);
                          return (
                            <TableCell key={m.key} className="text-center">
                              <Select value={level} onValueChange={(v) => setLevel(u, m.key, v as MenuAccessLevel)}>
                                <SelectTrigger
                                  className="h-8 w-[124px] mx-auto text-xs"
                                  aria-label={`${u.name} — ${m.title} access`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="hidden">{LEVEL_LABEL.hidden}</SelectItem>
                                  <SelectItem value="standard">{LEVEL_LABEL.standard}</SelectItem>
                                  <SelectItem value="full">{LEVEL_LABEL.full}</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                          );
                        }
                        const canSee = !hidden.includes(m.key);
                        return (
                          <TableCell key={m.key} className="text-center">
                            <Checkbox
                              checked={canSee}
                              onCheckedChange={(v) => toggle(u, m.key, v === true)}
                              aria-label={`${u.name} can see ${m.title}`}
                            />
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center border-l">
                        <Checkbox
                          checked={allowPipelineFor(u)}
                          onCheckedChange={(v) => togglePipeline(u, v === true)}
                          aria-label={`${u.name} may view the legacy pipeline source`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={dirty ? "default" : "outline"}
                          disabled={!dirty || savingId === u.id}
                          onClick={() => save(u)}
                          className="gap-1.5"
                        >
                          <Save className="h-3.5 w-3.5" />
                          {savingId === u.id ? "Saving…" : "Save"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
