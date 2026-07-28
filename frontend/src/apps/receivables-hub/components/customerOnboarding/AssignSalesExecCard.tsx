/**
 * Who owns this customer — settable at ANY point, not only at step 9.
 *
 * A rep is usually known the day the request is raised, and naming them early is
 * what puts the customer on their radar (assignment grants read access and
 * notifies them). Waiting until the ledger exists means the person who will
 * actually service the account cannot see their own customer being onboarded.
 *
 * ⚠ TWO FIELDS, TWO VOCABULARIES — see TallyPanel's header. The portal user
 *   drives notifications and access; the Tally salesperson string is what the
 *   hub's receivables dashboards key on. Neither implies the other.
 */
import { useState } from "react";
import { Loader2, UserCog } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { useToast } from "@hub/hooks/use-toast";
import { PanelField } from "./StepActionPanel";
import { PersonSelect, useOrgPeople } from "./PeoplePicker";
import { useSalespersonNames } from "./TallyPanel";
import { SectionHeading } from "./Readout";
import { useCustomerAction, useCustomerStore } from "@hub/lib/customerOnboarding/store";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";

export default function AssignSalesExecCard({ request }: { request: CustomerRequest }) {
  const r = request;
  const s = useCustomerStore();
  const run = useCustomerAction();
  const { toast } = useToast();
  const people = useOrgPeople();
  const salespeople = useSalespersonNames();

  const [editing, setEditing] = useState(false);
  const [execId, setExecId] = useState<string | null>(r.assignedSalesExecId);
  const [execName, setExecName] = useState(r.assignedSalesExecName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors fms_customer_assign_sales_exec: coordinator, any back-office step
  // owner, or the person who raised it.
  const mayAssign = s.isCoordinator || s.isAnyStepOwner || s.canActOn("submission", r);
  if (!mayAssign && !r.assignedSalesExecName && !r.assignedSalesExecId) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await run(() => s.writes.assignSalesExec(r.id, execId, execName.trim()));
      toast({ title: "Sales executive updated" });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-5">
        <SectionHeading
          right={
            mayAssign && !editing ? (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditing(true)}>
                <UserCog className="h-3.5 w-3.5" />
                {r.assignedSalesExecId || r.assignedSalesExecName ? "Change" : "Assign"}
              </Button>
            ) : undefined
          }
        >
          Sales executive
        </SectionHeading>

        {!editing ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Portal user
              </div>
              <div className="text-sm mt-0.5">
                {r.assignedSalesExecId ? s.personName(r.assignedSalesExecId)
                  : <span className="text-muted-foreground">Nobody assigned</span>}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Salesperson in Tally
              </div>
              <div className="text-sm mt-0.5">
                {r.assignedSalesExecName ?? <span className="text-muted-foreground">Not set</span>}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <PanelField
                id="assign-user"
                label="Portal user"
                hint="Gets the notifications and can see this customer."
              >
                <PersonSelect
                  value={execId}
                  onChange={(id) => setExecId(id)}
                  people={people}
                  disabled={busy}
                  placeholder="Nobody"
                />
              </PanelField>
              <PanelField
                id="assign-tally"
                label="Salesperson in Tally"
                hint="What the receivables dashboards key on."
              >
                <Select
                  value={execName || "__none__"}
                  onValueChange={(v) => setExecName(v === "__none__" ? "" : v)}
                  disabled={busy}
                >
                  <SelectTrigger id="assign-tally"><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    {execName && !salespeople.includes(execName) && (
                      <SelectItem value={execName}>{execName} (not in Tally)</SelectItem>
                    )}
                    {salespeople.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </PanelField>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={busy} className="gap-1.5">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
              </Button>
              <Button
                size="sm" variant="ghost" disabled={busy}
                onClick={() => {
                  setExecId(r.assignedSalesExecId);
                  setExecName(r.assignedSalesExecName ?? "");
                  setEditing(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
