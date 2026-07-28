/**
 * Hosts the wizard for three cases: a brand-new customer, resuming a draft, and
 * editing a request that came back for rework.
 *
 * The wizard itself knows nothing about which of the three it is in beyond
 * `mode` — everything else is just initial values.
 */
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, UserPlus } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import WizardShell from "@hub/components/customerOnboarding/WizardShell";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { emptyFormValues, toFormValues } from "@hub/lib/customerOnboarding/schema";
import { formLockReason } from "@hub/lib/customerOnboarding/queues";
import { homeHref, detailHref } from "@hub/lib/customerOnboarding/routes";
import { stageLabel } from "@hub/lib/customerOnboarding/format";

export default function NewCustomer() {
  const { id } = useParams();
  const s = useCustomerStore();

  if (s.loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const existing = id ? s.requestById(id) : undefined;

  // A 'submission' step-owner list, when configured, restricts who may raise.
  if (!existing && !s.canRaise) {
    return (
      <Guard title="You cannot raise new customers">
        Raising a customer is restricted to the people configured as owners of the submission
        step. Ask an administrator if you think you should be one of them.
      </Guard>
    );
  }

  if (id && !existing) {
    return (
      <Guard title="Request not found">
        This request does not exist, or you do not have access to it.
      </Guard>
    );
  }

  if (existing) {
    const lock = formLockReason(existing);
    if (lock) {
      return (
        <Guard title="This request can no longer be edited">
          {lock}{" "}
          <Link to={detailHref(existing.id)} className="text-primary hover:underline">
            View the request
          </Link>.
        </Guard>
      );
    }
    if (!s.canActOn("submission", existing) && !s.isCoordinator) {
      return (
        <Guard title="Not your request">
          Only the person who raised this request can edit it.
        </Guard>
      );
    }
  }

  const isDraft = !existing || existing.status === "draft";

  return (
    <div className="p-6 space-y-5 max-w-[1100px] mx-auto">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1 gap-1 text-muted-foreground">
          <Link to={existing ? detailHref(existing.id) : homeHref()}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <UserPlus className="h-6 w-6 text-primary" />
          {!existing ? "New customer"
            : existing.status === "draft" ? "Continue draft"
            : `Update ${existing.reqNo ?? "request"}`}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Seven short steps. Everything is saved as you go, so you can stop and come back.
        </p>
      </div>

      {existing?.status === "rework" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <div className="flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="text-sm text-amber-900 dark:text-amber-200">
              <p className="font-medium">Sent back by {stageLabel(existing.reworkStage)}</p>
              <p className="mt-0.5">{existing.reworkReason}</p>
              <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
                Fix what they asked for and submit again. It goes back to Accounts first, because
                changing the details makes their earlier checks out of date.
              </p>
            </div>
          </div>
        </div>
      )}

      <WizardShell
        requestId={existing?.id ?? null}
        mode={isDraft ? "draft" : "edit"}
        initialValues={existing ? toFormValues(existing) : emptyFormValues()}
      />
    </div>
  );
}

function Guard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-6 max-w-[720px] mx-auto">
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{children}</p>
          <Button variant="outline" asChild><Link to={homeHref()}>Back to onboarding</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
