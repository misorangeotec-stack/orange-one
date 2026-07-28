/**
 * Who handles each step.
 *
 * ⚠ AUTHORIZATION COMES SOLELY FROM THE EMPLOYEE LIST.
 *   `department_ids` narrows the picker below and grants NOTHING —
 *   fms_customer_is_step_owner() reads `employee_ids` and nothing else. Adding a
 *   department without adding its people appoints no one, which is exactly why
 *   the department control says so on screen.
 *
 * ⚠ CONFIGURE THESE BEFORE TELLING ANYONE THE MODULE IS LIVE. An unowned step
 *   still accepts requests; they simply arrive and notify nobody, and the first
 *   sign of trouble is a customer nobody onboarded for a fortnight.
 *
 * `submission` is listed too, but it means something different: leave it EMPTY
 * and anyone with hub access may raise a customer (the normal case). Filling it
 * in restricts raising to those people.
 */
import { useEffect, useState } from "react";
import { Loader2, Save, Users } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Label } from "@hub/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { useToast } from "@hub/hooks/use-toast";
import { PeopleMultiSelect, useOrgPeople } from "@hub/components/customerOnboarding/PeoplePicker";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { STEPS, type StepKey } from "@hub/lib/customerOnboarding/steps";
import { useDirectory } from "@/core/platform/store";

const ALL_DEPTS = "__all__";

function StepRow({ step, title, blurb }: { step: StepKey; title: string; blurb: string }) {
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();
  const people = useOrgPeople();
  const { departments } = useDirectory();

  const owner = s.stepOwnerFor(step);
  const [dept, setDept] = useState<string>(owner?.departmentIds[0] ?? ALL_DEPTS);
  const [ids, setIds] = useState<string[]>(owner?.employeeIds ?? []);
  const [busy, setBusy] = useState(false);

  // Re-seed when the appointment genuinely changes underneath (another admin,
  // another tab).
  //
  // ⚠ Keyed on the CONTENTS, not the arrays. The snapshot hands back fresh array
  //   identities on every refetch — and react-query refetches on window focus —
  //   so depending on the arrays themselves would wipe a half-made selection the
  //   moment the admin alt-tabbed away and back.
  const signature = `${(owner?.employeeIds ?? []).join(",")}|${(owner?.departmentIds ?? []).join(",")}`;
  useEffect(() => {
    setIds(owner?.employeeIds ?? []);
    setDept(owner?.departmentIds[0] ?? ALL_DEPTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const dirty =
    JSON.stringify([...ids].sort()) !== JSON.stringify([...(owner?.employeeIds ?? [])].sort()) ||
    (dept === ALL_DEPTS ? [] : [dept]).join() !== (owner?.departmentIds ?? []).join();

  // The filter narrows the CANDIDATES only. Anyone already appointed stays
  // visible whatever department is selected, or narrowing the list would look
  // like it had silently removed them.
  const candidates = people.filter(
    (p) => dept === ALL_DEPTS || p.departmentId === dept || ids.includes(p.id),
  );

  const save = async () => {
    setBusy(true);
    try {
      await run(() =>
        s.writes.setStepOwner(step, {
          departmentIds: dept === ALL_DEPTS ? [] : [dept],
          designationId: null,
          employeeIds: ids,
        }),
      );
      toast({ title: `${title} owners saved` });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{blurb}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <Label className="text-xs font-medium">Narrow the list by department</Label>
          <div className="mt-1.5">
            <Select value={dept} onValueChange={setDept} disabled={busy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DEPTS}>Everyone</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            A filter, not a permission — only the people below are appointed.
          </p>
        </div>

        <div>
          <Label className="text-xs font-medium">People</Label>
          <div className="mt-1.5">
            <PeopleMultiSelect
              value={ids}
              onChange={setIds}
              people={candidates}
              disabled={busy}
              placeholder={step === "submission" ? "Anyone may raise a customer" : "Nobody — this step notifies no one"}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
        </Button>
        {ids.length === 0 && step !== "submission" && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            Nobody is appointed — requests arriving here will notify no one.
          </span>
        )}
      </div>
    </div>
  );
}

const BLURB: Record<StepKey, string> = {
  submission:
    "Leave empty so anyone with access to this module may raise a customer. Fill it in to restrict raising to named people.",
  accounts_verification: "Verify the GST registration and the trade references, and recommend a credit limit.",
  sales_head_approval:   "Grade the customer and approve the recommended credit.",
  director_approval:     "Approve exposures above the credit threshold.",
  tally_creation:        "Create the ledger in Tally and record the customer code.",
};

export default function StepOwnersSection() {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" /> Step owners
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Who handles each hand-off. This is what the database checks and what the
            notifications go to — set it before anyone starts using the module.
          </p>
        </div>
        {STEPS.map((st) => (
          <StepRow key={st.key} step={st.key} title={st.title} blurb={BLURB[st.key]} />
        ))}
      </CardContent>
    </Card>
  );
}
