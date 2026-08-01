import { Tabs, TabsList, TabsTrigger, TabsContent } from "@hub/components/ui/tabs";
import { MenuPermissions } from "@hub/components/MenuPermissions";
import { MusterPanel } from "@hub/pages/MusterEditor";
import { useHubMenuAccess } from "@hub/lib/menus";

/**
 * Settings — masters, plus menu permissions for admins.
 *
 * The Data Refresh tab (a "Refresh Data" button + a Last Refresh table) was removed on
 * 01-08-2026. It drove the ORIGINAL Google-Sheets pipeline through VITE_REFRESH_API_URL,
 * which no longer exists: the receivables data is rebuilt entirely by the external Python
 * pipeline and the ConnectWave Tally sync, neither of which this button could reach. In
 * production it rendered nothing but "Refresh service is not configured" over a "Refresh
 * metadata not available" card — a dead control that implied the data could be refreshed
 * from here. If an in-app refresh is ever wanted again it needs a new server endpoint, not
 * this button back.
 *
 * With Data Refresh gone the page has NO standard-tier content, which is why `settings` is
 * now a full-access-only menu (see lib/menus fullAccessOnly) — there is nothing to show a
 * user who can see it but wasn't granted it, and the route guard requires the grant.
 */
export default function Settings() {
  // Full access to Settings is what unlocks the Masters tab — and, since Data Refresh went
  // away, the page as a whole. Menu Permissions stays ADMIN-ONLY and deliberately so: it
  // edits other people's profile rows, which RLS on the identity project grants to admins
  // alone (profiles_select / profiles_update_own). A non-admin opening it would see a
  // partial user list and every save would fail — see the note in MenuPermissions.
  const { isAdmin } = useHubMenuAccess();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAdmin ? "Manage masters and menu access" : "Manage masters"}
        </p>
      </div>

      <Tabs defaultValue="masters">
        <TabsList>
          <TabsTrigger value="masters">Masters</TabsTrigger>
          {isAdmin && <TabsTrigger value="menu">Menu Permissions</TabsTrigger>}
        </TabsList>

        {/* ── Masters (admins + anyone granted full Settings access) ─────────── */}
        <TabsContent value="masters" className="mt-4">
          <MusterPanel />
        </TabsContent>

        {/* ── Menu Permissions (admin only) ─────────────────────────────────── */}
        {isAdmin && (
          <TabsContent value="menu" className="mt-4 max-w-5xl">
            <MenuPermissions />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
