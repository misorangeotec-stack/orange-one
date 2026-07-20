import { useState } from "react";
import { Lock, Save } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Checkbox } from "@hub/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { useToast } from "@hub/hooks/use-toast";
import { PERMISSION_MENUS } from "@hub/lib/menus";
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

/**
 * Admin-only matrix to control per-user receivables access.
 *
 * MENU columns: a ticked box = the user CAN see that menu; un-ticking it hides the menu for
 * that user (writes the key into profiles.receivables_hidden_menus, a deny-list). Default is
 * everything visible.
 *
 * LEGACY PIPELINE column: the hub defaults everyone to the Live (Tally) source. Tick this to
 * let the user switch to the old pipeline source (writes profiles.receivables_allow_pipeline).
 * Default is off — most users only ever see Live and get no source toggle.
 *
 * Admins are exempt from both and always see everything, so they're not listed here. Saving
 * only touches these two receivables columns (never the password).
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
  const [pipelineDraft, setPipelineDraft] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const hiddenFor = (u: Profile): string[] => draft[u.id] ?? u.receivablesHiddenMenus ?? [];
  const allowPipelineFor = (u: Profile): boolean => pipelineDraft[u.id] ?? u.receivablesAllowPipeline;
  const isDirty = (u: Profile): boolean =>
    (u.id in draft && !sameKeys(draft[u.id], u.receivablesHiddenMenus ?? [])) ||
    (u.id in pipelineDraft && pipelineDraft[u.id] !== u.receivablesAllowPipeline);

  const toggle = (u: Profile, menuKey: string, canSee: boolean) => {
    const current = hiddenFor(u);
    const next = canSee ? current.filter((k) => k !== menuKey) : [...current, menuKey];
    setDraft((d) => ({ ...d, [u.id]: next }));
  };

  const togglePipeline = (u: Profile, allow: boolean) => {
    setPipelineDraft((d) => ({ ...d, [u.id]: allow }));
  };

  const save = async (u: Profile) => {
    setSavingId(u.id);
    try {
      await updateUser(u.id, {
        receivablesHiddenMenus: hiddenFor(u),
        receivablesAllowPipeline: allowPipelineFor(u),
      });
      setDraft((d) => {
        const { [u.id]: _omit, ...rest } = d;
        return rest;
      });
      setPipelineDraft((d) => {
        const { [u.id]: _omit, ...rest } = d;
        return rest;
      });
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
          Choose which left-nav menus each user can see (visible by default — un-tick to hide),
          and whether they may switch to the legacy pipeline source. Everyone defaults to the
          Live (Tally) source; tick <span className="font-medium">Legacy pipeline</span> to give a
          user the source toggle. Admins always see every menu and both sources.
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
                  const dirty = isDirty(u);
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="sticky left-0 bg-card z-10 font-medium whitespace-nowrap">
                        {u.name}
                      </TableCell>
                      {PERMISSION_MENUS.map((m) => {
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
