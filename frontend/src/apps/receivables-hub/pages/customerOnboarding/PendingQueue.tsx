/**
 * The back-office work queues — ONE page for all four steps, keyed by `?step=`.
 *
 * Four routes would be four copies of the same table drifting apart on what a
 * column means, and the sidebar already computes active state for query-string
 * children (that is how the Reports sub-nav works). The step tabs also make the
 * whole pipeline legible from any one of them: you can see the Director queue is
 * empty without navigating to it.
 *
 * ⚠ THE URL IS NOT A PERMISSION. Anyone with hub access can reach
 *   ?step=director_approval. What they get is a read-only list scoped by RLS,
 *   and the action panel on the detail page decides whether they may act. Never
 *   let a queue page imply authority.
 */
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Inbox, Pencil } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@hub/components/ui/tabs";
import RequestTable, { type RequestColumn } from "@hub/components/customerOnboarding/RequestTable";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { OWNED_STEPS, STEPS, stepTitle, type StepKey } from "@hub/lib/customerOnboarding/steps";
import { correctHref, detailHref, settingsHref } from "@hub/lib/customerOnboarding/routes";
import { stageLockReason } from "@hub/lib/customerOnboarding/queues";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";
import {
  colCustomer, colCustomerCode, colDue, colGst, colPlace, colRaisedBy, colRaisedOn,
  colRecommendedLimit, colRef, colRequestedLimit, colSalesExec, colStatus, colTerms,
} from "./columns";

const isStepKey = (v: string | null): v is StepKey =>
  !!v && (OWNED_STEPS as string[]).includes(v);

/** What each queue is actually for, said once at the top of it. */
const BLURB: Record<StepKey, string> = {
  submission: "Requests sitting with the person who raised them.",
  accounts_verification:
    "Check the GST registration and the trade references, then recommend a credit limit.",
  sales_head_approval:
    "Grade the customer and approve the credit Accounts have recommended.",
  director_approval:
    "Approvals above the credit threshold, plus anything the sales head escalated.",
  tally_creation:
    "Approved customers waiting for a ledger. Record the code Tally issues.",
};

export default function PendingQueue() {
  const [params, setParams] = useSearchParams();
  const s = useCustomerStore();

  const raw = params.get("step");
  const step: StepKey = isStepKey(raw) ? raw : "accounts_verification";

  const pending = useMemo(() => s.queueFor(step).map((e) => e.request), [s, step]);
  const completed = useMemo(() => s.completedFor(step), [s, step]);

  /** Correct a step already recorded — shown only when the server would allow it. */
  const colCorrect: RequestColumn<CustomerRequest> = {
    key: "correct",
    header: "",
    cell: (r) => {
      if (!s.canActOn(step, r) || stageLockReason(step, r) !== null) return null;
      return (
        <Button
          variant="ghost" size="sm" asChild
          className="h-auto py-1 px-2 gap-1 text-xs font-normal"
          onClick={(e) => e.stopPropagation()}
        >
          <Link to={correctHref(r.id, step)}><Pencil className="h-3 w-3" /> Correct</Link>
        </Button>
      );
    },
  };

  const pendingColumns =
    step === "tally_creation"
      ? [colRef, colCustomer, colGst, colPlace, colTerms, colRecommendedLimit,
         colDue(s.dueIsoFor), colRaisedBy, colStatus]
      : step === "director_approval"
        ? [colRef, colCustomer, colPlace, colTerms, colRequestedLimit, colRecommendedLimit,
           colDue(s.dueIsoFor), colRaisedBy, colStatus]
        : [colRef, colCustomer, colPlace, colTerms, colRequestedLimit,
           colDue(s.dueIsoFor), colRaisedBy, colRaisedOn, colStatus];

  const completedColumns =
    step === "tally_creation"
      ? [colRef, colCustomer, colCustomerCode, colGst, colSalesExec, colRaisedOn, colStatus, colCorrect]
      : [colRef, colCustomer, colPlace, colRecommendedLimit, colRaisedBy, colRaisedOn, colStatus, colCorrect];

  if (s.loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (s.error) {
    return (
      <div className="p-6">
        <Card><CardContent className="p-6 text-sm text-destructive">{s.error}</CardContent></Card>
      </div>
    );
  }

  // Step-level, not row-level: for every owned step canActOn() reduces to
  // "coordinator, or an owner of this step" — it never looks at the row.
  const mayAct = s.isCoordinator || s.isStepOwner(step);
  const owners = s.stepOwnerIds(step);

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Inbox className="h-6 w-6 text-primary" /> {stepTitle(step)}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{BLURB[step]}</p>
      </div>

      {/* Switching queue is a URL change, so the sidebar's active child stays in
          step and the view is linkable. */}
      <div className="flex flex-wrap gap-2">
        {OWNED_STEPS.map((k) => {
          const n = s.queueFor(k).length;
          const on = k === step;
          return (
            <Button
              key={k}
              variant={on ? "default" : "outline"}
              size="sm"
              onClick={() => setParams({ step: k }, { replace: true })}
              className="gap-2"
            >
              {STEPS.find((x) => x.key === k)?.short}
              <span
                className={
                  on
                    ? "rounded-full bg-primary-foreground/20 px-1.5 text-[11px] tabular-nums"
                    : "rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground"
                }
              >
                {n}
              </span>
            </Button>
          );
        })}
      </div>

      {/* An unowned step notifies nobody, which is invisible until someone
          wonders why nothing ever arrives. Say it here. */}
      {owners.length === 0 && s.isAdmin && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Nobody is configured to handle this step, so requests arriving here notify no one.
          Set the owners in <Link to={settingsHref()} className="underline font-medium">Onboarding settings</Link>.
        </div>
      )}

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
          <TabsTrigger value="completed">Completed{completed.length ? ` (${completed.length})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <Card><CardContent className="p-5">
            <RequestTable
              rows={pending}
              columns={pendingColumns}
              rowHref={(r) => detailHref(r.id)}
              searchPlaceholder="Search by name, GST, city, request number…"
              empty={
                mayAct
                  ? "Nothing is waiting at this step."
                  : "Nothing is waiting at this step — and this queue is not yours to action."
              }
            />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          <Card><CardContent className="p-5">
            <RequestTable
              rows={completed}
              columns={completedColumns}
              rowHref={(r) => detailHref(r.id)}
              searchPlaceholder="Search finished requests…"
              exportName={`${stepTitle(step).replace(/\s+/g, "-")}-completed`}
              empty="Nothing has been through this step yet."
            />
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
