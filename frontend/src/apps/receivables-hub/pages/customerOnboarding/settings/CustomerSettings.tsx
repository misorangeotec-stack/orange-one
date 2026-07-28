/**
 * Customer Onboarding → Settings.
 *
 * ⚠ ADMIN AND COORDINATOR ONLY, and the guard here is a courtesy: every write on
 *   this page goes to a table whose RLS policy is admin-only
 *   (fms_customer_step_owners, fms_customer_config) or to an admin-only RPC. A
 *   non-admin who reaches this URL gets a read-only screen and a rejected write,
 *   not a hole.
 *
 * Deliberately its own page rather than a tab on the hub's Settings screen: that
 * one is built around the receivables pipeline (refresh, masters, menu
 * permissions) and loads useAppData, which this module must never touch.
 */
import { Link } from "react-router-dom";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { homeHref } from "@hub/lib/customerOnboarding/routes";
import StepOwnersSection from "./StepOwnersSection";
import ApprovalRulesSection from "./ApprovalRulesSection";
import StepDueDatesSection from "./StepDueDatesSection";
import CoordinatorsSection from "./CoordinatorsSection";
import NotificationsSection from "./NotificationsSection";

export default function CustomerSettings() {
  const s = useCustomerStore();

  if (s.loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  if (!s.isAdmin) {
    return (
      <div className="p-6 max-w-[720px] mx-auto">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <h1 className="text-lg font-semibold">Administrators only</h1>
            <p className="text-sm text-muted-foreground">
              Step owners, approval rules and due dates are set by an administrator.
            </p>
            <Button variant="outline" asChild><Link to={homeHref()}>Back to onboarding</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-[1000px] mx-auto">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1 gap-1 text-muted-foreground">
          <Link to={homeHref()}><ArrowLeft className="h-4 w-4" /> Customer onboarding</Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-primary" /> Onboarding settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Who handles each step, when a Director must approve, and how long each step gets.
        </p>
      </div>

      {/* Owners first: it is the one setting the module cannot function without. */}
      <StepOwnersSection />
      <ApprovalRulesSection />
      <StepDueDatesSection />
      <CoordinatorsSection />
      <NotificationsSection />
    </div>
  );
}
